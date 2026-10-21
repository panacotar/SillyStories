const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const project = path.resolve(__dirname, "..");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "silly-server-"));
  const children = [];
  fs.cpSync(path.join(project, "src"), path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(project, "scripts/dev.js"), path.join(root, "scripts/dev.js"));
  fs.symlinkSync(path.join(project, "node_modules"), path.join(root, "node_modules"), "dir");
  // Keep a database handle alive until disconnect(), without requiring MongoDB.
  fs.writeFileSync(path.join(root, "fake-mongo.js"), `
    const mongoose = require("mongoose");
    const handle = setInterval(() => {}, 1000);
    mongoose.connect = async () => mongoose;
    mongoose.disconnect = async () => clearInterval(handle);
  `);
  const source = path.join(root, "src/server.js");
  fs.writeFileSync(source, `require("../fake-mongo.js");\n${fs.readFileSync(source, "utf8")}`);

  t.after(async () => {
    for (const child of children) {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      await child.finished;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  return {
    source,
    start(port) {
      const child = spawn(process.execPath, ["scripts/dev.js"], {
        cwd: root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(port),
          MONGODB_URI: "mongodb://127.0.0.1:1/test",
          MONGODB_PASSWORD_FILE: "",
        },
      });
      children.push(child);
      child.output = "";
      child.stdout.on("data", (data) => { child.output += data; });
      child.stderr.on("data", (data) => { child.output += data; });
      const timeout = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 10_000);
      child.finished = new Promise((resolve) => child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      }));
      return child;
    },
  };
}

async function listen() {
  const server = net.createServer();
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  return server;
}

async function waitForStarts(child, count) {
  const deadline = Date.now() + 5000;
  while ((child.output.match(/Server has started:/g) || []).length < count) {
    assert.ok(Date.now() < deadline, child.output || "Server did not start");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("a busy port reports a useful error and exits after disconnecting MongoDB", async (t) => {
  const app = fixture(t);
  const occupied = await listen();
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const child = app.start(occupied.address().port);
  assert.deepEqual(await child.finished, { code: 1, signal: null });
  assert.match(child.output, /EADDRINUSE/);
  assert.match(child.output, /already in use/);
  assert.doesNotMatch(child.output, /Unhandled 'error' event/);
});

test("repeated stops release the port when only the dev runner receives the signal", async (t) => {
  const app = fixture(t);
  const reservation = await listen();
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  for (const signal of ["SIGINT", "SIGTERM", "SIGINT", "SIGTERM"]) {
    const child = app.start(port);
    await waitForStarts(child, 1);
    assert.match(child.output, new RegExp(`http://localhost:${port}`));
    child.kill(signal);
    assert.deepEqual(await child.finished, { code: 0, signal: null });
  }
  const probe = net.createServer().listen(port, "0.0.0.0");
  await once(probe, "listening");
  await new Promise((resolve) => probe.close(resolve));
});

test("a file-change restart waits for the previous server to release its port", async (t) => {
  const app = fixture(t);
  const reservation = await listen();
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = app.start(port);
  await waitForStarts(child, 1);
  fs.appendFileSync(app.source, "\n// Trigger development reload.\n");
  await waitForStarts(child, 2);
  assert.doesNotMatch(child.output, /EADDRINUSE/);
  child.kill("SIGTERM");
  assert.deepEqual(await child.finished, { code: 0, signal: null });
});
