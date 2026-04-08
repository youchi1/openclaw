import fs from "node:fs";
import { loadWorkspaceBootstrapFiles, type WorkspaceBootstrapFile } from "./workspace.js";

type CacheEntry = {
  files: WorkspaceBootstrapFile[];
  mtimes: Map<string, number>;
};

const cache = new Map<string, CacheEntry>();

function snapshotMtimes(files: WorkspaceBootstrapFile[]): Map<string, number> {
  const mtimes = new Map<string, number>();
  for (const file of files) {
    if (file.missing || !file.path) {
      continue;
    }
    try {
      mtimes.set(file.path, fs.statSync(file.path).mtimeMs);
    } catch {
      // File may have been removed since load — treat as changed on next check.
    }
  }
  return mtimes;
}

function hasStaleFiles(entry: CacheEntry): boolean {
  for (const file of entry.files) {
    if (file.missing && file.path) {
      // Previously-missing file now exists — stale.
      try {
        fs.statSync(file.path);
        return true;
      } catch {
        // Still missing — fine.
      }
    } else if (file.path) {
      const cachedMtime = entry.mtimes.get(file.path);
      try {
        const currentMtime = fs.statSync(file.path).mtimeMs;
        if (currentMtime !== cachedMtime) {
          return true;
        }
      } catch {
        // File removed or inaccessible — stale.
        return true;
      }
    }
  }
  return false;
}

export async function getOrLoadBootstrapFiles(params: {
  workspaceDir: string;
  sessionKey: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const existing = cache.get(params.sessionKey);
  if (existing) {
    if (!hasStaleFiles(existing)) {
      return existing.files;
    }
  }

  const files = await loadWorkspaceBootstrapFiles(params.workspaceDir);
  const entry = { files, mtimes: snapshotMtimes(files) };
  cache.set(params.sessionKey, entry);
  return files;
}

export function clearBootstrapSnapshot(sessionKey: string): void {
  cache.delete(sessionKey);
}

export function clearBootstrapSnapshotOnSessionRollover(params: {
  sessionKey?: string;
  previousSessionId?: string;
}): void {
  if (!params.sessionKey || !params.previousSessionId) {
    return;
  }

  clearBootstrapSnapshot(params.sessionKey);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
}
