// Alpha Vantage client. AV_PREMIUM=1 -> bulk quotes (100 symbols/call). Otherwise one GLOBAL_QUOTE per ticker,
// capped by AV_DAILY_LIMIT (free tier ~25/day) and resumed round-robin, so coverage is slow but never errors out.
import { db } from "./db.js";

const BASE = "https://www.alphavantage.co/query";
const key = () => process.env.ALPHAVANTAGE_KEY;
const premium = () => process.env.AV_PREMIUM === "1";
const limit = () => +(process.env.AV_DAILY_LIMIT || (premium() ? 100000 : 25));

export function callsToday(day) { return db.prepare("SELECT n FROM api_calls WHERE day=?").get(day)?.n || 0; }
export const budgetLeft = (day) => limit() - callsToday(day);

async function get(params, day) {
  if (!key()) throw new Error("ALPHAVANTAGE_KEY not set");
  db.prepare("INSERT INTO api_calls VALUES (?,1) ON CONFLICT(day) DO UPDATE SET n=n+1").run(day);
  const r = await fetch(`${BASE}?${new URLSearchParams({ ...params, apikey: key() })}`);
  if (!r.ok) throw new Error(`alphavantage ${r.status}`);
  const j = await r.json();
  const msg = j.Note || j.Information || j["Error Message"];
  if (msg) throw new Error(`alphavantage: ${msg}`.slice(0, 200));
  return j;
}

export function parseQuote(j) {
  const q = j["Global Quote"];
  if (!q?.["05. price"]) return null;
  return { ticker: q["01. symbol"], day: q["07. latest trading day"], price: +q["05. price"],
    change_pct: parseFloat(q["10. change percent"]), volume: +q["06. volume"] };
}
export function parseBulk(j) {
  return (j.data || []).map((q) => ({ ticker: q.symbol, day: (q.timestamp || "").slice(0, 10), price: +q.close,
    change_pct: parseFloat(q.change_percent), volume: +q.volume })).filter((q) => q.ticker && q.price);
}

// Returns quotes within budget. Free mode: ETFs first (category benchmarks), then stocks round-robin,
// keeping `reserve` calls for the daily news pulls.
export async function quotes({ etfs, stocks }, day, reserve = 0) {
  if (premium()) {
    const all = [...etfs, ...stocks], out = [];
    for (let i = 0; i < all.length && budgetLeft(day) > 0; i += 100)
      out.push(...parseBulk(await get({ function: "REALTIME_BULK_QUOTES", symbol: all.slice(i, i + 100).join() }, day)));
    return out;
  }
  const out = [];
  const one = async (t) => {
    try { const q = parseQuote(await get({ function: "GLOBAL_QUOTE", symbol: t }, day)); if (q) out.push(q); return true; }
    catch (e) { console.error(e.message); return !/rate|limit|premium|call frequency/i.test(e.message); }
  };
  for (const t of etfs) { if (budgetLeft(day) <= reserve || !(await one(t))) return out; }
  let pos = db.prepare("SELECT pos FROM cursor WHERE id=1").get()?.pos || 0;
  for (let n = 0; n < stocks.length && budgetLeft(day) > reserve; n++, pos = (pos + 1) % stocks.length)
    if (!(await one(stocks[pos]))) break;
  db.prepare("INSERT OR REPLACE INTO cursor VALUES (1,?)").run(pos);
  return out;
}

// Average sentiment + article count for a category's tickers.
export async function news(tickers, day) {
  const j = await get({ function: "NEWS_SENTIMENT", tickers: tickers.slice(0, 20).join(), limit: 200 }, day);
  const s = (j.feed || []).flatMap((a) => (a.ticker_sentiment || []).filter((x) => tickers.includes(x.ticker)).map((x) => +x.ticker_sentiment_score));
  return { sentiment: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null, articles: (j.feed || []).length };
}
