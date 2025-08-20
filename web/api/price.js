// web/api/price.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Jupiter Lite Price v3 endpoint (mint IDs or symbols)
const JUP = "https://lite-api.jup.ag/price/v3";

module.exports = async (req, res) => {
  console.log('Price API called'); // Runtime log for debugging
  if (preflight(req, res)) return;
  setCors(res, req.headers.origin);
  if (rateLimit(req, res, "price")) return;

  const url = new URL(req.url, "http://x");
  const ids = url.searchParams.get("ids") || "So11111111111111111111111111111111111111112"; // SOL
  const meta = { route: "/api/price", ids };

  try {
    logStart("PRICE", meta);
    const r = await fetch(`${JUP}?ids=${encodeURIComponent(ids)}`, {
      headers: { "Accept": "application/json" }
    });
    const text = await r.text();
    if (!r.ok) {
      logErr("PRICE", { ...meta, status: r.status, excerpt: text.slice(0, 400) });
      res.setHeader("Cache-Control", "no-store");
      return res.status(r.status).end(text);
    }
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    logOk("PRICE", { ...meta, status: r.status });
    res.setHeader("Cache-Control", "public, max-age=20");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).end(JSON.stringify(data));
  } catch (e) {
    logErr("PRICE", { ...meta, error: String(e?.message || e) });
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
