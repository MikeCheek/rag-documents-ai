// A simple, in-process sliding-window limiter for outgoing calls to a
// rate-limited provider (OpenRouter, Cohere) — proactively waits for a
// free slot before a call is made, using the same "calls per minute"
// concept the Ledger already tracks and displays, rather than only
// discovering the limit was hit after the provider rejects the request
// with a 429. This is a separate, in-memory mechanism from the api_calls
// table's historical logging (used for the Ledger's charts) — the two
// stay numerically consistent in practice since every gated call that
// proceeds also gets logged afterward, but they serve different purposes
// (proactive real-time gating vs. persisted historical reporting) and
// aren't unified into one source of truth.
//
// In-process/in-memory: correct for the documented single-process
// deployment (`npm run dev` / a single self-hosted Node server) — not
// synchronized across multiple serverless instances if deployed that way.

export type WaitCallback = (waitMs: number) => void;

class SlidingWindowLimiter {
  private timestamps: number[] = [];

  constructor(private windowMs: number) {}

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  /**
   * Resolves once a call is safe to make under `limit` calls per window,
   * reserving the slot before returning. A limit of 0/undefined disables
   * throttling entirely (an unconfigured/unlimited provider). Waits
   * longer than 5s are chunked into repeated short sleeps so `onWait` can
   * keep reporting an updated remaining time rather than going silent for
   * the whole duration.
   */
  async waitForSlot(limit: number | undefined, onWait?: WaitCallback): Promise<void> {
    if (!limit || limit <= 0) return;

    while (true) {
      const now = Date.now();
      this.prune(now);

      if (this.timestamps.length < limit) {
        this.timestamps.push(now);
        return;
      }

      const waitMs = Math.max(0, this.timestamps[0] + this.windowMs - now) + 25;
      onWait?.(waitMs);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
    }
  }
}

export const openrouterLimiter = new SlidingWindowLimiter(60_000);
export const cohereLimiter = new SlidingWindowLimiter(60_000);
