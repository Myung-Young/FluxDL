import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenStore } from "./localApi.js";

/**
 * Notifier secrets (Phase 6B): Discord webhook URL + Telegram bot token.
 * safeStorage-encrypted JSON (`notifier-secrets.dat`), same fail-closed
 * pattern as the API token — never settings.json (plaintext), never IPC
 * responses, never logs. Chat IDs and enable flags are NOT secrets and
 * live in settings.
 */

const SECRETS_FILE = "notifier-secrets.dat";
const SECRETS_TMP = "notifier-secrets.dat.tmp";

export interface NotifierSecrets {
  readonly discordWebhook: string | null;
  readonly telegramBotToken: string | null;
}

const EMPTY_SECRETS: NotifierSecrets = { discordWebhook: null, telegramBotToken: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored secrets, or nulls on any failure (never throws). */
export function readNotifierSecrets(userDataDir: string, store: TokenStore): NotifierSecrets {
  if (!store.available) return EMPTY_SECRETS;
  try {
    const data = readFileSync(join(userDataDir, SECRETS_FILE));
    const text = store.decrypt(data);
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return EMPTY_SECRETS;
    return {
      discordWebhook:
        typeof parsed["discordWebhook"] === "string" && parsed["discordWebhook"].length > 0
          ? parsed["discordWebhook"]
          : null,
      telegramBotToken:
        typeof parsed["telegramBotToken"] === "string" && parsed["telegramBotToken"].length > 0
          ? parsed["telegramBotToken"]
          : null,
    };
  } catch {
    return EMPTY_SECRETS;
  }
}

export function writeNotifierSecrets(
  userDataDir: string,
  store: TokenStore,
  secrets: NotifierSecrets,
): void {
  if (!store.available) throw new Error("encryption-unavailable");
  const tmp = join(userDataDir, SECRETS_TMP);
  writeFileSync(tmp, store.encrypt(JSON.stringify(secrets)), "utf8");
  renameSync(tmp, join(userDataDir, SECRETS_FILE));
}

/** Discord webhook URLs are long bearer tokens — https + path only. */
export function cleanDiscordWebhook(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > 512) return null;
  if (
    t.startsWith("https://discord.com/api/webhooks/") ||
    t.startsWith("https://discordapp.com/api/webhooks/")
  ) {
    return t;
  }
  return null;
}

export function cleanTelegramToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > 256 || /\s/.test(t)) return null;
  return t;
}

/**
 * Best-effort webhook POST (10 s timeout, no secret in errors). Resolves
 * false on any failure — notifications must never fail a download.
 */
export async function postDiscordWebhook(webhook: string, text: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, 10_000);
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 1500) }),
        signal: ctrl.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** Best-effort Telegram sendMessage (token rides the path, never logs). */
export async function postTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, 10_000);
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 1500) }),
        signal: ctrl.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
