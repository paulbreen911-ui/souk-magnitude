import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import { score } from "./src/engine.js";

test("score is 0 within targets, >0 outside", () => {
  const t = { cpa: { max: 10 }, roas: { min: 3 } };
  assert.equal(score({ cpa: 9, roas: 3.5 }, t), 0);
  assert.ok(score({ cpa: 12, roas: 3.5 }, t) > 0);
});

process.env.AV_MIN_GAP_MS = "0"; process.env.AV_RETRY_MS = "1";

test("market pipeline: snapshots -> daily -> category summary", async () => {
  process.env.DATA_DIR = fs.mkdtempSync(os.tmpdir() + "/mk-");
  process.env.ALPHAVANTAGE_KEY = "k"; process.env.AV_PREMIUM = "1";
  const { db } = await import("./src/market/db.js");
  const jobs = await import("./src/market/jobs.js");
  const av = await import("./src/market/av.js");

  assert.deepEqual(av.parseQuote({ "Global Quote": { "01. symbol": "AWK", "05. price": "100", "07. latest trading day": "2026-10-08", "10. change percent": "1.5%", "06. volume": "9" } }),
    { ticker: "AWK", day: "2026-10-08", price: 100, change_pct: 1.5, volume: 9 });
  assert.equal(jobs.nyNow(new Date("2026-10-08T14:30:00Z")).hour, 10);

  const day = "2026-10-08";
  let price = 100;
  globalThis.fetch = async (url) => {
    const f = new URL(url).searchParams.get("function");
    const body = f === "NEWS_SENTIMENT"
      ? { feed: [{ ticker_sentiment: [{ ticker: "AWK", ticker_sentiment_score: "0.4" }] }] }
      : { data: ["AWK", "PHO"].map((symbol) => ({ symbol, timestamp: day + " 15:00:00", close: String(price), change_percent: "2.0", volume: "5" })) };
    return { ok: true, json: async () => body };
  };
  await jobs.snapshot({ day }); price = 102; await jobs.snapshot({ day });
  await jobs.daily({ day });
  const d = db.prepare("SELECT * FROM daily WHERE ticker='AWK'").get();
  assert.equal(d.open, 100); assert.equal(d.close, 102); assert.equal(d.high, 102);
  const c = db.prepare("SELECT * FROM category_daily WHERE category='water'").get();
  assert.equal(c.etf_change_pct, 2); assert.equal(c.best, "AWK"); assert.equal(c.sentiment, 0.4);
});

test("free mode: ETFs first, respects daily limit and news reserve", async () => {
  process.env.AV_PREMIUM = "0"; process.env.AV_DAILY_LIMIT = "12";
  const av = await import("./src/market/av.js");
  const calls = [];
  globalThis.fetch = async (url) => {
    const sym = new URL(url).searchParams.get("symbol"); calls.push(sym);
    return { ok: true, json: async () => ({ "Global Quote": { "01. symbol": sym, "05. price": "10", "07. latest trading day": "2026-10-09", "10. change percent": "1%", "06. volume": "1" } }) };
  };
  const etfs = ["A", "B", "C"], stocks = ["S1", "S2", "S3", "S4", "S5", "S6"];
  const q = await av.quotes({ etfs, stocks }, "2026-10-09", 5);
  assert.equal(q.length, 7);              // 12 limit - 5 reserved
  assert.deepEqual(calls.slice(0, 3), etfs);
  const q2 = await av.quotes({ etfs, stocks }, "2026-10-10", 5);  // next day resumes at cursor
  assert.equal(calls[10], "S5");
});

test("forecast: needs history, cone widens, drift is shrunk", async () => {
  const { forecast, backtest } = await import("./src/market/forecast.js");
  assert.equal(forecast([1, 2, 3]).ready, false);
  let p = 100; const closes = Array.from({ length: 120 }, (_, i) => (p *= 1 + 0.002 + Math.sin(i) * 0.01));
  const f = forecast(closes, 20);
  assert.ok(f.ready && f.points.length === 20);
  assert.ok(f.points[19].hi80 - f.points[19].lo80 > f.points[0].hi80 - f.points[0].lo80);
  assert.ok(f.points[4].pUp > 0.5 && f.points[4].pUp < 0.8);
  const b = backtest(closes, 5);
  assert.ok(b.n > 50 && b.cover80 > 0.5);
});

test("backfill parser", async () => {
  const { parseDaily } = await import("./src/market/av.js");
  const r = parseDaily({ "Time Series (Daily)": { "2026-10-08": { "1. open": "1", "2. high": "3", "3. low": "0.5", "4. close": "2", "5. volume": "9" }, "2026-10-07": { "1. open": "1", "2. high": "1", "3. low": "1", "4. close": "1", "5. volume": "1" } } });
  assert.deepEqual(r.map((x) => x.day), ["2026-10-07", "2026-10-08"]);
  assert.equal(r[1].close, 2);
});

test("retries the 1-request-per-second reply instead of giving up", async () => {
  process.env.AV_PREMIUM = "0"; process.env.AV_DAILY_LIMIT = "50";
  const av = await import("./src/market/av.js");
  let n = 0;
  globalThis.fetch = async (url) => {
    const sym = new URL(url).searchParams.get("symbol");
    const body = ++n % 2 ? { Information: "Please consider spreading out your free API requests more sparingly (1 request per second)." }
      : { "Global Quote": { "01. symbol": sym, "05. price": "5", "07. latest trading day": "2026-10-09", "10. change percent": "1%", "06. volume": "1" } };
    return { ok: true, json: async () => body };
  };
  const q = await av.quotes({ etfs: ["A", "B", "C"], stocks: [] }, "2026-10-11", 0);
  assert.equal(q.length, 3);
  assert.equal(av.callsToday("2026-10-11"), 3); // rejected attempts are not counted
});

test("free scheduled snapshot probes first and stops when the close isn't published yet", async () => {
  process.env.AV_PREMIUM = "0"; process.env.AV_DAILY_LIMIT = "50";
  const jobs = await import("./src/market/jobs.js");
  const av = await import("./src/market/av.js");
  const { db } = await import("./src/market/db.js");
  let latest = "2026-10-09", calls = 0;
  globalThis.fetch = async (url) => {
    calls++; const sym = new URL(url).searchParams.get("symbol");
    return { ok: true, json: async () => ({ "Global Quote": { "01. symbol": sym, "05. price": "5", "07. latest trading day": latest, "10. change percent": "1%", "06. volume": "1" } }) };
  };
  assert.equal(await jobs.snapshot({ day: "2026-10-12" }), 0);   // lagging: stale probe only
  assert.equal(calls, 1);
  latest = "2026-10-12";
  const k = await jobs.snapshot({ day: "2026-10-12" });          // published: ETFs + a few stocks
  assert.ok(k >= 9);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM snapshots WHERE day='2026-10-12'").get().n >= 9);
});
