// Generic REST connector. Config:
// { type:"http", name, metricsUrl, actionUrl, actions:[...], headers:{Authorization:"env:MY_TOKEN"} }
// metricsUrl must return flat JSON numbers e.g. {"cpa":11.2,"roas":3.4}.
// actionUrl receives POST {"action":"bid_up"}. Adapt per platform as needed.
export function httpConnector(c) {
  const headers = Object.fromEntries(
    Object.entries(c.headers || {}).map(([k, v]) => [k, v.startsWith("env:") ? process.env[v.slice(4)] || "" : v])
  );
  return {
    name: c.name,
    actions: c.actions || ["hold"],
    async metrics() {
      const r = await fetch(c.metricsUrl, { headers });
      if (!r.ok) throw new Error(`${c.name} metrics ${r.status}`);
      return r.json();
    },
    async apply(action) {
      const r = await fetch(c.actionUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error(`${c.name} action ${r.status}`);
    },
  };
}
