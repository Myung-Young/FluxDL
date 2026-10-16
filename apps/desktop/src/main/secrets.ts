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

/** Webhook URLs are bearer tokens — https only, valid URL structure. */
export function cleanWebhookUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > 2048) return null;
  try {
    const parsed = new URL(t);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export const cleanDiscordWebhook = cleanWebhookUrl;

export function cleanTelegramToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > 256 || /\s/.test(t)) return null;
  return t;
}

