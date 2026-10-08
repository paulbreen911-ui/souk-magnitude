// Honest, simple projection from price history only: shrunk drift + volatility cone.
// Drift is shrunk hard toward 0 (no momentum extrapolation); the cone widens with sqrt(horizon).
const erf = (x) => { // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const Z50 = 0.6745, Z80 = 1.2816;

export function forecast(closes, H = 20) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  const n = r.length;
  if (n < 20) return { ready: false, n };
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  let ew = v; for (const x of r) ew = 0.94 * ew + 0.06 * (x - mean) ** 2; // recent-weighted variance
  const sigma = Math.sqrt(0.5 * v + 0.5 * ew);
  const mu = mean * n / (n + 60);
  const last = closes.at(-1), points = [];
  for (let h = 1; h <= H; h++) {
    const m = mu * h, s = sigma * Math.sqrt(h), at = (z) => last * Math.exp(m + z * s);
    points.push({ h, median: at(0), lo50: at(-Z50), hi50: at(Z50), lo80: at(-Z80), hi80: at(Z80), pUp: Phi(m / s) });
  }
  return { ready: true, n, mu, sigma, annVol: sigma * Math.sqrt(252) * 100, confidence: n < 40 ? "low" : n < 120 ? "medium" : "high", points };
}

// Walk-forward check: forecast h days ahead from each past day, compare with what happened.
export function backtest(closes, h = 5, minTrain = 30) {
  let n = 0, hit = 0, brier = 0, cover = 0;
  for (let t = minTrain; t + h < closes.length; t++) {
    const f = forecast(closes.slice(0, t + 1), h);
    if (!f.ready) continue;
    const p = f.points[h - 1], actual = closes[t + h], up = actual > closes[t] ? 1 : 0;
    n++; hit += (p.pUp >= 0.5) === !!up; brier += (p.pUp - up) ** 2; cover += actual >= p.lo80 && actual <= p.hi80;
  }
  return n ? { n, hit: hit / n, brier: brier / n, cover80: cover / n } : { n: 0 };
}
