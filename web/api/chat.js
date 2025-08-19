// web/api/chat.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  setCors(res, req.headers.origin);
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  if (rateLimit(req, res, "chat")) return;

  const meta = {
    route: "/api/chat",
    method: req.method,
    ip,
    ua: req.headers["user-agent"],
    region: process.env.VERCEL_REGION,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  };

  try {
    if (req.method !== "POST") {
      logWarn("CHAT", { ...meta, reason: "method_not_allowed" });
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!process.env.OPENAI_API_KEY) {
      logErr("CHAT", { ...meta, reason: "missing_api_key" });
      return res.status(500).json({ error: "OPENAI_API_KEY not set" });
    }

    const body = await readJsonBody(req);
    const {
      messages,
      temperature = 0.6,
      max_tokens = 700,
      model,
    } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      logWarn("CHAT", { ...meta, reason: "messages_missing" });
      return res.status(400).json({ error: "messages[] required" });
    }

    // Preferred + fallback model (helps when primary hits 429/quota)
    const primaryModel  = model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const fallbackModel = "gpt-3.5-turbo";

    async function callOpenAI(useModel) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: useModel,
            temperature,
            max_tokens,
            messages,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        return r;
      } catch (e) {
        clearTimeout(t);
        throw e;
      }
    }

    logStart("CHAT", { ...meta, messagesCount: messages.length, primaryModel });

    let upstream = await callOpenAI(primaryModel);
    let textBackup = await upstream.clone().text().catch(() => "");

    // Auto‑retry on quota (429) with fallback model
    if (!upstream.ok && upstream.status === 429) {
      logWarn("CHAT", { ...meta, reason: "quota_exceeded", retryingWith: fallbackModel });
      upstream = await callOpenAI(fallbackModel);
      textBackup = await upstream.clone().text().catch(() => "");
    }

    if (!upstream.ok) {
      let errJson;
      try { errJson = JSON.parse(textBackup); } catch {}
      logErr("CHAT", { ...meta, status: upstream.status, excerpt: textBackup?.slice?.(0, 400) });
      res.setHeader("Cache-Control", "no-store");
      return res
        .status(upstream.status)
        .json(errJson || { error: "upstream_error", detail: textBackup });
    }

    let data;
    try { data = JSON.parse(textBackup); } catch { data = await upstream.json().catch(() => ({})); }

    const content   = data?.choices?.[0]?.message?.content ?? "";
    const usage     = data?.usage || null;
    const modelUsed = data?.model || primaryModel;

    logOk("CHAT", { ...meta, status: upstream.status, usage, modelUsed, contentLen: content.length });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ content, usage, model: modelUsed });
  } catch (e) {
    logErr("CHAT", { ...meta, error: String(e?.message || e) });
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
