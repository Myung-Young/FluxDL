/* FluxDL Remote popup: server + token setup, send-tab, connection test. */
"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "http://127.0.0.1:48127";

async function load() {
  const got = await chrome.storage.local.get({ baseUrl: DEFAULT_BASE, token: "" });
  $("base").value = String(got.baseUrl || DEFAULT_BASE);
  $("tok").value = String(got.token || "");
}

function say(text) {
  $("status").textContent = text;
}

$("save").onclick = async () => {
  await chrome.storage.local.set({
    baseUrl: $("base").value.trim() || DEFAULT_BASE,
    token: $("tok").value.trim(),
  });
  say("Saved.");
};

$("test").onclick = async () => {
  say("Testing…");
  const reply = await chrome.runtime.sendMessage({ type: "test" }).catch((e) => ({ ok: false, error: String(e) }));
  say(reply.ok ? "Connected." : `Failed (${reply.status || reply.error || "?"}) — is Remote enabled in Settings?`);
};

$("send").onclick = async () => {
  say("Sending…");
  const reply = await chrome.runtime.sendMessage({ type: "send-tab" }).catch((e) => ({ ok: false, error: String(e) }));
  say(reply.ok ? "Sent — confirm in the app." : `Failed: ${reply.error || reply.status || "?"}`);
};

void load();
