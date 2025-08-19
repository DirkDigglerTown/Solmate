// Add asset verification to health check
const fs = require('fs').promises;
const path = require('path');

module.exports = async (req, res) => {
  const meta = {
    route: "/api/health",
    method: req.method,
    ua: req.headers["user-agent"],
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
    region: process.env.VERCEL_REGION,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  };

  try {
    console.log("HEALTH: start", meta);

    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    
    // Check critical assets
    const assetChecks = {
      vrm: false,
      logo: false
    };

    try {
      const vrmPath = path.join(process.cwd(), 'assets', 'avatar', 'solmate.vrm');
      const logoPath = path.join(process.cwd(), 'assets', 'logo', 'solmatelogo.png');
      
      const [vrmStat, logoStat] = await Promise.all([
        fs.stat(vrmPath).catch(() => null),
        fs.stat(logoPath).catch(() => null)
      ]);

      assetChecks.vrm = !!(vrmStat && vrmStat.size > 0);
      assetChecks.logo = !!(logoStat && logoStat.size > 0);
    } catch (e) {
      console.warn("HEALTH: asset check failed", e.message);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");

    const body = {
      ok: true,
      time: Date.now(),
      env: hasOpenAI,
      region: meta.region || null,
      commit: meta.commit || null,
      assets: assetChecks
    };

    console.log("HEALTH: ok", { env: hasOpenAI, time: body.time, assets: assetChecks });
    return res.status(200).json(body);
  } catch (err) {
    console.error("HEALTH: error", { err: String(err?.message || err) });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
};
