const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app.js");

const origin = "https://silly-stories.organicdarius.com";
let server;
let baseUrl;
let cookie;
let token;

before(async () => {
  server = createApp({ production: true, publicOrigin: origin, trustProxy: 1 })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/missing`);
  cookie = response.headers.get("set-cookie").split(";")[0];
  token = cookie.split("=")[1];
});
after(() => new Promise((resolve) => server.close(resolve)));

function submit(data, extraHeaders = {}) {
  return fetch(baseUrl, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, ...extraHeaders },
    body: new URLSearchParams({ _csrf: token, ...data }),
    redirect: "manual",
  });
}

test("production fails closed without a canonical HTTPS origin", () => {
  for (const publicOrigin of [undefined, "http://example.com", `${origin}/`]) {
    assert.throws(() => createApp({ production: true, publicOrigin }));
  }
});

test("responses set a strict CSP, secure cookie, and no framework header", async () => {
  const response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self';/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /unsafe-inline/);
  assert.match(response.headers.get("set-cookie"), /__Host-silly-csrf=.*; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
});

test("health check reports an unavailable database without exposing details", async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("forged forms and cross-site submissions are blocked before database access", async () => {
  assert.equal((await submit({ message: "A valid sentence", _csrf: "0".repeat(64) })).status, 403);
  assert.equal((await submit({ message: "A valid sentence" }, { Cookie: "" })).status, 403);
  assert.equal((await submit({ message: "A valid sentence" }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await submit({ message: "A valid sentence" }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
});

test("invalid text, repeated fields, and oversized bodies cannot reach MongoDB", async () => {
  for (const message of ["", "    ", "tiny", "x".repeat(2001)]) {
    assert.equal((await submit({ message })).status, 400);
  }
  const fields = new URLSearchParams({ _csrf: token, message: "A valid sentence" });
  fields.append("message", "A duplicate field");
  const duplicate = await fetch(baseUrl, {
    method: "POST", headers: { Cookie: cookie, Origin: origin }, body: fields,
  });
  assert.equal(duplicate.status, 400);
  assert.equal((await submit({ message: "x".repeat(9000) })).status, 413);
  assert.equal((await submit({ message: "A valid sentence", email: "bad email" })).status, 400);
});

test("submission limiter returns 429 with a retry interval", async () => {
  let response;
  for (let index = 0; index < 11; index++) {
    response = await submit({ message: "" });
    if (response.status === 429) break;
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
});

test("development pages do not force HTTPS on localhost", async () => {
  const local = createApp({ production: false, trustProxy: false }).listen(0, "127.0.0.1");
  await new Promise((resolve) => local.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/missing`);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /upgrade-insecure-requests/);
    assert.equal(response.headers.get("strict-transport-security"), null);
    assert.doesNotMatch(response.headers.get("set-cookie"), /; Secure/);
  } finally {
    await new Promise((resolve) => local.close(resolve));
  }
});
