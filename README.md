# Souk Magnitude

Closed loop: **pull metrics from platform APIs → compare to targets → pick an action → push it back → measure → learn.**

```
npm start        # http://localhost:3000
npm test
```

- `config.json` – targets, tick speed, exploration rate, connectors
- `src/connectors/` – one file per platform (generic `http` to start). Each exposes `metrics()`, `apply(action)`, `actions`.
- `src/engine.js` – the loop. Learning = per-action average improvement toward targets (epsilon-greedy), saved to `data/state.json`.
- Dashboard edits targets live and pauses the loop.

Add a platform: copy `http.js`, adapt auth/endpoints, register in `engine.js`.

## Deploy (Railway)
Start command `npm start`. Env vars: `DASH_PASSWORD` (login `admin` / this; set it, the dashboard can change targets),
`CLAUDE_TOKEN` (optional; read-only Bearer access to `/api/state` for Claude),
`DATA_DIR` (point at a mounted volume so learning survives redeploys), plus any connector tokens referenced as `env:NAME` in `config.json`.
