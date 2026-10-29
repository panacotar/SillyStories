const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

// Exercise real Git history and the real backup helper, with no Docker daemon
// or public network access. Fake commands record which services are touched.
function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "silly-deploy-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const seed = path.join(tmp, "source");
  const remote = path.join(tmp, "remote.git");
  const checkout = path.join(tmp, "checkout with spaces");
  const bin = path.join(tmp, "bin");
  const log = path.join(tmp, "commands.jsonl");
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_AUTHOR_NAME: "Deploy test",
    GIT_AUTHOR_EMAIL: "deploy@example.test",
    GIT_COMMITTER_NAME: "Deploy test",
    GIT_COMMITTER_EMAIL: "deploy@example.test",
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    DEPLOY_TEST_LOG: log,
  };
  // Do not inherit a caller's real production stack overrides into fixtures.
  for (const key of ["SILLY_ENV_FILE", "SILLY_COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "APP_IMAGE"])
    delete env[key];
  function git(dir, ...args) {
    return execFileSync("git", ["-C", dir, ...args], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  fs.mkdirSync(path.join(seed, "scripts"), { recursive: true });
  fs.mkdirSync(bin);
  git(seed, "init", "--initial-branch=main");
  for (const script of ["update-production.sh", "production.sh", "backup-db.sh", "db-common.sh"])
    fs.copyFileSync(path.join(root, "scripts", script), path.join(seed, "scripts", script));
  fs.copyFileSync(path.join(root, "compose.production.yaml"), path.join(seed, "compose.production.yaml"));
  fs.writeFileSync(path.join(seed, ".gitignore"), "backups/\n.db-operation.lock/\n.env.production\ndeploy/secrets/\n");
  fs.writeFileSync(path.join(seed, "app.txt"), "initial release\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "Initial release");
  git(tmp, "clone", "--bare", seed, remote);
  git(seed, "remote", "add", "origin", remote);
  git(tmp, "clone", remote, checkout);
  fs.writeFileSync(path.join(checkout, ".env.production"), "DOMAIN=example.test\n");
  const fakeCommand = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const name = path.basename(process.argv[1]);
let args = process.argv.slice(2);
if (args[0] === "compose") args = args.slice(args.indexOf("-f") + 2);
const databaseLocked = fs.existsSync(path.join(process.cwd(), ".db-operation.lock"));
fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify({ name, args, databaseLocked }) + "\\n");
if (args[0] === "build" && process.env.DEPLOY_TEST_BACKUP_DURING_BUILD) {
  const { spawnSync } = require("node:child_process");
  const backup = spawnSync("bash", ["scripts/backup-db.sh"], { encoding: "utf8" });
  fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify({
    name: "concurrent-backup", args: [], status: backup.status, stderr: backup.stderr,
  }) + "\\n");
}
if (name === "curl") process.exit(process.env.DEPLOY_TEST_FAIL === "https" ? 22 : 0);
if (args[0] === "ps" && args.includes("--quiet")) {
  if (args.at(-1) !== process.env.DEPLOY_TEST_STOPPED) console.log("container");
}
if (args[0] === "images") console.log("sha256:previous-image");
if (args[0] === "exec" && args.includes("dump")) {
  if (process.env.DEPLOY_TEST_FAIL === "backup") process.exit(1);
  process.stdout.write("test archive");
}
if (args[0] === "exec" && args.includes("node")) console.log("https://example.test");
if (args[0] === process.env.DEPLOY_TEST_FAIL) process.exit(1);
`;
  for (const command of ["docker", "curl"]) {
    fs.writeFileSync(path.join(bin, command), fakeCommand, { mode: 0o755 });
  }
  function release(branch = "main") {
    if (branch === "main") git(seed, "switch", "main");
    else git(seed, "switch", "-c", branch);
    fs.writeFileSync(path.join(seed, "app.txt"), `release on ${branch}\n`);
    git(seed, "commit", "-am", "New release");
    git(seed, "push", "origin", branch);
    return git(seed, "rev-parse", "HEAD");
  }
  function run(args = [], overrides = {}) {
    return spawnSync("bash", [path.join(checkout, "scripts/update-production.sh"), ...args], {
      cwd: tmp, env: { ...env, ...overrides }, encoding: "utf8", timeout: 15000,
    });
  }
  function events() {
    return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
  }
  function noLocks() {
    assert.equal(fs.existsSync(path.join(checkout, ".git/silly-stories-deploy.lock")), false);
    assert.equal(fs.existsSync(path.join(checkout, ".db-operation.lock")), false);
  }
  return { tmp, seed, remote, checkout, git, release, run, events, noLocks };
}

test("updates from any directory, backs up before building, and replaces only app", (t) => {
  const f = fixture(t);
  const revision = f.release();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment verified:/);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), revision);
  const events = f.events();
  const dump = events.findIndex(({ args }) => args.includes("dump"));
  const build = events.findIndex(({ args }) => args[0] === "build");
  const up = events.find(({ args }) => args[0] === "up");
  assert.ok(dump >= 0 && build > dump);
  assert.deepEqual(up.args, ["up", "-d", "--no-deps", "--no-build", "--wait", "app"]);
  assert.ok(events.some(({ args }) => args[0] === "start" && args[1] === "app"));
  assert.ok(events.some(({ args }) => args.join(" ") === "image tag sha256:previous-image silly-stories:rollback"));
  assert.equal(events.at(-1).args.at(-1), "https://example.test/healthz");
  assert.equal(fs.readdirSync(path.join(f.checkout, "backups")).length, 1);
  assert.equal(fs.readFileSync(path.join(f.checkout, ".env.production"), "utf8"), "DOMAIN=example.test\n");
  assert.equal(f.git(f.checkout, "status", "--porcelain"), "");
  f.noLocks();
});

test("explicit branch creates a tracking branch and can subsequently fast-forward it", (t) => {
  const f = fixture(t);
  const revision = f.release("release/new-version");
  const result = f.run(["release/new-version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git(f.checkout, "branch", "--show-current"), "release/new-version");
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), revision);
  assert.equal(f.git(f.checkout, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/release/new-version");
  fs.appendFileSync(path.join(f.seed, "app.txt"), "another release\n");
  f.git(f.seed, "commit", "-am", "Another release");
  f.git(f.seed, "push", "origin", "release/new-version");
  const next = f.run(["release/new-version"]);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.git(f.seed, "rev-parse", "HEAD"));
  f.noLocks();
});

test("finishes safely when the fetched release replaces the update script itself", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.seed, "scripts/update-production.sh"), "#!/usr/bin/env bash\nexit 99\n");
  const revision = f.release();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment verified:/);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), revision);
  f.noLocks();
});

test("no argument honors a configured upstream remote and differently named branch", (t) => {
  const f = fixture(t);
  const revision = f.release("release/production");
  f.git(f.checkout, "remote", "add", "lab", f.remote);
  f.git(f.checkout, "config", "branch.main.remote", "lab");
  f.git(f.checkout, "config", "branch.main.merge", "refs/heads/release/production");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git(f.checkout, "branch", "--show-current"), "main");
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), revision);
});

for (const change of ["tracked", "untracked"]) {
  test(`refuses ${change} local changes before touching production`, (t) => {
    const f = fixture(t);
    f.release();
    fs.writeFileSync(path.join(f.checkout, change === "tracked" ? "app.txt" : "local.txt"), "local edit\n");
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /local changes/);
    assert.deepEqual(f.events(), []);
  });
}

test("refuses locally committed divergence without discarding code or backing up", (t) => {
  const f = fixture(t);
  f.release();
  fs.writeFileSync(path.join(f.checkout, "local.txt"), "local commit\n");
  f.git(f.checkout, "add", "local.txt");
  f.git(f.checkout, "commit", "-m", "Local production change");
  const before = f.git(f.checkout, "rev-parse", "HEAD");
  const result = f.run(["main"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to discard/);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), before);
  assert.deepEqual(f.events(), []);
  f.noLocks();
});

test("missing remote branches fail before backup or branch switch", (t) => {
  const f = fixture(t);
  const result = f.run(["does-not-exist"]);
  assert.notEqual(result.status, 0);
  assert.equal(f.git(f.checkout, "branch", "--show-current"), "main");
  assert.deepEqual(f.events(), []);
  f.noLocks();
});

test("requires a running stack before creating a backup", (t) => {
  const f = fixture(t);
  f.release();
  const result = f.run([], { DEPLOY_TEST_STOPPED: "mongodb" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mongodb is not running/);
  assert.equal(f.events().some(({ args }) => args.includes("dump")), false);
  f.noLocks();
});

test("backup failure restarts the app and stops before checkout or build", (t) => {
  const f = fixture(t);
  const before = f.git(f.checkout, "rev-parse", "HEAD");
  f.release();
  const result = f.run([], { DEPLOY_TEST_FAIL: "backup" });
  assert.notEqual(result.status, 0);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), before);
  assert.ok(f.events().some(({ args }) => args[0] === "start"));
  assert.equal(f.events().some(({ args }) => args[0] === "build" || args[0] === "up"), false);
  assert.deepEqual(fs.readdirSync(path.join(f.checkout, "backups")), []);
  f.noLocks();
});

test("failed build preserves the saved image and never replaces the running app", (t) => {
  const f = fixture(t);
  f.release();
  const result = f.run([], { DEPLOY_TEST_FAIL: "build" });
  assert.notEqual(result.status, 0);
  assert.ok(f.events().some(({ args }) => args[0] === "image"));
  assert.equal(f.events().some(({ args }) => args[0] === "up"), false);
  assert.match(result.stderr, /Previous revision:/);
  f.noLocks();
});

for (const stage of ["up", "https"]) {
  test(`reports ${stage} failure without claiming success or rolling back data`, (t) => {
    const f = fixture(t);
    f.release();
    const result = f.run([], { DEPLOY_TEST_FAIL: stage });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Deployment verified:/);
    assert.ok(f.events().some(({ args }) => args[0] === "up"));
    if (stage === "https") assert.ok(f.events().some(({ name }) => name === "curl"));
    assert.equal(f.events().some(({ args }) => args.includes("restore") || args.includes("down")), false);
    f.noLocks();
  });
}

test("concurrent deployment lock refuses a second update", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.checkout, ".git/silly-stories-deploy.lock"));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Another update is running/);
  assert.deepEqual(f.events(), []);
  assert.ok(fs.existsSync(path.join(f.checkout, ".git/silly-stories-deploy.lock")));
});

test("deployment excludes concurrent backups through replacement and verification", (t) => {
  const f = fixture(t);
  f.release();
  const result = f.run([], { DEPLOY_TEST_BACKUP_DURING_BUILD: "1" });
  assert.equal(result.status, 0, result.stderr);
  const events = f.events();
  const backup = events.find(({ name }) => name === "concurrent-backup");
  assert.equal(backup.status, 1);
  assert.match(backup.stderr, /Another database operation is running/);
  assert.equal(events.filter(({ args }) => args.includes("dump")).length, 1);
  assert.equal(events.filter(({ args }) => args[0] === "stop").length, 1);
  for (const phase of ["images", "build", "up"]) {
    assert.equal(events.find(({ args }) => args[0] === phase).databaseLocked, true);
  }
  assert.equal(events.find(({ name }) => name === "curl").databaseLocked, true);
  f.noLocks();
});

test("an active database operation refuses an update without removing its lock", (t) => {
  const f = fixture(t);
  f.release();
  const lock = path.join(f.checkout, ".db-operation.lock");
  fs.mkdirSync(lock);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Another database operation is running/);
  assert.ok(fs.existsSync(lock));
  assert.equal(fs.existsSync(path.join(f.checkout, ".git/silly-stories-deploy.lock")), false);
  assert.equal(f.events().some(({ args }) => ["stop", "build", "up"].includes(args[0])), false);
});

test("detached checkout needs an explicit branch and help needs no deployment", (t) => {
  const f = fixture(t);
  f.git(f.checkout, "switch", "--detach");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Detached HEAD/);
  assert.equal(f.run(["--help"]).status, 0);
  assert.notEqual(f.run(["--bad-option"]).status, 0);
  assert.notEqual(f.run(["main", "extra"]).status, 0);
  assert.deepEqual(f.events(), []);
});
