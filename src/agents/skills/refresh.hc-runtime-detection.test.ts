/**
 * HC-002 regression: chokidar v5 must detect SKILL.md files installed at runtime.
 *
 * Original bug (chokidar v5 glob regression): when the watcher was started with
 * a glob pattern like `dir/*\/SKILL.md`, new subdirectories created after the
 * watcher started were silently missed. Skills installed at runtime did not
 * bump getSkillsSnapshotVersion(), so long-running gateways served stale
 * snapshots until restart.
 *
 * This test exercises the exact scenario against the upstream watcher
 * implementation: start the watcher with an empty skills dir, then create a
 * new skill subdirectory and SKILL.md file. The watcher must observe the add
 * event and bump the snapshot version within a bounded debounce window.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSkillsSnapshotVersion } from "./refresh-state.js";
import { ensureSkillsWatcher, resetSkillsRefreshForTest } from "./refresh.js";

async function waitForVersionBump(
  workspaceDir: string,
  baseline: number,
  timeoutMs = 5000,
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = getSkillsSnapshotVersion(workspaceDir);
    if (current > baseline) {
      return current;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return getSkillsSnapshotVersion(workspaceDir);
}

describe("HC-002 runtime new-skill detection", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "hc002-ws-"));
    await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true });
  });

  afterEach(async () => {
    await resetSkillsRefreshForTest();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("detects a SKILL.md created in a new subdirectory after watcher start", async () => {
    // Start the watcher with a workspace that has skills/ but no skill subdirs.
    ensureSkillsWatcher({
      workspaceDir,
      config: { skills: { load: { watch: true, watchDebounceMs: 100 } } } as never,
    });

    // Give chokidar time to set up watchers.
    await new Promise((r) => setTimeout(r, 250));

    const baselineVersion = getSkillsSnapshotVersion(workspaceDir);

    // Now create a new skill subdirectory with a SKILL.md AFTER the watcher
    // started. This is exactly the scenario the chokidar v5 glob bug missed.
    const newSkillDir = path.join(workspaceDir, "skills", "runtime-test-skill");
    await fs.mkdir(newSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(newSkillDir, "SKILL.md"),
      "---\nname: runtime-test\n---\n\n# Runtime test skill\n",
    );

    const finalVersion = await waitForVersionBump(workspaceDir, baselineVersion, 5000);
    expect(finalVersion).toBeGreaterThan(baselineVersion);
  });

  it("detects a SKILL.md unlinked from an existing skill directory", async () => {
    // Pre-create a skill so it exists at watcher start.
    const existingSkillDir = path.join(workspaceDir, "skills", "to-be-removed");
    await fs.mkdir(existingSkillDir, { recursive: true });
    await fs.writeFile(path.join(existingSkillDir, "SKILL.md"), "---\nname: gone\n---\n");

    ensureSkillsWatcher({
      workspaceDir,
      config: { skills: { load: { watch: true, watchDebounceMs: 100 } } } as never,
    });
    await new Promise((r) => setTimeout(r, 250));

    const baselineVersion = getSkillsSnapshotVersion(workspaceDir);

    // Remove the SKILL.md.
    await fs.rm(path.join(existingSkillDir, "SKILL.md"));

    const finalVersion = await waitForVersionBump(workspaceDir, baselineVersion, 5000);
    expect(finalVersion).toBeGreaterThan(baselineVersion);
  });
});
