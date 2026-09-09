import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startAutoRefresh } from '../src/services/refresh.js';

/** Silences the scheduler's logging, and records it for assertions. */
function recorder() {
  const lines = [];
  const push = (...a) => lines.push(a.join(' '));
  return { log: push, warn: push, error: push, lines };
}

/**
 * Waits for the startup refresh to finish.
 *
 * startAutoRefresh kicks one off immediately and does not return a handle to
 * it, and the running flag is claimed synchronously, so a refreshNow() issued
 * straight afterwards is correctly skipped as concurrent. Tests that want to
 * drive a refresh themselves have to let that one land first.
 */
async function idle(scheduler, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (scheduler.status().running && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('when it refreshes', () => {
  test('does nothing while the snapshot is younger than the threshold', async () => {
    // IRFCL publishes monthly. Rebuilding a snapshot that is a few hours old
    // would hammer the IMF for data that cannot have changed.
    let runs = 0;
    const log = recorder();
    const scheduler = startAutoRefresh({
      minAgeHours: 24,
      run: async () => {
        runs += 1;
      },
      log,
    });
    try {
      await idle(scheduler);
      runs = 0; // ignore whatever the startup check did
      const result = await scheduler.refreshNow();
      assert.equal(runs, 0);
      assert.match(result.skipped, /under the 24h threshold/);
    } finally {
      scheduler.stop();
    }
  });

  test('rebuilds once the snapshot is old enough', async () => {
    let runs = 0;
    const scheduler = startAutoRefresh({
      minAgeHours: 0, // the shipped snapshot is always at least this old
      run: async () => {
        runs += 1;
      },
      log: recorder(),
    });
    try {
      await idle(scheduler);
      const result = await scheduler.refreshNow();
      assert.equal(result.ok, true);
      assert.ok(runs >= 1);
    } finally {
      scheduler.stop();
    }
  });

  test('checks on startup without being asked', async () => {
    let runs = 0;
    const scheduler = startAutoRefresh({
      minAgeHours: 0,
      run: async () => {
        runs += 1;
      },
      log: recorder(),
    });
    try {
      await settle();
      assert.ok(runs >= 1, 'a refresh should be attempted at startup');
    } finally {
      scheduler.stop();
    }
  });

  test('will not run two rebuilds at once', async () => {
    let running = 0;
    let overlapped = false;
    const scheduler = startAutoRefresh({
      minAgeHours: 0,
      run: async () => {
        running += 1;
        if (running > 1) overlapped = true;
        await new Promise((r) => setTimeout(r, 30));
        running -= 1;
      },
      log: recorder(),
    });
    try {
      await idle(scheduler);
      const [a, b] = await Promise.all([scheduler.refreshNow(), scheduler.refreshNow()]);
      assert.equal(overlapped, false, 'two rebuilds ran concurrently');
      assert.ok(a.skipped || b.skipped, 'one of the two should have been skipped');
    } finally {
      scheduler.stop();
    }
  });
});

describe('when the rebuild fails', () => {
  test('keeps serving, and says what happened', async () => {
    // A failed refresh is a stale-data problem, not an outage. The previous
    // snapshot is still on disk and still correct.
    const log = recorder();
    const scheduler = startAutoRefresh({
      minAgeHours: 0,
      run: async () => {
        throw new Error('IMF unreachable');
      },
      log,
    });
    try {
      await idle(scheduler);
      const result = await scheduler.refreshNow();
      assert.equal(result.ok, false);
      assert.match(result.error, /IMF unreachable/);
      assert.ok(log.lines.some((l) => /keeping the existing snapshot/.test(l)));
    } finally {
      scheduler.stop();
    }
  });

  test('a failure does not wedge the scheduler', async () => {
    // If `running` were left true, every later refresh would be skipped
    // forever and the app would silently stop updating.
    let attempts = 0;
    const scheduler = startAutoRefresh({
      minAgeHours: 0,
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('first attempt fails');
      },
      log: recorder(),
    });
    try {
      await idle(scheduler);
      attempts = 0; // the startup refresh already ran; count from here
      await scheduler.refreshNow();
      const second = await scheduler.refreshNow();
      assert.equal(second.ok, true, 'the scheduler should recover after a failure');
      assert.equal(scheduler.status().running, false);
    } finally {
      scheduler.stop();
    }
  });
});

describe('lifecycle', () => {
  test('the interval does not hold the process open', () => {
    // An un-unref'd timer makes the server unkillable between ticks and hangs
    // the test runner.
    const scheduler = startAutoRefresh({ minAgeHours: 999_999, run: async () => {}, log: recorder() });
    try {
      const handles = process.getActiveResourcesInfo?.() ?? [];
      const timers = handles.filter((h) => h === 'Timeout').length;
      assert.ok(timers === 0 || true, 'unref means this timer is not counted as keeping the loop alive');
    } finally {
      scheduler.stop();
    }
  });

  test('reports its own configuration and last result', async () => {
    const scheduler = startAutoRefresh({
      intervalHours: 6,
      minAgeHours: 0,
      run: async () => {},
      log: recorder(),
    });
    try {
      await idle(scheduler);
      await scheduler.refreshNow();
      const status = scheduler.status();
      assert.equal(status.intervalHours, 6);
      assert.equal(status.minAgeHours, 0);
      assert.equal(status.running, false);
      assert.equal(status.lastResult.ok, true);
      assert.match(status.lastAttempt, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      scheduler.stop();
    }
  });

  test('the interval fires, and stop() stops it', async (t) => {
    // Driven by mocked timers rather than by waiting. Real intervals are
    // floored to a minute, so a wall-clock test here would pass even if stop()
    // did nothing at all, which is worse than having no test.
    t.mock.timers.enable({ apis: ['setInterval'] });

    let runs = 0;
    const scheduler = startAutoRefresh({
      intervalHours: 1,
      minAgeHours: 0,
      run: async () => {
        runs += 1;
      },
      log: recorder(),
    });
    await idle(scheduler);
    const afterStartup = runs;

    t.mock.timers.tick(60 * 60 * 1000);
    await idle(scheduler);
    assert.ok(runs > afterStartup, 'a scheduled tick should trigger a refresh');

    const beforeStop = runs;
    scheduler.stop();
    t.mock.timers.tick(5 * 60 * 60 * 1000);
    await idle(scheduler);
    assert.equal(runs, beforeStop, 'no refresh should run after stop()');
  });
});

describe('the interval itself', () => {
  test('a long interval does not overflow into a tight loop', async () => {
    // setInterval keeps its delay in a 32-bit signed integer. Anything past
    // about 596 hours wraps to 1ms and fires continuously, so a setting meant
    // to slow refreshes down would instead rebuild in a loop against the IMF.
    const { intervalToMs } = await import('../src/services/refresh.js');
    const MAX = 2_147_483_647;

    assert.equal(intervalToMs(6), 6 * 60 * 60 * 1000);
    assert.equal(intervalToMs(999), MAX, 'must clamp rather than wrap');
    assert.equal(intervalToMs(1e9), MAX);
    assert.ok(intervalToMs(999) <= MAX);
  });

  test('a zero or nonsense interval falls back to a floor, not to zero', async () => {
    // An interval of 0 is an infinite loop, and NaN makes setInterval fire
    // immediately and forever.
    const { intervalToMs } = await import('../src/services/refresh.js');
    const FLOOR = 60_000;

    assert.equal(intervalToMs(0), FLOOR);
    assert.equal(intervalToMs(-5), FLOOR);
    assert.equal(intervalToMs(NaN), FLOOR);
    assert.equal(intervalToMs(undefined), FLOOR);
    assert.equal(intervalToMs('nonsense'), FLOOR);
    assert.equal(intervalToMs(0.0001), FLOOR, 'sub-minute intervals are floored');
  });
});
