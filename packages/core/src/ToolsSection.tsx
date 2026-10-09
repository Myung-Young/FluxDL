import { useCallback, useEffect, useState } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { DownloadEngine, EngineVersions } from "./engine.js";
import type { DoctorCheck, DoctorReport } from "./doctor.js";
import { TOOL_MANIFESTS, type ToolManifest } from "./tools.js";
import { formatStr, useStrings } from "./locale.js";
import type { SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";

export interface ToolsSectionProps {
  readonly engine: Pick<
    DownloadEngine,
    | "getEngineVersion"
    | "updateEngine"
    | "repairEngine"
    | "rollbackTool"
    | "reinstallTool"
    | "runDoctor"
    | "writeClipboard"
  >;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly hidden: boolean;
}

const TOOL_IDS: readonly string[] = ["yt-dlp", "ffmpeg", "gallery-dl", "deno", "aria2c"];

function versionOf(manifest: ToolManifest, versions: EngineVersions | null): string | null {
  if (versions === null) return null;
  switch (manifest.id) {
    case "yt-dlp":
      return versions.ytdlp === "unknown" ? null : versions.ytdlp;
    case "ffmpeg":
      return versions.ffmpeg;
    case "gallery-dl":
      return versions.galleryDl ?? null;
    case "deno": {
      const denoPath = versions.toolPaths?.deno ?? null;
      if (denoPath === null) return null;
      const runtime = versions.jsRuntime ?? "present";
      return runtime;
    }
    case "aria2c":
      return versions.aria2c ?? null;
    default:
      return null;
  }
}

function pathOf(manifest: ToolManifest, versions: EngineVersions | null): string | null {
  const paths = versions?.toolPaths;
  if (paths === undefined) return null;
  switch (manifest.id) {
    case "yt-dlp":
      return paths["ytDlp"] ?? null;
    case "ffmpeg":
      return paths["ffmpeg"] ?? null;
    case "gallery-dl":
      return paths["galleryDl"] ?? null;
    case "deno":
      return paths["deno"] ?? null;
    case "aria2c":
      return paths["aria2c"] ?? null;
    default:
      return null;
  }
}

/**
 * Tools & Engines section (Phase 2): versions, paths, Update / Reinstall /
 * Rollback per bundled tool, yt-dlp channel, Update-all, last-checked time,
 * and the Doctor health check with one-click fixes. External tools
 * (deno/aria2c) are detected only — the app never downloads executables.
 */
export function ToolsSection({ engine, settings, toast, hidden }: ToolsSectionProps): React.JSX.Element {
  const S = useStrings(settings);
  const saved = useStore(settings, (s) => s.settings);
  const [versions, setVersions] = useState<EngineVersions | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void engine
      .getEngineVersion()
      .then((v) => {
        setVersions(v);
      })
      .catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    // getEngineVersion spawns every tool binary: fetch once per mount, then
    // only after an op (Refresh via Update-all/doctor). Unhide churn must
    // not re-spawn the world on every Settings visit.
    if (hidden || versions !== null) return;
    refresh();
  }, [hidden, refresh, versions]);

  const stampCheck = (): void => {
    void settings
      .getState()
      .save({ lastToolCheckAt: Date.now() })
      .catch(() => undefined);
  };

  const fail = (err: unknown): void => {
    setBusy(null);
    toast
      .getState()
      .push(err instanceof Error && err.message.length > 0 ? err.message : S.settings.saveFailed, "error");
    refresh();
  };

  const runOp = (key: string, op: () => Promise<unknown>, done?: string): void => {
    setBusy(key);
    void op()
      .then(() => {
        setBusy(null);
        if (done !== undefined) toast.getState().push(done, "success");
        refresh();
      })
      .catch(fail);
  };

  const fixLabel = (check: DoctorCheck): string => {
    switch (check.fix) {
      case "update":
        return S.settings.toolsUpdate;
      case "repair":
        return S.errors.actionRepair;
      case "reinstall":
        return S.settings.toolsReinstall;
      case "rollback":
        return S.settings.toolsRollback;
      default:
        return S.settings.toolsUpdate;
    }
  };

  const fixGuidance = (check: DoctorCheck): string | null => {
    if (check.fix === "install-guide") {
      const manifest = TOOL_MANIFESTS.find((t) => t.id === check.id);
      return formatStr(S.settings.toolsInstallGuide, { exe: manifest?.exe ?? check.id });
    }
    if (check.fix === "open-settings") {
      return formatStr(S.settings.toolsOpenSettings, { section: check.label });
    }
    return null;
  };

  const fixCheck = (check: DoctorCheck): void => {
    switch (check.fix) {
      case "update":
        runOp(`fix-${check.id}`, () => engine.updateEngine(), S.settings.toolsUpdated);
        break;
      case "repair":
        runOp(`fix-${check.id}`, () => engine.repairEngine(), S.settings.toolsUpdated);
        break;
      case "reinstall":
      case "rollback":
        if (check.id !== "yt-dlp" && check.id !== "ffmpeg" && check.id !== "gallery-dl") {
          toast.getState().push(check.detail, "info");
          return;
        }
        runOp(
          `fix-${check.id}`,
          () =>
            check.fix === "rollback"
              ? engine.rollbackTool(check.id).then(() => engine.getEngineVersion())
              : engine.reinstallTool(check.id),
          S.settings.toolsUpdated,
        );
        break;
      case "install-guide": {
        const manifest = TOOL_MANIFESTS.find((t) => t.id === check.id);
        toast
          .getState()
          .push(
            formatStr(S.settings.toolsInstallGuide, { exe: manifest?.exe ?? check.id }),
            "info",
          );
        break;
      }
      case "open-settings":
        toast.getState().push(formatStr(S.settings.toolsOpenSettings, { section: check.label }), "info");
        break;
      default:
        break;
    }
  };

  const copyReport = (): void => {
    if (doctor === null) return;
    const text = doctor.checks
      .map((c) => `[${c.status}] ${c.label}: ${c.detail}`)
      .join("\n");
    void engine
      .writeClipboard(`FluxDL doctor (${new Date(doctor.checkedAt).toISOString()})\n${text}`)
      .then((ok) => {
        toast.getState().push(ok ? S.settings.saved : S.settings.saveFailed, ok ? "success" : "error");
      })
      .catch(() => undefined);
  };

  const lastChecked =
    saved.lastToolCheckAt === null
      ? S.settings.toolsNeverChecked
      : formatStr(S.settings.toolsLastChecked, {
          when: new Date(saved.lastToolCheckAt).toLocaleString(),
        });

  return (
    <section className="grabber-card" aria-label={S.settings.toolsTitle} hidden={hidden}>
      <h2 className="dl-title">{S.settings.toolsTitle}</h2>
      {TOOL_MANIFESTS.filter((m) => TOOL_IDS.includes(m.id)).map((m) => {
        const version = versionOf(m, versions);
        const path = pathOf(m, versions);
        const bundled = m.installMode === "bundled";
        return (
          <article key={m.id} className="grabber-card">
            <h3 className="dl-title">{m.name}</h3>
            <p className="muted">
              {version ?? S.settings.toolsMissing}
              {path !== null && path.length > 0 ? ` · ${path}` : ""}
            </p>
            <p className="muted">{m.description}</p>
            <div className="chip-row">
              {m.id === "yt-dlp" && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => {
                    runOp(`update-${m.id}`, () => engine.updateEngine(), S.settings.toolsUpdated);
                  }}
                >
                  {S.settings.toolsUpdate}
                </button>
              )}
              {bundled && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => {
                    runOp(`reinstall-${m.id}`, () => engine.reinstallTool(m.id), S.settings.toolsUpdated);
                  }}
                >
                  {S.settings.toolsReinstall}
                </button>
              )}
              {(m.id === "yt-dlp" || m.id === "gallery-dl") && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => {
                    runOp(`rollback-${m.id}`, () =>
                      engine.rollbackTool(m.id).then(() => engine.getEngineVersion()),
                    );
                  }}
                >
                  {S.settings.toolsRollback}
                </button>
              )}
            </div>
          </article>
        );
      })}
      <label className="field-label" htmlFor="set-ytdlp-channel">
        {S.settings.toolsChannel}
      </label>
      <select
        id="set-ytdlp-channel"
        className="input"
        value={saved.ytdlpChannel}
        onChange={(e) => {
          const v = e.target.value;
          void settings
            .getState()
            .save({ ytdlpChannel: v === "nightly" ? "nightly" : "stable" })
            .catch(() => undefined);
        }}
      >
        <option value="stable">stable</option>
        <option value="nightly">nightly</option>
      </select>
      <div className="chip-row">
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            runOp("update-all", () => engine.updateEngine(), S.settings.toolsUpdated);
            stampCheck();
          }}
        >
          {S.settings.toolsUpdateAll}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            setBusy("doctor");
            void engine
              .runDoctor()
              .then((report) => {
                setBusy(null);
                setDoctor(report);
                stampCheck();
              })
              .catch(fail);
          }}
        >
          {S.settings.toolsRunDoctor}
        </button>
        {doctor !== null && (
          <button type="button" className="btn btn-small" onClick={copyReport}>
            {S.logs.copyLog}
          </button>
        )}
      </div>
      <p className="muted" role="status">
        {lastChecked}
      </p>
      {doctor !== null && (
        <div>
          <p className="muted" role="status">
            {doctor.ok ? S.settings.toolsDoctorOk : S.settings.toolsMissing}
          </p>
          {doctor.checks.map((c) => {
            const guidance = fixGuidance(c);
            return (
              <article key={c.id} className="grabber-card">
                <span className="badge">{c.status}</span> <span className="dl-title">{c.label}</span>
                <p className="muted">{c.detail}</p>
                {guidance !== null && <p className="muted">{guidance}</p>}
                {c.fix !== undefined && guidance === null && (
                  <div className="chip-row">
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy !== null}
                      onClick={() => {
                        fixCheck(c);
                      }}
                    >
                      {fixLabel(c)}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
