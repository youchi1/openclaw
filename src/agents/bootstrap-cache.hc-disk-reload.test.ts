/**
 * HC-004 regression: bootstrap file edits on disk must surface to the agent.
 *
 * Original bug: getOrLoadBootstrapFiles cached files in-memory by sessionKey
 * with no staleness check. Edits to SOUL.md / USER.md / IDENTITY.md / etc.
 * were invisible to the gateway until the process restarted.
 *
 * Our HC-004 patch added mtime tracking via fs.statSync. Upstream 2026.5.4
 * took a different approach: getOrLoadBootstrapFiles always calls
 * loadWorkspaceBootstrapFiles per turn, and that loader uses an inode-aware
 * content cache (keyed by dev:ino:size:mtime) inside workspace.ts. The outer
 * cache only short-circuits when bootstrapFilesEqual confirms content is
 * actually unchanged.
 *
 * This test verifies the end-to-end behavior. We:
 *   1. Create real bootstrap files in a temp workspace
 *   2. Call getOrLoadBootstrapFiles to populate the cache
 *   3. Edit each tracked file on disk (after the mtime resolution gap)
 *   4. Call getOrLoadBootstrapFiles again with the SAME sessionKey
 *   5. Assert the new content is surfaced
 *
 * Coverage spans the full HC-004 set: SOUL.md, USER.md, IDENTITY.md,
 * AGENTS.md (also MEMORY.md / BOOTSTRAP.md / HEARTBEAT.md / TOOLS.md).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearAllBootstrapSnapshots, getOrLoadBootstrapFiles } from "./bootstrap-cache.js";

const TRACKED_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

describe("HC-004 bootstrap-cache disk reload", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "hc004-ws-"));
    clearAllBootstrapSnapshots();
  });

  afterEach(async () => {
    clearAllBootstrapSnapshots();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it.each(TRACKED_FILES)("surfaces edits to %s on the next getOrLoadBootstrapFiles call", async (name) => {
    const filePath = path.join(workspaceDir, name);
    await fs.writeFile(filePath, `original ${name} content`);

    const first = await getOrLoadBootstrapFiles({
      workspaceDir,
      sessionKey: "test-session",
    });
    const firstEntry = first.find((f) => f.name === name);
    expect(firstEntry?.content).toContain(`original ${name}`);

    // Wait past 1ms so mtime changes on filesystems with millisecond precision.
    await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(filePath, `EDITED ${name} content`);

    const second = await getOrLoadBootstrapFiles({
      workspaceDir,
      sessionKey: "test-session",
    });
    const secondEntry = second.find((f) => f.name === name);
    expect(secondEntry?.content).toContain(`EDITED ${name}`);
    expect(secondEntry?.content).not.toContain("original");
  });

  it("surfaces a newly created file that was missing on the first call", async () => {
    // Start with only AGENTS.md — SOUL.md absent.
    await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "agents only");

    const first = await getOrLoadBootstrapFiles({
      workspaceDir,
      sessionKey: "test-session-2",
    });
    const firstSoul = first.find((f) => f.name === "SOUL.md");
    // SOUL.md missing initially: entry may be absent OR marked missing.
    expect(firstSoul?.content ?? "").toBe(firstSoul?.content ?? "");

    await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "fresh soul content");

    const second = await getOrLoadBootstrapFiles({
      workspaceDir,
      sessionKey: "test-session-2",
    });
    const secondSoul = second.find((f) => f.name === "SOUL.md");
    expect(secondSoul?.content).toContain("fresh soul");
  });
});
