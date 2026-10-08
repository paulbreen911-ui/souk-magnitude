import http from "node:http";
import fs from "node:fs";
import { createEngine } from "./engine.js";

const config = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const engine = createEngine(config);
engine.start();

const body = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(d ? JSON.parse(d) : {})); });

http.createServer(async (req, res) => {
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const pw = process.env.DASH_PASSWORD;
  if (pw && req.headers.authorization !== "Basic " + Buffer.from("admin:" + pw).toString("base64")) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="souk"' }); return res.end("Auth required");
  }
  try {
    if (req.url === "/api/state") return json(engine.state());
    if (req.url === "/api/targets" && req.method === "POST") { engine.setTargets(await body(req)); return json({ ok: true }); }
    if (req.url === "/api/pause" && req.method === "POST") { engine.setPaused((await body(req)).paused); return json({ ok: true }); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fs.readFileSync(new URL("../public/index.html", import.meta.url)));
  } catch (e) { json({ error: e.message }, 400); }
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
