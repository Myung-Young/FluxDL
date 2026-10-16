/**
 * Remote finish/fail notifiers (Phase 6B / security hardening).
 *
 * Dispatches webhooks (Discord, Slack, generic) and Telegram bot messages.
 * Kept isolated from disk/safeStorage decryption helpers to prevent false
 * positive heuristic AV detections on bundled scripts.
 */

export async function postWebhookNotification(webhook: string, text: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, 10_000);
    try {
      const msg = text.slice(0, 1500);
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: msg,
          content: msg,
        }),
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

/** Backward-compatible alias for the webhook notifier. */
export const postDiscordWebhook = postWebhookNotification;

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
