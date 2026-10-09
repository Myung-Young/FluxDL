import { useCallback, useEffect, useState } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { DownloadEngine, RemoteApiStatus } from "./engine.js";
import { buildLanPairingLink, buildPairingLink } from "./remoteApi.js";
import { formatStr, useStrings } from "./locale.js";
import type { SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";

export interface RemoteSectionProps {
  readonly engine: Pick<DownloadEngine, "remoteApi" | "notifiers" | "writeClipboard">;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly hidden: boolean;
}

/**
 * Remote access section (Phase 6A loopback + 6B LAN/notifiers): API server
 * toggle, port, status, pairing-link copy, token rotation, opt-in LAN with
 * allowlist + auto-disable, encrypted notifier secrets, redacted audit
 * export. The server runs main-side and reconciles on every settings save.
 */
export function RemoteSection({ engine, settings, toast, hidden }: RemoteSectionProps): React.JSX.Element {
  const S = useStrings(settings);
  const saved = useStore(settings, (s) => s.settings);
  const [status, setStatus] = useState<RemoteApiStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<string>("");
  const [botToken, setBotToken] = useState<string>("");
  const [notifyFlags, setNotifyFlags] = useState<{ discord: boolean; telegram: boolean } | null>(null);

  const refresh = useCallback(() => {
    void engine
      .remoteApi({ op: "status" })
      .then((res) => {
        if (res.kind === "status") setStatus(res.status);
      })
      .catch(() => undefined);
    void engine
      .notifiers({ op: "status" })
      .then((res) => {
        if (res.kind === "status") setNotifyFlags({ discord: res.discord, telegram: res.telegram });
      })
      .catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    if (hidden) return;
    refresh();
  }, [hidden, refresh]);

  const save = (patch: Parameters<SettingsStoreState["save"]>[0]): void => {
    void settings
      .getState()
      .save(patch)
      .then(() => {
        refresh();
      })
      .catch((err: unknown) => {
        toast
          .getState()
          .push(
            err instanceof Error && err.message.length > 0 ? err.message : S.settings.saveFailed,
            "error",
          );
      });
  };

  const statusLine = (): string => {
    if (status === null) return S.settings.remoteStopped;
    if (status.error === "encryption-unavailable") return S.settings.remoteErrEncryption;
    if (status.error === "bind-failed") return S.settings.remoteErrBind;
    if (status.error !== null) return formatStr(S.settings.remoteErrUnknown, { detail: status.error });
    if (!status.running) return S.settings.remoteStopped;
    return formatStr(S.settings.remoteRunning, { port: status.port ?? saved.apiPort });
  };

  const copyLink = (): void => {
    setBusy("copy");
    void engine
      .remoteApi({ op: "reveal" })
      .then(async (res) => {
        if (res.kind !== "token") throw new Error("Token unavailable.");
        const link = buildPairingLink(status?.port ?? saved.apiPort, res.token);
        const ok = await engine.writeClipboard(link);
        toast.getState().push(ok ? S.settings.remoteCopied : S.settings.remoteCopyFailed, ok ? "success" : "error");
      })
      .catch((err: unknown) => {
        toast
          .getState()
          .push(
            err instanceof Error && err.message.length > 0 ? err.message : S.settings.remoteCopyFailed,
            "error",
          );
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const rotate = (): void => {
    if (!window.confirm(S.settings.remoteRotateConfirm)) return;
    setBusy("rotate");
    void engine
      .remoteApi({ op: "rotate" })
      .then((res) => {
        if (res.kind !== "token") throw new Error("Token unavailable.");
        toast.getState().push(S.settings.remoteRotated, "success");
        refresh();
      })
      .catch((err: unknown) => {
        toast
          .getState()
          .push(
            err instanceof Error && err.message.length > 0 ? err.message : S.settings.saveFailed,
            "error",
          );
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const failNotify = (err: unknown): void => {
    setBusy(null);
    toast
      .getState()
      .push(
        err instanceof Error && err.message.length > 0 ? err.message : S.settings.notifyFailed,
        "error",
      );
    refresh();
  };

  const saveSecret = (kind: "discord" | "telegram"): void => {
    const value = kind === "discord" ? webhook.trim() : botToken.trim();
    if (value.length === 0) {
      toast.getState().push(S.settings.notifyFailed, "error");
      return;
    }
    setBusy(`secret-${kind}`);
    void engine
      .notifiers(
        kind === "discord" ? { op: "save", discordWebhook: value } : { op: "save", telegramBotToken: value },
      )
      .then(() => {
        setBusy(null);
        if (kind === "discord") setWebhook("");
        else setBotToken("");
        toast.getState().push(S.settings.saved, "success");
        refresh();
      })
      .catch(failNotify);
  };

  const clearSecret = (kind: "discord" | "telegram"): void => {
    setBusy(`secret-${kind}`);
    void engine
      .notifiers(
        kind === "discord" ? { op: "save", discordWebhook: "" } : { op: "save", telegramBotToken: "" },
      )
      .then(() => {
        setBusy(null);
        refresh();
      })
      .catch(failNotify);
  };

  const testNotify = (kind: "discord" | "telegram"): void => {
    setBusy(`test-${kind}`);
    void engine
      .notifiers({ op: kind === "discord" ? "test-discord" : "test-telegram" })
      .then(() => {
        setBusy(null);
        toast.getState().push(S.settings.notifySent, "success");
      })
      .catch(failNotify);
  };

  const toggleLan = (on: boolean): void => {
    if (on && !window.confirm(S.settings.lanConfirm)) return;
    setBusy("lan");
    // Enabling rotates the token (old clients drop) and the server starts
    // listening on all interfaces; disabling returns to loopback-only.
    const apply = (): void => {
      save({ lanEnabled: on });
      setBusy(null);
      if (on) {
        void engine
          .remoteApi({ op: "rotate" })
          .then(() => {
            toast.getState().push(S.settings.lanOn, "success");
            refresh();
          })
          .catch(() => undefined);
      }
    };
    apply();
  };

  const copyLanLink = (): void => {
    const address = status?.lan?.addresses[0];
    if (address === undefined || address.length === 0) return;
    setBusy("lanlink");
    void engine
      .remoteApi({ op: "reveal" })
      .then(async (res) => {
        if (res.kind !== "token") throw new Error("Token unavailable.");
        const ok = await engine.writeClipboard(
          buildLanPairingLink(address, status?.port ?? saved.apiPort, res.token),
        );
        toast.getState().push(ok ? S.settings.remoteCopied : S.settings.remoteCopyFailed, ok ? "success" : "error");
      })
      .catch((err: unknown) => {
        toast
          .getState()
          .push(
            err instanceof Error && err.message.length > 0 ? err.message : S.settings.remoteCopyFailed,
            "error",
          );
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const downloadAudit = (): void => {
    setBusy("audit");
    void engine
      .remoteApi({ op: "audit" })
      .then((res) => {
        setBusy(null);
        if (res.kind !== "audit") return;
        try {
          const blob = new Blob([JSON.stringify(res.entries, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "fluxdl-api-audit.json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => {
            URL.revokeObjectURL(url);
          }, 5000);
        } catch {
          toast.getState().push(S.settings.notifyFailed, "error");
        }
      })
      .catch(() => {
        setBusy(null);
      });
  };

  return (
    <section className="grabber-card" aria-label={S.settings.remoteTitle} hidden={hidden}>
      <h2 className="dl-title">{S.settings.remoteTitle}</h2>
      <p className="hint">{S.settings.remoteHint}</p>
      <div className="check-col">
        <label className="check-row">
          <input
            type="checkbox"
            data-setting="apiEnabled"
            checked={saved.apiEnabled}
            onChange={(e) => {
              save({ apiEnabled: e.target.checked });
            }}
          />
          {S.settings.remoteEnable}
        </label>
      </div>
      <label className="field-label" htmlFor="set-api-port">
        {S.settings.remotePort}
      </label>
      <input
        id="set-api-port"
        className="input"
        type="number"
        min={1024}
        max={65535}
        defaultValue={saved.apiPort}
        key={String(saved.apiPort)}
        onBlur={(e) => {
          save({ apiPort: Number(e.target.value) });
        }}
      />
      <p className="muted" role="status">
        {statusLine()}
      </p>
      <div className="chip-row">
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={refresh}>
          {S.settings.remoteRefresh}
        </button>
        <button type="button" className="btn btn-small" disabled={busy !== null || !saved.apiEnabled} onClick={copyLink}>
          {S.settings.remoteCopyLink}
        </button>
        <button type="button" className="btn btn-small" disabled={busy !== null || !saved.apiEnabled} onClick={rotate}>
          {S.settings.remoteRotate}
        </button>
        <button type="button" className="btn btn-small" disabled={busy !== null || !saved.apiEnabled} onClick={downloadAudit}>
          {S.settings.remoteAudit}
        </button>
      </div>
      <p className="hint">{S.settings.remoteLanNote}</p>

      {/* Opt-in LAN (Phase 6B): 0.0.0.0 with allowlist + auto-disable. */}
      <div className="check-col">
        <label className="check-row">
          <input
            type="checkbox"
            data-setting="lanEnabled"
            checked={saved.lanEnabled}
            disabled={!saved.apiEnabled}
            onChange={(e) => {
              toggleLan(e.target.checked);
            }}
          />
          {S.settings.lanEnable}
        </label>
      </div>
      <p className="hint">{S.settings.lanWarn}</p>
      <label className="field-label" htmlFor="set-lan-allow">
        {S.settings.lanAllowlist}
      </label>
      <input
        id="set-lan-allow"
        className="input"
        type="text"
        defaultValue={saved.lanAllowlist}
        key={`lan-allow:${saved.lanAllowlist}`}
        spellCheck={false}
        placeholder="192.168.1."
        onBlur={(e) => {
          save({ lanAllowlist: e.target.value });
        }}
      />
      <label className="field-label" htmlFor="set-lan-hours">
        {S.settings.lanAutoDisable}
      </label>
      <input
        id="set-lan-hours"
        className="input"
        type="number"
        min={1}
        max={168}
        defaultValue={saved.lanAutoDisableHours ?? ""}
        key={`lan-hours:${String(saved.lanAutoDisableHours ?? "")}`}
        inputMode="numeric"
        onBlur={(e) => {
          const raw = e.target.value.trim();
          save({ lanAutoDisableHours: raw.length === 0 ? null : Number(raw) });
        }}
      />
      {status?.lan?.enabled === true && (
        <div className="chip-row">
          <button type="button" className="btn btn-small" disabled={busy !== null} onClick={copyLanLink}>
            {S.settings.remoteCopyLink}
          </button>
        </div>
      )}

      {/* Finish/fail notifiers (Phase 6B): secrets encrypted, never in settings. */}
      <h3 className="dl-title">{S.settings.notifyTitle}</h3>
      <div className="check-col">
        <label className="check-row">
          <input
            type="checkbox"
            data-setting="notifyDiscord"
            checked={saved.notifyDiscord}
            onChange={(e) => {
              save({ notifyDiscord: e.target.checked });
            }}
          />
          {S.settings.notifyDiscord}
          {notifyFlags !== null && (notifyFlags.discord ? " ✓" : "")}
        </label>
      </div>
      <label className="field-label" htmlFor="set-notify-webhook">
        {S.settings.notifyWebhook}
      </label>
      <input
        id="set-notify-webhook"
        className="input"
        type="password"
        value={webhook}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setWebhook(e.target.value);
        }}
      />
      <div className="chip-row">
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            saveSecret("discord");
          }}
        >
          {S.settings.saved}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            clearSecret("discord");
          }}
        >
          {S.settings.notifyClear}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            testNotify("discord");
          }}
        >
          {S.settings.notifyTest}
        </button>
      </div>
      <div className="check-col">
        <label className="check-row">
          <input
            type="checkbox"
            data-setting="notifyTelegram"
            checked={saved.notifyTelegram}
            onChange={(e) => {
              save({ notifyTelegram: e.target.checked });
            }}
          />
          {S.settings.notifyTelegram}
          {notifyFlags !== null && (notifyFlags.telegram ? " ✓" : "")}
        </label>
      </div>
      <label className="field-label" htmlFor="set-notify-chat">
        {S.settings.notifyChatId}
      </label>
      <input
        id="set-notify-chat"
        className="input"
        type="text"
        defaultValue={saved.telegramChatId ?? ""}
        key={`notify-chat:${saved.telegramChatId ?? ""}`}
        spellCheck={false}
        onBlur={(e) => {
          save({ telegramChatId: e.target.value });
        }}
      />
      <label className="field-label" htmlFor="set-notify-token">
        {S.settings.notifyToken}
      </label>
      <input
        id="set-notify-token"
        className="input"
        type="password"
        value={botToken}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setBotToken(e.target.value);
        }}
      />
      <div className="chip-row">
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            saveSecret("telegram");
          }}
        >
          {S.settings.saved}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            clearSecret("telegram");
          }}
        >
          {S.settings.notifyClear}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            testNotify("telegram");
          }}
        >
          {S.settings.notifyTest}
        </button>
      </div>
    </section>
  );
}
