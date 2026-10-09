#!/usr/bin/env node
/**
 * Tiny `fluxdl` CLI (Phase 6B, E-item): talks to a running FluxDL instance
 * over its loopback/LAN API. No dependencies (global fetch only).
 *
 * The token never lives here: pass --token or set FLUXDL_TOKEN (the app's
 * pairing link carries it after `#token=`). Usage:
 *
 *   node scripts/fluxdl.mjs add <url>... [--server http://127.0.0.1:48127] [--token ...]
 *   node scripts/fluxdl.mjs status [--server ...] [--token ...]
 *   node scripts/fluxdl.mjs pause|resume|cancel <job-id> [...]
 */

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

function fail(message) {
  console.error(`fluxdl: ${message}`);
  process.exit(1);
}

async function call(server, token, path, init) {
  let res;
  try {
    res = await fetch(`${server}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  } catch (err) {
    fail(`cannot reach ${server} (is Remote access enabled?): ${err instanceof Error ? err.message : err}`);
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

async function main() {
  const [command, ...rest] = args.filter((a) => !a.startsWith("--"));
  const server = (flag("--server") ?? process.env["FLUXDL_SERVER"] ?? "http://127.0.0.1:48127").replace(/\/+$/, "");
  const token = flag("--token") ?? process.env["FLUXDL_TOKEN"] ?? "";
  if (!/^http:\/\/[^/]+$/.test(server)) fail("bad --server (http://host:port only).");
  if (token.length === 0) fail("missing token: --token or FLUXDL_TOKEN (see Settings → Remote access).");

  if (command === "add") {
    const urls = rest.filter((u) => u.length > 0);
    if (urls.length === 0) fail("add needs at least one URL.");
    const { status, body } = await call(server, token, "/api/add", {
      method: "POST",
      body: JSON.stringify(urls.length === 1 ? { url: urls[0] } : { urls }),
    });
    if (status !== 202) fail(`server said ${status}: ${body.error ?? "unknown"}`);
    console.log(`Accepted (${body.accepted ?? urls.length}) — confirm in the app.`);
    return;
  }
  if (command === "status") {
    const { status, body } = await call(server, token, "/api/status");
    if (status !== 200) fail(`server said ${status}: ${body.error ?? "unknown"}`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (command === "pause" || command === "resume" || command === "cancel") {
    if (rest.length === 0) fail(`${command} needs at least one job id (see status).`);
    for (const id of rest) {
      const { status: code, body } = await call(server, token, "/api/job", {
        method: "POST",
        body: JSON.stringify({ id, action: command }),
      });
      console.log(`${command} ${id}: ${code === 200 ? "engine" : code === 202 ? "queued" : `error ${code} (${body.error ?? "?"})`}`);
    }
    return;
  }
  fail("usage: fluxdl.mjs (add <url>... | status | pause|resume|cancel <id>...) [--server URL] [--token TOKEN]");
}

await main();
