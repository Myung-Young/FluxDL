import { APP_NAME } from "./branding.js";

/**
 * Windows toast notifications via the renderer Notification API.
 * No IPC needed; the packaged app sets appUserModelId (see M7) so toasts
 * attribute correctly. All helpers no-op where Notification is unavailable.
 */

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function sendNotification(title: string, body: string): boolean {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission !== "granted") return false;
    const n = new Notification(`${APP_NAME} — ${title}`, { body });
    n.onclick = () => {
      window.focus();
    };
    return true;
  } catch {
    return false;
  }
}
