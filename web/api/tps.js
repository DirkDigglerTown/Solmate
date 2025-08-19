// web/api/tps.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Use env if available; fallback to your provided key
const HELIUS_RPC = process.env.HELIUS_RPC_URL
  || "https://mainnet.helius-rpc.com/?api-key=9355c09c-5049-4ffa-a0fa-786d2482af6b";

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  setCors(res, req.headers.origin);
  if (rateLimit(req, res, "tps")) return;

  try {
    logStart("TPS", { url: HELIUS_RPC });
    const body = { jsonrpc:"2.0", id:1, method:"getRecentPerformanceSamples", params:[1] };
    const r = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    const json = await r.json().catch(() => ({}));
    const s = json?.result?.[0];
    let tps = null;
    if (s) tps = Math.round((s.numTransactions || 0) / (s.samplePeriodSecs || 1));
    logOk("TPS", { status: r.status, tps });
    res.setHeader("Cache-Control", "public, max-age=10");
    return res.status(200).json({ tps, raw: json });
  } catch (e) {
    logErr("TPS", { error: String(e?.message || e) });
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
