import dns from "node:dns/promises";
import net from "node:net";

// Guards custom (user-defined) tool HTTP calls against being pointed at
// internal/private network addresses. This matters even for a
// single-user, self-hosted app: the *agent*, not just the user, decides
// when to call a tool and with what arguments, and a prompt injected into
// a retrieved document could try to steer it toward an internal address.

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIPv4(normalized.slice("::ffff:".length));
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

export async function assertSafeToolUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed for tool calls.");
  }

  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to call blocked host: ${url.hostname}`);
  }

  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) {
      throw new Error(`Refusing to call a private/internal address: ${url.hostname}`);
    }
    return url;
  }

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${url.hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(
        `Refusing to call ${url.hostname}: it resolves to a private/internal address.`
      );
    }
  }

  return url;
}
