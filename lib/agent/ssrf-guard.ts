import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

// Guards custom (user-defined) tool HTTP calls against being pointed at
// internal/private network addresses. This matters even for a
// single-user, self-hosted app: the *agent*, not just the user, decides
// when to call a tool and with what arguments, and a prompt injected into
// a retrieved document could try to steer it toward an internal address.
//
// Checking a URL up front isn't enough on its own, for two reasons this
// module handles:
//  - DNS rebinding: a hostname can resolve to a public IP when checked and
//    to 127.0.0.1 a moment later when the request actually connects. So
//    the check runs inside the socket's own DNS lookup — the address that
//    gets validated is the address that gets connected to.
//  - Redirects: fetch() follows them silently, so a public URL answering
//    "302 -> http://169.254.169.254/" would bypass a one-time check.
//    Redirects are followed manually here, re-checking every hop.

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);
const MAX_REDIRECTS = 5;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expands any valid IPv6 string to its 8 hextets (handles `::` and embedded IPv4). */
function ipv6Hextets(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    addr = addr.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = addr.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (addr.includes("::") ? missing < 1 : missing !== 0) return null;
  const parts = [...headParts, ...Array(addr.includes("::") ? missing : 0).fill("0"), ...tailParts];
  const nums = parts.map((h) => parseInt(h, 16));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

function isPrivateIPv6(ip: string): boolean {
  const h = ipv6Hextets(ip);
  if (!h) return true; // unparseable — refuse rather than guess
  if (h.every((x) => x === 0)) return true; // :: unspecified
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1 loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    return isPrivateIPv4(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
  }
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

function hostOf(url: URL): string {
  // URL keeps brackets around IPv6 literals ("[::1]"); net.isIP doesn't want them.
  return url.hostname.replace(/^\[|\]$/g, "");
}

/** Static checks on a URL: scheme, blocked hostnames, and IP literals. */
export function assertSafeToolUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed for tool calls.");
  }

  const host = hostOf(url).toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost")) {
    throw new Error(`Refusing to call blocked host: ${url.hostname}`);
  }

  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error(`Refusing to call a private/internal address: ${url.hostname}`);
  }

  return url;
}

/**
 * DNS lookup used by the outgoing socket itself: resolves normally, then
 * refuses to hand back any private address. Because the connection uses
 * exactly the address returned here, there's no window between check and
 * connect for the DNS answer to change.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => isPrivateIp(a.address));
    if (list.length === 0 || blocked) {
      const e = new Error(
        list.length === 0
          ? `Could not resolve host: ${hostname}`
          : `Refusing to call ${hostname}: it resolves to a private/internal address.`
      );
      return (callback as any)(e);
    }
    if ((options as any)?.all) return (callback as any)(null, list);
    (callback as any)(null, list[0].address, list[0].family);
  });
};

export type GuardedResponse = { status: number; ok: boolean; text: string };

function requestOnce(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; maxBytes: number }
): Promise<{ status: number; location?: string; text: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: init.method,
        headers: init.headers,
        lookup: guardedLookup,
        signal: init.signal,
        // A fresh agent per request: a pooled keep-alive socket could
        // otherwise be reused without going through the lookup again.
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, text: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size >= init.maxBytes) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= init.maxBytes) res.destroy();
        });
        const finish = () =>
          resolve({ status, text: Buffer.concat(chunks).toString("utf-8").slice(0, init.maxBytes) });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/**
 * fetch()-like request for model-initiated tool calls, with every hop
 * (the original URL and each redirect target) checked statically and at
 * connect time. Reads at most `maxBytes` of the response body.
 */
export async function guardedRequest(
  rawUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
  } = {}
): Promise<GuardedResponse> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let method = options.method ?? "GET";
  let body = options.body;
  let headers = options.headers ?? {};
  let url = assertSafeToolUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, {
      method,
      headers,
      body,
      signal,
      maxBytes: options.maxBytes ?? 1_000_000,
    });

    if (!res.location) {
      return { status: res.status, ok: res.status >= 200 && res.status < 300, text: res.text };
    }

    const next = assertSafeToolUrl(new URL(res.location, url).toString());
    // A custom tool's static headers often carry an API key; like fetch,
    // don't forward them to a different origin.
    if (next.origin !== url.origin) headers = {};
    url = next;
    // Same semantics as fetch: 303 (and 301/302 after a POST) become GET.
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }

  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}
