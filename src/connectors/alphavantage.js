// Alpha Vantage data source. Free tier is ~25 calls/day, so each poll makes ONE call,
// cycling through: GLOBAL_QUOTE per ticker + one NEWS_SENTIMENT for all tickers.
// Config: { type:"alphavantage", name, tickers:["AAPL","MSFT"], everySeconds:3600, key:"env:ALPHAVANTAGE_KEY" }
const BASE = "https://www.alphavantage.co/query";

export function parseQuote(json, t) {
  const q = json["Global Quote"];
  if (!q || !q["05. price"]) return {};
  return {
    [`${t}_price`]: +q["05. price"],
    [`${t}_change_pct`]: parseFloat(q["10. change percent"]),
    [`${t}_volume`]: +q["06. volume"],
  };
}

export function parseNews(json, tickers) {
  const out = {};
  for (const t of tickers) {
    const s = (json.feed || []).flatMap((a) => a.ticker_sentiment || []).filter((x) => x.ticker === t);
    if (!s.length) continue;
    out[`${t}_sentiment`] = s.reduce((a, x) => a + +x.ticker_sentiment_score, 0) / s.length;
    out[`${t}_news_count`] = s.length;
  }
  return out;
}

export function alphaVantageConnector(c) {
  const key = c.key?.startsWith("env:") ? process.env[c.key.slice(4)] : c.key || process.env.ALPHAVANTAGE_KEY;
  const calls = [...c.tickers.map((t) => ({ fn: "GLOBAL_QUOTE", t })), { fn: "NEWS_SENTIMENT" }];
  let i = 0;
  const cache = {};

  async function get(params) {
    const r = await fetch(`${BASE}?${new URLSearchParams({ ...params, apikey: key })}`);
    if (!r.ok) throw new Error(`alphavantage ${r.status}`);
    const j = await r.json();
    const msg = j.Note || j.Information || j["Error Message"];
    if (msg) throw new Error(`alphavantage: ${msg}`.slice(0, 200));
    return j;
  }

  return {
    name: c.name,
    everySeconds: c.everySeconds || 3600,
    actions: ["hold"], // read-only for now; no push-back yet
    async metrics() {
      if (!key) throw new Error("ALPHAVANTAGE_KEY not set");
      const call = calls[i++ % calls.length];
      Object.assign(cache, call.fn === "GLOBAL_QUOTE"
        ? parseQuote(await get({ function: call.fn, symbol: call.t }), call.t)
        : parseNews(await get({ function: call.fn, tickers: c.tickers.join(), limit: 200 }), c.tickers));
      return { ...cache };
    },
    async apply() {},
  };
}
