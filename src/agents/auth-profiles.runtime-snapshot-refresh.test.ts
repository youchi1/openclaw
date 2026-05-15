import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORE_VERSION } from "./auth-profiles/constants.js";
import { setRuntimeAuthProfileStoreSnapshot } from "./auth-profiles/runtime-snapshots.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
} from "./auth-profiles/store.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveExternalAuthProfilesWithPlugins: () => [],
}));

vi.mock("./auth-profiles/external-cli-sync.js", () => ({
  resolveExternalCliAuthProfiles: () => [],
}));

function withAgentDirEnv(prefix: string, run: (agentDir: string) => void) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previousAgentDir = process.env.OPENCLAW_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.OPENCLAW_AGENT_DIR = agentDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    run(agentDir);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.OPENCLAW_AGENT_DIR;
    } else {
      process.env.OPENCLAW_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
}

function writeAuthProfilesJson(agentDir: string, store: AuthProfileStore) {
  fs.writeFileSync(
    path.join(agentDir, "auth-profiles.json"),
    `${JSON.stringify(store, null, 2)}\n`,
    "utf8",
  );
}

function writeAuthStateJson(
  agentDir: string,
  state: { usageStats?: Record<string, Record<string, unknown>> },
) {
  fs.writeFileSync(
    path.join(agentDir, "auth-state.json"),
    `${JSON.stringify({ version: AUTH_STORE_VERSION, ...state }, null, 2)}\n`,
    "utf8",
  );
}

function bumpMtime(filePath: string, offsetMs: number) {
  const stamp = new Date(Date.now() + offsetMs);
  fs.utimesSync(filePath, stamp, stamp);
}

describe("runtime auth profile snapshot staleness refresh (HC-009)", () => {
  beforeEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
  });

  afterEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
  });

  it("reloads the snapshot when auth-state.json is rewritten out-of-band (cross-process)", () => {
    withAgentDirEnv("openclaw-auth-snapshot-state-", (agentDir) => {
      // Disk state: anthropic profile billing-disabled.
      const disabledUntil = Date.now() + 5 * 60 * 60 * 1000;
      const store: AuthProfileStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-ant-test",
          },
        },
        usageStats: {
          "anthropic:default": {
            disabledUntil,
            disabledReason: "billing",
            errorCount: 1,
            failureCounts: { billing: 1 },
          },
        },
      };
      writeAuthProfilesJson(agentDir, store);
      writeAuthStateJson(agentDir, { usageStats: store.usageStats });
      // Seed the runtime snapshot to reflect the on-disk billing state.
      setRuntimeAuthProfileStoreSnapshot(store);

      // Sanity: first read returns the disabled snapshot.
      const seeded = ensureAuthProfileStore(agentDir);
      expect(seeded.usageStats?.["anthropic:default"]).toMatchObject({
        disabledUntil,
        disabledReason: "billing",
      });

      // Simulate a cross-process write that clears the cooldown on disk
      // without touching this process's runtime snapshot.
      const clearedStore: AuthProfileStore = {
        ...store,
        usageStats: {},
      };
      writeAuthProfilesJson(agentDir, clearedStore);
      try {
        fs.unlinkSync(path.join(agentDir, "auth-state.json"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
          throw err;
        }
      }
      bumpMtime(path.join(agentDir, "auth-profiles.json"), 2_000);

      const reloaded = ensureAuthProfileStore(agentDir);
      expect(reloaded.usageStats?.["anthropic:default"]).toBeUndefined();
      expect(reloaded.profiles["anthropic:default"]).toMatchObject({
        type: "api_key",
        provider: "anthropic",
      });
    });
  });

  it("keeps serving the snapshot when disk mtime has not advanced", () => {
    withAgentDirEnv("openclaw-auth-snapshot-stable-", (agentDir) => {
      const store: AuthProfileStore = {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "sk-stable",
          },
        },
      };
      writeAuthProfilesJson(agentDir, store);
      setRuntimeAuthProfileStoreSnapshot(store);

      const first = ensureAuthProfileStore(agentDir);
      const second = ensureAuthProfileStore(agentDir);
      expect(first.profiles["openai:default"]).toMatchObject({ key: "sk-stable" });
      expect(second.profiles["openai:default"]).toMatchObject({ key: "sk-stable" });
    });
  });
});
