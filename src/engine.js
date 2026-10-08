import fs from "node:fs";
import { httpConnector } from "./connectors/http.js";
import { alphaVantageConnector } from "./connectors/alphavantage.js";

const makers = { http: httpConnector, alphavantage: alphaVantageConnector };
const DIR = process.env.DATA_DIR ? `${process.env.DATA_DIR}/` : new URL("../data/", import.meta.url).pathname;
export const HISTORY_FILE = DIR + "history.jsonl"; // full time series, append-only
const STATE_FILE = process.env.DATA_DIR ? `${process.env.DATA_DIR}/state.json` : new URL("../data/state.json", import.meta.url);

// How far metrics are outside their targets (0 = all within target).
export function score(metrics, targets) {
  let s = 0;
  for (const [m, t] of Object.entries(targets)) {
    const v = metrics[m];
    if (v == null) continue;
    if (t.max != null && v > t.max) s += (v - t.max) / t.max;
    if (t.min != null && v < t.min) s += (t.min - v) / t.min;
  }
  return s;
}

export function createEngine(config) {
  const connectors = config.connectors.map((c) => makers[c.type](c));
  let state = { targets: config.targets, paused: false, stats: {}, log: [], latest: {}, history: [] };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
  // Drop leftovers from connectors that are no longer configured.
  const names = new Set(connectors.map((c) => c.name));
  for (const k of Object.keys(state.latest)) if (!names.has(k)) delete state.latest[k];
  for (const k of Object.keys(state.stats)) if (!names.has(k.split(":")[0])) delete state.stats[k];
  state.history = state.history.filter((h) => names.has(h.connector));
  const last = {};
  const lastRun = {}; // connector -> { action, before }

  const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} };

  function choose(c) {
    const stat = (a) => state.stats[`${c.name}:${a}`] || { n: 0, avg: 0 };
    if (Math.random() < config.epsilon) return c.actions[Math.floor(Math.random() * c.actions.length)];
    return c.actions.reduce((best, a) => (stat(a).avg > stat(best).avg ? a : best));
  }

  async function tickOne(c) {
    const metrics = await c.metrics();
    const now = score(metrics, state.targets);
    // Learn: reward the previous action by how much it improved the score.
    const prev = last[c.name];
    if (prev) {
      const key = `${c.name}:${prev.action}`;
      const st = state.stats[key] || { n: 0, avg: 0 };
      st.n++; st.avg += (prev.before - now - st.avg) / st.n;
      state.stats[key] = st;
    }
    const action = now === 0 && Math.random() > config.epsilon ? "hold" : choose(c);
    await c.apply(action);
    last[c.name] = { action, before: now };
    state.latest[c.name] = { metrics, score: now, action, at: Date.now() };
    state.history.push({ at: Date.now(), connector: c.name, metrics, score: now, action });
    try { fs.appendFileSync(HISTORY_FILE, JSON.stringify({ at: Date.now(), connector: c.name, metrics }) + "\n"); } catch {}
    state.history = state.history.slice(-300);
  }

  async function tick() {
    if (state.paused) return;
    for (const c of connectors) {
      if (c.everySeconds && Date.now() - (lastRun[c.name] || 0) < c.everySeconds * 1000) continue;
      lastRun[c.name] = Date.now();
      try { await tickOne(c); }
      catch (e) { state.log.push({ at: Date.now(), error: `${c.name}: ${e.message}` }); state.log = state.log.slice(-50); }
    }
    save();
  }

  return {
    start() { tick(); return setInterval(tick, config.tickSeconds * 1000); },
    tick,
    state: () => state,
    setTargets(t) { state.targets = t; save(); },
    setPaused(p) { state.paused = !!p; save(); },
  };
}
