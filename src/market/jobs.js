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

export async function snapshot(n = nyNow()) {
  const all = allTickers();
  const qs = await av.quotes({ etfs: all.filter((t) => t[2]).map((t) => t[0]), stocks: all.filter((t) => !t[2]).map((t) => t[0]) },
    n.day, process.env.AV_PREMIUM === "1" ? 0 : Object.keys(UNIVERSE).length);
  const ins = db.prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?)");
  const ts = new Date().toISOString();
  // Keep only quotes from today's session (skips holidays / stale data).
  for (const q of qs) if (q.day === n.day) ins.run(ts, n.day, q.ticker, q.price, q.change_pct, q.volume);
  return qs.length;
}

export function buildDaily(day) {
  const rows = db.prepare("SELECT ticker, price, change_pct, volume FROM snapshots WHERE day=? ORDER BY ts").all(day);
  const by = {};
  for (const r of rows) (by[r.ticker] ??= []).push(r);
  const up = db.prepare("INSERT OR REPLACE INTO daily VALUES (?,?,?,?,?,?,?,?)");
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

export async function daily(n = nyNow()) {
  buildDaily(n.day);
  for (const [cat, u] of Object.entries(UNIVERSE)) {
    if (av.budgetLeft(n.day) <= 0) break;
    try { const x = await av.news([...u.tickers, u.etf], n.day);
      db.prepare("INSERT OR REPLACE INTO news VALUES (?,?,?,?)").run(n.day, cat, x.sentiment, x.articles);
    } catch (e) { console.error("news", cat, e.message); }
  }
  buildCategories(n.day);
}

// Check once a minute. Snapshots (hourly if premium, else once at 16:00 ET) on weekdays; daily rollup after 16:30 ET.
export function startScheduler() {
  const tick = async () => {
    const n = nyNow();
    if (!isWeekday(n)) return;
    try {
      // Premium: hourly 10–16 ET. Free: one snapshot at 16:00 ET (call budget).
      const first = process.env.AV_PREMIUM === "1" ? 10 : 16;
      if (n.hour >= first && n.hour <= 16 && !done(`snap ${n.day} ${n.hour}`)) {
        mark(`snap ${n.day} ${n.hour}`); console.log("snapshot", n.day, n.hour, await snapshot(n));
      }
      if ((n.hour > 16 || (n.hour === 16 && n.minute >= 30)) && !done(`daily ${n.day}`)) {
        mark(`daily ${n.day}`); await daily(n); console.log("daily rollup", n.day);
      }
    } catch (e) { console.error("scheduler", e.message); }
  };
  tick(); return setInterval(tick, 60_000);
}
