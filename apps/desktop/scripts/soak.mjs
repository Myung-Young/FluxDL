/**
 * Idle CPU/RAM soak (M4.8).
 *
 * Launches the built app, hides the window (the tray owns the lifetime), then
 * samples `app.getAppMetrics()` for every process so idle cost can be compared
 * across releases. Run it after `pnpm build`:
 *
 *   node scripts/soak.mjs                 # 10 minutes (release default)
 *   node scripts/soak.mjs --minutes 2     # quick check while iterating
 *   node scripts/soak.mjs --minutes 10 --json
 *
 * Everything is local: no network, no telemetry, nothing is written outside a
 * throwaway userData directory.
 */
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const MINUTES = Number(flag("minutes", "10"));
const AS_JSON = args.includes("--json");
const SAMPLE_MS = 30_000;
const WARMUP_MS = 20_000;

const mb = (kb) => Math.round((kb / 1024) * 10) / 10;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = mkdtempSync(join(tmpdir(), "fluxdl-soak-"));
const app = await electron.launch({
  args: [".", `--user-data-dir=${userData}`],
  cwd: appDir,
});

const samples = [];
try {
  await app.firstWindow({ timeout: 60_000 });
  // Warm up: JIT, the MediaInfo LRU, first paint.
  await wait(WARMUP_MS);
  // Hidden in the tray, which is how the app actually idles between sessions.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.hide();
  });

  const total = MINUTES * 60_000;
  for (let elapsed = 0; elapsed < total; elapsed += SAMPLE_MS) {
    await wait(Math.min(SAMPLE_MS, total - elapsed));
    // NOTE: this callback is serialized into the main process, so it cannot
    // close over helpers from this file.
    const metrics = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((m) => ({
        type: m.type,
        cpu: Math.round((m.cpu?.percent ?? 0) * 100) / 100,
        workingSetMb: Math.round(((m.memory?.workingSetSize ?? 0) / 1024) * 10) / 10,
      })),
    );
    const at = Math.round((elapsed + SAMPLE_MS) / 1000);
    samples.push({ at, metrics });
    const summary = metrics
      .map((m) => `${m.type}: ${String(m.cpu)}% cpu / ${String(m.workingSetMb)} MB`)
      .join("  ");
    process.stdout.write(`t+${String(at)}s  ${summary}\n`);
  }
} finally {
  await app.close().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
}

function aggregate(type) {
  const rows = samples.flatMap((s) => s.metrics.filter((m) => m.type === type));
  if (rows.length === 0) return null;
  const cpu = rows.map((r) => r.cpu);
  const ram = rows.map((r) => r.workingSetMb);
  const avg = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100;
  return {
    samples: rows.length,
    cpuAvg: avg(cpu),
    cpuMax: Math.max(...cpu),
    ramStartMb: ram[0],
    ramEndMb: ram[ram.length - 1],
    ramGrowthMb: Math.round((ram[ram.length - 1] - ram[0]) * 10) / 10,
  };
}

const report = {
  minutes: MINUTES,
  types: ["Browser", "Tab", "GPU", "Utility"].map((t) => ({
    type: t,
    ...(aggregate(t) ?? { skipped: true }),
  })),
};

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`\nIdle soak: ${String(MINUTES)} min, window hidden\n`);
  for (const row of report.types) {
    if (row.skipped === true) {
      process.stdout.write(`  ${row.type.padEnd(8)} (no samples)\n`);
      continue;
    }
    process.stdout.write(
      `  ${row.type.padEnd(8)} cpu avg ${String(row.cpuAvg)}% max ${String(row.cpuMax)}%` +
        `  ram ${String(row.ramStartMb)} -> ${String(row.ramEndMb)} MB` +
        ` (${row.ramGrowthMb >= 0 ? "+" : ""}${String(row.ramGrowthMb)})\n`,
    );
  }
}