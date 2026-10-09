import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanDiscordWebhook,
  cleanTelegramToken,
  readNotifierSecrets,
  writeNotifierSecrets,
  type NotifierSecrets,
} from "./secrets.js";
import type { TokenStore } from "./localApi.js";

function fakeStore(available = true): TokenStore {
  return {
    available,
    encrypt: (plain: string) => Buffer.from(`E${plain}`, "utf8"),
    decrypt: (data: Buffer) => data.toString("utf8").replace(/^E/, ""),
  };
}

describe("notifier secrets", () => {
  it("round-trips encrypted, reads nulls when absent or locked", () => {
    const dir = mkdtempSync(join(tmpdir(), "fluxdl-secrets-"));
    const store = fakeStore(true);
    expect(readNotifierSecrets(dir, store)).toEqual({ discordWebhook: null, telegramBotToken: null });
    const secrets: NotifierSecrets = {
      discordWebhook: "https://discord.com/api/webhooks/abc/def",
      telegramBotToken: "123:ABC",
    };
    writeNotifierSecrets(dir, store, secrets);
    expect(readNotifierSecrets(dir, store)).toEqual(secrets);
    // The bytes on disk went through the store's encrypt (fake here is a
    // prefix cipher, so assert the transform — real confidentiality comes
    // from safeStorage/DPAPI, which headless tests cannot provide).
    for (const name of readdirSync(dir)) {
      const stored = readFileSync(join(dir, name), "utf8");
      expect(stored).not.toBe(JSON.stringify(secrets));
      expect(stored.startsWith("E")).toBe(true);
    }
  });

  it("fails closed without encryption", () => {
    const dir = mkdtempSync(join(tmpdir(), "fluxdl-secrets-"));
    const store = fakeStore(false);
    expect(readNotifierSecrets(dir, store)).toEqual({ discordWebhook: null, telegramBotToken: null });
    expect(() => {
      writeNotifierSecrets(dir, store, { discordWebhook: "x", telegramBotToken: null });
    }).toThrow("encryption-unavailable");
  });

  it("validates webhook URLs and bot tokens", () => {
    expect(cleanDiscordWebhook("https://discord.com/api/webhooks/a/b")).toBe(
      "https://discord.com/api/webhooks/a/b",
    );
    expect(cleanDiscordWebhook("https://discordapp.com/api/webhooks/a/b")).not.toBeNull();
    expect(cleanDiscordWebhook("http://evil.com/hook")).toBeNull();
    expect(cleanDiscordWebhook("")).toBeNull();
    expect(cleanDiscordWebhook(null)).toBeNull();
    expect(cleanTelegramToken("123:ABC-def")).toBe("123:ABC-def");
    expect(cleanTelegramToken("has space")).toBeNull();
    expect(cleanTelegramToken("")).toBeNull();
  });
});
