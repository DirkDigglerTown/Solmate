// web/api/health.js
const { setCors, preflight, logStart, logOk, logErr } = require("./_utils.js");

module.exports = async (req, res) => {
  // Handle preflight
  if (preflight(req, res)) return;
  
  // Set CORS
  setCors(res, req.headers.origin);
  
  const meta = {
    route: "/api/health",
    method: req.method,
    ua: req.headers["user-agent"],
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
    region: process.env.VERCEL_REGION,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  };

  try {
    logStart("HEALTH", meta);

    // Check environment variables
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasHelius = !!process.env.HELIUS_RPC_URL;
    
    // Basic health check response
    const body = {
      ok: true,
      time: Date.now(),
      timestamp: new Date().toISOString(),
      environment: {
        hasOpenAI,
        hasHelius,
        nodeVersion: process.version,
        region: meta.region || null,
        commit: meta.commit || null,
        env: process.env.VERCEL_ENV || "development"
      },
      services: {
        chat: hasOpenAI,
        tts: hasOpenAI,
        price: true,
        tps: hasHelius || !!process.env.SOLANA_RPC_URL
      }
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 200;

    logOk("HEALTH", { env: hasOpenAI, time: body.time });
    return res.end(JSON.stringify(body));
    
  } catch (err) {
    logErr("HEALTH", { err: String(err?.message || err) });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 500;
    return res.end(JSON.stringify({ 
      ok: false, 
      error: String(err?.message || err) 
    }));
  }
};
