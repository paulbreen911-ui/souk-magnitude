import http from "node:http";
import fs from "node:fs";
import { createEngine, HISTORY_FILE } from "./engine.js";
import { db } from "./market/db.js";
import { lastError } from "./market/av.js";
import { buildDashboard } from "./market/dashboard.js";
import { startScheduler, snapshot, daily, backfill, nyNow } from "./market/jobs.js";

const config = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const engine = createEngine(config);
let job = { running: false };
engine.start();
startScheduler();

const body = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(d ? JSON.parse(d) : {})); });

http.createServer(async (req, res) => {
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const pw = process.env.DASH_PASSWORD, tok = process.env.CLAUDE_TOKEN;
  const isAdmin = !pw || req.headers.authorization === "Basic " + Buffer.from("admin:" + pw).toString("base64");
  // CLAUDE_TOKEN: read-only access to /api/state via "Authorization: Bearer <token>"
  const isClaude = tok && (req.url === "/api/state" || req.url === "/api/history" || req.url.startsWith("/api/market")) && req.method === "GET" && req.headers.authorization === "Bearer " + tok;
  if (!isAdmin && !isClaude) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="souk"' }); return res.end("Auth required");
  }
  try {
    if (req.url.startsWith("/api/market")) {
      const u = new URL(req.url, "http://x"), q = (sql, ...a) => db.prepare(sql).all(...a);
      const days = +(u.searchParams.get("days") || 30);
      const what = u.pathname.split("/")[3] || "summary";
      if (what === "dashboard") return json(buildDashboard(days));
      if (what === "summary") return json(q("SELECT * FROM category_daily WHERE day >= date('now', ?) ORDER BY day DESC, category", `-${days} days`));
      if (what === "daily") return json(q("SELECT d.*, c.category FROM daily d JOIN companies c USING(ticker) WHERE day >= date('now', ?) AND (? IS NULL OR c.category=?) ORDER BY day DESC, category, ticker", `-${days} days`, u.searchParams.get("category"), u.searchParams.get("category")));
      if (what === "snapshots") return json(q("SELECT * FROM snapshots WHERE day >= date('now', ?) AND (? IS NULL OR ticker=?) ORDER BY ts DESC LIMIT 5000", `-${days} days`, u.searchParams.get("ticker"), u.searchParams.get("ticker")));
      if (what === "status") return json({ today: nyNow(), lastError, job, calls: q("SELECT * FROM api_calls ORDER BY day DESC LIMIT 7"), snapshots: q("SELECT day, COUNT(*) n FROM snapshots GROUP BY day ORDER BY day DESC LIMIT 7") });
      if (req.method === "POST" && what === "run") {
        const n = nyNow(), name = u.searchParams.get("job") || "snapshot";
        if (name === "resetcalls") { db.prepare("DELETE FROM api_calls WHERE day=?").run(n.day); return json({ ok: true }); }
        if (job.running) return json({ error: `Already running: ${job.name}` }, 409);
        job = { running: true, name, startedAt: Date.now() };
        // Runs in the background (free-tier spacing makes jobs take 10–30s; proxies time out on long requests).
        (async () => {
          try {
            const last = db.prepare("SELECT MAX(day) d FROM snapshots").get().d;
            const r = name === "daily" ? await daily({ day: u.searchParams.get("day") || last || n.day }) : name === "backfill" ? await backfill(n) : await snapshot(n, true);
            job = { running: false, name, result: r ?? null, error: lastError, finishedAt: Date.now() };
          } catch (e) { job = { running: false, name, error: e.message, finishedAt: Date.now() }; }
        })();
        return json({ ok: true, started: true });
      }
      return json({ error: "unknown" }, 404);
    }
    if (req.url === "/api/history") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      return res.end(fs.existsSync(HISTORY_FILE) ? fs.readFileSync(HISTORY_FILE) : "");
    }
    if (req.url === "/api/state") return json(engine.state());
    if (req.url === "/api/targets" && req.method === "POST") { engine.setTargets(await body(req)); return json({ ok: true }); }
    if (req.url === "/api/pause" && req.method === "POST") { engine.setPaused((await body(req)).paused); return json({ ok: true }); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fs.readFileSync(new URL("../public/index.html", import.meta.url)));
  } catch (e) { json({ error: e.message }, 400); }
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
