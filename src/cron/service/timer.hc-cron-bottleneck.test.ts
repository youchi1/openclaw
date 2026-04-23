/**
 * HC-008: Cron concurrency bottleneck and stale runningAtMs tests.
 *
 * Four issues:
 * 1. runningAtMs set on ALL due jobs before workers start (timer.ts:698)
 * 2. CommandLane.Nested maxConcurrent=1 serializes all cron LLM work (server-lanes.ts)
 * 3. forceReload in applyOutcomeToStoredJob can lose runningAtMs clears (timer.ts:571)
 * 4. STUCK_RUN_MS = 2h is too slow for recovery (jobs.ts:38)
 */
import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createDueIsolatedJob,
  noopLogger,
  setupCronRegressionFixtures,
  writeCronJobs,
} from "../../../test/helpers/cron/service-regression-fixtures.js";
import { applyGatewayLaneConcurrency } from "../../gateway/server-lanes.js";
import { getCommandLaneSnapshot } from "../../process/command-queue.js";
import { CommandLane } from "../../process/lanes.js";
import type { CronJob } from "../types.js";
import { createCronServiceState } from "./state.js";
import { applyJobResult, onTimer } from "./timer.js";

const fixtures = setupCronRegressionFixtures({
  prefix: "cron-hc008-bottleneck-",
});

describe("HC-008: cron concurrency bottleneck", () => {
  // Issue 1: runningAtMs is set on ALL due jobs at timer.ts:698 before workers
  // start executing. Jobs beyond maxConcurrentRuns show "running" in the UI
  // while actually waiting for a worker slot. The Phase-1 persist (line 701)
  // writes this state to disk, which is what cron.list / the UI reads.
  //
  // We test this by checking the persisted state after the Phase-1 persist:
  // only maxConcurrentRuns jobs should have runningAtMs set on disk.
  it("only sets runningAtMs on jobs that will start immediately, not all due jobs", async () => {
    const store = fixtures.makeStorePath();
    const now = Date.parse("2026-04-23T12:00:00.000Z");
    const maxConcurrentRuns = 2;
    const jobCount = 4;

    // Capture the persisted state after Phase-1 persist (before any job runs)
    let phase1PersistedJobs: CronJob[] | undefined;

    const runIsolatedAgentJob = vi.fn(async () => {
      // On first call, read the file to capture Phase-1 persisted state
      if (!phase1PersistedJobs) {
        const data = JSON.parse(await fs.readFile(store.storePath, "utf8")) as { jobs: CronJob[] };
        phase1PersistedJobs = data.jobs;
      }
      return { status: "ok" as const, summary: "done" };
    });

    const jobs = Array.from({ length: jobCount }, (_, i) =>
      createDueIsolatedJob({
        id: `job-${i}`,
        nowMs: now,
        nextRunAtMs: now - 1,
      }),
    );
    await writeCronJobs(store.storePath, jobs);

    const state = createCronServiceState({
      cronEnabled: true,
      cronConfig: { maxConcurrentRuns },
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob,
    });

    await onTimer(state);

    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(jobCount);
    expect(phase1PersistedJobs).toBeDefined();

    // Count how many jobs had runningAtMs set in the Phase-1 persisted state
    const runningCount = phase1PersistedJobs!.filter(
      (j) => typeof j.state.runningAtMs === "number",
    ).length;

    // BUG: currently all 4 get runningAtMs at timer.ts:698 before any worker starts.
    // EXPECTED: only maxConcurrentRuns (2) jobs should have runningAtMs on disk.
    expect(
      runningCount,
      `Phase-1 persist had ${runningCount} jobs with runningAtMs (expected <= ${maxConcurrentRuns})`,
    ).toBeLessThanOrEqual(maxConcurrentRuns);
  });

  // Issue 2: HC-008 part 2 — Nested lane concurrency.
  //
  // Originally, applyGatewayLaneConcurrency did not configure CommandLane.Nested,
  // leaving its maxConcurrent at 1 and serializing all cron-inner LLM work.
  //
  // Upstream 2026.4.27 introduced a dedicated CommandLane.CronNested (separate
  // from the generic Nested used by subagents/A2A) and wires it explicitly. We
  // dropped our patch's `setCommandLaneConcurrency(Nested, …)` modification in
  // favour of upstream's CronNested wiring. The wiring itself is verified by
  // src/gateway/server-lanes.hc-cron-nested.test.ts. This test now only sanity-
  // checks that the CronNested lane is reachable from the cron path.
  it("CronNested lane is the inner lane used by isolated cron runs", async () => {
    applyGatewayLaneConcurrency({
      cron: { maxConcurrentRuns: 6 },
    } as never);

    const snapshot = getCommandLaneSnapshot(CommandLane.CronNested);
    expect(snapshot.maxConcurrent).toBe(6);
  });

  // Issue 3: applyJobResult (which clears runningAtMs) only runs inside the
  // locked block at timer.ts:770. If the completion persist at line 782 fails
  // (disk error, permissions), the in-memory runningAtMs is cleared but the
  // on-disk state retains the stale marker from the Phase-1 persist (line 701).
  // On next timer tick, forceReload reads the stale disk state, and the job
  // appears stuck for up to STUCK_RUN_MS.
  //
  // More practically: the Phase-1 persist (line 701) sets runningAtMs on ALL
  // due jobs at once and writes to disk. If the process crashes or the
  // completion persist fails, ALL those jobs have stale runningAtMs on disk.
  // We test that applyJobResult clears runningAtMs correctly in the normal
  // path and that the in-memory state is consistent.
  it("applyJobResult clears runningAtMs on completed job", () => {
    const now = Date.parse("2026-04-23T12:00:00.000Z");
    const job: CronJob = createDueIsolatedJob({
      id: "test-job",
      nowMs: now,
      nextRunAtMs: now - 1,
    });
    // Simulate the job being in "running" state
    job.state.runningAtMs = now;

    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/unused",
      log: noopLogger,
      nowMs: () => now + 60_000,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({
        status: "ok" as const,
        summary: "done",
      })),
    });

    applyJobResult(state, job, {
      status: "ok",
      startedAt: now,
      endedAt: now + 60_000,
    });

    // runningAtMs must be cleared
    expect(job.state.runningAtMs).toBeUndefined();
    expect(job.state.lastStatus).toBe("ok");
    expect(job.state.lastDurationMs).toBe(60_000);
  });

  // Issue 4: When runningAtMs gets stuck, the only automatic recovery is
  // normalizeJobTickState which checks STUCK_RUN_MS = 2 * 60 * 60 * 1000 (2 hours).
  // For cron jobs that typically run in minutes, 2 hours is far too long.
  it("clears stuck runningAtMs faster than 2 hours for jobs with known duration", async () => {
    const store = fixtures.makeStorePath();
    const now = Date.parse("2026-04-23T12:00:00.000Z");

    // Create a job that previously ran for 60 seconds, stuck for 30 minutes
    const job: CronJob = {
      id: "fast-job",
      name: "fast-job",
      enabled: true,
      createdAtMs: now - 86_400_000,
      updatedAtMs: now - 86_400_000,
      schedule: {
        kind: "every",
        everyMs: 3_600_000,
        anchorMs: now - 86_400_000,
      },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "fast job" },
      delivery: { mode: "none" },
      state: {
        // Stuck: runningAtMs was set 30 minutes ago but job typically takes 60s
        runningAtMs: now - 30 * 60 * 1000,
        lastDurationMs: 60_000,
        nextRunAtMs: now - 1,
      },
    };

    await writeCronJobs(store.storePath, [job]);

    const state = createCronServiceState({
      cronEnabled: true,
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({
        status: "ok" as const,
        summary: "done",
      })),
    });

    await onTimer(state);

    // The stuck marker should be cleared on this tick. Upstream's
    // alreadyExecutedSlot logic (added in 2026.5.x) defers re-execution to the
    // next tick when lastRun < nextRun, so we only assert the stuck-clear here.
    // BUG before HC-008: STUCK_RUN_MS is flat 2h, so at 30 minutes the marker
    // is NOT cleared and the job stays stuck for hours.
    const persisted = JSON.parse(await fs.readFile(store.storePath, "utf8")) as { jobs: CronJob[] };
    const persistedJob = persisted.jobs.find((j) => j.id === "fast-job");

    expect(persistedJob?.state.runningAtMs).toBeUndefined();
  });
});
