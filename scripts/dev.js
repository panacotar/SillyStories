const { spawn } = require("node:child_process");
const { watch } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let child;
let restartPending = false;
let stopping = false;
let debounce;

const watcher = watch(path.join(root, "src"), { recursive: true }, (_event, filename) => {
  if (filename && !filename.endsWith(".js")) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (stopping || !child) return;
    restartPending = true;
    child.kill("SIGTERM");
  }, 100);
});

function stop(code, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounce);
  watcher.close();
  process.exitCode = code;
  if (child) child.kill(signal);
}

function start() {
  child = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    console.error("Could not start development server:", error.code);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    child = undefined;
    if (stopping) return;
    // Only file changes request a restart; a failed server must exit the watcher.
    if (restartPending && (code === 0 || signal === "SIGTERM")) {
      restartPending = false;
      start();
    } else {
      stop(code ?? 1);
    }
  });
}

watcher.on("error", (error) => {
  console.error("Could not watch development files:", error.code);
  stop(1);
});
process.on("SIGINT", () => stop(0, "SIGINT"));
process.on("SIGTERM", () => stop(0));
start();
