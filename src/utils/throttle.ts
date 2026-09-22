/**
 * Leading-edge throttle with a single trailing call (2026-09-16, ported from the merged review pass's
 * 500 ms P&L tick coalescing, extracted so the *rule* is testable rather than implicit in a hook).
 *
 * Why this shape: a burst of feed updates should not re-derive the whole book per message, but the last
 * update in a burst must still be applied - a plain "drop calls inside the window" throttle loses the
 * final price, which for mark-to-market is exactly the one that matters.
 *
 * Timers and the clock are injected so tests are deterministic (no fake-timer machinery, no sleeps).
 */
export interface TimerLike {
  now(): number;
  set(cb: () => void, ms: number): number;
  clear(id: number): void;
}

export const realTimers: TimerLike = {
  now: () => Date.now(),
  set: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
};

export interface Throttle {
  /** Run now (window elapsed) or schedule exactly one trailing run. Extra calls never extend the window. */
  schedule(): void;
  /** Drop a pending trailing run (call from an effect cleanup, so unmounting cannot setState). */
  cancel(): void;
}

export function createLeadingThrottle(run: () => void, windowMs: number, timers: TimerLike = realTimers): Throttle {
  let lastRun = -Infinity;
  let pending: number | null = null;

  const invoke = () => {
    pending = null;
    lastRun = timers.now();
    run();
  };

  return {
    schedule() {
      if (pending !== null) return; // one trailing call is already queued; do not push it later
      const since = timers.now() - lastRun;
      if (since >= windowMs) {
        invoke();
        return;
      }
      pending = timers.set(invoke, windowMs - since);
    },
    cancel() {
      if (pending !== null) {
        timers.clear(pending);
        pending = null;
      }
    },
  };
}
