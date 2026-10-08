import test from "node:test";
import assert from "node:assert";
import { score } from "./src/engine.js";
test("score is 0 within targets, >0 outside", () => {
  const t = { cpa: { max: 10 }, roas: { min: 3 } };
  assert.equal(score({ cpa: 9, roas: 3.5 }, t), 0);
  assert.ok(score({ cpa: 12, roas: 3.5 }, t) > 0);
});
