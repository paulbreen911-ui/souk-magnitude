import { db } from "./db.js";
import { UNIVERSE } from "./universe.js";
import { forecast, backtest } from "./forecast.js";
import { callsToday, limit } from "./av.js";
import { nyNow } from "./jobs.js";

const rows = (sql, ...a) => db.prepare(sql).all(...a);

export function buildDashboard(days = 120) {
  const categories = Object.entries(UNIVERSE).map(([category, u]) => {
    const all = rows("SELECT day, close FROM daily WHERE ticker=? ORDER BY day DESC LIMIT 260", u.etf).reverse();
    const closes = all.map((r) => r.close);
    const pct = (n) => (closes.length > n ? (closes.at(-1) / closes.at(-1 - n) - 1) * 100 : null);
    const stocks = u.tickers.map((t) => rows("SELECT ticker, close price, change_pct, day FROM daily WHERE ticker=? ORDER BY day DESC LIMIT 1", t)[0]).filter(Boolean);
    return {
      category, etf: u.etf, series: all.slice(-days).map((r) => [r.day, r.close]),
      last: closes.at(-1) ?? null, d1: pct(1), d5: pct(5), d20: pct(20),
      sentiment: rows("SELECT day, sentiment FROM news WHERE category=? AND sentiment IS NOT NULL ORDER BY day DESC LIMIT ?", category, days).reverse().map((r) => [r.day, r.sentiment]),
      stocks, forecast: forecast(closes, 20), backtest: backtest(closes, 5),
    };
  });
  const day = nyNow().day;
  return {
    asOf: categories.flatMap((c) => c.series.at(-1)?.[0] ?? []).sort().at(-1) ?? null,
    today: day, calls: { used: callsToday(day), limit: limit() },
    daysStored: rows("SELECT COUNT(DISTINCT day) n FROM daily")[0].n, categories,
  };
}
