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
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(SNAP_DIR, { recursive: true }); fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const METHODS = ["Cash", "eSewa", "Khalti", "Bank transfer", "Salary deduction", "Other"];

const DEFAULT = () => ({
  version: 0,
  config: { title: "Dashain Raffle", lede: "Buy a ticket, fly a kite, win something. Every paid ticket gets an equal chance at every prize.",
    headerTag: "Company-wide · 2026", departments: [], logo: null,
    price: 200, bundles: [{ qty: 1, price: 200 }, { qty: 3, price: 500 }, { qty: 7, price: 1000 }], currency: "Rs", drawAt: null, prefix: "DSH", cap: 0, perPerson: 0, publicUrl: "raffle.akshyatsharma.com.np" },
  counter: 1, prizes: [], sales: [], batches: [], draws: [], stage: { state: "idle", at: null }, audit: [],
});

let db;
try { db = { ...DEFAULT(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; }
catch (e) { if (e.code !== "ENOENT") { console.error("cannot read", DB_FILE, e.message); process.exit(1); } db = DEFAULT(); }

// sales window, self-issue and payment collectors (added after launch; fill in on older data files)
db.config.salesCloseAt ??= null;
db.config.headerTag ??= "Company-wide · 2026";
db.config.departments ??= [];
db.config.logo ??= null;
db.config.selfIssue = { enabled: false, code: "", holdHours: 48, maxPer: 21, ...(db.config.selfIssue || {}) };
// company code: prices and payment collectors are hidden from the public board until a visitor enters it (empty = no gate)
db.config.companyCode ??= "ODIN2082";
const migratedCode = !!db.config.selfIssue.code;
if (migratedCode) { db.config.companyCode = db.config.selfIssue.code; delete db.config.selfIssue.code; }
db.config.collectors ??= [{ id: "c-finance", name: "Finance team", kind: "finance", methods: ["Cash", "eSewa", "Khalti", "Bank transfer"], note: "", qr: null }];
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
if (migratedCode) save(); // persist the one-code migration so the on-disk file matches memory
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
const salesOpen = () => !db.config.salesCloseAt || Date.now() < Date.parse(db.config.salesCloseAt);
function assertOpen() { if (!salesOpen()) throw bad("Ticket sales have closed"); }
function pickCollector(b) {
  const cs = db.config.collectors || []; if (!b.collectorId && !cs.length) return {};
  const c = cs.find(x => x.id === b.collectorId); if (!c) throw bad("Choose who the payment goes to");
  const method = str(b.method, 30); if (!c.methods.includes(method)) throw bad(`${c.name} doesn't take ${method || "that payment method"}`);
  return { collectorId: c.id, method };
}
const collectorPublic = c => ({ id: c.id, name: c.name, kind: c.kind, methods: c.methods, note: c.note, contact: c.contact || "", contactUrl: c.contactUrl || "", qr: c.qr ? "/uploads/" + c.qr : null });
// links buyers can follow to message a collector: web links, email, and the Slack / Teams app schemes only
const safeLink = v => { const u = str(v, 300); return /^(https:\/\/|mailto:|slack:\/\/|msteams:\/\/)/i.test(u) ? u : ""; };
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

const codeSig = code => crypto.createHmac("sha256", SESSION_SECRET).update("cc:" + String(code || "").trim().toLowerCase()).digest("base64url");
const gateOn = () => !!(db.config.companyCode || "").trim();
// a visitor is unlocked when their `rc` cookie is the signature of the CURRENT code (changing the code re-locks everyone) or they are signed in
function unlocked(req) {
  if (!gateOn()) return true;
  if (readSession(req)) return true;
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)rc=([^;]+)/); if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(codeSig(db.config.companyCode));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function publicState(req, force = false) {
  const open = force || unlocked(req), { companyCode, logo, ...cfg } = db.config;
  const config = { ...cfg, logoUrl: logo ? "/uploads/" + logo : null, selfIssue: { enabled: !!db.config.selfIssue.enabled, holdHours: db.config.selfIssue.holdHours, maxPer: db.config.selfIssue.maxPer }, collectors: db.config.collectors.map(collectorPublic) };
  if (!open) { delete config.bundles; delete config.price; config.collectors = []; }
  return {
    version: db.version, prizes: prizesPublic(), salesOpen: salesOpen(), locked: !open, gated: gateOn(),
    config,
    sales: liveSales().map(s => ({ id: s.id, name: publicName(s), dept: s.anon ? "" : s.dept, nums: s.nums, paid: s.paid, at: s.at })),
    draws: db.draws.map(d => { const s = saleFor(d.ticket); return { id: d.id, prizeId: d.prizeId, prizeName: d.prizeName, ticket: d.ticket, name: s ? publicName(s) : "—", dept: s && !s.anon ? s.dept : "", at: d.at }; }),
    stage: stagePublic(), inDraw: eligible().length,
  };
}
function stagePublic() {
  const st = db.stage; if (st.state !== "revealed") return st;
  const s = saleFor(st.ticket); return { ...st, name: s ? publicName(s) : "", dept: s && !s.anon ? s.dept : "" };
}
const prizesPublic = () => db.prizes.map(p => ({ ...p, imageUrl: p.image ? "/uploads/" + p.image : null }));
function adminState() { return { ...db, prizes: prizesPublic(), config: { ...db.config, logoUrl: db.config.logo ? "/uploads/" + db.config.logo : null, collectors: db.config.collectors.map(c => ({ ...c, qrUrl: c.qr ? "/uploads/" + c.qr : null })) }, salesOpen: salesOpen(), stage: stagePublic(), inDraw: eligible().length, audit: db.audit.slice(-200) }; }

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
function body(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > limit) { reject(bad("Request too large", 413)); req.destroy(); } else chunks.push(c); });
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
    assertOpen();
    const count = int(b.count, 1, 100); checkLimits(buyer, count); const pr = charge(count), pay = pickCollector(b);
    if (!who.finance) b.paid = false; // organisers record sales; finance confirms the money
    const sale = { id: uid("s"), buyer, dept: str(b.dept, 40), nums: allocate(count), amount: pr.amount, pricing: pr.parts, method: str(b.method, 30), ...pay,
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
    assertOpen();
    checkLimits(buyer, nums.length); const pr = charge(nums.length), pay = pickCollector(b);
    if (!who.finance) b.paid = false;
    const sale = { id: uid("s"), buyer, dept: str(b.dept, 40), nums, amount: pr.amount, pricing: pr.parts, method: str(b.method, 30), ...pay,
      paid: !!b.paid, anon: !!b.anon, void: false, at: new Date().toISOString(), soldBy: who.name, source: "book", batchId: batchFor(nums[0]).id };
    db.sales.push(sale); audit(who.name, `recorded paper tickets ${nums.join(",")} for ${buyer}`); return { sale };
  },
  saleUpdate(b, who) {
    const s = db.sales.find(x => x.id === b.id); if (!s) throw bad("Sale not found", 404);
    if ("paid" in b) financeOnly(who, "change payment status");
    if (b.void && s.paid) financeOnly(who, "void a paid sale");
    if ("paid" in b) { s.paid = !!b.paid; s.paidAt = s.paid ? new Date().toISOString() : null; s.confirmedBy = s.paid ? who.name : null; audit(who.name, `${s.paid ? "paid" : "unpaid"} ${s.id}`); }
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
    const p = db.prizes.find(x => x.id === b.id); if (p?.image) fs.rm(path.join(UPLOAD_DIR, p.image), () => {});
    db.prizes = db.prizes.filter(p => p.id !== b.id); audit(who.name, `deleted prize ${b.id}`); return {};
  },
  prizeImage(b, who) {
    const p = db.prizes.find(x => x.id === b.id); if (!p) throw bad("Save the prize first, then upload an image");
    if (b.remove) { if (p.image) fs.rm(path.join(UPLOAD_DIR, p.image), () => {}); p.image = null; audit(who.name, `removed image for ${p.name}`); return {}; }
    const m = String(b.dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/); if (!m) throw bad("Upload a PNG, JPG or WebP image");
    const buf = Buffer.from(m[2], "base64"); if (buf.length > 2 * 1024 * 1024) throw bad("That image is over 2 MB. Use a smaller photo.");
    const sig = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
    if (!sig.every((v, i) => buf[i] === v)) throw bad("That file isn't a valid image");
    const file = `prize-${p.id}-${crypto.randomBytes(4).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    if (p.image) fs.rm(path.join(UPLOAD_DIR, p.image), () => {});
    p.image = file; audit(who.name, `uploaded image for ${p.name}`); return { image: "/uploads/" + file };
  },
  config(b, who) {
    const c = db.config;
    if (b.bundles !== undefined && JSON.stringify(b.bundles) !== JSON.stringify(c.bundles)) financeOnly(who, "change ticket prices");
    const seen = new Set(), bundles = (Array.isArray(b.bundles) ? b.bundles : []).slice(0, 8)
      .map(x => ({ qty: int(x.qty, 1, 100), price: int(x.price, 0, 1e7) })).filter(x => !seen.has(x.qty) && seen.add(x.qty)).sort((x, y) => x.qty - y.qty);
    if (b.bundles === undefined) bundles.push(...c.bundles);
    if (!bundles.length || bundles[0].qty !== 1) throw bad("Set a price for a single ticket so any number of tickets can be sold");
    const departments = Array.isArray(b.departments)
      ? [...new Set(b.departments.map(d => str(d, 40)).filter(Boolean))].slice(0, 40)
      : c.departments;
    Object.assign(c, {
      title: str(b.title, 60) || "Dashain Raffle", lede: str(b.lede, 160),
      headerTag: b.headerTag === undefined ? c.headerTag : str(b.headerTag, 60), departments,
      bundles, price: bundles[0].price, currency: str(b.currency, 6),
      prefix: (str(b.prefix, 5).toUpperCase().replace(/[^A-Z0-9]/g, "") || "T"), cap: int(b.cap, 0, 100000), perPerson: int(b.perPerson, 0, 10000),
      drawAt: b.drawAt && !isNaN(Date.parse(b.drawAt)) ? new Date(b.drawAt).toISOString() : null, publicUrl: str(b.publicUrl, 80) || c.publicUrl,
      salesCloseAt: b.salesCloseAt && !isNaN(Date.parse(b.salesCloseAt)) ? new Date(b.salesCloseAt).toISOString() : null,
    });
    if (b.companyCode !== undefined) {
      const code = str(b.companyCode, 40);
      if (code !== (c.companyCode || "")) financeOnly(who, "change the company code");
      if (code && code.length < 4) throw bad("The company code needs at least 4 characters, or leave it blank to show prices to everyone");
      c.companyCode = code;
    }
    if (b.selfIssue) {
      const si = b.selfIssue;
      if (si.enabled && !(c.companyCode || "").trim()) throw bad("Set a company code before opening self-service, so only staff can reserve tickets");
      c.selfIssue = { enabled: !!si.enabled, holdHours: int(si.holdHours, 1, 336), maxPer: int(si.maxPer, 1, 100) };
    }
    audit(who.name, "updated settings"); return { config: c };
  },
  collectors(b, who) {
    financeOnly(who, "manage payment collectors");
    const old = new Map((db.config.collectors || []).map(c => [c.id, c]));
    const list = (Array.isArray(b.collectors) ? b.collectors : []).slice(0, 12).map(x => {
      const id = /^c-[a-z0-9]{4,20}$/.test(x.id || "") ? x.id : uid("c");
      const methods = (Array.isArray(x.methods) ? x.methods : []).filter(m => METHODS.includes(m));
      const name = str(x.name, 50); if (!name) throw bad("Every collector needs a name");
      if (!methods.length) throw bad(`Pick at least one payment method for ${name}`);
      if (x.contactUrl && !safeLink(x.contactUrl)) throw bad(`The chat link for ${name} must start with https://, mailto:, slack:// or msteams://`);
      return { id, name, kind: x.kind === "finance" ? "finance" : "designated", methods, note: str(x.note, 160), contact: str(x.contact, 80), contactUrl: safeLink(x.contactUrl), qr: old.get(id)?.qr || null };
    });
    if (!list.length) throw bad("Keep at least one collector so buyers know who to pay");
    for (const [id, c] of old) if (!list.some(x => x.id === id) && c.qr) fs.rm(path.join(UPLOAD_DIR, c.qr), () => {});
    db.config.collectors = list; audit(who.name, `saved ${list.length} payment collectors`); return { collectors: list };
  },
  collectorQr(b, who) {
    financeOnly(who, "upload payment QR codes");
    const c = (db.config.collectors || []).find(x => x.id === b.id); if (!c) throw bad("Save the collector first, then upload the QR");
    if (b.remove) { if (c.qr) fs.rm(path.join(UPLOAD_DIR, c.qr), () => {}); c.qr = null; audit(who.name, `removed QR for ${c.name}`); return {}; }
    const m = String(b.dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/); if (!m) throw bad("Upload a PNG, JPG or WebP image");
    const buf = Buffer.from(m[2], "base64"); if (buf.length > 2 * 1024 * 1024) throw bad("That image is over 2 MB. Use a smaller screenshot.");
    const sig = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
    if (!sig.every((v, i) => buf[i] === v)) throw bad("That file isn't a valid image");
    const file = `qr-${c.id}-${crypto.randomBytes(4).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    if (c.qr) fs.rm(path.join(UPLOAD_DIR, c.qr), () => {});
    c.qr = file; audit(who.name, `uploaded QR for ${c.name}`); return { qr: "/uploads/" + file };
  },
  logoUpload(b, who) {
    const c = db.config;
    if (b.remove) { if (c.logo) fs.rm(path.join(UPLOAD_DIR, c.logo), () => {}); c.logo = null; audit(who.name, "removed company logo"); return {}; }
    const m = String(b.dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/); if (!m) throw bad("Upload a PNG, JPG or WebP image");
    const buf = Buffer.from(m[2], "base64"); if (buf.length > 2 * 1024 * 1024) throw bad("That image is over 2 MB. Use a smaller file.");
    const sig = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[1]];
    if (!sig.every((v, i) => buf[i] === v)) throw bad("That file isn't a valid image");
    const file = `logo-${crypto.randomBytes(4).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    if (c.logo) fs.rm(path.join(UPLOAD_DIR, c.logo), () => {});
    c.logo = file; audit(who.name, "uploaded company logo"); return { logo: "/uploads/" + file };
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
  // physical draw: an organiser pulls a ticket from the bowl and types its number; the server checks it can win
  drawManual(b, who) {
    if (db.stage.state === "rolling") throw bad("A random draw is in progress. Wait for it to finish.", 409);
    const prize = db.prizes.find(p => p.id === b.prizeId); if (!prize) throw bad("Pick a prize");
    if (db.draws.filter(d => d.prizeId === prize.id).length >= prize.qty) throw bad("That prize has been fully drawn");
    const m = String(b.ticket || "").toUpperCase().match(/(\d{1,6})\s*$/); if (!m) throw bad("Type the number printed on the ticket, like DSH-0042");
    const n = +m[1], s = db.sales.find(x => x.nums.includes(n) && !x.void);
    if (!s) throw bad(`Ticket ${n} was never sold (or was voided). Put it aside and draw again.`);
    if (!s.paid) throw bad(`Ticket ${n} belongs to ${s.buyer} but isn't paid, so it can't win. Draw again.`);
    const prev = db.draws.find(d => d.ticket === n); if (prev) throw bad(`Ticket ${n} already won ${prev.prizeName}. Draw again.`);
    const d = { id: uid("d"), prizeId: prize.id, prizeName: prize.name, ticket: n, saleId: s.id, at: new Date().toISOString(), by: who.name, mode: "physical", poolSize: eligible().length };
    db.draws.push(d);
    db.stage = { state: "revealed", prizeId: prize.id, prizeName: prize.name, ticket: n, drawId: d.id, at: d.at };
    audit(who.name, `physical draw: ticket ${n} for ${prize.name}`); return { draw: d };
  },
  drawRemove(b, who) {
    const d = db.draws.find(x => x.id === b.id); if (!d) throw bad("Result not found", 404);
    db.draws = db.draws.filter(x => x !== d); if (db.stage.drawId === d.id) db.stage = { state: "idle", at: new Date().toISOString() };
    audit(who.name, `removed result ${d.ticket} for ${d.prizeName}`); return {};
  },
  stageReset(b, who) { if (db.stage.state === "rolling") throw bad("Wait for the current draw to finish", 409); db.stage = { state: "idle", at: new Date().toISOString() }; return {}; },
};

/* ---------------- self-service (public, access-code gated) ---------------- */
const selfHits = new Map(), unlockHits = new Map();
function rateHit(map, req, max, msg) {
  const ip = clientIp(req), now = Date.now(), a = map.get(ip) || { n: 0, reset: now + 3600e3 };
  if (now > a.reset) { a.n = 0; a.reset = now + 3600e3; }
  if (a.n >= max) throw bad(msg, 429);
  a.n++; map.set(ip, a);
}
const selfRate = (req, max) => rateHit(selfHits, req, max, "Too many requests from this device. Try again in an hour or ask an organiser.");
// the whole office shares one outbound IP, so wrong company codes get their own generous bucket (failures only)
const unlockRate = req => rateHit(unlockHits, req, 60, "Too many wrong codes from this network. Try again in an hour or ask an organiser.");
const receiptOf = s => {
  const c = (db.config.collectors || []).find(x => x.id === s.collectorId);
  return { token: s.token, buyer: s.buyer, dept: s.dept, nums: s.nums, amount: s.amount, pricing: s.pricing, method: s.method, paid: s.paid, void: s.void,
    expired: !!s.expired, expiresAt: s.expiresAt, claimedAt: s.claimedAt || null, txn: s.txn || "", at: s.at, collector: c ? collectorPublic(c) : null };
};
const selfService = {
  issue(b, req) {
    const si = db.config.selfIssue;
    if (!si.enabled) throw bad("Self-service tickets are switched off. Ask an organiser.", 403);
    assertOpen();
    if (!unlocked(req)) throw bad("Enter the company code first. It's shared on the company channel.", 403);
    selfRate(req, 8);
    const buyer = str(b.buyer, 80); if (buyer.length < 2) throw bad("Enter your full name");
    const count = int(b.count, 1, si.maxPer); checkLimits(buyer, count);
    const pr = charge(count), pay = pickCollector(b);
    const now = Date.now();
    const sale = { id: uid("s"), token: crypto.randomBytes(12).toString("base64url"), buyer, dept: str(b.dept, 40), phone: str(b.phone, 20), nums: allocate(count),
      amount: pr.amount, pricing: pr.parts, ...pay, paid: false, anon: !!b.anon, void: false, at: new Date(now).toISOString(),
      expiresAt: new Date(now + si.holdHours * 3600e3).toISOString(), soldBy: "Self-service", source: "self" };
    db.sales.push(sale); audit("Self-service", `${buyer} reserved ${count}`); save();
    return { receipt: receiptOf(sale) };
  },
  claim(b, req) {
    selfRate(req, 30);
    const s = db.sales.find(x => x.token && x.token === String(b.token || "")); if (!s) throw bad("Receipt not found", 404);
    if (s.void) throw bad(s.expired ? "This reservation expired. Reserve new tickets." : "This reservation was cancelled.");
    s.txn = str(b.txn, 60); s.claimedAt = new Date().toISOString(); audit("Self-service", `${s.buyer} says paid (${s.txn || "no reference"})`); save();
    return { receipt: receiptOf(s) };
  },
};
// unpaid self-service reservations lapse after the hold window so they never clutter the books
setInterval(() => {
  const now = Date.now(); let n = 0;
  for (const s of db.sales) if (s.source === "self" && !s.paid && !s.void && s.expiresAt && Date.parse(s.expiresAt) < now && !s.claimedAt) { s.void = true; s.expired = true; s.voidAt = new Date(now).toISOString(); n++; }
  if (n) { audit("System", `expired ${n} unpaid self-service reservation${n > 1 ? "s" : ""}`); save(); }
}, 60e3);

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, version: db.version });
    if (url.pathname.startsWith("/uploads/")) {
      const f = url.pathname.slice(9); if (!/^(qr-c-[a-z0-9-]+|logo-[a-z0-9]+|prize-[a-z0-9-]+)\.(png|jpg|webp)$/.test(f)) return send(res, 404, { error: "Not found" });
      return fs.readFile(path.join(UPLOAD_DIR, f), (err, buf) => {
        if (err) return send(res, 404, { error: "Not found" });
        res.writeHead(200, { "content-type": { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[f.split(".").pop()], "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
        res.end(buf);
      });
    }
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res);

    const session = readSession(req);
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, publicState(req));
    if (req.method === "GET" && url.pathname === "/api/receipt") {
      const s = db.sales.find(x => x.token && x.token === url.searchParams.get("t"));
      return s ? send(res, 200, { receipt: receiptOf(s) }) : send(res, 404, { error: "Receipt not found" });
    }
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
    if (url.pathname === "/api/unlock") {
      const b = await body(req), code = String(b.code || "").trim().toLowerCase();
      if (!gateOn()) return send(res, 200, { ok: true, ...publicState(req) });
      const want = crypto.createHash("sha256").update(db.config.companyCode.trim().toLowerCase()).digest();
      if (!code || !crypto.timingSafeEqual(crypto.createHash("sha256").update(code).digest(), want)) { unlockRate(req); return send(res, 403, { error: "That company code isn't right. Ask your organiser or check the company channel." }); }
      return send(res, 200, { ok: true, ...publicState(req, true) }, { "set-cookie": `rc=${codeSig(db.config.companyCode)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}` });
    }
    if (url.pathname === "/api/self/issue") return send(res, 200, { ok: true, ...selfService.issue(await body(req), req) });
    if (url.pathname === "/api/self/claim") return send(res, 200, { ok: true, ...selfService.claim(await body(req), req) });
    if (url.pathname === "/api/logout") return send(res, 200, { admin: false }, { "set-cookie": "rs=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

    if (!session) return send(res, 401, { error: "Sign in to manage the raffle" });
    if (url.pathname === "/api/admin/state") return send(res, 200, adminState());
    const name = url.pathname.replace("/api/admin/", "");
    const fn = Object.hasOwn(actions, name) ? actions[name] : null;
    if (!fn) return send(res, 404, { error: "Not found" });
    const result = fn(await body(req, name === "collectorQr" || name === "logoUpload" || name === "prizeImage" ? 3 * 1024 * 1024 : 64 * 1024), session);
    save();
    return send(res, 200, { ok: true, ...result });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong on the server" });
  }
});
server.listen(PORT, () => console.log(`raffle listening on :${PORT}, ${db.sales.length} sales, v${db.version}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); process.exit(0); });
