// Dashain Raffle — zero-dependency Node server.
// JSON file store, SSE live updates, cookie-session admin, server-side draws.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_PASSWORD = process.env.RAFFLE_ADMIN_PASSWORD || "";   // organisers: sell, books, prizes, draw
const FINANCE_PASSWORD = process.env.RAFFLE_FINANCE_PASSWORD || ""; // finance: everything organisers do + payments, pricing, collections
const SESSION_SECRET = process.env.RAFFLE_SESSION_SECRET || "";
const ROLL_MS = +process.env.RAFFLE_ROLL_MS || 4000;
const SESSION_HOURS = 12;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || !FINANCE_PASSWORD || FINANCE_PASSWORD.length < 12 || FINANCE_PASSWORD === ADMIN_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("RAFFLE_ADMIN_PASSWORD and RAFFLE_FINANCE_PASSWORD (>=12 chars, different) and RAFFLE_SESSION_SECRET (>=32 chars) must be set");
  process.exit(1);
}

/* ---------------- store ---------------- */
const DB_FILE = path.join(DATA_DIR, "raffle.json");
const SNAP_DIR = path.join(DATA_DIR, "snapshots");
fs.mkdirSync(SNAP_DIR, { recursive: true });

const DEFAULT = () => ({
  version: 0,
  config: { title: "Dashain Raffle", lede: "Buy a ticket, fly a kite, win something. Every paid ticket gets an equal chance at every prize.",
    price: 200, bundles: [{ qty: 1, price: 200 }, { qty: 3, price: 500 }, { qty: 7, price: 1000 }], currency: "Rs", drawAt: null, prefix: "DSH", cap: 0, perPerson: 0, publicUrl: "raffle.akshyatsharma.com.np" },
  counter: 1, prizes: [], sales: [], batches: [], draws: [], stage: { state: "idle", at: null }, audit: [],
});

let db;
try { db = { ...DEFAULT(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; }
catch (e) { if (e.code !== "ENOENT") { console.error("cannot read", DB_FILE, e.message); process.exit(1); } db = DEFAULT(); }

// pricing: bundles[] is the price list; `price` mirrors the 1-ticket tier. Older sales keep what they were charged.
if (!Array.isArray(db.config.bundles) || !db.config.bundles.length) db.config.bundles = [{ qty: 1, price: +db.config.price || 0 }];
for (const s of db.sales) if (s.amount == null) s.amount = s.nums.length * (s.price ?? db.config.price ?? 0);
if (db.stage.state === "rolling") db.stage = { state: "idle", at: new Date().toISOString() }; // a restart mid-roll never picked a winner
if (!db.version && !db.prizes.length) db.prizes = [ // sample prizes on a fresh install, flagged until edited
  ["55-inch 4K smart TV", 1, 85000], ["Weekend for two in Pokhara", 1, 40000], ["Smartwatch", 1, 25000],
  ["Extra day of annual leave", 2, null], ["Dinner voucher for two", 3, 5000], ["Dashain sweets & dry-fruit hamper", 5, 3000],
].map(([name, qty, value], i) => ({ id: "p" + (i + 1), name, qty, value, sponsor: "", order: i + 1, sample: true }));

let lastSnapHour = "";
function save() {
  db.version++;
  const body = JSON.stringify(db);
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, DB_FILE);
  const hour = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, "");
  if (hour !== lastSnapHour) { // hourly rolling snapshot, keep 72
    lastSnapHour = hour;
    fs.writeFileSync(path.join(SNAP_DIR, `raffle-${hour}.json`), body);
    const snaps = fs.readdirSync(SNAP_DIR).filter(f => f.startsWith("raffle-")).sort();
    for (const f of snaps.slice(0, Math.max(0, snaps.length - 72))) fs.unlinkSync(path.join(SNAP_DIR, f));
  }
  broadcast();
}
function audit(who, what) { db.audit.push({ at: new Date().toISOString(), who, what }); if (db.audit.length > 1000) db.audit.splice(0, db.audit.length - 1000); }
const uid = p => p + "-" + crypto.randomBytes(5).toString("hex");

/* ---------------- domain ---------------- */
const liveSales = () => db.sales.filter(s => !s.void);
const soldSet = () => new Set(liveSales().flatMap(s => s.nums));
const soldCount = () => liveSales().reduce((a, s) => a + s.nums.length, 0);
function eligible() {
  const won = new Set(db.draws.map(d => d.ticket)); const out = [];
  for (const s of liveSales()) if (s.paid) for (const n of s.nums) if (!won.has(n)) out.push({ n, s });
  return out;
}
const batchFor = n => db.batches.find(b => n >= b.from && n <= b.to);
const saleFor = n => db.sales.find(s => !s.void && s.nums.includes(n));
function publicName(s) {
  if (s.anon) return `Someone from ${s.dept || "the team"}`;
  const parts = String(s.buyer).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}
// Cheapest exact combination of bundles for n tickets (unbounded knapsack). Returns {amount, parts:[{qty,price,times}]} or null.
function priceFor(n, bundles = db.config.bundles) {
  const best = [{ amount: 0, pick: null }];
  for (let i = 1; i <= n; i++) {
    best[i] = null;
    for (const b of bundles) if (b.qty <= i && best[i - b.qty]) {
      const a = best[i - b.qty].amount + b.price;
      if (!best[i] || a < best[i].amount) best[i] = { amount: a, pick: b };
    }
  }
  if (!best[n]) return null;
  const counts = new Map(); for (let i = n; i > 0; i -= best[i].pick.qty) counts.set(best[i].pick, (counts.get(best[i].pick) || 0) + 1);
  return { amount: best[n].amount, parts: [...counts].sort((x, y) => y[0].qty - x[0].qty).map(([b, times]) => ({ qty: b.qty, price: b.price, times })) };
}
function charge(n) { const p = priceFor(n); if (!p) throw bad("That number of tickets can't be made from the bundles on sale"); return p; }
function allocate(count) { const from = db.counter; db.counter += count; return Array.from({ length: count }, (_, i) => from + i); }
function parseNums(spec) {
  const out = new Set();
  for (const part of String(spec || "").split(/[\s,]+/).filter(Boolean)) {
    const m = part.match(/^(?:[A-Za-z]+-)?(\d+)(?:-(?:[A-Za-z]+-)?(\d+))?$/);
    if (!m) throw bad(`"${part}" isn't a ticket number or range`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (b < a || b - a > 500) throw bad(`"${part}" isn't a valid range`);
    for (let n = a; n <= b; n++) out.add(n);
  }
  if (!out.size) throw bad("Enter at least one ticket number");
  return [...out].sort((x, y) => x - y);
}
function checkLimits(buyer, count) {
  const c = db.config;
  if (c.cap > 0 && soldCount() + count > c.cap) throw bad(`Only ${Math.max(0, c.cap - soldCount())} tickets left under the limit`);
  if (c.perPerson > 0) {
    const have = liveSales().filter(s => s.buyer.toLowerCase() === buyer.toLowerCase()).reduce((a, s) => a + s.nums.length, 0);
    if (have + count > c.perPerson) throw bad(`${buyer} already has ${have}; the limit is ${c.perPerson} per person`);
  }
}

function publicState() {
  return {
    version: db.version, config: db.config, prizes: db.prizes,
    sales: liveSales().map(s => ({ id: s.id, name: publicName(s), dept: s.anon ? "" : s.dept, nums: s.nums, paid: s.paid, at: s.at })),
    draws: db.draws.map(d => { const s = saleFor(d.ticket); return { id: d.id, prizeId: d.prizeId, prizeName: d.prizeName, ticket: d.ticket, name: s ? publicName(s) : "—", dept: s && !s.anon ? s.dept : "", at: d.at }; }),
    stage: stagePublic(), inDraw: eligible().length,
  };
}
function stagePublic() {
  const st = db.stage; if (st.state !== "revealed") return st;
  const s = saleFor(st.ticket); return { ...st, name: s ? publicName(s) : "", dept: s && !s.anon ? s.dept : "" };
}
function adminState() { return { ...db, stage: stagePublic(), inDraw: eligible().length, audit: db.audit.slice(-200) }; }

/* ---------------- sessions ---------------- */
const sign = v => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
function makeSession(name, role) {
  const payload = Buffer.from(JSON.stringify({ n: name, r: role, e: Date.now() + SESSION_HOURS * 3600e3 })).toString("base64url");
  return payload + "." + sign(payload);
}
function readSession(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)rs=([^;]+)/); if (!m) return null;
  const [p, sig] = m[1].split("."); if (!p || !sig) return null;
  const good = sign(p); if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.e > Date.now() ? { name: o.n, role: o.r === "finance" ? "finance" : "organiser", finance: o.r === "finance" } : null; } catch { return null; }
}
const attempts = new Map();
function clientIp(req) { return req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress; }
const hashEq = (x, y) => crypto.timingSafeEqual(crypto.createHash("sha256").update(String(x)).digest(), crypto.createHash("sha256").update(String(y)).digest());
function roleFor(pw) { const f = hashEq(pw, FINANCE_PASSWORD), o = hashEq(pw, ADMIN_PASSWORD); return f ? "finance" : o ? "organiser" : null; }
const financeOnly = (who, what) => { if (!who.finance) throw bad(`Only finance can ${what}`, 403); };

/* ---------------- SSE ---------------- */
const clients = new Set();
let bTimer = null;
function broadcast() {
  clearTimeout(bTimer);
  bTimer = setTimeout(() => { for (const c of clients) c.write(`event: changed\ndata: ${db.version}\n\n`); }, 60);
}
setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 25000);

/* ---------------- http helpers ---------------- */
function bad(msg, code = 400) { const e = new Error(msg); e.status = code; return e; }
function send(res, status, obj, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > 64 * 1024) { reject(bad("Request too large", 413)); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(bad("Invalid JSON")); } });
    req.on("error", reject);
  });
}
const str = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const int = (v, min, max) => { const n = Math.floor(Number(v)); if (!Number.isFinite(n)) return min; return Math.min(max, Math.max(min, n)); };

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: "Not found" });
  fs.readFile(file, (err, buf) => {
    if (err) { // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, idx) => {
        if (e2) return send(res, 404, { error: "Not found" });
        res.writeHead(200, { "content-type": TYPES[".html"], "content-security-policy": CSP, "cache-control": "no-cache" }); res.end(idx);
      });
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "content-security-policy": CSP, "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
    res.end(buf);
  });
}

/* ---------------- admin actions ---------------- */
const actions = {
  sale(b, who) {
    const buyer = str(b.buyer, 80); if (!buyer) throw bad("Enter the buyer's name");
    const count = int(b.count, 1, 100); checkLimits(buyer, count); const pr = charge(count);
    if (!who.finance) b.paid = false; // organisers record sales; finance confirms the money
    const sale = { id: uid("s"), buyer, dept: str(b.dept, 40), nums: allocate(count), amount: pr.amount, pricing: pr.parts, method: str(b.method, 30),
      paid: !!b.paid, anon: !!b.anon, void: false, at: new Date().toISOString(), soldBy: who.name, source: "digital" };
    db.sales.push(sale); audit(who.name, `sold ${count} to ${buyer}`); return { sale };
  },
  bookSale(b, who) {
    const buyer = str(b.buyer, 80); if (!buyer) throw bad("Enter the buyer's name");
    const nums = parseNums(b.nums), taken = soldSet();
    for (const n of nums) {
      if (!batchFor(n)) throw bad(`Ticket ${n} isn't in any printed ticket book`);
      if (taken.has(n)) throw bad(`Ticket ${n} has already been sold`);
    }
    checkLimits(buyer, nums.length); const pr = charge(nums.length);
    if (!who.finance) b.paid = false;
    const sale = { id: uid("s"), buyer, dept: str(b.dept, 40), nums, amount: pr.amount, pricing: pr.parts, method: str(b.method, 30),
      paid: !!b.paid, anon: !!b.anon, void: false, at: new Date().toISOString(), soldBy: who.name, source: "book", batchId: batchFor(nums[0]).id };
    db.sales.push(sale); audit(who.name, `recorded paper tickets ${nums.join(",")} for ${buyer}`); return { sale };
  },
  saleUpdate(b, who) {
    const s = db.sales.find(x => x.id === b.id); if (!s) throw bad("Sale not found", 404);
    if ("paid" in b) financeOnly(who, "change payment status");
    if (b.void && s.paid) financeOnly(who, "void a paid sale");
    if ("paid" in b) { s.paid = !!b.paid; s.paidAt = s.paid ? new Date().toISOString() : null; audit(who.name, `${s.paid ? "paid" : "unpaid"} ${s.id}`); }
    if (b.void) {
      if (db.draws.some(d => s.nums.includes(d.ticket))) throw bad("One of these tickets has already won. Remove that result first.");
      s.void = true; s.voidAt = new Date().toISOString(); audit(who.name, `voided ${s.id}`);
    }
    return { sale: s };
  },
  batch(b, who) {
    const count = int(b.count, 1, 1000);
    const c = db.config; if (c.cap > 0 && db.counter - 1 + count > c.cap) throw bad(`That would number past the ${c.cap}-ticket limit`);
    const nums = allocate(count);
    const batch = { id: uid("b"), label: str(b.label, 40) || `Book ${db.batches.length + 1}`, holder: str(b.holder, 60), from: nums[0], to: nums[nums.length - 1], at: new Date().toISOString(), by: who.name };
    db.batches.push(batch); audit(who.name, `printed book ${batch.label} ${batch.from}-${batch.to}`); return { batch };
  },
  batchDelete(b, who) {
    const bt = db.batches.find(x => x.id === b.id); if (!bt) throw bad("Book not found", 404);
    if (liveSales().some(s => s.nums.some(n => n >= bt.from && n <= bt.to))) throw bad("Tickets from this book are already sold. Void those sales first.");
    db.batches = db.batches.filter(x => x !== bt); audit(who.name, `deleted book ${bt.label}`); return {};
  },
  prizeUpsert(b, who) {
    const d = { name: str(b.name, 80), qty: int(b.qty, 1, 100), value: b.value === null || b.value === "" ? null : int(b.value, 0, 1e9), sponsor: str(b.sponsor, 40), order: int(b.order, 1, 999) };
    if (!d.name) throw bad("Give the prize a name");
    let p = db.prizes.find(x => x.id === b.id);
    if (p) { const drawn = db.draws.filter(x => x.prizeId === p.id).length; if (d.qty < drawn) throw bad(`${drawn} already drawn; quantity can't go lower`); Object.assign(p, d, { sample: false }); }
    else { p = { id: uid("p"), ...d, sample: false }; db.prizes.push(p); }
    audit(who.name, `saved prize ${p.name}`); return { prize: p };
  },
  prizeDelete(b, who) {
    if (db.draws.some(d => d.prizeId === b.id)) throw bad("This prize has been drawn. Remove its results first.");
    db.prizes = db.prizes.filter(p => p.id !== b.id); audit(who.name, `deleted prize ${b.id}`); return {};
  },
  config(b, who) {
    const c = db.config;
    if (b.bundles !== undefined && JSON.stringify(b.bundles) !== JSON.stringify(c.bundles)) financeOnly(who, "change ticket prices");
    const seen = new Set(), bundles = (Array.isArray(b.bundles) ? b.bundles : []).slice(0, 8)
      .map(x => ({ qty: int(x.qty, 1, 100), price: int(x.price, 0, 1e7) })).filter(x => !seen.has(x.qty) && seen.add(x.qty)).sort((x, y) => x.qty - y.qty);
    if (b.bundles === undefined) bundles.push(...c.bundles);
    if (!bundles.length || bundles[0].qty !== 1) throw bad("Set a price for a single ticket so any number of tickets can be sold");
    Object.assign(c, {
      title: str(b.title, 60) || "Dashain Raffle", lede: str(b.lede, 160), bundles, price: bundles[0].price, currency: str(b.currency, 6),
      prefix: (str(b.prefix, 5).toUpperCase().replace(/[^A-Z0-9]/g, "") || "T"), cap: int(b.cap, 0, 100000), perPerson: int(b.perPerson, 0, 10000),
      drawAt: b.drawAt && !isNaN(Date.parse(b.drawAt)) ? new Date(b.drawAt).toISOString() : null, publicUrl: str(b.publicUrl, 80) || c.publicUrl,
    });
    audit(who.name, "updated settings"); return { config: c };
  },
  draw(b, who) {
    if (db.stage.state === "rolling") throw bad("A draw is already in progress", 409);
    const prize = db.prizes.find(p => p.id === b.prizeId); if (!prize) throw bad("Pick a prize");
    if (db.draws.filter(d => d.prizeId === prize.id).length >= prize.qty) throw bad("That prize has been fully drawn");
    if (!eligible().length) throw bad("No paid tickets left in the draw");
    db.stage = { state: "rolling", prizeId: prize.id, prizeName: prize.name, at: new Date().toISOString(), ticket: null };
    setTimeout(() => {
      const pool = eligible();
      if (!pool.length) { db.stage = { state: "idle", at: new Date().toISOString() }; return save(); }
      const pick = pool[crypto.randomInt(pool.length)];
      const d = { id: uid("d"), prizeId: prize.id, prizeName: prize.name, ticket: pick.n, saleId: pick.s.id, at: new Date().toISOString(), by: who.name, poolSize: pool.length };
      db.draws.push(d);
      db.stage = { state: "revealed", prizeId: prize.id, prizeName: prize.name, ticket: pick.n, drawId: d.id, at: d.at };
      audit(who.name, `drew ${pick.n} for ${prize.name} from ${pool.length} tickets`); save();
    }, ROLL_MS);
    audit(who.name, `started draw for ${prize.name}`); return {};
  },
  drawRemove(b, who) {
    const d = db.draws.find(x => x.id === b.id); if (!d) throw bad("Result not found", 404);
    db.draws = db.draws.filter(x => x !== d); if (db.stage.drawId === d.id) db.stage = { state: "idle", at: new Date().toISOString() };
    audit(who.name, `removed result ${d.ticket} for ${d.prizeName}`); return {};
  },
  stageReset(b, who) { if (db.stage.state === "rolling") throw bad("Wait for the current draw to finish", 409); db.stage = { state: "idle", at: new Date().toISOString() }; return {}; },
};

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, version: db.version });
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res);

    const session = readSession(req);
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, publicState());
    if (req.method === "GET" && url.pathname === "/api/me") return send(res, 200, { admin: !!session, name: session?.name || null, role: session?.role || null });
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`retry: 3000\nevent: changed\ndata: ${db.version}\n\n`);
      clients.add(res); req.on("close", () => clients.delete(res)); return;
    }

    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    // CSRF: the session cookie is SameSite=Strict and every write must carry this header (not settable cross-site without CORS).
    if (req.headers["x-raffle"] !== "1") return send(res, 403, { error: "Forbidden" });

    if (url.pathname === "/api/login") {
      const ip = clientIp(req), now = Date.now(), a = attempts.get(ip) || { n: 0, reset: now + 15 * 60e3 };
      if (now > a.reset) { a.n = 0; a.reset = now + 15 * 60e3; }
      if (a.n >= 8) return send(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
      const b = await body(req);
      const role = roleFor(b.password || "");
      if (!role) { a.n++; attempts.set(ip, a); return send(res, 401, { error: "Wrong password" }); }
      attempts.delete(ip);
      const name = str(b.name, 40) || "Organiser";
      audit(name, `signed in (${role})`); save();
      return send(res, 200, { admin: true, name, role }, { "set-cookie": `rs=${makeSession(name, role)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}` });
    }
    if (url.pathname === "/api/logout") return send(res, 200, { admin: false }, { "set-cookie": "rs=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

    if (!session) return send(res, 401, { error: "Sign in to manage the raffle" });
    if (url.pathname === "/api/admin/state") return send(res, 200, adminState());
    const name = url.pathname.replace("/api/admin/", "");
    const fn = Object.hasOwn(actions, name) ? actions[name] : null;
    if (!fn) return send(res, 404, { error: "Not found" });
    const result = fn(await body(req), session);
    save();
    return send(res, 200, { ok: true, ...result });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong on the server" });
  }
});
server.listen(PORT, () => console.log(`raffle listening on :${PORT}, ${db.sales.length} sales, v${db.version}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); process.exit(0); });
