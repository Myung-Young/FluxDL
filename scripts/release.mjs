/**
 * One-command publish: tag + GitHub Release + asset upload.
 *
 * Usage: GH_TOKEN=... pnpm release
 * Reads the version from the root package.json, takes the matching
 * CHANGELOG.md section as the notes, tags vX.Y.Z, and uploads
 * release/FluxDL-Setup-<v>.exe + release/FluxDL-Portable-<v>.exe.
 * Needs GH_TOKEN (or GITHUB_TOKEN) with contents:write.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
if (token.length === 0) fail("set GH_TOKEN (or GITHUB_TOKEN) with contents:write.");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = typeof pkg.version === "string" ? pkg.version : "";
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`bad version in package.json: ${version}`);
const tag = `v${version}`;

let remote = "";
try {
  remote = sh("git", ["remote", "get-url", "origin"]);
} catch {
  fail("no git origin remote.");
}
const slug = (remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/) ?? [])[1] ?? "";
if (!slug) fail(`cannot parse GitHub slug from origin: ${remote}`);

const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const section = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][\\s\\S]*?(?=^## \\[|\\Z)`, "m").exec(
  changelog,
);
if (!section) fail(`no CHANGELOG.md section for [${version}].`);
const body = section[0].trim();

const setup = join(ROOT, "release", `FluxDL-Setup-${version}.exe`);
const portable = join(ROOT, "release", `FluxDL-Portable-${version}.exe`);
for (const f of [setup, portable]) {
  if (!existsSync(f)) fail(`missing artifact (run pnpm dist first): ${f}`);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "FluxDL-release-script",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) fail(`GitHub API ${res.status}: ${JSON.stringify(data)?.slice(0, 300)}`);
  return data;
};

const existingTag = (() => {
  try {
    sh("git", ["rev-parse", "--verify", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
})();
if (!existingTag) {
  sh("git", ["tag", tag]);
  sh("git", ["push", "origin", tag]);
  console.log(`tagged + pushed ${tag}`);
} else {
  console.log(`tag ${tag} already exists, reusing`);
}

const lookup = await fetch(
  `https://api.github.com/repos/${slug}/releases/tags/${encodeURIComponent(tag)}`,
  {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "FluxDL-release-script",
    },
  },
);
const existing = lookup.ok ? await lookup.json().catch(() => null) : null;
let uploadUrl =
  existing !== null && typeof existing.upload_url === "string" ? existing.upload_url : null;
if (uploadUrl === null) {
  const created = await api(`/repos/${slug}/releases`, {
    method: "POST",
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false }),
  });
  uploadUrl = created.upload_url;
  console.log(`created release ${tag}`);
} else {
  console.log(`release ${tag} already exists, uploading assets to it`);
}

for (const file of [setup, portable]) {
  const name = file.split(/[\\/]/).pop();
  const size = statSync(file).size;
  const url = uploadUrl.replace(/\{.*\}$/, "") + `?name=${encodeURIComponent(name)}`;
  const buf = readFileSync(file);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "User-Agent": "FluxDL-release-script",
    },
    body: buf,
  });
  if (!res.ok) fail(`asset upload failed (${res.status}) for ${name}`);
  console.log(`uploaded ${name} (${size} bytes)`);
}
console.log("done.");
