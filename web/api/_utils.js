// web/api/_utils.js
// CORS + simple per-IP rate limit + preflight + tiny logger helpers

const RATE = { max: 8, windowMs: 30_000 }; // 8 req / 30s / IP
const buckets = new Map();

// Allow your preview domains + localhost during dev
const ALLOWLIST = new Set([
  "http://localhost:3000",
  "http://localhost:4173",
  "http://127.0.0.1:3000",
  "https://vercel.app",              // generic (fallback)
  // Add your specific preview/production host(s) here if you want to lock it down:
  // "https://solmate-<hash>-dirkdigglertowns-projects.vercel.app",
  // "https://solmate.yourdomain.com",
]);

function nowSec() { return Math.floor(Date.now()/1000); }

function setCors(res, origin) {
  // If you want to strictly enforce, uncomment the allowlist check below.
  // if (origin && ![...ALLOWLIST].some(a => origin.startsWith(a))) origin = undefined;

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function preflight(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res, req.headers.origin);
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function rateLimit(req, res, keyPrefix = "rl") {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();
  const win = RATE.windowMs;

  let b = buckets.get(key);
  if (!b) b = { t: now, c: 0 };
  if (now - b.t > win) { b.t = now; b.c = 0; }
  b.c += 1;
  buckets.set(key, b);

  const remaining = Math.max(0, RATE.max - b.c);
  res.setHeader("X-RateLimit-Limit", String(RATE.max));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((b.t + win) / 1000)));

  if (b.c > RATE.max) {
    console.warn("RATE_LIMIT", { ip, keyPrefix, count: b.c, windowMs: RATE.windowMs });
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Rate limit exceeded" }));
    return true;
  }
  return false;
}

function logStart(tag, extra = {}) {
  console.log(`${tag}: start`, {
    region: process.env.VERCEL_REGION,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    ...extra
  });
}
function logOk(tag, extra = {}) {
  console.log(`${tag}: ok`, extra);
}
function logWarn(tag, extra = {}) {
  console.warn(`${tag}: warn`, extra);
}
function logErr(tag, extra = {}) {
  console.error(`${tag}: error`, extra);
}

module.exports = {
  setCors, preflight, rateLimit,
  logStart, logOk, logWarn, logErr
};
