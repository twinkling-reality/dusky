import { spawn } from "node:child_process";

/**
 * Run Playwright in its own process group so an interrupted local audit cannot
 * orphan its web servers or WebMCP-enabled Chrome instance. Hosted CI already
 * supervises the job process tree, so Playwright must remain in that tree there.
 * Playwright still performs its ordinary graceful cleanup in both environments.
 */
const runningInCi = process.env["CI"] === "true";
const detached = process.platform !== "win32" && !runningInCi;
const forwarded = process.argv.slice(2);
if (forwarded[0] === "--") forwarded.shift();
const child = spawn("pnpm", ["exec", "playwright", "test", ...forwarded], {
  detached,
  stdio: "inherit",
});

let stopping = false;
let interrupted = false;
let forceTimer;

function signalChild(signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (detached && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  interrupted = true;
  signalChild(signal);
  forceTimer = setTimeout(() => signalChild("SIGKILL"), 3_000);
  forceTimer.unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => stop(signal));
}

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (forceTimer !== undefined) clearTimeout(forceTimer);
  process.exitCode = interrupted ? 130 : (code ?? (signal === null ? 1 : 128));
});
