import { DatabaseSync } from "node:sqlite";
import { allTickers } from "./universe.js";

const DIR = process.env.DATA_DIR || new URL("../../data", import.meta.url).pathname;
export const db = new DatabaseSync(`${DIR}/market.db`);

db.exec(`
CREATE TABLE IF NOT EXISTS companies (ticker TEXT PRIMARY KEY, category TEXT, is_etf INT);
CREATE TABLE IF NOT EXISTS snapshots (ts TEXT, day TEXT, ticker TEXT, price REAL, change_pct REAL, volume REAL,
  PRIMARY KEY (ts, ticker));
CREATE TABLE IF NOT EXISTS daily (day TEXT, ticker TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
  change_pct REAL, PRIMARY KEY (day, ticker));
CREATE TABLE IF NOT EXISTS news (day TEXT, category TEXT, sentiment REAL, articles INT, PRIMARY KEY (day, category));
CREATE TABLE IF NOT EXISTS category_daily (day TEXT, category TEXT, avg_change_pct REAL, etf_change_pct REAL,
  ret_5d REAL, ret_20d REAL, sentiment REAL, up INT, down INT, best TEXT, worst TEXT, PRIMARY KEY (day, category));
CREATE TABLE IF NOT EXISTS runs (key TEXT PRIMARY KEY, at TEXT);
CREATE TABLE IF NOT EXISTS api_calls (day TEXT, n INT, PRIMARY KEY (day));
CREATE TABLE IF NOT EXISTS cursor (id INT PRIMARY KEY, pos INT);
`);
const ins = db.prepare("INSERT OR REPLACE INTO companies VALUES (?,?,?)");
for (const [t, c, e] of allTickers()) ins.run(t, c, e ? 1 : 0);
