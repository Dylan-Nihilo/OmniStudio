import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {Record<string, string | undefined>} [baseEnv]
 * @param {NodeJS.Platform} [platform]
 */
export function buildNextDevEnv(
  baseEnv = process.env,
  platform = process.platform,
) {
  const env = { ...baseEnv };

  // Production exports use ../static. Give the dev compiler its own directory so
  // `npm run build` can run without invalidating assets served by a live dev server.
  if (!env.NEXT_DEV_DIST_DIR) {
    env.NEXT_DEV_DIST_DIR = ".next-dev";
  }

  // Watchpack's native watcher can hit EMFILE on large macOS workspaces.
  // Polling trades a little CPU for a much more stable dev server.
  if (platform === "darwin") {
    if (!env.WATCHPACK_POLLING) {
      env.WATCHPACK_POLLING = "true";
    }
    if (env.WATCHPACK_POLLING === "true" && !env.WATCHPACK_POLLING_INTERVAL) {
      env.WATCHPACK_POLLING_INTERVAL = "1000";
    }
  }

  return env;
}

export function runNextDev(args = process.argv.slice(2)) {
  const env = buildNextDevEnv();
  const nextEntry = path.resolve("node_modules", "next", "dist", "bin", "next");
  const hasExplicitPortArg = args.some(
    (arg, index) =>
      arg === "--port" ||
      arg === "-p" ||
      arg.startsWith("--port=") ||
      (index > 0 && (args[index - 1] === "--port" || args[index - 1] === "-p")),
  );
  const resolvedArgs = hasExplicitPortArg
    ? args
    : ["--port", env.PORT || "3008", ...args];

  if (env.WATCHPACK_POLLING === "true") {
    console.log(
      "[dev] Enabling Watchpack polling on macOS to avoid EMFILE watcher failures in this workspace.",
    );
  }

  const child = spawn(process.execPath, [nextEntry, "dev", ...resolvedArgs], {
    stdio: "inherit",
    env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  return child;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNextDev();
}
