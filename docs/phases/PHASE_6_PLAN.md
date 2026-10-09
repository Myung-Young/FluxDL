# PHASE 6 PLAN — Remote API, PWA, Extension (loopback slice)

Source: docs/UPDATE_PLAN.md § Phase 6. Recon 2026-10-08: no prior art in
repo (no `safeStorage`, no HTTP server, no extension dir); queue ownership
lives renderer-side (`QueueController` + `queue.json` mirror on every
change); main owns `DesktopEngine` active jobs + deep-link broadcasts.

## 0. Slice order (user choice)

1. **6A — Loopback API server first**: `127.0.0.1` only, token auth,
   validation tests. No LAN listen in this slice.
2. **6B — PWA**: tiny page served by the server (same origin, no CORS).
3. **6C — Extension**: MV3 skeleton, unpacked load, token in
   `chrome.storage.local`. Build script only, no store publishing.
4. **Threat review BEFORE any LAN mode** (§6 below). LAN is NOT implemented
   here — explicit opt-in, QR pairing, IP allowlist, auto-disable stay
   roadmap until the review lands.

## 1. Tasks

### A. Core protocol — `packages/core/src/remoteApi.ts` (new, pure)

- Types: `RemoteApiOp` (`status|rotate|reveal|drain|audit`), `RemoteApiAction`
  (`add-urls` | `job-action: pause|resume|cancel`), `ApiJobView` (id, url,
  title, status, progress, speed, eta — **no filesystem paths**).
- Pure helpers (all unit-tested):
  - `parseBearer(authHeader)` → token | null (constant-shape, no logging).
  - `tokensEqual(a, b)` — timing-safe compare over equal-length UTF-8.
  - `isLoopbackHost(host, port)` — Host header must be `127.0.0.1:port`
    or `localhost:port` (DNS-rebinding gate).
  - `originAllowed(origin, port)` — absent or same loopback origin only.
  - `parseAddBody(raw)` — `{url?|urls?}` → validated URL list (http/https,
    ≤2048 chars each, max 50, trimmed; garbage → typed error, never throw
    with secrets).
  - `createRateLimiter({limit, windowMs, now})` — per-IP sliding window
    (default 120 req/min), pure with injected clock.
  - `redactAuditEntry()` — audit keeps method/path/status only, never
    headers, bodies, or tokens. Ring buffer cap 100.
  - `buildPairingLink(port, token)` / `parsePairingLink(text)` — the "copy
    pairing link" payload (`http://127.0.0.1:PORT/#token=…`, fragment never
    sent to the server).
- No Electron/Node imports (core rule). `normalizeUrl` reuse for add URLs.

### B. Server — `apps/desktop/src/main/localApi.ts` (new)

- `node:http` only (no new dependency). Binds `127.0.0.1` explicitly; on
  `EADDRINUSE` tries the next 10 ports and reports the actual port (spec:
  auto-pick + show the port). Any other bind error → status error, never a
  crash, never blocks boot.
- Auth: `Authorization: Bearer <token>` on every `/api/*`. Token ≥32 random
  bytes (base64url), generated with `crypto.randomBytes`, stored
  safeStorage-encrypted in `<userData>/api-token.dat` (DPAPI on Windows).
  **Encryption unavailable → server refuses to start** (`status.error =
  "encryption-unavailable"`). No plaintext fallback (global secrets rule).
- Routes:
  - `GET /health` → `{ok, app, version}` (auth required — no unauth surface).
  - `GET /api/status` → `{running, port, queue:{active,queued,errors},
    engine:{active}}` (counts only, no paths).
  - `GET /api/queue` → `ApiJobView[]` from `queue.json` snapshot + engine
    live progress map (paths stripped at the boundary, tested).
  - `POST /api/add` (body ≤32 KB) → validate → queue `add-urls` drain
    action → `202 {accepted:n}`. Renderer confirms via the existing
    deep-link/batch path semantics (fluxdl:// always confirms — same here).
  - `POST /api/job {id, action}` → active engine jobs act immediately
    (pause/resume/cancel); anything else becomes a `job-action` drain
    action for the renderer queue store (queued jobs included).
  - `GET /` + `/manifest.webmanifest` → PWA (same origin).
  - Everything else → 404 JSON. Errors are JSON `{error}` with safe codes
    (`unauthorized|forbidden|bad-request|rate-limited|…`); messages carry no
    paths, tokens, or argv.
- Defenses: Host-header gate (403), Origin allowlist (403), rate limit
  (429 + `Retry-After`), body cap (413), JSON-only, no `Server` version
  banner, audit ring (redacted). No endpoint takes a filesystem path or
  executes a command (spec compliance, pinned by tests).
- Lifecycle: `LocalApiServer` class with injected deps (settings reader,
  token store, queue reader, engine control, deep-link sink) so tests run
  headless with a real HTTP socket on a random port. `DesktopEngine` owns
  one instance; `saveSettings` handler re-syncs on `apiEnabled/apiPort`
  change (same pattern as `syncLoginSettings`); `before-quit` closes it.
- Renderer drain: existing Shell 1 s tick also calls
  `remoteApi({op:"drain"})` → executes `add-urls` via the batch path +
  `job-action` via the queue store. No new timers (M4.9 idle-cost lesson:
  drain returns `[]` with no emit/persist when idle).

### C. Engine/IPC wiring — ONE new channel (56→57)

- `engine.ts`: `RemoteApiRequest {op, …}` / `RemoteApiResult` (status |
  token-rotated | token | actions | audit), `DownloadEngine.remoteApi()`,
  `IPC_CHANNELS.remoteApi = "engine:remoteApi"`.
- `ipc.ts` validator (op allow-list, id/action caps like packs), preload
  1:1 mirror, e2e mock mirror + new settings fields, `index.test.ts` pin
  56→57. `saveSettings` handler syncs the server after persist.
- Settings: `apiEnabled: false`, `apiPort: 48127` (clamp 1024–65535).
  Sanitizers + shape-pin + e2e mirror updated together (D68 lesson).

### D. UI + PWA + extension

- Settings "Remote access" section: enable toggle, port field, status line
  (running port / stopped / error), Copy pairing link, Rotate token,
  Test connection (authed `/health`), loopback-only note + LAN-roadmap
  note. Strings EN+MS in parity. Follows the PackStore-in-Settings pattern
  (no new view/nav).
- PWA (`served by localApi.ts`, static strings in the same file — no path
  resolution issues packaged vs dev): single HTML (inline CSS/JS), token
  field (localStorage), Add form, queue list (2 s poll), pause/resume/
  cancel buttons, health dot. `manifest.webmanifest` with `share_target`
  (`GET /?share=…` pre-fills). No build step.
- `extension/` (new top-level dir): `manifest.json` (MV3, Chromium
  `service_worker`; one-line swap documented for Firefox `scripts`),
  `background.js` (context menus for link/image/video/audio/page + action
  click → `POST /api/add` with stored token), `popup.html` + `popup.js`
  (server URL + token in `chrome.storage.local`, Send-current-tab, status).
  Unpacked load — no build script needed (deviation from "build script
  only": there is nothing to build; documented here).
- Notifiers (Discord/Telegram) → **6B slice** (deferred, not dropped): the
  safeStorage token store establishes the secrets pattern they will reuse;
  needs its own settings + UI + webhook tests.

## 2. Files touched (surgical)

New: core `remoteApi.ts(+test)`, main `localApi.ts(+test)`,
`extension/{manifest.json,background.js,popup.html,popup.js}`.
Edit: `types.ts` (2 settings fields), `settings.ts(+test)`,
`engine.ts` (+method/channel/result types), `desktopEngine.ts` (own +
implement `remoteApi`), `ipc.ts`, preload, e2e mock, `index.test.ts` (pin),
`Shell.tsx` (drain on tick), `SettingsScreen.tsx` (+Remote section),
`strings.ts` (parity), `persist.ts`? (no — token file helpers live in
`localApi.ts`), `DECISIONS.md`, `CHANGELOG.md` (Unreleased), `ROADMAP.md`
(one line: loopback done, LAN pending review).

One new IPC channel (56→57). No new dependencies.

## 3. Risks

- Queue ownership split: main serves `queue.json` (stale ≤1 change behind)
  + live engine progress; renderer drain executes mutations. Documented;
  drain is the single mutation path for queued jobs (no dual-owner writes).
- safeStorage needs `app.whenReady()` + a loaded userData dir; tests inject
  a fake store. Encryption-off (portable oddities) fails closed with a
  readable status error, not a silent plaintext file.
- Port scans on loopback: token is the boundary (≥32 bytes, rotate/revoke
  via UI); Host/Origin gates blunt rebinding; rate limit blunts brute
  force (2^256 space makes it moot anyway).
- PWA token in localStorage on `http://127.0.0.1` — same-machine only,
  acceptable for loopback; LAN review must revisit transport (HTTPS eval).
- Extension origin `chrome-extension://<id>` is NOT allowlisted: extension
  calls are same-requirement Bearer requests; Host gate still applies
  (destination is loopback). CORS preflight from extensions: answer 204
  with no `Access-Control-Allow-Origin` echo for non-matching origins —
  fetch with `mode: no-cors`? No: extension pages may call with full CORS;
  answer preflight ONLY for same-origin (PWA). Extension background worker
  fetch to `http://127.0.0.1` needs `host_permissions` (declared) and sends
  no Origin that we must echo — tested manually (checklist item).

## 4. Test plan

- Core pure: bearer parse, timing-safe equal (len-mismatch false), host
  gate (evil.com/localhost:evil-port rejected), origin gate, add-body
  shapes (single/multi/over-cap/bad-scheme/oversize), rate limiter
  (allow→block→window-reset), pairing link round-trip, audit redaction.
- Server (real socket, random port, fake deps): unauthorized→401 (no body
  leak), wrong Host→403, bad Origin→403, add→202 + drain returns action,
  job-action→engine passthrough vs drain, queue strips paths, rate
  limit→429, oversize→413, unknown→404, bind-conflict auto-picks next.
- IPC/validator: op allow-list, id/action caps, unknown-op throw.
- Settings: merge clamps port, drops garbage, defaults off.
- Existing: full gates + live archive test + e2e smoke (mock drift!).
- Manual checklist: enable → copy pairing link → PWA in Edge (add +
  pause/cancel + poll) → extension unpacked (context menu + popup) →
  rotate (old token 401s) → disable (connection refused) → restart
  (server back when enabled, token stable).

## 5. Definition of Done

A link POSTed with a valid token lands in the app (via drain confirm path)
and downloads; queue/status reflect it; pause/resume/cancel work for active
jobs and (via drain) queued ones; wrong/missing token, foreign Host/Origin,
oversize bodies and floods are all rejected with safe errors; server off by
default; token rotates; no FS path or command execution reachable; gates
green; e2e green.

## 6. Threat review (REQUIRED before any LAN mode)

Loopback slice mitigations (implemented): fixed `127.0.0.1` bind (no
`0.0.0.0`), Bearer ≥256-bit, safeStorage at rest, Host-header pin (DNS
rebinding), same-origin-only CORS, per-IP rate limit, 32 KB body cap,
redacted audit ring, no path/command endpoints, PWA same-origin.

LAN mode (NOT implemented — do not bind `0.0.0.0` without all of these):
explicit opt-in + big warning; QR pairing with one-time token (pairing link
+ confirm on screen); optional IP allowlist; auto-disable timer; HTTPS
evaluation recorded in DECISIONS.md (options: self-signed + manual trust,
mkcert-style local CA, or plaintext-on-LAN with a written risk acceptance —
none chosen yet); token never in URLs (fragment only); extension ID
allowlist; audit export. Until then the UI says loopback-only.
