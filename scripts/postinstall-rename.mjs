// Rewrites package.json name back to "openclaw" after npm install.
// This runs as part of the published postinstall chain so that upstream
// runtime code (which resolves its own root by package name) works correctly.
// It also removes itself from the postinstall command.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

pkg.name = "openclaw";

// Remove this script from the postinstall chain so it doesn't re-run.
if (pkg.scripts?.postinstall) {
  pkg.scripts.postinstall =
    pkg.scripts.postinstall
      .split(" && ")
      .filter((cmd) => !cmd.includes("postinstall-rename"))
      .join(" && ") || undefined;
  if (!pkg.scripts.postinstall) {
    delete pkg.scripts.postinstall;
  }
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
