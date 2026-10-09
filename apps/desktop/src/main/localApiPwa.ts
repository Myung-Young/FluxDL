import { APP_NAME } from "@grabber/core/branding.js";

/**
 * Loopback PWA assets (Phase 6A). Served by `localApi.ts` over the same
 * origin, so the page needs no CORS dance. Single-file on purpose: no build
 * step, no path resolution differences between dev and packaged builds.
 *
 * The token arrives via the pairing-link fragment (`#token=…`, never sent to
 * the server) and is kept in `localStorage` on `http://127.0.0.1` — a
 * same-machine store for a same-machine server. LAN mode must revisit this
 * (see PHASE_6_PLAN.md §6); until then the UI says loopback-only.
 */

export const PWA_MANIFEST_JSON = JSON.stringify({
  name: `${APP_NAME} Remote`,
  short_name: APP_NAME,
  start_url: "/",
  display: "standalone",
  background_color: "#0b0d12",
  theme_color: "#0b0d12",
  icons: [],
  share_target: {
    action: "/",
    method: "GET",
    params: { title: "title", text: "text", url: "url" },
  },
});

export const PWA_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0d12">
<link rel="manifest" href="/manifest.webmanifest">
<title>${APP_NAME} Remote</title>
<style>
:root{color-scheme:dark;--bg:#0b0d12;--card:#141824;--fg:#e8eaf0;--dim:#9aa0b4;--accent:#6ea8fe;--danger:#f66;--line:#262c3d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
h1{font-size:19px;margin:4px 0 12px}.row{display:flex;gap:8px;margin:8px 0}
input,button{border-radius:8px;border:1px solid var(--line);padding:9px 12px;font:inherit}
input{flex:1;background:var(--card);color:var(--fg);min-width:0}
button{background:var(--accent);color:#06121f;border:none;font-weight:600;cursor:pointer}
button.ghost{background:var(--card);color:var(--fg);border:1px solid var(--line);font-weight:400}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}
.card .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .m{color:var(--dim);font-size:13px;margin-top:2px}
.card .ops{display:flex;gap:6px;margin-top:8px}
.card .ops button{padding:5px 10px;font-size:13px}
#dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#666;margin-right:6px;vertical-align:1px}
#dot.ok{background:#4c4}#note{color:var(--dim);font-size:13px;margin:10px 0}
label{font-size:13px;color:var(--dim)}
</style>
</head>
<body>
<main>
<h1><span id="dot"></span>${APP_NAME} Remote <span style="font-weight:400;font-size:13px;color:var(--dim)">loopback only</span></h1>
<div id="note">Same-machine remote. Paste the pairing link once — the token stays in this browser.</div>
<div class="row"><input id="tok" type="password" placeholder="Bearer token (or open the pairing link)" autocomplete="off"><button id="save">Save</button></div>
<div class="row"><input id="url" type="url" placeholder="https://… link to download" autocomplete="off"><button id="add">Add</button></div>
<div id="status" class="m" style="color:var(--dim);font-size:13px"></div>
<div id="jobs"></div>
</main>
<script>
"use strict";
const $=(id)=>document.getElementById(id);
const dot=$("dot"),jobsEl=$("jobs"),statusEl=$("status"),tokEl=$("tok"),urlEl=$("url");
try{
  const frag=new URLSearchParams(location.hash.slice(1)).get("token");
  if(frag){localStorage.setItem("fluxdl-token",frag);history.replaceState(null,"",location.pathname+location.search);}
  const q=new URLSearchParams(location.search);
  const shared=q.get("url")||q.get("text")||"";
  if(shared){urlEl.value=shared;}
  tokEl.value=localStorage.getItem("fluxdl-token")||"";
}catch(e){}
$("save").onclick=()=>{try{localStorage.setItem("fluxdl-token",tokEl.value.trim());}catch(e){}poll();};
function auth(){return (tokEl.value||"").trim();}
async function api(path,init){
  const r=await fetch(path,Object.assign({headers:{Authorization:"Bearer "+auth()}},init||{}));
  const body=await r.json().catch(()=>({}));
  return {status:r.status,body};
}
$("add").onclick=async()=>{
  const u=urlEl.value.trim();if(!u)return;
  const r=await api("/api/add",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+auth()},body:JSON.stringify({url:u})});
  statusEl.textContent=r.status===202?"Added ("+r.body.accepted+") — confirm in the app.":"Error: "+(r.body.error||r.status);
  urlEl.value="";poll();
};
async function job(id,action){
  const r=await api("/api/job",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+auth()},body:JSON.stringify({id,action})});
  if(r.status!==200)statusEl.textContent="Error: "+(r.body.error||r.status);
  poll();
}
function row(j){
  const d=document.createElement("div");d.className="card";
  const pct=j.progress==null?"":(" · "+Math.round(j.progress)+"%");
  const sp=j.speed?(" · "+j.speed):"";
  d.innerHTML="";
  const t=document.createElement("div");t.className="t";t.textContent=j.title||j.url;d.appendChild(t);
  const m=document.createElement("div");m.className="m";m.textContent=j.status+pct+sp;d.appendChild(m);
  const ops=document.createElement("div");ops.className="ops";
  for(const a of ["pause","resume","cancel"]){
    const b=document.createElement("button");b.className="ghost";b.textContent=a;b.onclick=()=>job(j.id,a);ops.appendChild(b);
  }
  d.appendChild(ops);return d;
}
async function poll(){
  if(!auth()){dot.className="";statusEl.textContent="Enter the token from the pairing link.";return;}
  try{
    const h=await api("/health");
    if(h.status!==200){dot.className="";statusEl.textContent="No access ("+h.status+"). Check the token.";return;}
    dot.className="ok";
    const q=await api("/api/queue");
    const list=(q.body&&q.body.jobs)||[];
    statusEl.textContent=list.length+" job(s) in queue.";
    jobsEl.innerHTML="";
    for(const j of list)jobsEl.appendChild(row(j));
  }catch(e){dot.className="";statusEl.textContent="Server unreachable. Is the app running with Remote enabled?";}
}
setInterval(poll,2000);poll();
</script>
</body>
</html>
`;
