import { db } from "./db.js";
import { UNIVERSE, allTickers } from "./universe.js";
import * as av from "./av.js";

// Current time in New York: { day:"YYYY-MM-DD", hour, minute, dow }
export function nyNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, dow: p.weekday };
}
const isWeekday = (n) => !["Sat", "Sun"].includes(n.dow);
const done = (key) => db.prepare("SELECT 1 FROM runs WHERE key=?").get(key);
const mark = (key) => db.prepare("INSERT OR IGNORE INTO runs VALUES (?,?)").run(key, new Date().toISOString());

// Returns the number of quotes stored. Free-tier quotes are end-of-day and can lag the close, so a scheduled
// free run first probes ONE ETF: if its trading day isn't today yet, stop (costs 1 call) and try again later.
export async function snapshot(n = nyNow(), force = false) {
  const all = allTickers(), free = process.env.AV_PREMIUM !== "1";
  const etfs = all.filter((t) => t[2]).map((t) => t[0]), stocks = all.filter((t) => !t[2]).map((t) => t[0]);
  let probed = [];
  if (free && !force) {
    probed = await av.quotes({ etfs: [etfs[0]], stocks: [] }, n.day, 0);
    if (!probed.length || probed[0].day !== n.day) return 0;
  }
  const rest = await av.quotes({ etfs: probed.length ? etfs.slice(1) : etfs, stocks }, n.day, free ? Object.keys(UNIVERSE).length : 0);
  const qs = [...probed, ...rest];
  const ins = db.prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?)");
  const ts = new Date().toISOString();
  // Scheduled: only today's session (skips holidays/stale). Manual (force): keep the quote's own trading day.
  let k = 0;
  for (const q of qs) if (force ? q.day : q.day === n.day) { ins.run(ts, q.day, q.ticker, q.price, q.change_pct, q.volume); k++; }
  return k;
}

export function buildDaily(day) {
  const rows = db.prepare("SELECT ticker, price, change_pct, volume FROM snapshots WHERE day=? ORDER BY ts").all(day);
  const by = {};
  for (const r of rows) (by[r.ticker] ??= []).push(r);
  // Keep a real OHLC row (e.g. from backfill) if present: widen high/low, update close.
  const up = db.prepare(`INSERT INTO daily VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(day, ticker) DO UPDATE SET
    high=max(high, excluded.high), low=min(low, excluded.low), close=excluded.close, volume=excluded.volume, change_pct=excluded.change_pct`);
  for (const [t, a] of Object.entries(by)) {
    const p = a.map((x) => x.price), last = a.at(-1);
    up.run(day, t, p[0], Math.max(...p), Math.min(...p), last.price, last.volume, last.change_pct);
  }
}

const ret = (ticker, day, n) => {
  const r = db.prepare("SELECT close FROM daily WHERE ticker=? AND day<=? ORDER BY day DESC LIMIT ?").all(ticker, day, n + 1);
  return r.length > n ? ((r[0].close / r[n].close) - 1) * 100 : null;
};
const avg = (a) => { a = a.filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };

export function buildCategories(day) {
  for (const [cat, u] of Object.entries(UNIVERSE)) {
    const d = u.tickers.map((t) => db.prepare("SELECT * FROM daily WHERE day=? AND ticker=?").get(day, t)).filter(Boolean);
    if (!d.length) continue;
    const sorted = [...d].sort((a, b) => b.change_pct - a.change_pct);
    const etf = db.prepare("SELECT change_pct FROM daily WHERE day=? AND ticker=?").get(day, u.etf);
    const sent = db.prepare("SELECT sentiment FROM news WHERE day=? AND category=?").get(day, cat);
    db.prepare("INSERT OR REPLACE INTO category_daily VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      day, cat, avg(d.map((x) => x.change_pct)), etf?.change_pct ?? null,
      ret(u.etf, day, 5), ret(u.etf, day, 20),
      sent?.sentiment ?? null, d.filter((x) => x.change_pct > 0).length, d.filter((x) => x.change_pct < 0).length,
      sorted[0].ticker, sorted.at(-1).ticker);
  }
}

// One-time: ~100 days of daily history per category ETF, so trends/forecasts work from day one.
export async function backfill(n = nyNow()) {
  const reserve = process.env.AV_PREMIUM === "1" ? 0 : Object.keys(UNIVERSE).length * 2; // quotes + news
  const ins = db.prepare("INSERT OR IGNORE INTO daily VALUES (?,?,?,?,?,?,?,?)");
  let got = 0;
  for (const u of Object.values(UNIVERSE)) {
    if (av.budgetLeft(n.day) <= reserve) break;
    if (done(`backfill ${u.etf}`)) continue;
    const h = await av.history(u.etf, n.day);
    h.forEach((r, i) => ins.run(r.day, u.etf, r.open, r.high, r.low, r.close, r.volume, i ? (r.close / h[i - 1].close - 1) * 100 : null));
    mark(`backfill ${u.etf}`); got++;
  }
  return got;
}

export async function daily(n = nyNow()) {
  buildDaily(n.day);
  const today = nyNow().day; // API budget is counted per real day, even when rolling up an earlier trading day
  for (const [cat, u] of Object.entries(UNIVERSE)) {
    if (av.budgetLeft(today) <= 0) break;
    try { const x = await av.news([...u.tickers, u.etf], today);
      db.prepare("INSERT OR REPLACE INTO news VALUES (?,?,?,?)").run(n.day, cat, x.sentiment, x.articles);
    } catch (e) { console.error("news", cat, e.message); }
  }
  buildCategories(n.day);
}

// Check once a minute, weekdays only (see below).
export function startScheduler() {
  const tick = async () => {
    const n = nyNow();
    try {
      if (n.hour >= 8 && !done(`backfillrun ${n.day}`)) { mark(`backfillrun ${n.day}`); console.log("backfill", await backfill(n)); }
    } catch (e) { console.error("backfill", e.message); }
    if (!isWeekday(n)) return;
    try {
      if (process.env.AV_PREMIUM === "1") {
        // Premium (real-time): hourly 10:00–16:00 ET, rollup after 16:30.
        if (n.hour >= 10 && n.hour <= 16 && !done(`snap ${n.day} ${n.hour}`)) {
          mark(`snap ${n.day} ${n.hour}`); console.log("snapshot", n.day, n.hour, await snapshot(n));
        }
        if ((n.hour > 16 || (n.hour === 16 && n.minute >= 30)) && !done(`daily ${n.day}`)) {
          mark(`daily ${n.day}`); await daily(n); console.log("daily rollup", n.day);
        }
      } else {
        // Free (end-of-day data): try at 17:00, 18:00, 19:00, 20:00 ET until today's close is available, then roll up.
        if (n.hour >= 17 && n.hour <= 20 && !done(`snapok ${n.day}`) && !done(`snaptry ${n.day} ${n.hour}`)) {
          mark(`snaptry ${n.day} ${n.hour}`);
          const k = await snapshot(n); console.log("snapshot", n.day, n.hour, k);
          if (k > 0) mark(`snapok ${n.day}`);
        }
        if (done(`snapok ${n.day}`) && !done(`daily ${n.day}`)) { mark(`daily ${n.day}`); await daily(n); console.log("daily rollup", n.day); }
      }
    } catch (e) { console.error("scheduler", e.message); }
  };
  tick(); return setInterval(tick, 60_000);
}
