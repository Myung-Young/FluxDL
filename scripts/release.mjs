#!/usr/bin/env node
/**
 * Automated GitHub Release Publisher for FluxDL.
 *
 * Reads version from package.json, extracts section from CHANGELOG.md,
 * verifies tag v<version> on git, and uploads release/FluxDL-Setup-<version>.exe
 * & release/FluxDL-Portable-<version>.exe directly to GitHub Releases.
 *
 * Authentication:
 * Uses GITHUB_TOKEN / GH_TOKEN env var if present, else automatically
 * queries the local git credential helper.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

function runGit(args, input = "") {
  const res = spawnSync("git", args, {
    input,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();

  try {
    const creds = runGit(["credential", "fill"], "protocol=https\nhost=github.com\n\n");
    for (const line of creds.split("\n")) {
      if (line.startsWith("password=")) {
        return line.slice("password=".length).trim();
      }
    }
  } catch (err) {
    console.warn("[release] Warning: failed to query git credential helper:", err.message);
  }

  throw new Error(
    "GitHub token not found. Please login with git or set GITHUB_TOKEN / GH_TOKEN environment variable.",
  );
}

function getRepoInfo() {
  try {
    const remoteUrl = runGit(["remote", "get-url", "origin"]);
    // Match https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match && match[1] && match[2]) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // fallback
  }
  return { owner: "Myung-Young", repo: "FluxDL" };
}

function extractChangelog(version) {
  const changelogPath = join(process.cwd(), "CHANGELOG.md");
  if (!existsSync(changelogPath)) return `Release v${version}`;

  const text = readFileSync(changelogPath, "utf8");
  const escapedVer = version.replace(/\./g, "\\.");
  const startRegex = new RegExp(`^##\\s*\\[${escapedVer}\\][^\\n]*$`, "m");
  const startMatch = startRegex.exec(text);

  if (!startMatch) {
    return `Release v${version}`;
  }

  const startIndex = startMatch.index;
  const afterStart = text.slice(startIndex + startMatch[0].length);
  const nextSectionMatch = /^##\s*\[/m.exec(afterStart);

  const section = nextSectionMatch
    ? afterStart.slice(0, nextSectionMatch.index)
    : afterStart;

  return section.trim();
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  const version = pkg.version;
  const tag = `v${version}`;
  const releaseTitle = `FluxDL ${tag}`;
  const { owner, repo } = getRepoInfo();
  const token = getGitHubToken();

  console.log(`[release] Preparing release for ${owner}/${repo} ${tag}...`);

  // Ensure git tag exists
  const existingTags = runGit(["tag", "-l", tag]);
  if (!existingTags) {
    console.log(`[release] Tag ${tag} does not exist locally. Creating tag...`);
    runGit(["tag", "-a", tag, "-m", `Release ${tag}`]);
    console.log(`[release] Pushing tag ${tag} to origin...`);
    runGit(["push", "origin", tag]);
  } else {
    console.log(`[release] Tag ${tag} already exists. Pushing tag to origin (if needed)...`);
    try {
      runGit(["push", "origin", tag]);
    } catch {
      // already pushed
    }
  }

  // Check artifacts in release/
  const setupExe = join(process.cwd(), "release", `FluxDL-Setup-${version}.exe`);
  const portableExe = join(process.cwd(), "release", `FluxDL-Portable-${version}.exe`);

  const artifacts = [setupExe, portableExe];
  for (const f of artifacts) {
    if (!existsSync(f)) {
      throw new Error(`Required release artifact not found: ${f}. Run 'pnpm dist' first!`);
    }
  }

  const changelogBody = extractChangelog(version);
  const body = `## What's Changed in FluxDL ${tag}\n\n${changelogBody}\n\n### Downloads\n- **Installer (Setup)**: \`FluxDL-Setup-${version}.exe\`\n- **Portable**: \`FluxDL-Portable-${version}.exe\`\n`;

  console.log(`[release] Checking existing release on GitHub...`);
  const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "FluxDL-Release-Script",
    },
  });

  let release;
  if (checkRes.ok) {
    release = await checkRes.json();
    console.log(`[release] Existing release found (id: ${release.id}). Updating notes...`);
    const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "FluxDL-Release-Script",
      },
      body: JSON.stringify({
        name: releaseTitle,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    if (!updateRes.ok) {
      throw new Error(`Failed to update release: ${await updateRes.text()}`);
    }
    release = await updateRes.json();
  } else if (checkRes.status === 404) {
    console.log(`[release] Creating new release ${tag}...`);
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "FluxDL-Release-Script",
      },
      body: JSON.stringify({
        tag_name: tag,
        name: releaseTitle,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create release: ${await createRes.text()}`);
    }
    release = await createRes.json();
    console.log(`[release] Created release id: ${release.id}`);
  } else {
    throw new Error(`GitHub API check failed: ${await checkRes.text()}`);
  }

  // Upload assets
  const existingAssets = release.assets ?? [];
  for (const filePath of artifacts) {
    const fileName = basename(filePath);
    const existing = existingAssets.find((a) => a.name === fileName);
    if (existing) {
      console.log(`[release] Removing old asset ${fileName}...`);
      await fetch(existing.url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FluxDL-Release-Script",
        },
      });
    }

    const sizeMb = (statSync(filePath).size / (1024 * 1024)).toFixed(1);
    console.log(`[release] Uploading ${fileName} (${sizeMb} MB)...`);
    const fileData = readFileSync(filePath);
    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/octet-stream",
        "User-Agent": "FluxDL-Release-Script",
      },
      body: fileData,
    });

    if (!uploadRes.ok) {
      throw new Error(`Failed to upload ${fileName}: ${await uploadRes.text()}`);
    }
    console.log(`[release] Successfully uploaded ${fileName}!`);
  }

  console.log(`\n🎉 Release published successfully!\nURL: ${release.html_url}`);
}

main().catch((err) => {
  console.error("[release] Error:", err.message);
  process.exit(1);
});
