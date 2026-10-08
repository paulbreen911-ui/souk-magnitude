import test from "node:test";
import assert from "node:assert";
import { score } from "./src/engine.js";
test("score is 0 within targets, >0 outside", () => {
  const t = { cpa: { max: 10 }, roas: { min: 3 } };
  assert.equal(score({ cpa: 9, roas: 3.5 }, t), 0);
  assert.ok(score({ cpa: 12, roas: 3.5 }, t) > 0);
});
import { parseQuote, parseNews } from "./src/connectors/alphavantage.js";
test("alphavantage parsers", () => {
  const q = parseQuote({ "Global Quote": { "05. price": "150.5", "10. change percent": "0.67%", "06. volume": "100" } }, "IBM");
  assert.deepEqual(q, { IBM_price: 150.5, IBM_change_pct: 0.67, IBM_volume: 100 });
  const n = parseNews({ feed: [{ ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "0.2" }] }, { ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "0.4" }] }] }, ["AAPL", "MSFT"]);
  assert.equal(n.AAPL_news_count, 2);
  assert.ok(Math.abs(n.AAPL_sentiment - 0.3) < 1e-9);
  assert.equal(n.MSFT_sentiment, undefined);
});
