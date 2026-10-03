# Signing FluxDL for Windows (SmartScreen)

**Status: v1.4.0 is NOT signed.** Nothing in this repository signs anything.
This document exists so that signing *can* be turned on without touching code,
and so nobody is surprised by the SmartScreen warning.

## Why Windows warns about an unsigned build

Windows Defender SmartScreen shows the blue *"Windows protected your PC"*
dialog for executables it cannot attribute to a known publisher. The warning
is about **reputation and publisher identity**, not about malware:

- Unsigned binaries have no publisher signature at all.
- Even signed binaries are flagged when the certificate is new or the file has
  almost no download reputation — the first days after release are always the
  worst, and reputation builds over time from real-world usage.
- The portable build is a single self-extracting `.exe`, which looks the most
  suspicious of all to a heuristic scanner.

What the user sees, and the documented way past it: click **More info**, then
**Run anyway**. Always tell users this explicitly — a silent warning on a
downloaded tool is exactly the pattern people are trained to click through.

## What is actually in the build config today

`apps/desktop/package.json` → `build` contains no certificate, no signing tool
and no secret. electron-builder therefore produces unsigned artifacts, which is
the intended, honest state of this repository.

electron-builder reads signing material from the environment, so enabling
signing needs **no code change and no committed secret**:

| Variable | Purpose |
| --- | --- |
| `CSC_LINK` | Path to a `.pfx`/`.p12`, or a base64-encoded certificate. |
| `CSC_KEY_PASSWORD` | Password for that certificate. |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Set to `false` so a certificate installed on the build machine is never picked up silently. |

`.gitignore` already excludes `.env*`, `*.pem`, `*.p12` and `*.pfx`. Keep it
that way: certificates belong in the CI secret store or in a local file that is
never committed.

## Realistic options (ordered by cost)

1. **No certificate** — ship unsigned and document *More info → Run anyway*.
   Free, and honest. Fine for a personal or internal build.
2. **SignPath for open source** — free for qualifying OSS projects; they sign
   your artifacts in their own infrastructure, so no key ever touches your
   machine. The usual choice for a public repo.
3. **Azure Trusted Signing** — Microsoft-run signing service, per-artifact or
   per-account identity, billed per signature. Requires an Azure tenant and an
   identity validation step; still much cheaper than a code-signing certificate.
4. **Standard OV / EV code-signing certificate** — the traditional route.
   EV additionally gets an instant SmartScreen reputation boost (Microsoft's
   requirement for that has changed over time, so verify current policy rather
   than trusting old blog posts). Most expensive: yearly cost per certificate.

Whichever route you pick, the mechanics are the same: put `CSC_LINK` and
`CSC_KEY_PASSWORD` into the environment of the machine or CI runner that runs
`pnpm dist`, and verify the artifacts afterwards:

```powershell
# Should print a valid signature and the publisher name.
Get-AuthenticodeSignature .\release\FluxDL-Setup-1.4.0.exe | Format-List *
```

If the output says `Status: NotSigned`, the environment variables did not reach
the build (check that they are exported in the same shell, and that
`CSC_IDENTITY_AUTO_DISCOVERY` is not the only thing you set).

## Verifying an unsigned build is still sound

Signing is reputation, not integrity. To keep trust high while unsigned:

- Publish SHA-256 sums next to the artifacts so users can verify the download
  itself:

  ```powershell
  Get-FileHash .\release\FluxDL-Setup-1.4.0.exe -Algorithm SHA256
  ```

- Keep `scripts/fetch-binaries.mjs` hash-verifying the bundled yt-dlp and ffmpeg
  (it already does, on every fetch and again at runtime in `binaries.ts`).
- Prefer the NSIS installer over the portable exe when distributing to others;
  the portable build trips more heuristics.

## Release checklist

- [ ] `pnpm fetch:binaries` (hash-verified)
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [ ] `pnpm --filter @grabber/desktop test:e2e`
- [ ] `pnpm dist`
- [ ] Artifact sizes recorded in `DECISIONS.md` (ffmpeg floats on `latest`, so
      expect a small unexplained delta)
- [ ] `Get-AuthenticodeSignature` run — record `NotSigned` honestly, or the
      publisher name if signing is configured
- [ ] Portable build launched once from a path containing spaces