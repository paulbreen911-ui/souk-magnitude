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
