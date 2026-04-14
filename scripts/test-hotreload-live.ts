#!/usr/bin/env node --import=tsx
/**
 * Live hot-reload test for HC-001..HC-004 patches.
 * Requires: configured `openclaw` CLI with API keys.
 * Run: node --import=tsx scripts/test-hotreload-live.ts
 *
 * Strategy: spawn `openclaw agent` in background, watch the session transcript
 * .jsonl file for the assistant response, then kill the process. This avoids
 * the upstream issue where the CLI hangs after printing output.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME ?? "";
const WORKSPACE_DIR = path.join(HOME, ".openclaw", "workspace");
const USER_MD = path.join(WORKSPACE_DIR, "USER.md");
const SKILLS_DIR = path.join(HOME, ".openclaw", "skills");
const TEST_SKILL_DIR = path.join(SKILLS_DIR, "e2e-hotreload-test");
const SESSIONS_DIR = path.join(HOME, ".openclaw", "agents", "main", "sessions");
const SESSIONS_JSON = path.join(SESSIONS_DIR, "sessions.json");

let originalUserMd: string | undefined;
try {
  originalUserMd = fs.readFileSync(USER_MD, "utf-8");
} catch {
  /* may not exist */
}

function cleanup() {
  if (originalUserMd !== undefined) {
    fs.writeFileSync(USER_MD, originalUserMd);
  }
  fs.rmSync(TEST_SKILL_DIR, { recursive: true, force: true });
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

function getSessionFile(): string | undefined {
  try {
    const store = JSON.parse(fs.readFileSync(SESSIONS_JSON, "utf-8"));
    const entry = store["agent:main:main"];
    if (entry?.sessionFile) {
      return entry.sessionFile;
    }
    if (entry?.sessionId) {
      const candidate = path.join(SESSIONS_DIR, `${entry.sessionId}.jsonl`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function getTranscriptLineCount(file: string): number {
  try {
    return fs.readFileSync(file, "utf-8").trim().split("\n").length;
  } catch {
    return 0;
  }
}

function extractAssistantText(file: string, afterLine: number): string | undefined {
  try {
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
    // Search from afterLine onwards for the last assistant message
    for (let i = lines.length - 1; i >= afterLine; i--) {
      const entry = JSON.parse(lines[i]);
      if (entry.message?.role === "assistant") {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          return content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("")
            .replace(/^\[\[.*?\]\]\s*/, ""); // strip [[reply_to_current]] etc.
        }
        if (typeof content === "string") {
          return content;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

async function agentAsk(message: string): Promise<string> {
  const sessionFile = getSessionFile();
  const linesBefore = sessionFile ? getTranscriptLineCount(sessionFile) : 0;

  const child = spawn("openclaw", ["agent", "--agent", "main", "--message", message], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timeout waiting for agent response (60s)"));
    }, 60_000);

    // Poll transcript file for new assistant message
    const poll = setInterval(() => {
      const file = sessionFile ?? getSessionFile();
      if (!file) {
        return;
      }
      const text = extractAssistantText(file, linesBefore);
      if (text !== undefined) {
        clearInterval(poll);
        clearTimeout(timeout);
        child.kill("SIGKILL");
        resolve(text.trim());
      }
    }, 500);

    child.on("error", (err) => {
      clearInterval(poll);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

let passed = 0;
let failed = 0;

async function assert(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// --- Bootstrap file tests ---
console.log("\n=== Bootstrap file hot-reload ===\n");

const name1 = `HotReloadUser${Date.now()}`;
fs.writeFileSync(USER_MD, `# USER.md\n\n- **Name: ${name1}**\n`);
await assert("picks up USER.md name change mid-session", async () => {
  const resp = await agentAsk(
    "What user name is listed in the current context prompt? Forget previous reports if any, it is supposed to be changed. Just the name, nothing else.",
  );
  if (!resp.includes(name1)) {
    throw new Error(`Expected "${name1}" in: "${resp}"`);
  }
});

const name2 = `SecondName${Date.now()}`;
fs.writeFileSync(USER_MD, `# USER.md\n\n- **Name: ${name2}**\n`);
await assert("picks up USER.md name change again in same session", async () => {
  const resp = await agentAsk(
    "What user name is listed in the current context prompt? Forget previous reports if any, it is supposed to be changed. Just the name, nothing else.",
  );
  if (!resp.includes(name2)) {
    throw new Error(`Expected "${name2}" in: "${resp}"`);
  }
});

// --- Skills tests ---
console.log("\n=== Skills hot-reload ===\n");

fs.rmSync(TEST_SKILL_DIR, { recursive: true, force: true });
await assert("skill absent before install", async () => {
  const resp = await agentAsk(
    "List all your available skills. Just the skill names as a bullet list. Forget previous reports if any, it is supposed to be changed. ",
  );
  if (resp.includes("e2e-hotreload-test")) {
    throw new Error(`Skill should not be present: "${resp}"`);
  }
});

fs.mkdirSync(TEST_SKILL_DIR, { recursive: true });
fs.writeFileSync(
  path.join(TEST_SKILL_DIR, "SKILL.md"),
  "---\nname: e2e-hotreload-test\ndescription: E2E test skill for hot reload verification\n---\nTest skill body.\n",
);
await assert("picks up newly installed skill mid-session", async () => {
  const resp = await agentAsk(
    "List all your available skills. Just the skill names as a bullet list. Forget previous reports if any, it is supposed to be changed. ",
  );
  if (!resp.includes("e2e-hotreload-test")) {
    throw new Error(`Skill should be present: "${resp}"`);
  }
});

fs.rmSync(TEST_SKILL_DIR, { recursive: true, force: true });
await assert("picks up skill removal mid-session", async () => {
  const resp = await agentAsk(
    "List all your available skills. Just the skill names as a bullet list. Forget previous reports if any, it is supposed to be changed. ",
  );
  if (resp.includes("e2e-hotreload-test")) {
    throw new Error(`Skill should be gone: "${resp}"`);
  }
});

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
