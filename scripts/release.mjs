/**
 * One-command publish: tag + GitHub Release + asset upload.
 *
 * Usage: pnpm release (or GH_TOKEN=... pnpm release)
 * Reads the version from the root package.json, takes the matching
 * CHANGELOG.md section as the notes, tags vX.Y.Z, and uploads
 * release/FluxDL-Setup-<v>.exe + release/FluxDL-Portable-<v>.exe.
 * Uses GH_TOKEN/GITHUB_TOKEN if set, otherwise falls back to local git credentials.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function sh(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
if (token.length === 0) {
  try {
    const creds = execFileSync("git", ["credential", "fill"], {
      cwd: ROOT,
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
    });
    for (const line of creds.split("\n")) {
      if (line.startsWith("password=")) {
        token = line.slice("password=".length).trim();
        break;
      }
    }
  } catch {
    // fallback
  }
}
if (token.length === 0) fail("set GH_TOKEN (or GITHUB_TOKEN) with contents:write, or login with git.");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const cliVersion = process.argv[2]?.replace(/^v/, "");
const version = cliVersion ?? (typeof pkg.version === "string" ? pkg.version : "");
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`bad version: ${version}`);
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

// Stale-bundle guard (v1.8.1): the 1.8.0 portable shipped a renderer that
// predated its own changelog entry, so the Changelog tab stopped at 1.7.2.
// The built renderer is plain text — the release version string must occur
// in it (changelog entry + version displays), or the bundle is stale.
{
  const { readdirSync } = await import("node:fs");
  const assetsDir = join(ROOT, "apps", "desktop", "out", "renderer", "assets");
  let hits = 0;
  try {
    for (const name of readdirSync(assetsDir)) {
      if (!name.endsWith(".js")) continue;
      const text = readFileSync(join(assetsDir, name), "utf8");
      if (text.includes(version)) hits += 1;
    }
  } catch {
    fail("cannot read built renderer (run pnpm build first).");
  }
  if (hits === 0) {
    fail(
      `built renderer has no "${version}" string — stale bundle? Delete apps/desktop/out and rebuild.`,
    );
  }
  console.log(`renderer bundle check: "${version}" found in ${hits} chunk(s)`);
}

// SHA-256 checksums (Phase 7): users verify SmartScreen-flagged binaries
// against these before running. Written next to the artifacts, uploaded too.
const sumsPath = join(ROOT, "release", "SHA256SUMS.txt");
{
  const lines = [];
  for (const f of [setup, portable]) {
    const hash = createHash("sha256").update(readFileSync(f)).digest("hex");
    lines.push(`${hash}  ${f.split(/[\\/]/).pop()}`);
  }
  writeFileSync(sumsPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`wrote ${sumsPath}`);
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
  try {
    sh("git", ["push", "origin", tag]);
  } catch {
    // already pushed
  }
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
  console.log(`release ${tag} already exists, updating notes and assets`);
  await api(`/repos/${slug}/releases/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: tag, body, draft: false, prerelease: false }),
  });
}

const assets = [setup, portable, sumsPath];
const bomPath = join(ROOT, "release", "bom.json");
if (existsSync(bomPath)) {
  assets.push(bomPath);
} else {
  console.log("no release/bom.json (SBOM skipped; generate with: pnpm exec cyclonedx-npm --ignore-npm-errors --output-file release/bom.json --output-format JSON)");
}
for (const file of assets) {
  const name = file.split(/[\\/]/).pop();
  const size = statSync(file).size;

  if (existing && Array.isArray(existing.assets)) {
    const prev = existing.assets.find((a) => a.name === name);
    if (prev) {
      console.log(`deleting previous asset ${name}...`);
      await fetch(prev.url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FluxDL-release-script",
        },
      });
    }
  }

  const url = uploadUrl.replace(/\{.*\}$/, "") + `?name=${encodeURIComponent(name)}`;
  const buf = readFileSync(file);
  console.log(`uploading ${name} (${(size / (1024 * 1024)).toFixed(1)} MB)...`);
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
console.log(`\n🎉 Release published successfully!\nURL: https://github.com/${slug}/releases/tag/${tag}`);
