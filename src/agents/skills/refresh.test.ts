import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const watchMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(async () => undefined),
}));

let refreshModule: typeof import("./refresh.js");

vi.mock("chokidar", () => ({
  default: { watch: watchMock },
}));

vi.mock("./plugin-skills.js", () => ({
  resolvePluginSkillDirs: vi.fn(() => []),
}));

describe("ensureSkillsWatcher", () => {
  beforeAll(async () => {
    refreshModule = await import("./refresh.js");
  });

  beforeEach(() => {
    watchMock.mockClear();
  });

  afterEach(async () => {
    await refreshModule.resetSkillsRefreshForTest();
  });

  it("watches skill root directories with depth limit and ignore patterns", async () => {
    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const firstCall = (
      watchMock.mock.calls as unknown as Array<[string[], { ignored?: unknown; depth?: number }]>
    )[0];
    const targets = firstCall?.[0] ?? [];
    const opts = firstCall?.[1] ?? {};

    expect(opts.ignored).toBe(refreshModule.DEFAULT_SKILLS_WATCH_IGNORED);
    // Chokidar v5 glob patterns don't detect new subdirectories, so we watch
    // the parent directories directly with depth: 1 and filter for SKILL.md
    // in the event handler.
    expect(opts.depth).toBe(1);
    expect(targets).toEqual(
      expect.arrayContaining([
        path.resolve("/tmp/workspace", "skills"),
        path.resolve("/tmp/workspace", ".agents", "skills"),
        path.resolve(os.homedir(), ".agents", "skills"),
      ]),
    );
    // Targets should be directories, not glob patterns
    expect(targets.every((target: string) => !target.includes("*"))).toBe(true);
    const ignored = refreshModule.DEFAULT_SKILLS_WATCH_IGNORED;

    // Node/JS paths
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/node_modules/pkg/index.js"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/dist/index.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.git/config"))).toBe(true);

    // Python virtual environments and caches
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/scripts/.venv/bin/python"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/venv/lib/python3.10/site.py"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/__pycache__/module.pyc"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.mypy_cache/3.10/foo.json"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.pytest_cache/v/cache"))).toBe(true);

    // Build artifacts and caches
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/build/output.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.cache/data.json"))).toBe(true);

    // Should NOT ignore normal skill files
    expect(ignored.some((re) => re.test("/tmp/.hidden/skills/index.md"))).toBe(false);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/my-skill/SKILL.md"))).toBe(false);
  });
});
