import { spawnSync } from "node:child_process";
import path from "node:path";

const rawArgs = process.argv.slice(2);
const filteredArgs = rawArgs.filter((arg) => arg !== "--runInBand");

const hasVitestMode = filteredArgs.some((arg) =>
  arg === "run" || arg === "watch" || arg === "related",
);

const vitestEntry = path.resolve("node_modules", "vitest", "vitest.mjs");
const args = [vitestEntry, "--configLoader", "runner"];
if (!hasVitestMode) {
  args.push("run");
}
args.push(...filteredArgs);

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}
process.exit(1);
