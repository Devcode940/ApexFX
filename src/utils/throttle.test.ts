import { describe, it, expect } from 'vitest';
import { createLeadingThrottle, type TimerLike } from './throttle';

/** Deterministic clock+timer harness: time only moves when the test says so. */
function fakeClock(start = 0) {
  let now = start;
  const queue: Array<{ id: number; at: number; cb: () => void }> = [];
  let seq = 0;
  const timers: TimerLike = {
    now: () => now,
    set: (cb, ms) => { queue.push({ id: ++seq, at: now + ms, cb }); return seq; },
    clear: (id) => { const i = queue.findIndex(q => q.id === id); if (i >= 0) queue.splice(i, 1); },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = queue.filter(q => q.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      queue.splice(queue.indexOf(due), 1);
      due.cb();
    }
    now = target;
  };
  return { timers, advance, pending: () => queue.length };
}

describe('createLeadingThrottle', () => {
  it('runs immediately when the window has passed', () => {
    const { timers } = fakeClock();
    let n = 0;
    const t = createLeadingThrottle(() => { n++; }, 500, timers);
    t.schedule();
    expect(n).toBe(1);
  });

  it('defers calls inside the window, then runs once', () => {
    const { timers, advance } = fakeClock();
    let n = 0;
    const t = createLeadingThrottle(() => { n++; }, 500, timers);
    t.schedule();            // leading
    t.schedule();            // deferred
    expect(n).toBe(1);
    advance(500);
    expect(n).toBe(2);       // exactly one trailing run
  });

  it('collapses a burst without losing the last update (the point of a trailing call)', () => {
    const { timers, advance, pending } = fakeClock();
    let last = 0; let runs = 0;
    const t = createLeadingThrottle(() => { runs++; last = timers.now(); }, 500, timers);
    for (let ms = 0; ms <= 400; ms += 20) { advance(20); t.schedule(); }
    expect(runs).toBe(1);            // leading only, so far
    expect(pending()).toBe(1);       // exactly one trailing pending, however many calls
    advance(500);
    expect(runs).toBe(2);
    // 520, not 500: the window is anchored to the LEADING run (20ms) + 500, so a later call in the burst
    // cannot push it out. The trailing run still reads the clock at 520 -> latest state wins.
    expect(last).toBe(520);
  });

  it('does not let a burst push the trailing call further out', () => {
    const { timers, advance } = fakeClock();
    const at: number[] = [];
    const t = createLeadingThrottle(() => at.push(timers.now()), 500, timers);
    t.schedule();          // runs at 0
    t.schedule();          // trailing scheduled for 500
    advance(400); t.schedule();  // must NOT move the pending run to 900
    advance(100);
    expect(at).toEqual([0, 500]);
  });

  it('cancel() drops the pending run (unmount safety)', () => {
    const { timers, advance, pending } = fakeClock();
    let n = 0;
    const t = createLeadingThrottle(() => { n++; }, 500, timers);
    t.schedule(); t.schedule();
    t.cancel();
    expect(pending()).toBe(0);
    advance(1000);
    expect(n).toBe(1);
  });

  it('keeps running on the leading edge once the window has elapsed again', () => {
    const { timers, advance } = fakeClock();
    let n = 0;
    const t = createLeadingThrottle(() => { n++; }, 500, timers);
    for (let i = 0; i < 5; i++) { t.schedule(); advance(600); }
    expect(n).toBe(5);     // never deferred: each call is outside the window
  });
});
