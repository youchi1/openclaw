import fs from "node:fs";
import { cloneAuthProfileStore } from "./clone.js";
import { resolveAuthStatePath, resolveAuthStorePath } from "./path-resolve.js";
import type { AuthProfileStore } from "./types.js";

export type AuthProfileSnapshotMtimes = {
  authMtimeMs: number | null;
  stateMtimeMs: number | null;
};

const runtimeAuthStoreSnapshots = new Map<string, AuthProfileStore>();
const runtimeAuthStoreSnapshotMtimes = new Map<string, AuthProfileSnapshotMtimes>();

function readMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function resolveRuntimeStoreKey(agentDir?: string): string {
  return resolveAuthStorePath(agentDir);
}

function captureSnapshotMtimes(agentDir: string | undefined): AuthProfileSnapshotMtimes {
  return {
    authMtimeMs: readMtimeMs(resolveAuthStorePath(agentDir)),
    stateMtimeMs: readMtimeMs(resolveAuthStatePath(agentDir)),
  };
}

export function getRuntimeAuthProfileStoreSnapshot(
  agentDir?: string,
): AuthProfileStore | undefined {
  const store = runtimeAuthStoreSnapshots.get(resolveRuntimeStoreKey(agentDir));
  return store ? cloneAuthProfileStore(store) : undefined;
}

export function hasRuntimeAuthProfileStoreSnapshot(agentDir?: string): boolean {
  return runtimeAuthStoreSnapshots.has(resolveRuntimeStoreKey(agentDir));
}

export function getRuntimeAuthProfileStoreSnapshotMtimes(
  agentDir?: string,
): AuthProfileSnapshotMtimes | undefined {
  return runtimeAuthStoreSnapshotMtimes.get(resolveRuntimeStoreKey(agentDir));
}

export function hasAnyRuntimeAuthProfileStoreSource(agentDir?: string): boolean {
  const requestedStore = getRuntimeAuthProfileStoreSnapshot(agentDir);
  if (requestedStore && Object.keys(requestedStore.profiles).length > 0) {
    return true;
  }
  if (!agentDir) {
    return false;
  }
  const mainStore = getRuntimeAuthProfileStoreSnapshot();
  return Boolean(mainStore && Object.keys(mainStore.profiles).length > 0);
}

export function replaceRuntimeAuthProfileStoreSnapshots(
  entries: Array<{ agentDir?: string; store: AuthProfileStore }>,
): void {
  runtimeAuthStoreSnapshots.clear();
  runtimeAuthStoreSnapshotMtimes.clear();
  for (const entry of entries) {
    const key = resolveRuntimeStoreKey(entry.agentDir);
    runtimeAuthStoreSnapshots.set(key, cloneAuthProfileStore(entry.store));
    runtimeAuthStoreSnapshotMtimes.set(key, captureSnapshotMtimes(entry.agentDir));
  }
}

export function clearRuntimeAuthProfileStoreSnapshots(): void {
  runtimeAuthStoreSnapshots.clear();
  runtimeAuthStoreSnapshotMtimes.clear();
}

export function setRuntimeAuthProfileStoreSnapshot(
  store: AuthProfileStore,
  agentDir?: string,
): void {
  const key = resolveRuntimeStoreKey(agentDir);
  runtimeAuthStoreSnapshots.set(key, cloneAuthProfileStore(store));
  runtimeAuthStoreSnapshotMtimes.set(key, captureSnapshotMtimes(agentDir));
}
