# Souk Magnitude

Closed loop: **pull metrics from platform APIs → compare to targets → pick an action → push it back → measure → learn.**

```
npm start        # http://localhost:3000
npm test
```

- `config.json` – targets, tick speed, exploration rate, connectors
- `src/connectors/` – one file per platform (generic `http`). Each exposes `metrics()`, `apply(action)`, `actions`.
- `src/engine.js` – the loop. Learning = per-action average improvement toward targets (epsilon-greedy), saved to `data/state.json`.
- Dashboard edits targets live and pauses the loop.

Add a platform: copy `http.js`, adapt auth/endpoints, register in `engine.js`.

## Deploy (Railway)
Start command `npm start`. Env vars: `DASH_PASSWORD` (login `admin` / this; set it, the dashboard can change targets),
`CLAUDE_TOKEN` (optional; read-only Bearer access to `/api/state` for Claude),
`ALPHAVANTAGE_KEY`, `DATA_DIR` (point at a mounted volume so learning survives redeploys), plus any connector tokens referenced as `env:NAME` in `config.json`.

## Market database (SQLite, `$DATA_DIR/market.db`)
- `src/market/universe.js` – categories → companies (+ ETF benchmark). Edit to change what's tracked.
- Premium: hourly snapshots 10:00–16:00 ET (weekdays) → `snapshots`; daily rollup after 16:30 ET → `daily`, `news`, `category_daily` (day change, vs ETF, 5d/20d trend, sentiment). Each day appends.
- Read APIs (admin login or `CLAUDE_TOKEN`): `/api/market/summary?days=60`, `/daily?category=water`, `/snapshots?ticker=AWK`, `/status`.
- Alpha Vantage free key ≈ 25 calls/day: one snapshot at 16:00 ET = 9 ETF benchmarks + a few stocks (round-robin, rest reserved for 9 news pulls). Category trends (5d/20d) use the ETF. Set `AV_PREMIUM=1` for bulk quotes (100 symbols/call) = full hourly coverage. `AV_DAILY_LIMIT` overrides the cap.
- Requires Node ≥ 22.13 (built-in `node:sqlite`).

## Dashboard & projections
- `/api/market/dashboard?days=90` feeds the UI: per-category ETF series, news sentiment, forecast cone, walk-forward track record.
- Projection (`src/market/forecast.js`): drift shrunk hard toward zero + volatility cone (50%/80% ranges). Price history only; the UI shows how well past 5-day calls did.
- History backfill: on first run the server pulls ~100 days of daily bars per category ETF (1 call each, spread over 1–2 days on the free tier), so trends/projections work immediately. Manual: `POST /api/market/run?job=backfill`.
