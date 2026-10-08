// Fake ad platform so the loop runs with no API keys. Optimum: bid=2, budget=100.
export function simConnector({ name }) {
  const s = { bid: 4, budget: 60 };
  const noise = () => (Math.random() - 0.5) * 0.6;
  return {
    name,
    actions: ["bid_up", "bid_down", "budget_up", "budget_down", "hold"],
    async metrics() {
      return {
        cpa: 8 + (s.bid - 2) ** 2 * 1.5 + noise(),
        roas: 4.5 - Math.abs(s.budget - 100) / 40 - Math.abs(s.bid - 2) * 0.3 + noise() * 0.3,
      };
    },
    async apply(a) {
      if (a === "bid_up") s.bid += 0.5;
      if (a === "bid_down") s.bid = Math.max(0.5, s.bid - 0.5);
      if (a === "budget_up") s.budget += 10;
      if (a === "budget_down") s.budget = Math.max(10, s.budget - 10);
    },
  };
}
