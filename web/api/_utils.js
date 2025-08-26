// web/api/_utils.js
// CORS + simple per-IP rate limit + preflight + tiny logger helpers

// Rate limit configuration
const RATE = { max: 8, windowMs: 30000 }; // 8 req / 30s / IP
const buckets = new Map();

function setCors(res, origin) {
  // Allow all origins for now - can be restricted later
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function preflight(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res, req.headers?.origin);
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function rateLimit(req, res, keyPrefix = "rl", customConfig = null) {
  const config = customConfig || RATE;
  const ip = (req.headers && req.headers["x-forwarded-for"]) || 
             (req.connection && req.connection.remoteAddress) || 
             "unknown";
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();
  const win = config.windowMs || 30000;

  let b = buckets.get(key);
  if (!b) b = { t: now, c: 0 };
  if (now - b.t > win) { b.t = now; b.c = 0; }
  b.c += 1;
  buckets.set(key, b);

  const remaining = Math.max(0, (config.max || 8) - b.c);
  res.setHeader("X-RateLimit-Limit", String(config.max || 8));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((b.t + win) / 1000)));

  if (b.c > (config.max || 8)) {
    console.warn("RATE_LIMIT", { ip, keyPrefix, count: b.c, windowMs: win });
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Rate limit exceeded" }));
    return true;
  }
  return false;
}

function logStart(tag, extra = {}) {
  console.log(`${tag}: start`, JSON.stringify({
    region: process.env.VERCEL_REGION,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    ...extra
  }));
}

function logOk(tag, extra = {}) {
  console.log(`${tag}: ok`, JSON.stringify(extra));
}

function logWarn(tag, extra = {}) {
  console.warn(`${tag}: warn`, JSON.stringify(extra));
}

function logErr(tag, extra = {}) {
  console.error(`${tag}: error`, JSON.stringify(extra));
}

module.exports = {
  setCors, 
  preflight, 
  rateLimit,
  logStart, 
  logOk, 
  logWarn, 
  logErr
};
