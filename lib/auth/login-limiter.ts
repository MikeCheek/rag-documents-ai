// Limits failed sign-in attempts per client, so the password can't be
// guessed quickly: after MAX_FAILURES failures within WINDOW_MS, that
// client is refused until the oldest failure ages out. In-process, which
// is right for the single-server deployment this app targets.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

/** Milliseconds until this client may try again, or 0 if it may now. */
export function retryAfterMs(key: string, now = Date.now()): number {
  const list = recent(key, now);
  return list.length >= MAX_FAILURES ? list[0] + WINDOW_MS - now : 0;
}

export function recordFailure(key: string, now = Date.now()) {
  failures.set(key, [...recent(key, now), now]);
}

export function clearFailures(key: string) {
  failures.delete(key);
}
