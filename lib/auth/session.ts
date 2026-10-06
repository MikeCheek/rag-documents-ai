// Sign-in sessions for the optional password protection (APP_PASSWORD).
//
// A session is a signed cookie: base64url(JSON payload) + "." +
// base64url(HMAC-SHA256(key, payload)). No server-side session store is
// needed, and it verifies in the edge middleware and Node routes alike
// (Web Crypto only).
//
// The signing key is APP_SESSION_SECRET when set, otherwise derived from
// the username and password themselves, so changing the password signs
// out every existing session.

export const SESSION_COOKIE = "rr_session";
export const SESSION_DAYS_REMEMBERED = 30;
export const SESSION_HOURS_DEFAULT = 12;

export type AuthConfig = { username: string; password: string; secret?: string };

export type SessionPayload = { u: string; exp: number };

/** The configured credentials, or null when password protection is off. */
export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const password = env.APP_PASSWORD;
  if (!password) return null;
  return { username: env.APP_USERNAME || "admin", password, secret: env.APP_SESSION_SECRET || undefined };
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function signingKey(config: AuthConfig): Promise<CryptoKey> {
  const material = config.secret ?? `reading-room-session\u0000${config.username}\u0000${config.password}`;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(config: AuthConfig, maxAgeSeconds: number, now = Date.now()): Promise<string> {
  const payload: SessionPayload = { u: config.username, exp: Math.floor(now / 1000) + maxAgeSeconds };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(config), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The session's payload if the token is authentic, unexpired and for the current user; else null. */
export async function verifySessionToken(config: AuthConfig, token: string | undefined, now = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    // crypto.subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify("HMAC", await signingKey(config), fromBase64Url(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    if (payload.u !== config.username) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (length is the only thing timing can reveal). */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Where to go after signing in: only a path on this site. Anything else
 * ("//evil.com", "https://...", "/\\evil.com") falls back to "/", so the
 * login page can't be used to redirect people elsewhere.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/api/")) return "/";
  return next;
}
