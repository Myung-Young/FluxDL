/* FluxDL Remote — background service worker (Chromium MV3).
 *
 * Firefox: use `"background": { "scripts": ["background.js"] }` instead of
 * `service_worker` (one-line manifest swap; this file works in both).
 * Load unpacked: chrome://extensions -> Developer mode -> Load unpacked.
 * No store publishing (Phase 6 plan). Token lives in chrome.storage.local
 * (never synced to any account).
 */
"use strict";

const DEFAULT_BASE = "http://127.0.0.1:48127";

async function settings() {
  const got = await chrome.storage.local.get({ baseUrl: DEFAULT_BASE, token: "" });
  return { baseUrl: String(got.baseUrl || DEFAULT_BASE).replace(/\/+$/, ""), token: String(got.token || "") };
}

async function sendUrls(urls) {
  const { baseUrl, token } = await settings();
  if (!token) throw new Error("No token saved — open the popup and paste the pairing token first.");
  const res = await fetch(`${baseUrl}/api/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(urls.length === 1 ? { url: urls[0] } : { urls }),
  });
  if (res.status === 202) return await res.json();
  const body = await res.json().catch(() => ({}));
  throw new Error(`Server said ${res.status}${body.error ? `: ${body.error}` : ""}`);
}

function urlFromClick(info, tab) {
  if (info.linkUrl) return info.linkUrl;
  if (info.srcUrl) return info.srcUrl;
  if (info.pageUrl) return info.pageUrl;
  if (tab && tab.url) return tab.url;
  return null;
}

chrome.runtime.onInstalled.addListener(() => {
  const contexts = ["link", "image", "video", "audio", "page"];
  try {
    chrome.contextMenus.create({ id: "fluxdl-send", title: "Send to FluxDL", contexts });
  } catch (e) {
    // Menu already exists (reload) — harmless.
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "fluxdl-send") return;
  const url = urlFromClick(info, tab);
  if (!url) return;
  sendUrls([url]).catch(() => {
    // No UI in the worker; the popup shows the last error on open.
    chrome.storage.local.set({ lastError: new Date().toISOString() }).catch(() => undefined);
  });
});

// Popup drive-by: { type: "send-tab" } | { type: "send-urls", urls } | { type: "test" }
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "send-tab") {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tabs[0] && tabs[0].url;
      if (!url) throw new Error("No active tab URL.");
      reply({ ok: true, result: await sendUrls([url]) });
    } else if (msg.type === "send-urls") {
      reply({ ok: true, result: await sendUrls(msg.urls || []) });
    } else if (msg.type === "test") {
      const { baseUrl, token } = await settings();
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      reply({ ok: res.status === 200, status: res.status });
    } else {
      reply({ ok: false, error: "unknown message" });
    }
  })().catch((e) => {
    reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
  });
  return true;
});
