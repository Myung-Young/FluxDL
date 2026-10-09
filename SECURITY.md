# Security Policy

## Supported versions

Only the latest public release is supported. Update before reporting.

## Reporting a vulnerability

Email the maintainer privately (see the GitHub profile) or open a
**private** report via GitHub Security Advisories. Do **not** open a public
issue for anything that could harm users (token handling, IPC validation,
downloaded-file trust, update integrity).

Please include: app version, Windows version, what you did, what you
expected, and the redacted diagnostics export (Settings → Logs → Copy
diagnostics — secrets are stripped automatically).

## What this project promises

- No telemetry, no accounts, no remote kill-switch. Network calls are only
  engine/tool updates (GitHub/Codeberg releases) and actions you trigger.
- Secrets (API tokens, notifier tokens, cookies) live OS-encrypted
  (DPAPI via Electron safeStorage) or in files you choose. They never
  appear in logs, diagnostics, argv, or IPC responses.
- Downloads run with argument arrays (`shell: false`), URLs are
  validated/normalized before any engine sees them, and executables
  downloaded from finished jobs confirm before opening.
- Releases ship SHA-256 checksums. Builds are currently **unsigned**
  (see `docs/SIGNING.md`): SmartScreen will warn — verify the checksum.

## Out of scope

Social engineering, physical access, or a compromised OS/user account.
FluxDL cannot protect secrets from malware running as your user.
