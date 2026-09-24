(() => {
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TZ = "Asia/Kathmandu";

const EMPTY = {config:{title:"Dashain Raffle", lede:"", headerTag:"Company-wide · 2026", departments:[], logoUrl:null, price:0, currency:"Rs", drawAt:null, prefix:"DSH", cap:0, perPerson:0}, prizes:[], sales:[], draws:[], stage:{state:"idle"}, inDraw:0};
const S = {pub:EMPTY, adm:null, admin:false, me:null, role:null, tab:"board", sub:"sell", lastIssued:null};
const cfg = () => S.pub.config;
const isFin = () => S.admin && S.role === "finance";

/* ---------------- helpers ---------------- */
const pad = n => String(n).padStart(4, "0");
const tno = n => `${cfg().prefix || "T"}-${pad(n)}`;
const money = v => `${cfg().currency || ""} ${Number(v || 0).toLocaleString("en-IN")}`.trim();
const fmtDate = iso => iso ? new Intl.DateTimeFormat("en-GB", {timeZone:TZ, weekday:"short", day:"numeric", month:"short", hour:"numeric", minute:"2-digit"}).format(new Date(iso)) : "";
const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };
const toast = msg => { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2800); };
const parseTicket = q => { const m = String(q).toUpperCase().match(/(\d{1,6})\s*$/); return m ? parseInt(m[1], 10) : null; };
function ranges(nums){ const a = [...nums].sort((x, y) => x - y), out = []; let i = 0;
  while (i < a.length){ let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(i === j ? tno(a[i]) : `${tno(a[i])} – ${pad(a[j])}`); i = j + 1; } return out.join(", "); }
function parseNums(spec){ const out = new Set();
  for (const part of String(spec || "").split(/[\s,]+/).filter(Boolean)){ const m = part.match(/^(?:[A-Za-z]+-)?(\d+)(?:-(?:[A-Za-z]+-)?(\d+))?$/); if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a; if (b < a || b - a > 500) return null; for (let n = a; n <= b; n++) out.add(n); }
  return [...out]; }
function armed(btn, fn){
  if (btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = "Click to confirm";
  setTimeout(() => { if (btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 3500);
}
const randInt = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };

async function api(path, body){
  const r = await fetch(path, {method:"POST", headers:{"content-type":"application/json", "x-raffle":"1"}, body:JSON.stringify(body || {}), credentials:"same-origin"});
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path.startsWith("/api/admin/")){ S.admin = false; S.adm = null; renderAuth(); }
  if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
  return j;
}
async function act(path, body, okMsg){ try { const j = await api("/api/admin/" + path, body); if (okMsg) toast(okMsg); await load(); return j; } catch (e){ toast(e.message); return null; } }

/* ---------------- pricing ---------------- */
const bundles = () => { const b = (cfg().bundles || []).filter(x => x.qty > 0); return b.length ? [...b].sort((x, y) => x.qty - y.qty) : (cfg().price ? [{qty:1, price:cfg().price}] : []); };
// cheapest exact combination for n tickets; mirrors priceFor() in server.js (the server's figure is what gets charged)
function priceFor(n){
  const bs = bundles(); if (!bs.length || n < 1) return null;
  const best = [{amount:0, pick:null}];
  for (let i = 1; i <= n; i++){ best[i] = null;
    for (const b of bs) if (b.qty <= i && best[i - b.qty]){ const a = best[i - b.qty].amount + b.price; if (!best[i] || a < best[i].amount) best[i] = {amount:a, pick:b}; } }
  if (!best[n]) return null;
  const c = new Map(); for (let i = n; i > 0; i -= best[i].pick.qty) c.set(best[i].pick, (c.get(best[i].pick) || 0) + 1);
  return {amount:best[n].amount, parts:[...c].sort((x, y) => y[0].qty - x[0].qty).map(([b, times]) => ({qty:b.qty, price:b.price, times}))};
}
const partsText = parts => (parts || []).map(p => `${p.times > 1 ? p.times + " × " : ""}${p.qty === 1 ? "single" : p.qty + " for " + money(p.price)}`).join(" + ");
const saleAmount = s => s.amount ?? s.nums.length * (s.price ?? cfg().price ?? 0);
const bestDeal = () => { const bs = bundles(); if (bs.length < 2) return null; return bs.reduce((a, b) => b.price / b.qty < a.price / a.qty ? b : a); };
const priceLine = () => bundles().map(b => b.qty === 1 ? `${money(b.price)} each` : `${b.qty} for ${Number(b.price).toLocaleString("en-IN")}`).join(" · ");
function upsell(n, buyer){ // smallest nudge up to +3 tickets that's free or cheaper than singles
  const base = priceFor(n), single = bundles()[0]?.price || 0; if (!base) return null;
  for (let m = n + 1; m <= n + 3; m++){ const p = priceFor(m); if (!p) continue;
    const extra = p.amount - base.amount;
    if (extra <= 0) return {m, extra:0, text:`<b>${m} tickets cost the same as ${n}.</b> ${buyer ? `Get ${m - n} free?` : `Give them ${m - n} free?`}`};
    if (single && extra < (m - n) * single && m - n === 1) return {m, extra, text:`One more ticket is only <b>${money(extra)}</b> (${partsText(p.parts)}).`}; }
  return null;
}

/* ---------------- derived ---------------- */
const pubPaid = () => S.pub.sales.filter(s => s.paid).reduce((a, s) => a + s.nums.length, 0);
const pubSold = () => S.pub.sales.reduce((a, s) => a + s.nums.length, 0);
const prizeQty = () => S.pub.prizes.reduce((a, p) => a + (p.qty || 1), 0);
const drawnFor = pid => S.pub.draws.filter(d => d.prizeId === pid).length;
const prizesLeft = () => S.pub.prizes.reduce((a, p) => a + Math.max(0, (p.qty || 1) - drawnFor(p.id)), 0);
const sortedPrizes = () => [...S.pub.prizes].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
const pubSaleFor = n => S.pub.sales.find(s => s.nums.includes(n));
function pWin(k, N, P){
  if (N <= 0 || P <= 0) return 0; if (k >= N) return 1; P = Math.min(P, N); if (N - k < P) return 1;
  let none = 1; for (let i = 0; i < P; i++) none *= (N - k - i) / (N - i); return 1 - none;
}
const pct = p => p >= 0.9995 ? "100%" : p < 0.001 && p > 0 ? "<0.1%" : (p * 100).toFixed(p < 0.1 ? 1 : 0) + "%";
const oneIn = p => p > 0 ? "1 in " + Math.max(1, Math.round(1 / p)).toLocaleString("en-IN") : "—";

/* ---------------- tabs ---------------- */
function setTab(t){
  S.tab = t;
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", b.dataset.tab === t);
  for (const v of ["board","buy","draw","manage"]) $("view-" + v).hidden = v !== t;
  if (t === "buy") renderBuy();
  try { history.replaceState(null, "", "#" + t); } catch {}
  renderTicker();
  if (t === "draw") requestAnimationFrame(() => stageSky.size());
  if (t === "board") requestAnimationFrame(() => heroSky.size());
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => setTab(b.dataset.tab));
addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (["board","buy","draw","manage"].includes(h) && h !== S.tab) setTab(h); });
function setSub(t){
  S.sub = t;
  for (const b of document.querySelectorAll(".subtab")) b.setAttribute("aria-selected", b.dataset.sub === t);
  for (const v of ["sell","paper","ledger","prizes","settings","collectors","payments","results"]) $("sub-" + v).hidden = v !== t;
  if (t === "collectors"){ colDirty = false; renderCollectors(true); }
  if (t === "payments") renderPayments();
  if (t === "settings") fillSettings();
}
document.querySelectorAll(".subtab").forEach(b => b.onclick = () => setSub(b.dataset.sub));

/* ---------------- board ---------------- */
const kiteSVG = (c1, c2, size = 26) => `<svg width="${size}" height="${Math.round(size * 1.15)}" viewBox="0 0 30 34" aria-hidden="true"><path d="M15 1 L28 13 L15 25 L2 13 Z" fill="${c1}"/><path d="M15 1 L15 25 M2 13 L28 13" stroke="${c2}" stroke-width="1.6"/><path d="M15 25 q-3 3 0 5 q3 2 0 4" stroke="var(--ink-3)" stroke-width="1.3" fill="none"/></svg>`;
const rankLabel = i => ["Grand prize","Second prize","Third prize"][i] || `Prize ${i + 1}`;
const kiteColors = [["var(--tika)","var(--marigold)"],["var(--marigold)","var(--tika)"],["var(--jamara)","var(--marigold)"],["var(--kite)","var(--marigold)"]];

function renderBoard(){
  const c = cfg(), title = c.title || "Dashain Raffle";
  document.title = title;
  $("brandTitle").textContent = title; $("heroTitle").textContent = title;
  $("brandSub").textContent = c.headerTag || "";
  if (c.logoUrl) { $("brandLogo").src = c.logoUrl; $("brandLogo").hidden = false; $("brandKite").hidden = true; }
  else { $("brandLogo").hidden = true; $("brandKite").hidden = false; }
  if (c.lede) $("heroLede").textContent = c.lede;
  $("drawWhen").textContent = c.drawAt ? "Live draw · " + fmtDate(c.drawAt) + " (NPT)" : "Draw date to be announced";

  const N = S.pub.inDraw, P = prizesLeft(), total = pubSold(), paid = pubPaid();
  $("stTickets").textContent = paid.toLocaleString("en-IN");
  $("stTicketsSub").textContent = total > paid ? `paid · ${total - paid} awaiting payment` : "paid & confirmed";
  $("stPrizes").textContent = prizeQty();
  $("stPrizesSub").textContent = S.pub.draws.length ? `${P} still to be won` : "to be won";
  $("stOdds").textContent = N && P ? pct(pWin(1, N, P)) : "—";
  const bd = bestDeal(), bs = bundles(), locked = !!S.pub.locked;
  $("unlockHero").hidden = !locked; $("stPrice").parentElement.hidden = locked;
  if (bd){ $("stPrice").textContent = `${bd.qty} for ${Number(bd.price).toLocaleString("en-IN")}`; $("stPriceSub").textContent = `${money(Math.round(bd.price / bd.qty))} a ticket` + (bs[0].qty === 1 ? ` · save ${money(bs[0].price * bd.qty - bd.price)}` : ""); }
  else { $("stPrice").textContent = bs[0] ? money(bs[0].price) : "—"; $("stPriceSub").textContent = "per ticket"; }
  $("tiers").innerHTML = bs.length > 1 ? bs.map(b => `<button type="button" class="tier ${bd && b.qty === bd.qty ? "best" : ""}" data-q="${b.qty}"><span class="q">${b.qty} ticket${b.qty > 1 ? "s" : ""}</span><span class="p">${esc(money(b.price))}</span><span class="e">${b.qty > 1 ? esc(money(Math.round(b.price / b.qty))) + " each" : "single"}</span></button>`).join("") : "";
  $("calcTiers").innerHTML = bs.length > 1 ? bs.map(b => `<button type="button" data-q="${b.qty}" aria-pressed="false">${b.qty} · ${esc(money(b.price))}</button>`).join("") : "";
  if (c.cap > 0){ $("capBox").hidden = false; $("capTxt").textContent = `${Math.max(0, c.cap - total)} of ${c.cap}`; $("capBar").style.width = Math.min(100, total / c.cap * 100) + "%"; }
  else $("capBox").hidden = true;

  const sp = sortedPrizes();
  $("prizeGrid").innerHTML = sp.length ? sp.map((p, i) => {
    const qty = p.qty || 1, got = S.pub.draws.filter(d => d.prizeId === p.id), left = qty - got.length, kc = kiteColors[i % kiteColors.length];
    const winners = got.map(d => `<div class="won-by">Won by ${esc(d.name)} · <span class="mono">${esc(tno(d.ticket))}</span></div>`).join("");
    return `<article class="prize ${i === 0 ? "grand" : ""} ${left <= 0 ? "done" : ""}">
      <div class="rank">${kiteSVG(kc[0], kc[1], i === 0 ? 30 : 22)}<span class="eyebrow">${rankLabel(i)}</span>${p.sample ? '<span class="chip gold">Sample</span>' : ""}</div>
      <h3>${esc(p.name)}</h3>
      <div class="meta">${qty > 1 ? `<span class="chip">${qty} winners</span>` : ""}${p.value ? `<span class="chip">Worth ${esc(money(p.value))}</span>` : ""}${p.sponsor ? `<span class="chip">Sponsored by ${esc(p.sponsor)}</span>` : ""}${left <= 0 ? '<span class="chip green">Won</span>' : got.length ? `<span class="chip green">${got.length} won</span>` : ""}</div>
      ${winners}
      <div class="odds"><span>Your ticket's odds</span><b>${left > 0 && N ? oneIn(Math.min(1, left / N)) : "—"}</b></div>
    </article>`;
  }).join("") : `<div class="empty">Prizes will appear here once the organisers add them.</div>`;

  renderCalc();

  const by = {}; for (const s of S.pub.sales){ const d = (s.dept || "Other").trim() || "Other"; by[d] = (by[d] || 0) + s.nums.length; }
  const depts = Object.entries(by).sort((a, b) => b[1] - a[1]); const max = depts[0]?.[1] || 1;
  $("deptBoard").innerHTML = depts.length ? depts.slice(0, 10).map(([d, n]) =>
    `<div class="dept"><span class="name" title="${esc(d)}">${esc(d)}</span><div class="track"><i style="width:${n / max * 100}%"></i></div><span class="n">${n}</span></div>`).join("")
    : `<div class="empty">No tickets yet. First team on the board wins bragging rights.</div>`;
  const allDepts = new Set(c.departments || []); for (const d of Object.keys(by)) allDepts.add(d); if (S.adm) for (const s of S.adm.sales) if (s.dept) allDepts.add(s.dept);
  $("deptList").innerHTML = [...allDepts].filter(d => d !== "Other").map(d => `<option value="${esc(d)}">`).join("");

  const recent = [...S.pub.sales].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 8);
  $("feedCount").textContent = S.pub.sales.length ? `${S.pub.sales.length} purchases` : "";
  $("feed").innerHTML = recent.length ? recent.map(s =>
    `<li>${kiteSVG("var(--marigold)","var(--tika)",14)}<span><span class="who">${esc(s.name)}</span> got ${s.nums.length} ticket${s.nums.length > 1 ? "s" : ""}${s.dept ? ` <span style="color:var(--ink-3)">· ${esc(s.dept)}</span>` : ""}</span><time datetime="${esc(s.at)}">${ago(s.at)}</time></li>`).join("")
    : `<li class="empty">Sales show up here the moment they happen.</li>`;

  const dr = [...S.pub.draws].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  $("winnersBlock").hidden = !dr.length;
  $("winnersSub").textContent = dr.length ? `${dr.length} of ${prizeQty()} drawn` : "";
  $("winnersGrid").innerHTML = dr.map(d => { const p = S.pub.prizes.find(x => x.id === d.prizeId);
    return `<div class="winner"><span class="eyebrow">${esc(p?.name || d.prizeName || "Prize")}</span><span class="tno">${esc(tno(d.ticket))}</span><b>${esc(d.name)}</b><span style="color:var(--ink-3);font-size:.85rem">${d.dept ? esc(d.dept) + " · " : ""}${fmtDate(d.at)}</span></div>`; }).join("");

  renderLookup();
}

function renderCalc(){
  const k = +$("calcRange").value, N = S.pub.inDraw, P = prizesLeft();
  const cost = priceFor(k);
  $("calcK").textContent = `${k} ticket${k > 1 ? "s" : ""}${cost ? " · " + money(cost.amount) : ""}`;
  document.querySelectorAll("#calcTiers button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.q === k));
  const p = N ? pWin(k, Math.max(N, k), P) : 0;
  $("calcPct").textContent = N && P ? pct(p) : "—";
  $("ringArc").setAttribute("stroke-dasharray", `${(p * 314.16).toFixed(1)} 314.16`);
  $("calcGrand").textContent = N && sortedPrizes()[0] ? `Grand prize alone: ${oneIn(Math.min(1, k / Math.max(N, k)))}, with ${N.toLocaleString("en-IN")} tickets in the draw today` : "Odds appear once paid tickets are in the draw.";
}
$("calcRange").oninput = renderCalc;
const pickTier = e => { const b = e.target.closest("[data-q]"); if (!b) return; $("calcRange").value = b.dataset.q; renderCalc();
  if (b.classList.contains("tier")) $("calcRange").closest(".panel").scrollIntoView({behavior:reduced ? "auto" : "smooth", block:"center"}); };
$("calcTiers").onclick = pickTier; $("tiers").onclick = pickTier;

function renderLookup(){
  const q = $("lookupQ").value.trim(), out = $("lookupOut");
  if (!q){ out.innerHTML = `<div class="empty">Type your name as it was entered at purchase, or a ticket number like ${esc(tno(12))}.</div>`; return; }
  const N = S.pub.inDraw, P = prizesLeft(), n = /\d/.test(q) ? parseTicket(q) : null;
  let hits = [];
  if (n != null){ const s = pubSaleFor(n); if (s) hits = [s]; }
  else if (q.length >= 2){ const ql = q.toLowerCase(); hits = S.pub.sales.filter(s => !s.name.startsWith("Someone from") && s.name.toLowerCase().includes(ql)); }
  if (!hits.length){ out.innerHTML = `<div class="empty">${q.length < 2 ? "Keep typing…" : n != null ? "That ticket hasn't been sold yet." : "No tickets found. Check the spelling, or ask the raffle team."}</div>`; return; }
  const groups = {}; for (const s of hits) (groups[s.name.toLowerCase() + "|" + s.dept] ||= []).push(s);
  out.innerHTML = Object.values(groups).slice(0, 5).map(list => {
    const nums = n != null ? [n] : list.flatMap(s => s.nums), paidNums = list.filter(s => s.paid).reduce((a, s) => a + s.nums.length, 0), all = list.reduce((a, s) => a + s.nums.length, 0);
    const wins = S.pub.draws.filter(d => list.some(s => s.nums.includes(d.ticket)));
    return `<div class="row"><b>${esc(list[0].name)}</b>${list[0].dept ? `<span style="color:var(--ink-3)">${esc(list[0].dept)}</span>` : ""}<span class="chip">${all} ticket${all > 1 ? "s" : ""}</span>
      ${paidNums < all ? `<span class="chip gold">${all - paidNums} unpaid</span>` : ""}
      ${wins.length ? `<span class="chip green">Winner</span>` : paidNums && N && P ? `<span class="chip red">${pct(pWin(paidNums, N, P))} chance</span>` : ""}
      <span class="mono" style="font-size:.85rem;color:var(--ink-2);width:100%">${esc(ranges(nums))}</span></div>`;
  }).join("");
}
$("lookupQ").oninput = renderLookup;

const salesOpen = () => !cfg().salesCloseAt || Date.now() < Date.parse(cfg().salesCloseAt);
const selfOn = () => !!cfg().selfIssue?.enabled;
function renderWindow(){
  const c = cfg(), open = salesOpen();
  const cw = $("closeWhen"); cw.hidden = !c.salesCloseAt;
  cw.textContent = open ? `Ticket sales close ${fmtDate(c.salesCloseAt)} (NPT)` : "Ticket sales have closed. Good luck in the draw!";
  cw.classList.toggle("shut", !open);
  $("cdLabel").textContent = open && c.salesCloseAt ? "Ticket sales close in" : "Live draw in";
  $("heroCta").hidden = !(selfOn() && open);
  $("tab-buy").hidden = !selfOn();
}
function tick(){
  const target = salesOpen() && cfg().salesCloseAt ? cfg().salesCloseAt : cfg().drawAt;
  if (tick._open !== undefined && tick._open !== salesOpen()){ renderWindow(); if (S.tab === "buy") renderBuy(); }
  tick._open = salesOpen();
  const t = target ? new Date(target) - Date.now() : NaN;
  const set = (id, v) => { const e = $(id), s = String(v).padStart(2, "0"); if (e.textContent !== s) e.textContent = s; };
  if (isNaN(t)){ ["cdD","cdH","cdM","cdS"].forEach(i => $(i).textContent = "--"); return; }
  const x = Math.max(0, t / 1000);
  set("cdD", Math.floor(x / 86400)); set("cdH", Math.floor(x % 86400 / 3600)); set("cdM", Math.floor(x % 3600 / 60)); set("cdS", Math.floor(x % 60));
}
setInterval(tick, 1000);

$("heroCta").onclick = () => setTab("buy");

/* ---------------- auth ---------------- */
function renderAuth(){
  $("loginForm").hidden = S.admin; $("console").hidden = !S.admin;
  document.body.classList.toggle("is-finance", isFin());
  $("whoName").innerHTML = S.admin ? `Signed in as <b>${esc(S.me)}</b> <span class="role-chip ${isFin() ? "finance" : ""}">${isFin() ? "Finance" : "Organiser"}</span>` : "";
  $("stageCtl").hidden = !S.admin;
}
$("loginForm").onsubmit = async e => {
  e.preventDefault(); $("lErr").textContent = "";
  try { const j = await api("/api/login", {name:$("lName").value, password:$("lPass").value}); S.admin = true; S.me = j.name; S.role = j.role; $("lPass").value = ""; renderAuth(); await load(); toast(`Welcome, ${j.name}`); }
  catch (err){ $("lErr").textContent = err.message; }
};
$("logoutBtn").onclick = async () => { try { await api("/api/logout"); } catch {} S.admin = false; S.adm = null; S.role = null; renderAuth(); toast("Signed out"); };

/* ---------------- manage ---------------- */
const admSales = () => S.adm ? S.adm.sales.filter(s => !s.void) : [];
function renderManage(){
  if (!S.adm) return;
  const live = admSales();
  const paidAmt = live.filter(s => s.paid).reduce((a, s) => a + saleAmount(s), 0);
  const oweAmt = live.filter(s => !s.paid).reduce((a, s) => a + saleAmount(s), 0);
  $("kSold").textContent = live.reduce((a, s) => a + s.nums.length, 0).toLocaleString("en-IN");
  $("kPaid").textContent = money(paidAmt); $("kOwe").textContent = money(oweAmt);
  $("kOweBox").classList.toggle("alert", oweAmt > 0);
  $("kBuyers").textContent = new Set(live.map(s => s.buyer.toLowerCase())).size;
  renderLedger(); renderPrizeEditor(); renderResults(); renderBooks(); updateTotal(); updatePaperTotal();
  fillCollectorSelect("sCollector", "sMethod"); fillCollectorSelect("pCollector", "pMethod");
  renderPayments(); if (S.sub === "collectors") renderCollectors();
  if (!S.lastIssued) renderTicket(null);
  if (S.sub === "settings" && !$("sub-settings").contains(document.activeElement)) fillSettings();
}

function renderLedger(){
  if (!S.adm) return;
  const q = $("lgQ").value.trim().toLowerCase(), f = $("lgF").value, price = +cfg().price || 0, qn = /\d/.test(q) ? parseTicket(q) : null;
  const rows = [...S.adm.sales].sort((a, b) => (b.at || "").localeCompare(a.at || "")).filter(s => {
    if (f === "unpaid" && (s.paid || s.void)) return false;
    if (f === "paid" && (!s.paid || s.void)) return false;
    if (f === "void" && !s.void) return false;
    if (f === "all" && s.void) return false;
    if (!q) return true;
    if (qn != null && s.nums.includes(qn)) return true;
    return s.buyer.toLowerCase().includes(q) || (s.dept || "").toLowerCase().includes(q);
  });
  $("lgBody").innerHTML = rows.length ? rows.map(s => `<tr class="${s.void ? "void" : ""}">
    <td class="mono">${esc(ranges(s.nums))}</td>
    <td>${esc(s.buyer)}${s.anon ? ' <span class="chip">hidden</span>' : ""}</td><td>${esc(s.dept || "")}</td>
    <td class="num">${s.nums.length}</td><td class="num" title="${esc(partsText(s.pricing))}">${esc(money(saleAmount(s)))}</td><td>${esc(s.method || "")}${colName(s.collectorId) ? `<span style="color:var(--ink-3)"> → ${esc(colName(s.collectorId))}</span>` : ""}</td>
    <td>${srcChip(s)}</td>
    <td>${s.void ? '<span class="chip">Void</span>' : s.paid ? '<span class="chip green">Paid</span>' : '<span class="chip gold">Unpaid</span>'}</td>
    <td style="color:var(--ink-3)" title="${esc(s.soldBy ? "by " + s.soldBy : "")}">${ago(s.at)}</td>
    <td class="acts">${s.void ? "" : `${!isFin() ? "" : s.paid ? `<button class="btn sm ghost" data-act="unpaid" data-id="${s.id}">Mark unpaid</button>` : `<button class="btn sm" data-act="paid" data-id="${s.id}">Mark paid</button>`}
      <button class="btn sm ghost" data-act="show" data-id="${s.id}">Ticket</button>
      <button class="btn sm ghost" data-act="print" data-id="${s.id}">Print</button>
      ${isFin() || !s.paid ? `<button class="btn sm ghost danger" data-act="void" data-id="${s.id}">Void</button>` : ""}`}</td></tr>`).join("")
    : `<tr><td colspan="10" class="empty" style="text-align:center">No sales match.</td></tr>`;
}
$("lgQ").oninput = renderLedger; $("lgF").onchange = renderLedger;
$("lgBody").onclick = e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const s = S.adm.sales.find(x => x.id === b.dataset.id); if (!s) return;
  const a = b.dataset.act;
  if (a === "paid") act("saleUpdate", {id:s.id, paid:true}, `Marked paid · ${s.buyer}`);
  else if (a === "unpaid") act("saleUpdate", {id:s.id, paid:false}, "Marked unpaid");
  else if (a === "show"){ S.lastIssued = s; renderTicket(s); setSub("sell"); scrollTo({top:0, behavior:reduced ? "auto" : "smooth"}); }
  else if (a === "print") printSale(s);
  else if (a === "void") armed(b, () => act("saleUpdate", {id:s.id, void:true}, `Voided ${ranges(s.nums)}`));
};

function renderPrizeEditor(){
  const host = $("prizeEditor"); if (host.contains(document.activeElement)) return;
  const sp = sortedPrizes();
  host.innerHTML = sp.length ? sp.map(p => `<div class="prize-edit" data-id="${p.id}">
    <label class="f wide">Prize<input type="text" id="pn-${p.id}" value="${esc(p.name)}" data-k="name" maxlength="80"></label>
    <label class="f">Qty<input type="number" id="pq-${p.id}" value="${p.qty || 1}" min="1" data-k="qty"></label>
    <label class="f">Value<input type="number" id="pv-${p.id}" value="${p.value ?? ""}" min="0" data-k="value"></label>
    <label class="f">Sponsor<input type="text" id="ps-${p.id}" value="${esc(p.sponsor || "")}" data-k="sponsor" maxlength="40"></label>
    <label class="f">Order<input type="number" id="po-${p.id}" value="${p.order ?? ""}" min="1" data-k="order"></label>
    <div style="display:flex;gap:6px"><button class="btn sm" data-save="${p.id}">Save</button><button class="btn sm ghost danger" data-del="${p.id}">Delete</button></div>
  </div>`).join("") : `<div class="empty">No prizes yet.</div>`;
}
$("prizeEditor").onclick = e => {
  const sv = e.target.closest("[data-save]"), dl = e.target.closest("[data-del]");
  if (sv){ const row = sv.closest(".prize-edit"), d = {id:sv.dataset.save};
    row.querySelectorAll("input[data-k]").forEach(i => d[i.dataset.k] = i.type === "number" ? (i.value === "" ? null : +i.value) : i.value);
    sv.blur(); act("prizeUpsert", d, "Prize saved"); }
  if (dl) armed(dl, () => act("prizeDelete", {id:dl.dataset.del}, "Prize deleted"));
};
$("addPrize").onclick = () => act("prizeUpsert", {name:"New prize", qty:1, value:null, sponsor:"", order:S.pub.prizes.reduce((m, p) => Math.max(m, p.order || 0), 0) + 1}, "Prize added. Edit its details below.");

function renderResults(){
  const dr = [...S.adm.draws].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const saleOf = n => S.adm.sales.find(s => !s.void && s.nums.includes(n));
  $("resBody").innerHTML = dr.length ? dr.map((d, i) => { const s = saleOf(d.ticket), p = S.adm.prizes.find(x => x.id === d.prizeId);
    return `<tr><td class="num">${i + 1}</td><td>${esc(p?.name || d.prizeName || "")}</td><td class="mono">${esc(tno(d.ticket))}</td><td>${esc(s?.buyer || "—")}</td><td>${esc(s?.dept || "")}</td><td style="color:var(--ink-3)">${fmtDate(d.at)}</td>
      <td><button class="btn sm ghost danger" data-undo="${d.id}">Remove</button></td></tr>`; }).join("")
    : `<tr><td colspan="7" class="empty" style="text-align:center">Nothing drawn yet. Run the draw from the Draw stage tab.</td></tr>`;
}
$("resBody").onclick = e => { const b = e.target.closest("[data-undo]"); if (b) armed(b, () => act("drawRemove", {id:b.dataset.undo}, "Result removed. That prize can be drawn again.")); };

function fillSettings(){
  const c = cfg();
  $("cTitle").value = c.title || ""; $("cLede").value = c.lede || ""; $("cCur").value = c.currency || "";
  $("cHeaderTag").value = c.headerTag || ""; $("cDepts").value = (c.departments || []).join("\n");
  if (c.logoUrl) { $("logoPreview").src = c.logoUrl; $("logoPreview").hidden = false; $("logoNone").hidden = true; $("logoRm").hidden = false; }
  else { $("logoPreview").hidden = true; $("logoNone").hidden = false; $("logoRm").hidden = true; }
  $("cPrefix").value = c.prefix || ""; $("cCap").value = c.cap || 0; $("cPer").value = c.perPerson || 0; $("cUrl").value = c.publicUrl || location.host;
  renderBundleRows(bundles().length ? bundles() : [{qty:1, price:0}]);
  const npt = iso => iso ? new Date(new Date(iso).getTime() + 345 * 60000).toISOString().slice(0, 16) : "";
  $("cDraw").value = npt(c.drawAt); $("cClose").value = npt(c.salesCloseAt);
  const si = (S.adm?.config || c).selfIssue || {};
  $("cCompany").value = S.adm?.config?.companyCode ?? "";
  $("siOn").checked = !!si.enabled; $("siHold").value = si.holdHours || 48; $("siMax").value = si.maxPer || 21;
}
$("sub-settings").onsubmit = e => {
  e.preventDefault(); const v = $("cDraw").value;
  const departments = $("cDepts").value.split("\n").map(d => d.trim()).filter(Boolean);
  act("config", {title:$("cTitle").value, lede:$("cLede").value, headerTag:$("cHeaderTag").value, departments,
    ...(isFin() ? {bundles:readBundleRows(), companyCode:$("cCompany").value} : {}), currency:$("cCur").value, prefix:$("cPrefix").value,
    cap:$("cCap").value, perPerson:$("cPer").value, publicUrl:$("cUrl").value, drawAt:v ? v + ":00+05:45" : null,
    salesCloseAt:$("cClose").value ? $("cClose").value + ":00+05:45" : null,
    selfIssue:{enabled:$("siOn").checked, holdHours:$("siHold").value, maxPer:$("siMax").value}}, "Settings saved");
};
$("logoFile").onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast("That image is over 2 MB. Use a smaller file.");
  const rd = new FileReader(); rd.onload = () => act("logoUpload", {dataUrl:rd.result}, "Logo uploaded").then(() => { e.target.value = ""; fillSettings(); });
  rd.readAsDataURL(file);
};
$("logoRm").onclick = () => act("logoUpload", {remove:true}, "Logo removed").then(() => fillSettings());

function renderBundleRows(list){
  $("bundleRows").innerHTML = list.map((b, i) => `<div class="brow">
    <label class="f">Tickets<input type="number" id="bq-${i}" data-k="qty" min="1" max="100" value="${b.qty}" ${i === 0 ? "readonly" : ""}></label>
    <label class="f">Price<input type="number" id="bp-${i}" data-k="price" min="0" value="${b.price}"></label>
    <span class="each" id="be-${i}"></span>
    ${i === 0 || !isFin() ? "<span></span>" : `<button type="button" class="btn sm ghost danger" data-rm="${i}">Remove</button>`}</div>`).join("")
    + (isFin() ? "" : `<p class="hint">Only finance can change ticket prices.</p>`);
  $("bundleRows").querySelectorAll("input").forEach(i => { if (!isFin()) i.readOnly = true; });
  $("addBundle").hidden = !isFin();
  eachHints();
}
const readBundleRows = () => [...$("bundleRows").querySelectorAll(".brow")].map(r => ({qty:+r.querySelector('[data-k=qty]').value, price:+r.querySelector('[data-k=price]').value}));
function eachHints(){ readBundleRows().forEach((b, i) => { const e = $("be-" + i); if (e) e.textContent = b.qty > 0 ? `${money(Math.round(b.price / b.qty))} each` : ""; }); }
$("bundleRows").oninput = eachHints;
$("bundleRows").onclick = e => { const b = e.target.closest("[data-rm]"); if (!b) return; const l = readBundleRows(); l.splice(+b.dataset.rm, 1); renderBundleRows(l); };
$("addBundle").onclick = () => { const l = readBundleRows(), last = l[l.length - 1] || {qty:1, price:0}; l.push({qty:last.qty + 2, price:Math.round(last.price / last.qty * (last.qty + 2) * .8)}); renderBundleRows(l); };

/* ---------------- digital sale ---------------- */
const clampCount = () => { const i = $("sCount"); i.value = Math.max(1, Math.min(100, parseInt(i.value, 10) || 1)); updateTotal(); };
$("sMinus").onclick = () => { $("sCount").value = (+$("sCount").value || 1) - 1; clampCount(); };
$("sPlus").onclick = () => { $("sCount").value = (+$("sCount").value || 1) + 1; clampCount(); };
$("sCount").onchange = clampCount; $("sCount").oninput = updateTotal;
function updateTotal(){
  const n = parseInt($("sCount").value, 10) || 0, p = priceFor(n), up = n ? upsell(n) : null;
  $("sTotal").textContent = p ? money(p.amount) : "Set prices in Settings";
  $("sBreak").textContent = p && p.parts.length && !(p.parts.length === 1 && p.parts[0].times === 1 && p.parts[0].qty === 1) ? partsText(p.parts) : "";
  const h = $("sHint"); h.hidden = !up;
  if (up) h.innerHTML = `<span>${up.text}</span><button type="button" class="btn sm" data-to="${up.m}">Make it ${up.m}</button>`;
}
$("sHint").onclick = e => { const b = e.target.closest("[data-to]"); if (!b) return; $("sCount").value = b.dataset.to; S.lastIssued = null; updateTotal(); renderTicket(null); };
["sBuyer","sDept","sCount"].forEach(id => $(id).addEventListener("input", () => { S.lastIssued = null; renderTicket(null); }));

$("sellForm").onsubmit = async e => {
  e.preventDefault();
  const btn = $("sSubmit"); btn.disabled = true; btn.textContent = "Generating…";
  const j = await act("sale", {buyer:$("sBuyer").value, dept:$("sDept").value, count:$("sCount").value, collectorId:$("sCollector").value, method:$("sMethod").value, paid:isFin() && $("sPaid").checked, anon:$("sAnon").checked});
  btn.disabled = false; btn.textContent = "Generate tickets";
  if (!j) return;
  S.lastIssued = j.sale; renderTicket(j.sale);
  toast(`Issued ${ranges(j.sale.nums)} to ${j.sale.buyer}`);
  $("sBuyer").value = ""; $("sCount").value = 1; $("sAnon").checked = false; updateTotal(); $("sBuyer").focus();
  burst(innerWidth * .7, 220, 50);
};

function renderTicket(s){
  const preview = !s, c = cfg();
  const nextNo = S.adm ? S.adm.counter : 1;
  const d = preview ? {buyer:$("sBuyer").value.trim() || "Buyer name", dept:$("sDept").value.trim(), nums:Array.from({length:Math.max(1, +$("sCount").value || 1)}, (_, i) => nextNo + i)} : s;
  const first = d.nums[0], n = d.nums.length;
  $("ticketPreview").innerHTML = `<div class="ticket" ${preview ? 'style="opacity:.72"' : ""}>
    <div class="t-main">
      <div class="ev">${esc(c.title || "Dashain Raffle")} · ${n} ticket${n > 1 ? "s" : ""}</div>
      <div class="ttl">शुभ दशैं</div>
      <div class="tno">${esc(tno(first))}${n > 1 ? `<span style="font-size:.55em;opacity:.7"> +${n - 1} more</span>` : ""}</div>
      <div class="holder">${esc(d.buyer)}${d.dept ? ` <span style="font-weight:500;color:#6B5433">· ${esc(d.dept)}</span>` : ""}</div>
      <div class="fine2">${c.drawAt ? "Draw " + esc(fmtDate(c.drawAt)) : "Draw date to be announced"}${preview ? " · preview" : s.paid ? " · paid" : " · <b>payment pending</b>"}</div>
      ${n > 1 ? `<div class="tlist">${d.nums.slice(0, 60).map(x => `<span>${esc(tno(x))}</span>`).join("")}${n > 60 ? "<span>…</span>" : ""}</div>` : ""}
    </div>
    <div class="t-stub">${kiteSVG("#FFB930","#FFF3E0",30)}<div class="v">${esc(tno(first))}</div><div class="sh">जय<br>दशैं</div></div>
  </div>`;
  $("issuedActs").hidden = preview;
}
function buyerMessage(s){
  const c = cfg();
  return `Your ${c.title || "Dashain Raffle"} ticket${s.nums.length > 1 ? "s" : ""}: ${ranges(s.nums)}${s.nums.length > 1 ? ` (${s.nums.length} tickets)` : ""}\n${c.drawAt ? "Draw: " + fmtDate(c.drawAt) + " (NPT)\n" : ""}${s.paid ? `Paid ${money(saleAmount(s))}. You're in the draw.` : `Amount due: ${money(saleAmount(s))}. Your tickets enter the draw once paid.`}${!s.paid && colOf(s.collectorId) ? `\nPay ${colOf(s.collectorId).name}${s.method ? " by " + s.method : ""}${colOf(s.collectorId).contact ? " and let them know on " + colOf(s.collectorId).contact : ""}.` : ""}\nFollow the odds and the live draw at https://${c.publicUrl || location.host}\nशुभ दशैं!`;
}
$("copyMsg").onclick = () => { const s = S.lastIssued; if (!s) return;
  navigator.clipboard.writeText(buyerMessage(s)).then(() => toast("Copied. Paste it to the buyer on Slack or email."), () => toast("Copy isn't available here. Select the ticket text manually.")); };
$("printIssued").onclick = () => S.lastIssued && printSale(S.lastIssued);
$("saveImg").onclick = async () => {
  const s = S.lastIssued; if (!s) return;
  const blob = await ticketPNG(s);
  downloadBlob(blob, `${tno(s.nums[0])}_${s.buyer.replace(/[^\w]+/g, "-")}.png`); toast("Ticket image saved");
};
function downloadBlob(blob, name){ const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
async function ticketPNG(s){
  try { await document.fonts.ready; } catch {}
  const W = 1200, H = 520, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d"), c = cfg();
  x.save(); x.beginPath(); x.roundRect(0, 0, W, H, 36); x.clip();
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#FFF6E0"); g.addColorStop(1, "#FFE3A6"); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = "#C4122F"; x.fillRect(W - 250, 0, 250, H);
  x.fillStyle = "#FFE9B8"; for (let y = 24; y < H - 16; y += 18){ x.beginPath(); x.arc(W - 250, y, 3.5, 0, 7); x.fill(); }
  x.restore();
  x.fillStyle = "#8A5A00"; x.font = "700 24px Mukta, sans-serif"; x.fillText((c.title || "Dashain Raffle").toUpperCase() + `  ·  ${s.nums.length} TICKET${s.nums.length > 1 ? "S" : ""}`, 60, 80);
  x.fillStyle = "#7A0C1E"; x.font = "72px 'Yatra One', serif"; x.fillText("शुभ दशैं", 60, 170);
  x.fillStyle = "#1A1410"; x.font = "600 92px 'IBM Plex Mono', monospace"; x.fillText(tno(s.nums[0]), 60, 290);
  if (s.nums.length > 1){ x.font = "600 30px 'IBM Plex Mono', monospace"; x.fillStyle = "#6B5433"; const t = ranges(s.nums); x.fillText(t.length > 52 ? t.slice(0, 50) + "…" : t, 60, 342); }
  x.fillStyle = "#1A1410"; x.font = "700 40px Mukta, sans-serif"; x.fillText(s.buyer + (s.dept ? "  ·  " + s.dept : ""), 60, 420);
  x.fillStyle = "#6B5433"; x.font = "500 26px Mukta, sans-serif"; x.fillText(c.drawAt ? "Live draw " + fmtDate(c.drawAt) + " (NPT)  ·  " + (c.publicUrl || location.host) : (c.publicUrl || location.host), 60, 466);
  x.save(); x.translate(W - 125, 150); x.fillStyle = "#FFB930"; x.beginPath(); x.moveTo(0, -80); x.lineTo(62, 0); x.lineTo(0, 80); x.lineTo(-62, 0); x.closePath(); x.fill();
  x.strokeStyle = "#FFF3E0"; x.lineWidth = 4; x.beginPath(); x.moveTo(0, -80); x.lineTo(0, 80); x.moveTo(-62, 0); x.lineTo(62, 0); x.stroke();
  x.beginPath(); x.moveTo(0, 80); x.quadraticCurveTo(-20, 110, 0, 130); x.quadraticCurveTo(20, 150, 0, 175); x.stroke(); x.restore();
  x.fillStyle = "#FFF3E0"; x.textAlign = "center"; x.font = "44px 'Yatra One', serif"; x.fillText("जय दशैं", W - 125, 400);
  x.font = "600 26px 'IBM Plex Mono', monospace"; x.fillText(tno(s.nums[0]), W - 125, 460);
  return new Promise(res => cv.toBlob(res, "image/png"));
}

/* ---------------- paper tickets ---------------- */
function renderBooks(){
  const books = [...S.adm.batches].sort((a, b) => a.from - b.from), sold = new Set(admSales().flatMap(s => s.nums));
  $("bookList").innerHTML = books.length ? books.map(b => {
    const total = b.to - b.from + 1; let n = 0; for (let i = b.from; i <= b.to; i++) if (sold.has(i)) n++;
    return `<div class="book"><div><div class="t">${esc(b.label)}${b.holder ? ` <span style="font-weight:500;color:var(--ink-3)">· ${esc(b.holder)}</span>` : ""}</div><div class="r">${esc(tno(b.from))} – ${esc(pad(b.to))} · ${n} of ${total} sold</div></div>
      <div class="acts"><button class="btn sm" data-bprint="${b.id}">Print</button>${n ? "" : `<button class="btn sm ghost danger" data-bdel="${b.id}">Delete</button>`}</div>
      <div class="bar"><i style="width:${n / total * 100}%"></i></div></div>`;
  }).join("") : `<div class="empty">No ticket books yet.</div>`;
}
$("bookList").onclick = e => {
  const p = e.target.closest("[data-bprint]"), d = e.target.closest("[data-bdel]");
  if (p){ const b = S.adm.batches.find(x => x.id === p.dataset.bprint); if (b) printBook(b); }
  if (d) armed(d, () => act("batchDelete", {id:d.dataset.bdel}, "Book deleted. Its numbers won't be reused."));
};
$("bookForm").onsubmit = async e => {
  e.preventDefault();
  const j = await act("batch", {count:$("bCount").value, label:$("bLabel").value, holder:$("bHolder").value});
  if (!j) return;
  toast(`${j.batch.label}: ${tno(j.batch.from)} – ${pad(j.batch.to)} reserved`); $("bLabel").value = ""; $("bHolder").value = "";
  printBook(j.batch);
};
function updatePaperTotal(){
  const nums = parseNums($("pNums").value);
  $("pBreak").textContent = "";
  if (!$("pNums").value.trim()){ $("pSummary").textContent = "Total due"; $("pTotal").textContent = "—"; return; }
  if (!nums){ $("pSummary").textContent = "Check the numbers"; $("pTotal").textContent = "—"; return; }
  $("pSummary").textContent = `${nums.length} ticket${nums.length > 1 ? "s" : ""}`; const pp = priceFor(nums.length); $("pTotal").textContent = pp ? money(pp.amount) : "—"; $("pBreak").textContent = pp && nums.length > 1 ? partsText(pp.parts) : "";
}
$("pNums").oninput = updatePaperTotal;
$("paperForm").onsubmit = async e => {
  e.preventDefault();
  const j = await act("bookSale", {nums:$("pNums").value, buyer:$("pBuyer").value, dept:$("pDept").value, collectorId:$("pCollector").value, method:$("pMethod").value, paid:isFin() && $("pPaid").checked, anon:$("pAnon").checked});
  if (!j) return;
  toast(`Recorded ${ranges(j.sale.nums)} for ${j.sale.buyer}`);
  ["pNums","pBuyer","pDept"].forEach(id => $(id).value = ""); $("pAnon").checked = false; updatePaperTotal(); $("pNums").focus();
};

/* ---------------- printing ---------------- */
function printTickets(items){
  const c = cfg(), url = c.publicUrl || location.host;
  const pz = sortedPrizes().slice(0, 3).map(p => p.name).join(" · ") + (S.pub.prizes.length > 3 ? ` + ${prizeQty() - 3} more prizes` : "");
  const when = c.drawAt ? "Live draw " + fmtDate(c.drawAt) + " (NPT)" : "Draw date to be announced";
  const one = it => `<div class="pt">
    <div class="stub">
      <div class="sn">${esc(tno(it.n))}</div>
      <div class="ln"><span>Name</span><i>${esc(it.buyer || "")}</i></div>
      <div class="ln"><span>Team</span><i>${esc(it.dept || "")}</i></div>
      <div class="ln"><span>Phone</span><i></i></div>
      <div class="ln"><span>Paid</span><i>${it.paid ? "Yes" : ""}</i><span>Seller</span><i>${esc(it.seller || "")}</i></div>
      <div class="keep">Seller keeps this stub</div>
    </div>
    <div class="main">
      <div>
        <div class="ev">${esc(c.title || "Dashain Raffle")}${bundles().length ? " · " + esc(priceLine()) : ""}</div>
        <div class="ttl">शुभ विजया दशमी</div>
        <div class="no">${esc(tno(it.n))}</div>
        <div class="nm">${esc(it.buyer || "")}</div>
        <div class="pz">${esc(pz)}</div>
        <div class="ft">${esc(when)} · Odds &amp; results: ${esc(url)}</div>
      </div>
      <div class="side">${kiteSVG("#C4122F","#E89B00",38).replace('stroke="var(--ink-3)"','stroke="#7a6a55"')}<div class="v">${esc(tno(it.n))}</div><div class="sh">जय<br>दशैं</div></div>
      ${it.paid ? '<div class="paid">PAID</div>' : ""}
    </div>
  </div>`;
  const pages = []; for (let i = 0; i < items.length; i += 5) pages.push(`<div class="psheet">${items.slice(i, i + 5).map(one).join("")}</div>`);
  $("printRoot").innerHTML = pages.join("");
  const go = () => setTimeout(() => window.print(), 120);
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go);
}
function printSale(s){ printTickets(s.nums.map(n => ({n, buyer:s.buyer, dept:s.dept, paid:s.paid, seller:s.soldBy}))); }
function printBook(b){
  const bySale = new Map(); for (const s of admSales()) for (const n of s.nums) bySale.set(n, s);
  const items = []; for (let n = b.from; n <= b.to; n++){ const s = bySale.get(n); items.push(s ? {n, buyer:s.buyer, dept:s.dept, paid:s.paid, seller:b.holder} : {n, seller:b.holder}); }
  printTickets(items);
}

$("csvBtn").onclick = () => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, price = +cfg().price || 0;
  const rows = [["Tickets","Buyer","Team","Qty","Amount","Method","Type","Paid","Void","Hidden from board","Sold at","Sold by"]]
    .concat([...S.adm.sales].sort((a, b) => a.nums[0] - b.nums[0]).map(s => [ranges(s.nums), s.buyer, s.dept, s.nums.length, saleAmount(s), s.method, s.source === "book" ? "paper" : "digital", s.paid ? "yes" : "no", s.void ? "yes" : "no", s.anon ? "yes" : "no", s.at, s.soldBy]));
  downloadBlob(new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\n")], {type:"text/csv"}), "dashain-raffle-sales.csv"); toast("CSV saved");
};

/* ---------------- draw stage ---------------- */
function renderStageCtl(){
  $("tIn").textContent = S.pub.inDraw; $("tLeft").textContent = prizesLeft(); $("tDrawn").textContent = S.pub.draws.length;
  if (!S.admin) return;
  const sel = $("drawPrize"), prev = sel.value;
  const opts = [...S.pub.prizes].sort((a, b) => (b.order ?? 0) - (a.order ?? 0)).map(p => ({p, left:(p.qty || 1) - drawnFor(p.id)})).filter(o => o.left > 0);
  sel.innerHTML = opts.length ? opts.map(o => `<option value="${o.p.id}">${esc(o.p.name)}${o.left > 1 ? ` (${o.left} left)` : ""}</option>`).join("") : `<option value="">All prizes drawn</option>`;
  if (opts.some(o => o.p.id === prev)) sel.value = prev;
  const phys = S.drawMode === "physical";
  document.querySelectorAll(".stage-ctl .mode button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === (S.drawMode || "random")));
  $("manualBox").hidden = !phys; $("drawBtn").textContent = phys ? "Announce winner" : "Draw a winner";
  $("drawBtn").disabled = !opts.length || S.pub.stage?.state === "rolling" || (phys ? !manualCheck().ok : !S.pub.inDraw);
  renderManualInfo();
}
let reelTimer = null, lastKey = "", animatedDraw = null, reelBusy = false;
const reelPool = () => S.pub.sales.filter(s => s.paid).flatMap(s => s.nums);
function renderStage(){
  const st = S.pub.stage || {state:"idle"}, reel = $("reel");
  const key = `${st.state}|${st.at}|${st.ticket}|${S.pub.draws.length}`; if (key === lastKey) return; lastKey = key;
  const fresh = st.at && Date.now() - new Date(st.at) < 30000;
  if (st.state === "idle"){
    if (reelBusy) return; stopReel();
    const last = [...S.pub.draws].sort((a, b) => (b.at || "").localeCompare(a.at || ""))[0];
    $("stEyebrow").textContent = last ? "Last winner" : "Get ready";
    $("stPrize").textContent = last ? (S.pub.prizes.find(p => p.id === last.prizeId)?.name || last.prizeName) : "Waiting for the next draw";
    reel.textContent = last ? tno(last.ticket) : `${cfg().prefix || "T"}-????`;
    $("stWho").textContent = last ? last.name + (last.dept ? " · " + last.dept : "") : "";
    $("stNote").textContent = "Keep this screen open. It updates the moment the organisers draw a winner.";
    return;
  }
  $("stPrize").textContent = S.pub.prizes.find(p => p.id === st.prizeId)?.name || st.prizeName || "Prize";
  if (st.state === "rolling"){
    $("stEyebrow").textContent = "Now drawing"; $("stWho").textContent = ""; $("stNote").textContent = "Picking a ticket at random from every paid ticket…";
    startReel();
  } else if (st.state === "revealed"){
    $("stEyebrow").textContent = "Winner";
    const land = () => { reel.classList.remove("rolling"); reel.textContent = tno(st.ticket); $("stWho").textContent = (st.name || "") + (st.dept ? " · " + st.dept : "");
      $("stNote").textContent = "Congratulations! Come see the raffle team to collect."; };
    if (fresh && !reduced && animatedDraw !== st.drawId){ animatedDraw = st.drawId; slowStop(() => { land(); reel.classList.remove("hit"); void reel.offsetWidth; reel.classList.add("hit"); celebrate(); }); }
    else if (!reelBusy){ stopReel(); land(); }
  }
}
function startReel(){
  const reel = $("reel"), pool = reelPool(); stopReel(); reel.classList.add("rolling");
  if (reduced){ reel.textContent = "…"; return; }
  reelTimer = setInterval(() => { reel.textContent = tno(pool.length ? pool[randInt(pool.length)] : randInt(9999) + 1); }, 55);
}
function slowStop(done){
  const reel = $("reel"), pool = reelPool(); clearInterval(reelTimer); reel.classList.add("rolling"); reelBusy = true;
  let delay = 60;
  const step = () => { if (delay > 420){ reelBusy = false; done(); return; } reel.textContent = tno(pool.length ? pool[randInt(pool.length)] : 1); delay *= 1.16; reelTimer = setTimeout(step, delay); };
  step();
}
function stopReel(){ clearInterval(reelTimer); clearTimeout(reelTimer); $("reel").classList.remove("rolling"); }
// physical draw: check the typed number against the organiser's copy of the sales before announcing
function manualCheck(){
  const raw = $("manualNo").value.trim(); if (!raw) return {ok:false, msg:""};
  const m = raw.toUpperCase().match(/(\d{1,6})\s*$/); if (!m) return {ok:false, msg:"Type the number printed on the ticket."};
  const n = +m[1], s = S.adm?.sales.find(x => !x.void && x.nums.includes(n));
  if (!s) return {ok:false, msg:`${tno(n)} was never sold. Put it aside and draw again.`};
  if (!s.paid) return {ok:false, msg:`${tno(n)} belongs to ${s.buyer} but isn't paid, so it can't win. Draw again.`};
  const w = S.pub.draws.find(d => d.ticket === n); if (w) return {ok:false, msg:`${tno(n)} already won ${w.prizeName}. Draw again.`};
  return {ok:true, n, msg:`${tno(n)} · ${s.buyer}${s.dept ? " (" + s.dept + ")" : ""} · paid. Ready to announce.`};
}
function renderManualInfo(){
  const el = $("manualInfo"), c = S.drawMode === "physical" ? manualCheck() : {msg:""};
  el.hidden = !c.msg; el.textContent = c.msg; el.className = "manual-info " + (c.ok ? "ok" : "bad");
}
document.querySelectorAll(".stage-ctl .mode button").forEach(b => b.onclick = () => { S.drawMode = b.dataset.mode; renderStageCtl(); if (S.drawMode === "physical") $("manualNo").focus(); });
$("manualNo").oninput = () => renderStageCtl();
$("manualNo").onkeydown = e => { if (e.key === "Enter" && !$("drawBtn").disabled) $("drawBtn").click(); };
$("drawBtn").onclick = async () => {
  const id = $("drawPrize").value; if (!id) return;
  $("drawBtn").disabled = true;
  if (S.drawMode === "physical"){ const c = manualCheck(); if (!c.ok) return renderStageCtl();
    const j = await act("drawManual", {prizeId:id, ticket:c.n}); if (j) $("manualNo").value = ""; renderStageCtl(); }
  else act("draw", {prizeId:id});
};
$("printSlips").onclick = () => {
  const won = new Set(S.pub.draws.map(d => d.ticket));
  const items = (S.adm?.sales || []).filter(s => !s.void && s.paid).flatMap(s => s.nums.filter(n => !won.has(n)).map(n => ({n, name:s.buyer}))).sort((a, b) => a.n - b.n);
  if (!items.length) return toast("No paid tickets to print yet.");
  const pages = []; for (let i = 0; i < items.length; i += 40) pages.push(`<div class="slipsheet">${items.slice(i, i + 40).map(it => `<div class="slip"><div class="n">${esc(tno(it.n))}</div><div class="b">${esc(it.name)}</div></div>`).join("")}</div>`);
  $("printRoot").innerHTML = pages.join("");
  toast(`${items.length} slips, ${pages.length} page${pages.length > 1 ? "s" : ""}. Cut, fold and drop them in the bowl.`);
  const go = () => setTimeout(() => window.print(), 150);
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go);
};
$("stageReset").onclick = () => act("stageReset", {}, "Stage cleared");

function renderPrizeBoard(){
  const sp = sortedPrizes(), st = S.pub.stage || {}, drawn = S.pub.draws.length, total = prizeQty();
  $("pbSub").textContent = total ? `${drawn} of ${total} drawn` : "";
  $("pbList").innerHTML = sp.length ? sp.map((p, i) => {
    const qty = p.qty || 1, got = S.pub.draws.filter(d => d.prizeId === p.id).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    const now = st.prizeId === p.id && (st.state === "rolling" || st.state === "revealed");
    const ws = got.map(d => `<span class="w"><span class="t">${esc(tno(d.ticket))}</span><b>${esc(d.name)}</b>${d.dept ? `<span style="color:var(--ink-3)">${esc(d.dept)}</span>` : ""}</span>`)
      .concat(Array.from({length:Math.max(0, qty - got.length)}, () => `<span class="w slot">${now && st.state === "rolling" ? "Drawing now…" : "To be drawn"}</span>`));
    return `<li class="pb ${i === 0 ? "grand" : ""} ${got.length >= qty ? "done" : ""} ${now ? "now" : ""}"><span class="rk">${p.order ?? i + 1}</span>
      <div class="nm">${esc(p.name)}<small>${rankLabel(i)}${qty > 1 ? ` · ${qty} winners` : ""}${p.value ? ` · worth ${esc(money(p.value))}` : ""}</small></div>
      <div class="ws">${ws.join("")}</div></li>`;
  }).join("") : `<li class="empty">No prizes yet.</li>`;
}
function setPrizeBoard(open){
  $("prizeBoard").hidden = !open; $("listToggle").setAttribute("aria-expanded", open);
  $("listToggle").textContent = open ? "Hide prizes & winners" : "Show prizes & winners";
  try { localStorage.setItem("raffle.pb", open ? "1" : "0"); } catch {}
  if (open && S.tab === "draw") $("prizeBoard").scrollIntoView({behavior:reduced ? "auto" : "smooth", block:"start"});
}
$("listToggle").onclick = () => setPrizeBoard($("prizeBoard").hidden);
try { if (localStorage.getItem("raffle.pb") === "1"){ $("prizeBoard").hidden = false; $("listToggle").setAttribute("aria-expanded", "true"); $("listToggle").textContent = "Hide prizes & winners"; } } catch {}

/* ---------------- ambient ---------------- */
function kiteSky(canvas, count, dark){
  const ctx = canvas.getContext("2d"); let W = 0, H = 0;
  const pal = ["#C4122F","#E89B00","#5E8C22","#2463D1","#FF5566","#FFB930"];
  const kites = Array.from({length:count}, (_, i) => ({x:Math.random(), y:.08 + Math.random() * .5, s:10 + Math.random() * 16, c:pal[i % pal.length], ph:Math.random() * 6.28, sp:.3 + Math.random() * .6, ax:.1 + Math.random() * .8}));
  const size = () => { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  const draw = t => {
    ctx.clearRect(0, 0, W, H);
    for (const k of kites){
      const x = k.x * W + Math.sin(t / 1000 * k.sp + k.ph) * 18, y = k.y * H + Math.cos(t / 1300 * k.sp + k.ph) * 10, s = k.s, rot = Math.sin(t / 900 * k.sp + k.ph) * .25;
      ctx.strokeStyle = dark ? "rgba(255,255,255,.14)" : "rgba(21,32,58,.14)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + s); ctx.quadraticCurveTo((x + k.ax * W) / 2, H * .9, k.ax * W, H + 10); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = dark ? .85 : .55;
      ctx.fillStyle = k.c; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * .8, 0); ctx.lineTo(0, s); ctx.lineTo(-s * .8, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.moveTo(-s * .8, 0); ctx.lineTo(s * .8, 0); ctx.stroke();
      ctx.restore();
    }
  };
  size(); addEventListener("resize", size);
  if (reduced){ draw(0); return {size:() => { size(); draw(0); }}; }
  const loop = t => { if (canvas.offsetParent !== null && !document.hidden) draw(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  return {size};
}
const heroSky = kiteSky($("kites"), 7, false), stageSky = kiteSky($("stageSky"), 10, true);

const fx = $("fx"), fctx = fx.getContext("2d"); let parts = [], fxOn = false;
function sizeFx(){ const d = devicePixelRatio || 1; fx.width = innerWidth * d; fx.height = innerHeight * d; fctx.setTransform(d, 0, 0, d, 0, 0); }
sizeFx(); addEventListener("resize", sizeFx);
function burst(x, y, n){
  if (reduced) return;
  const pal = ["#C4122F","#FFB930","#9BCB55","#6FA0FF","#FFF3E0"];
  for (let i = 0; i < n; i++){ const a = Math.random() * 6.28, v = 4 + Math.random() * 8;
    parts.push({x, y, vx:Math.cos(a) * v, vy:Math.sin(a) * v - 6, s:5 + Math.random() * 7, c:pal[i % pal.length], r:Math.random() * 6, vr:(Math.random() - .5) * .3, life:1}); }
  if (!fxOn){ fxOn = true; requestAnimationFrame(fxLoop); }
}
function fxLoop(){
  fctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 40);
  for (const p of parts){ p.vy += .25; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= .006;
    fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.r); fctx.globalAlpha = Math.max(0, p.life); fctx.fillStyle = p.c;
    fctx.beginPath(); fctx.moveTo(0, -p.s); fctx.lineTo(p.s * .7, 0); fctx.lineTo(0, p.s); fctx.lineTo(-p.s * .7, 0); fctx.closePath(); fctx.fill(); fctx.restore(); }
  if (parts.length) requestAnimationFrame(fxLoop); else { fxOn = false; fctx.clearRect(0, 0, innerWidth, innerHeight); }
}
function celebrate(){ const r = $("reel").getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 140); setTimeout(() => burst(innerWidth * .2, innerHeight * .3, 70), 250); setTimeout(() => burst(innerWidth * .8, innerHeight * .3, 70), 450); }


/* ---------------- live ticker + purchase pops ---------------- */
const nptDay = iso => new Intl.DateTimeFormat("en-CA", {timeZone:TZ}).format(new Date(iso));
let tickerKey = "";
function renderTicker(){
  const el = $("ticker"), show = S.tab !== "manage" && S.pub.sales.length > 0;
  el.hidden = !show; if (!show) return;
  const sales = [...S.pub.sales].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const recent = sales.slice(0, 14);
  const key = recent.map(s => s.id).join() + "|" + S.pub.inDraw + "|" + prizesLeft() + "|" + (cfg().drawAt || "");
  if (key === tickerKey) return; tickerKey = key;
  const today = nptDay(new Date().toISOString()), hourAgo = Date.now() - 3600e3;
  const tToday = sales.filter(s => nptDay(s.at) === today).reduce((a, s) => a + s.nums.length, 0);
  const tHour = sales.filter(s => new Date(s.at) > hourAgo).reduce((a, s) => a + s.nums.length, 0);
  const by = {}; for (const s of sales) if (s.dept) by[s.dept] = (by[s.dept] || 0) + s.nums.length;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const N = S.pub.inDraw, days = cfg().drawAt ? Math.ceil((new Date(cfg().drawAt) - Date.now()) / 86400e3) : null;
  const stats = [
    tHour ? `<b>${tHour}</b> tickets sold in the last hour` : tToday ? `<b>${tToday}</b> tickets sold today` : null,
    N && sortedPrizes()[0] ? `Grand prize odds now <b>1 in ${N.toLocaleString("en-IN")}</b> and shrinking` : null,
    top ? `${esc(top[0])} leads with <b>${top[1]}</b> tickets. Is your team next?` : null,
    days != null && days > 0 ? `<b>${days}</b> day${days > 1 ? "s" : ""} until the live draw` : null,
    prizesLeft() ? `<b>${prizesLeft()}</b> prizes still up for grabs` : null,
    bestDeal() ? `Best value: <b>${bestDeal().qty} tickets for ${esc(money(bestDeal().price))}</b>` : null,
  ].filter(Boolean);
  const kite = `<svg width="13" height="15" viewBox="0 0 30 34" aria-hidden="true"><path d="M15 1 L28 13 L15 25 L2 13 Z" fill="#FFB930"/><path d="M15 1 L15 25 M2 13 L28 13" stroke="#C4122F" stroke-width="2"/></svg>`;
  const items = []; let si = 0;
  recent.forEach((s, i) => {
    items.push(`<span class="tk">${kite}<b>${esc(s.name)}</b>${s.dept ? ` · ${esc(s.dept)}` : ""} got <span class="n">${s.nums.length}</span> ticket${s.nums.length > 1 ? "s" : ""} <span class="tm" data-at="${esc(s.at)}">${ago(s.at)}</span></span>`);
    if (i % 3 === 2 && stats.length) items.push(`<span class="tk tk-stat">${stats[si++ % stats.length]}</span>`);
  });
  if (recent.length < 3 && stats.length) items.push(`<span class="tk tk-stat">${stats[0]}</span>`);
  const html = items.join(""), track = $("tickerTrack");
  track.innerHTML = html + `<span style="display:contents" aria-hidden="true">${html}</span>`;
  requestAnimationFrame(() => { const w = track.scrollWidth / 2; track.style.animationDuration = Math.max(25, w / 55) + "s"; });
}
function refreshTickerTimes(){ document.querySelectorAll("#tickerTrack .tm[data-at]").forEach(e => { const t = ago(e.dataset.at); if (e.textContent !== t) e.textContent = t; }); }

const popQ = []; let popBusy = false, popTimer = 0;
function queuePops(fresh){ for (const s of fresh.slice(-2)) popQ.push(s); if (!popBusy) nextPop(); }
function nextPop(){
  const s = popQ.shift(), el = $("pop"); if (!s){ popBusy = false; return; }
  if (S.tab === "manage"){ popQ.length = 0; popBusy = false; return; }
  popBusy = true;
  $("popT").innerHTML = `<b>${esc(s.name)}</b>${s.dept ? ` from ${esc(s.dept)}` : ""} just bought <b>${s.nums.length} ticket${s.nums.length > 1 ? "s" : ""}</b>`;
  const N = S.pub.inDraw;
  $("popS").innerHTML = N ? `Grand prize odds are now <span class="hot">1 in ${N.toLocaleString("en-IN")}</span>${bestDeal() ? ` · ${bestDeal().qty} for ${esc(money(bestDeal().price))}` : cfg().price ? ` · ${esc(money(cfg().price))} a ticket` : ""}` : "Get yours before the draw";
  el.classList.add("show");
  clearTimeout(popTimer); popTimer = setTimeout(hidePop, 6500);
}
function hidePop(){ $("pop").classList.remove("show"); clearTimeout(popTimer); setTimeout(nextPop, 500); }
$("popX").onclick = hidePop;

/* ---------------- collectors (shared) ---------------- */
const METHODS = ["Cash","eSewa","Khalti","Bank transfer","Salary deduction","Other"];
const collectors = () => cfg().collectors || [];
const colOf = id => (S.adm?.config.collectors || collectors()).find(c => c.id === id);
const colName = id => (S.adm?.config.collectors || collectors()).find(c => c.id === id)?.name || "";
const srcChip = s => s.source === "book" ? '<span class="chip">Paper</span>' : s.source === "self" ? '<span class="chip gold">Self-service</span>' : '<span class="chip">Digital</span>';
function fillCollectorSelect(colId, methId){
  const cs = collectors(), cSel = $(colId), mSel = $(methId), prevC = cSel.value, prevM = mSel.value;
  const cHtml = cs.map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.kind === "finance" ? " (Finance)" : ""}</option>`).join("");
  if (cSel.dataset.h !== cHtml){ cSel.innerHTML = cHtml; cSel.dataset.h = cHtml; if (cs.some(c => c.id === prevC)) cSel.value = prevC; }
  const c = cs.find(x => x.id === cSel.value), ms = c ? c.methods : [];
  const mHtml = ms.map(m => `<option>${esc(m)}</option>`).join("");
  if (mSel.dataset.h !== mHtml){ mSel.innerHTML = mHtml; mSel.dataset.h = mHtml; if (ms.includes(prevM)) mSel.value = prevM; }
}
$("sCollector").onchange = () => fillCollectorSelect("sCollector", "sMethod");
$("pCollector").onchange = () => fillCollectorSelect("pCollector", "pMethod");

/* ---------------- company-code gate ---------------- */
async function unlock(inputId, errId, btn){
  $(errId).textContent = ""; const code = $(inputId).value.trim(); if (!code) return;
  btn.disabled = true;
  try {
    await api("/api/unlock", {code});
    await load(); toast("Prices and payment details unlocked");
  } catch (e){ $(errId).textContent = e.message; }
  finally { btn.disabled = false; }
}
$("unlockHero").onsubmit = e => { e.preventDefault(); unlock("ucHero", "ucHeroErr", e.submitter || $("unlockHero").querySelector("button")); };
$("unlockBuy").onsubmit = e => { e.preventDefault(); unlock("ucBuy", "ucBuyErr", e.submitter || $("unlockBuy").querySelector("button")); };

/* ---------------- self-service ---------------- */
S.receiptToken = new URLSearchParams(location.search).get("r"); S.receipt = null;
let buyCollector = null;
function renderBuy(){
  const open = salesOpen(), on = selfOn(), closed = $("buyClosed");
  if (S.receiptToken){ $("buyForm").hidden = true; $("unlockBuy").hidden = true; closed.hidden = true; renderReceipt(); return; }
  $("receipt").hidden = true;
  if (!on || !open){ $("buyForm").hidden = true; $("unlockBuy").hidden = true; closed.hidden = false;
    closed.innerHTML = `<h2>${open ? "Self-service isn't open" : "Ticket sales have closed"}</h2><p class="hint">${open ? "Buy your tickets from an organiser or the finance team." : "Thanks to everyone who took part. Watch the live draw on the Draw stage."}</p>`; return; }
  closed.hidden = true;
  $("unlockBuy").hidden = !S.pub.locked; $("buyForm").hidden = !!S.pub.locked;
  if (S.pub.locked) return;
  const bs = bundles(), max = cfg().selfIssue?.maxPer || 21;
  $("bCount").max = max;
  const tHtml = bs.map(b => `<button type="button" data-q="${b.qty}" aria-pressed="false"><b>${b.qty} ticket${b.qty > 1 ? "s" : ""}</b><span>${esc(money(b.price))}${b.qty > 1 ? " · " + esc(money(Math.round(b.price / b.qty))) + " each" : ""}</span></button>`).join("");
  if ($("buyTiers").dataset.h !== tHtml){ $("buyTiers").innerHTML = tHtml; $("buyTiers").dataset.h = tHtml; }
  const cs = collectors(); if (!cs.some(c => c.id === buyCollector)) buyCollector = cs[0]?.id || null;
  const cHtml = cs.map(c => `<label><input type="radio" name="bCol" value="${esc(c.id)}" ${c.id === buyCollector ? "checked" : ""}><span><span class="cn">${esc(c.name)}</span><br><span class="cm">${c.kind === "finance" ? "Finance · " : ""}${esc(c.methods.join(", "))}</span></span></label>`).join("");
  if ($("buyCollectors").dataset.h !== cHtml + buyCollector){ $("buyCollectors").innerHTML = cHtml; $("buyCollectors").dataset.h = cHtml + buyCollector; }
  const c = cs.find(x => x.id === buyCollector), mSel = $("bMethod"), prev = mSel.value;
  const mHtml = (c?.methods || []).map(m => `<option>${esc(m)}</option>`).join("");
  if (mSel.dataset.h !== mHtml){ mSel.innerHTML = mHtml; mSel.dataset.h = mHtml; if (c?.methods.includes(prev)) mSel.value = prev; }
  updateBuyTotal();
}
function updateBuyTotal(){
  const max = cfg().selfIssue?.maxPer || 21, i = $("bCount"); let n = parseInt(i.value, 10) || 1; n = Math.max(1, Math.min(max, n));
  const p = priceFor(n), up = n < max ? upsell(n, true) : null;
  $("bTotal").textContent = p ? money(p.amount) : "—";
  $("bBreak").textContent = p && n > 1 ? partsText(p.parts) : "";
  document.querySelectorAll("#buyTiers button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.q === n));
  const h = $("bHint"); h.hidden = !up || up.m > max;
  if (up && up.m <= max) h.innerHTML = `<span>${up.text}</span><button type="button" class="btn sm" data-to="${up.m}">Make it ${up.m}</button>`;
}
$("buyTiers").onclick = e => { const b = e.target.closest("[data-q]"); if (b){ $("bCount").value = b.dataset.q; updateBuyTotal(); } };
$("bHint").onclick = e => { const b = e.target.closest("[data-to]"); if (b){ $("bCount").value = b.dataset.to; updateBuyTotal(); } };
$("bMinus").onclick = () => { $("bCount").value = Math.max(1, (+$("bCount").value || 1) - 1); updateBuyTotal(); };
$("bPlus").onclick = () => { $("bCount").value = Math.min(cfg().selfIssue?.maxPer || 21, (+$("bCount").value || 1) + 1); updateBuyTotal(); };
$("bCount").oninput = updateBuyTotal;
$("buyCollectors").onchange = e => { if (e.target.name === "bCol"){ buyCollector = e.target.value; renderBuy(); } };
$("buyForm").onsubmit = async e => {
  e.preventDefault(); $("bErr").textContent = "";
  const btn = $("bSubmit"); btn.disabled = true; btn.textContent = "Reserving…";
  try {
    const j = await api("/api/self/issue", {buyer:$("bName").value, dept:$("bDept").value, phone:$("bPhone").value, count:$("bCount").value,
      collectorId:buyCollector, method:$("bMethod").value, anon:$("bAnon").checked});
    S.receipt = j.receipt; S.receiptToken = j.receipt.token;
    try { history.replaceState(null, "", "?r=" + encodeURIComponent(S.receiptToken) + "#buy"); } catch {}
    renderBuy(); burst(innerWidth / 2, 200, 80); scrollTo({top:0, behavior:reduced ? "auto" : "smooth"});
  } catch (err){ $("bErr").textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "Reserve my tickets"; }
};
async function fetchReceipt(){
  if (!S.receiptToken) return;
  try { const r = await fetch("/api/receipt?t=" + encodeURIComponent(S.receiptToken), {cache:"no-store"}); S.receiptLoaded = true; if (r.ok){ S.receipt = (await r.json()).receipt; if (S.tab === "buy") renderReceipt(); } else if (r.status === 404){ S.receipt = null; renderReceipt(); } } catch {}
}
function renderReceipt(){
  const el = $("receipt"); el.hidden = false; const r = S.receipt;
  if (!r && !S.receiptLoaded){ el.innerHTML = `<p class="hint">Loading your receipt…</p>`; return; }
  if (!r){ el.innerHTML = `<h2>Receipt not found</h2><p class="hint">Check the link, or reserve new tickets.</p><div><button type="button" class="btn" data-new>Reserve tickets</button></div>`; return; }
  const c = r.collector, ref = tno(r.nums[0]);
  const status = r.paid ? `<span class="chip green">Paid · you're in the draw</span>` : r.expired ? `<span class="chip">Expired</span>` : r.void ? `<span class="chip">Cancelled</span>` : r.claimedAt ? `<span class="chip gold">Waiting for finance to confirm</span>` : `<span class="chip red">Payment needed</span>`;
  const pending = !r.paid && !r.void;
  el.innerHTML = `
    <div class="status"><h2 style="margin-right:auto">${r.paid ? "You're in!" : pending ? "Tickets reserved" : "Reservation closed"}</h2>${status}</div>
    <div class="ticket"><div class="t-main">
      <div class="ev">${esc(cfg().title || "Dashain Raffle")} · ${r.nums.length} ticket${r.nums.length > 1 ? "s" : ""}</div>
      <div class="ttl">शुभ दशैं</div>
      <div class="tno">${esc(ref)}${r.nums.length > 1 ? `<span style="font-size:.55em;opacity:.7"> +${r.nums.length - 1} more</span>` : ""}</div>
      <div class="holder">${esc(r.buyer)}${r.dept ? ` <span style="font-weight:500;color:#6B5433">· ${esc(r.dept)}</span>` : ""}</div>
      <div class="fine2">${r.paid ? "Paid" : "Payment pending"} · ${esc(money(r.amount))}</div>
      ${r.nums.length > 1 ? `<div class="tlist">${r.nums.map(n => `<span>${esc(tno(n))}</span>`).join("")}</div>` : ""}
    </div><div class="t-stub">${kiteSVG("#FFB930","#FFF3E0",30)}<div class="v">${esc(ref)}</div><div class="sh">जय<br>दशैं</div></div></div>
    ${pending ? `<div class="pay-box">
      ${c?.qr && r.method !== "Cash" ? `<img src="${esc(c.qr)}" alt="Payment QR for ${esc(c.name)}">` : ""}
      <div>
        <div class="eyebrow">Pay ${c ? esc(c.name) : "the raffle team"}${r.method ? " · " + esc(r.method) : ""}</div>
        <div class="amt">${esc(money(r.amount))}</div>
        ${r.method !== "Cash" ? `<div class="hint" style="margin-top:4px">Put <span class="ref">${esc(ref)}</span> in the payment remarks so we can match it.</div>` : ""}
        ${c?.note ? `<p class="hint" style="margin-top:6px">${esc(c.note)}</p>` : ""}
        ${r.method === "Cash" ? `<p class="hint" style="margin-top:6px">Hand the cash to ${c ? esc(c.name) : "the collector"} and mention ${esc(ref)}.</p>` : ""}
        ${!r.claimedAt && r.expiresAt ? `<p class="hint" style="margin-top:6px">Held for you until <b>${esc(fmtDate(r.expiresAt))}</b>. Unpaid reservations are released after that.</p>` : ""}
      </div></div>
      ${r.claimedAt ? `<p class="hint">Thanks! You told us you paid${r.txn ? ` (reference ${esc(r.txn)})` : ""}. Finance will confirm shortly and this page updates by itself.</p>`
        : `<form class="claim" id="claimForm"><input type="text" id="claimTxn" maxlength="60" placeholder="${r.method === "Cash" ? "Who did you hand it to? (optional)" : "Transaction ID from " + esc(r.method || "your payment app")}"><button class="btn dark" type="submit">I've paid</button></form>`}` : ""}
    ${pending ? tellBlock(r) : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn" data-copy>Copy my receipt link</button>
      <button type="button" class="btn ghost" data-new>Reserve more tickets</button>
    </div>
    <p class="hint">Bookmark this page. It's your receipt, and it updates live when your payment is confirmed.</p>`;
}
const chatLabel = u => /slack/i.test(u) ? "Open Slack" : /teams|msteams/i.test(u) ? "Open Teams" : /^mailto:/i.test(u) ? "Send email" : /whatsapp|wa\.me/i.test(u) ? "Open WhatsApp" : "Open chat";
function paidMessage(r){
  const c = r.collector, first = (c?.name || "").split(/[ ,]/)[0];
  return `Hi${first ? " " + first : ""}, I've ${r.method === "Cash" ? "handed you" : "sent"} ${money(r.amount)}${r.method && r.method !== "Cash" ? " via " + r.method : ""} for my ${cfg().title || "raffle"} ticket${r.nums.length > 1 ? "s" : ""} ${ranges(r.nums)}.\n`
    + `Reference: ${tno(r.nums[0])}${r.txn ? " · Transaction ID: " + r.txn : ""}\nReceipt: ${location.origin}/?r=${encodeURIComponent(r.token)}#buy\nThanks! ${r.buyer}`;
}
function tellBlock(r){
  const c = r.collector; if (!c) return "";
  return `<div class="tell"><div class="eyebrow">Let ${esc(c.name)} know</div>
    <p class="hint" style="margin:0">After paying, send this on ${c.contact ? esc(c.contact) : "Slack, Teams or your usual office chat"} so they can confirm it quickly.</p>
    <pre id="tellMsg">${esc(paidMessage(r))}</pre>
    <div class="acts"><button type="button" class="btn dark" data-tell>Copy message</button>${c.contactUrl ? `<a class="btn" href="${esc(c.contactUrl)}" target="_blank" rel="noopener">${esc(chatLabel(c.contactUrl))}</a>` : ""}</div></div>`;
}
$("receipt").onclick = e => {
  if (e.target.closest("[data-tell]") && S.receipt) navigator.clipboard.writeText(paidMessage(S.receipt)).then(() => toast("Copied. Paste it in your chat with the collector."), () => toast("Copy isn't available. Select the message text instead."));
  if (e.target.closest("[data-copy]")) navigator.clipboard.writeText(location.origin + "/?r=" + encodeURIComponent(S.receiptToken) + "#buy").then(() => toast("Receipt link copied"), () => toast("Copy isn't available. Bookmark this page instead."));
  if (e.target.closest("[data-new]")){ S.receiptToken = null; S.receipt = null; try { history.replaceState(null, "", "/#buy"); } catch {} renderBuy(); }
};
$("receipt").onsubmit = async e => {
  if (e.target.id !== "claimForm") return; e.preventDefault();
  try { const j = await api("/api/self/claim", {token:S.receiptToken, txn:$("claimTxn").value}); S.receipt = j.receipt; renderReceipt(); toast("Thanks! Finance will confirm your payment."); }
  catch (err){ toast(err.message); }
};

/* ---------------- payments queue (finance) ---------------- */
function renderPayments(){
  if (!S.adm || !isFin()) return;
  const pend = S.adm.sales.filter(s => !s.void && !s.paid), claimed = pend.filter(s => s.claimedAt).length;
  $("payCount").hidden = !pend.length; $("payCount").textContent = pend.length;
  const fSel = $("payF"), prev = fSel.value || "all";
  const fHtml = `<option value="all">All collectors</option>` + S.adm.config.collectors.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  if (fSel.dataset.h !== fHtml){ fSel.innerHTML = fHtml; fSel.dataset.h = fHtml; fSel.value = [...fSel.options].some(o => o.value === prev) ? prev : "all"; }
  if (S.sub !== "payments") return;
  const rows = pend.filter(s => (fSel.value === "all" || s.collectorId === fSel.value) && (!$("payClaimed").checked || s.claimedAt))
    .sort((a, b) => (!!b.claimedAt - !!a.claimedAt) || (a.at || "").localeCompare(b.at || ""));
  $("payBody").innerHTML = rows.length ? rows.map(s => `<tr>
    <td class="mono">${esc(ranges(s.nums))}</td>
    <td>${esc(s.buyer)}${s.dept ? `<span style="color:var(--ink-3)"> · ${esc(s.dept)}</span>` : ""}${s.phone ? `<br><span class="mono" style="font-size:.8rem;color:var(--ink-3)">${esc(s.phone)}</span>` : ""}</td>
    <td class="num">${esc(money(saleAmount(s)))}</td>
    <td>${esc(colName(s.collectorId) || "—")}<br><span style="color:var(--ink-3);font-size:.82rem">${esc(s.method || "")}</span></td>
    <td>${s.claimedAt ? `<span class="chip gold">Says paid</span> <span class="mono">${esc(s.txn || "")}</span>` : '<span style="color:var(--ink-3)">—</span>'}</td>
    <td>${srcChip(s)}</td>
    <td style="color:var(--ink-3)">${ago(s.at)}${s.expiresAt && !s.claimedAt ? `<br><span style="font-size:.8rem">lapses ${esc(fmtDate(s.expiresAt))}</span>` : ""}</td>
    <td class="acts"><button class="btn sm primary" data-pay="${s.id}">Confirm paid</button><button class="btn sm ghost danger" data-rej="${s.id}">Reject</button></td></tr>`).join("")
    : `<tr><td colspan="8" class="empty" style="text-align:center">${pend.length ? "Nothing matches this filter." : "All caught up. No payments waiting."}</td></tr>`;
}
$("payF").onchange = renderPayments; $("payClaimed").onchange = renderPayments;
$("payBody").onclick = e => {
  const p = e.target.closest("[data-pay]"), r = e.target.closest("[data-rej]");
  if (p){ const s = S.adm.sales.find(x => x.id === p.dataset.pay); p.disabled = true; act("saleUpdate", {id:p.dataset.pay, paid:true}, `Confirmed ${s ? ranges(s.nums) : ""}`); }
  if (r) armed(r, () => act("saleUpdate", {id:r.dataset.rej, void:true}, "Reservation rejected and released"));
};

/* ---------------- collectors editor (finance) ---------------- */
let colDirty = false;
function renderCollectors(force){
  if (!S.adm || !isFin()) return;
  const host = $("colRows"); if (!force && (colDirty || host.contains(document.activeElement))) return;
  host.innerHTML = S.adm.config.collectors.map(colRow).join("");
}
const colRow = c => `<div class="col-row" data-id="${esc(c.id || "")}">
  <label class="f">Name<input type="text" data-k="name" id="cn-${esc(c.id || Math.random().toString(36).slice(2))}" value="${esc(c.name || "")}" maxlength="50" placeholder="e.g. Sunita, HR desk"></label>
  <label class="f">Type<select data-k="kind"><option value="finance" ${c.kind === "finance" ? "selected" : ""}>Finance</option><option value="designated" ${c.kind !== "finance" ? "selected" : ""}>Designated person</option></select></label>
  <div class="meth">${METHODS.map(m => `<label class="check"><input type="checkbox" data-m="${esc(m)}" ${(c.methods || []).includes(m) ? "checked" : ""}> ${esc(m)}</label>`).join("")}</div>
  <label class="f">How to reach them<input type="text" data-k="contact" value="${esc(c.contact || "")}" maxlength="80" placeholder="e.g. @sunita on Slack, or #dashain-raffle"></label>
  <label class="f">Chat link (optional)<input type="text" data-k="contactUrl" value="${esc(c.contactUrl || "")}" maxlength="300" placeholder="https://… Slack, Teams, mailto:"></label>
  <label class="f" style="grid-column:1/-1">Note for buyers (optional)<input type="text" data-k="note" value="${esc(c.note || "")}" maxlength="160" placeholder="e.g. Desk 4, 2nd floor. Scan the QR in eSewa."></label>
  <div class="qr">${c.qrUrl ? `<img src="${esc(c.qrUrl)}" alt="QR for ${esc(c.name)}">` : `<span class="none">No QR yet</span>`}
    ${c.id ? `<label class="btn sm">Upload QR<input type="file" accept="image/png,image/jpeg,image/webp" data-qr="${esc(c.id)}" hidden></label>${c.qrUrl ? `<button type="button" class="btn sm ghost" data-qrrm="${esc(c.id)}">Remove QR</button>` : ""}` : `<span class="hint">Save collectors first, then upload the QR.</span>`}
    <button type="button" class="btn sm ghost danger" data-colrm style="margin-left:auto">Remove collector</button></div>
</div>`;
const readCollectors = () => [...$("colRows").querySelectorAll(".col-row")].map(r => ({id:r.dataset.id || undefined, name:r.querySelector('[data-k=name]').value,
  kind:r.querySelector('[data-k=kind]').value, note:r.querySelector('[data-k=note]').value,
  contact:r.querySelector('[data-k=contact]').value, contactUrl:r.querySelector('[data-k=contactUrl]').value, methods:[...r.querySelectorAll("[data-m]:checked")].map(i => i.dataset.m)}));
$("colRows").oninput = () => { colDirty = true; };
$("colRows").onclick = e => { const rm = e.target.closest("[data-colrm]"); if (rm){ rm.closest(".col-row").remove(); colDirty = true; }
  const q = e.target.closest("[data-qrrm]"); if (q) act("collectorQr", {id:q.dataset.qrrm, remove:true}, "QR removed").then(() => renderCollectors(true)); };
$("colRows").onchange = e => {
  const f = e.target.closest("[data-qr]"); if (!f || !f.files[0]) return;
  const file = f.files[0]; if (file.size > 2 * 1024 * 1024) return toast("That image is over 2 MB. Use a smaller screenshot.");
  const rd = new FileReader(); rd.onload = () => act("collectorQr", {id:f.dataset.qr, dataUrl:rd.result}, "QR uploaded").then(() => renderCollectors(true)); rd.readAsDataURL(file);
};
$("addCol").onclick = () => { $("colRows").insertAdjacentHTML("beforeend", colRow({kind:"designated", methods:["Cash"]})); colDirty = true; };
$("saveCols").onclick = async () => { const j = await act("collectors", {collectors:readCollectors()}, "Collectors saved"); if (j){ colDirty = false; renderCollectors(true); } };

/* ---------------- data ---------------- */
function setLive(ok, txt){ $("liveDot").classList.toggle("off", !ok); $("liveTxt").textContent = txt; }
function renderAll(){ renderWindow(); if (S.tab === "buy") renderBuy(); renderBoard(); renderTicker(); renderStageCtl(); renderStage(); renderPrizeBoard(); renderManage(); tick(); }
let loading = null, again = false;
async function load(){
  if (loading){ again = true; return loading; }
  loading = (async () => {
    try {
      const prevIds = new Set(S.pub.sales.map(s => s.id)), had = S.pub !== EMPTY;
      const r = await fetch("/api/state", {cache:"no-store"}); if (!r.ok) throw 0;
      S.pub = await r.json();
      if (S.admin){ try { S.adm = (await api("/api/admin/state")); } catch {} }
      setLive(true, "Live");
      const fresh = had ? S.pub.sales.filter(s => !prevIds.has(s.id)) : [];
      renderAll(); fetchReceipt();
      if (fresh.length && S.tab !== "manage" && S.tab !== "buy"){ queuePops(fresh); if (S.tab === "board") burst(innerWidth / 2, 160, 36); }
    } catch { setLive(false, "Reconnecting…"); }
  })();
  await loading; loading = null;
  if (again){ again = false; return load(); }
}
function connect(){
  const es = new EventSource("/api/events");
  let t = 0; es.addEventListener("changed", () => { clearTimeout(t); t = setTimeout(load, 80); });
  es.onerror = () => setLive(false, "Reconnecting…");
  es.onopen = () => setLive(true, "Live");
}
async function boot(){
  const h = (location.hash || "").replace("#", "");
  if (S.receiptToken) setTab("buy"); else if (["buy","draw","manage"].includes(h)) setTab(h);
  try { const me = await (await fetch("/api/me", {cache:"no-store"})).json(); S.admin = !!me.admin; S.me = me.name; S.role = me.role; } catch {}
  renderAuth(); await load(); connect();
  setInterval(() => { if (S.tab === "board") renderBoard(); refreshTickerTimes(); }, 30000);
}
renderAll(); boot();
})();
