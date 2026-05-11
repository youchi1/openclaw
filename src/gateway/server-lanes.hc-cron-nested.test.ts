/**
 * HC-008 part 2 regression: cron nested-LLM concurrency must follow
 * cfg.cron.maxConcurrentRuns.
 *
 * Original bug: CommandLane.Nested (used by cron isolated-agent runs via
 * resolveNestedAgentLane) defaulted to maxConcurrent=1 and was never set by
 * applyGatewayLaneConcurrency. With cron.maxConcurrentRuns=6, only one cron
 * job's inner LLM work could execute at a time.
 *
 * Upstream solution: introduce a dedicated CronNested lane (separate from the
 * generic Nested lane used by subagents/A2A/agent-step) and explicitly wire
 * cron.maxConcurrentRuns into BOTH the outer Cron lane and the inner
 * CronNested lane in applyGatewayLaneConcurrency. resolveGlobalLane in
 * pi-embedded-runner remaps Cron -> CronNested for the inner work.
 *
 * This test verifies the wiring is intact for the patched-fork upgrade
 * decision: if these pass, our HC-008 part 2 is genuinely subsumed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandLane } from "../process/lanes.js";
import {
  getCommandLaneSnapshot,
  resetCommandQueueStateForTest,
  setCommandLaneConcurrency,
} from "../process/command-queue.js";
import { resolveGlobalLane } from "../agents/pi-embedded-runner/lanes.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { applyGatewayLaneConcurrency } from "./server-lanes.js";

describe("HC-008 part 2 CronNested concurrency wiring", () => {
  beforeEach(() => {
    resetCommandQueueStateForTest();
  });

  afterEach(() => {
    resetCommandQueueStateForTest();
  });

  it("sets CronNested concurrency from cfg.cron.maxConcurrentRuns", () => {
    applyGatewayLaneConcurrency({
      cron: { maxConcurrentRuns: 6 },
    } as OpenClawConfig);

    const cronNested = getCommandLaneSnapshot(CommandLane.CronNested);
    expect(cronNested.maxConcurrent).toBe(6);
  });

  it("sets outer Cron lane concurrency too", () => {
    applyGatewayLaneConcurrency({
      cron: { maxConcurrentRuns: 4 },
    } as OpenClawConfig);

    const cron = getCommandLaneSnapshot(CommandLane.Cron);
    expect(cron.maxConcurrent).toBe(4);
  });

  it("defaults to 1 when cron config is absent", () => {
    applyGatewayLaneConcurrency({} as OpenClawConfig);
    expect(getCommandLaneSnapshot(CommandLane.CronNested).maxConcurrent).toBe(1);
    expect(getCommandLaneSnapshot(CommandLane.Cron).maxConcurrent).toBe(1);
  });

  it("inner work invoked from Cron lane is remapped to CronNested", () => {
    expect(resolveGlobalLane(CommandLane.Cron)).toBe(CommandLane.CronNested);
  });

  it("inner work from non-cron parent lanes stays on Main (not CronNested)", () => {
    // Subagent / A2A inner work should not accidentally land on the cron-throttled lane.
    expect(resolveGlobalLane(CommandLane.Subagent)).not.toBe(CommandLane.CronNested);
    expect(resolveGlobalLane(undefined)).not.toBe(CommandLane.CronNested);
  });

  it("re-applying with a new value updates CronNested concurrency live", () => {
    applyGatewayLaneConcurrency({ cron: { maxConcurrentRuns: 2 } } as OpenClawConfig);
    expect(getCommandLaneSnapshot(CommandLane.CronNested).maxConcurrent).toBe(2);

    applyGatewayLaneConcurrency({ cron: { maxConcurrentRuns: 8 } } as OpenClawConfig);
    expect(getCommandLaneSnapshot(CommandLane.CronNested).maxConcurrent).toBe(8);
  });
});
