// web/api/tts.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  setCors(res, req.headers.origin);
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  if (rateLimit(req, res, "tts")) return;

  const meta = {
    route: "/api/tts",
    method: req.method,
    ip,
    ua: req.headers["user-agent"],
  };

  try {
    if (req.method !== "POST") {
      logWarn("TTS", { ...meta, reason: "method_not_allowed" });
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Parse JSON body safely
    let body = "";
    for await (const chunk of req) body += chunk;
    let text = "Hello from Solmate.", voice = "verse", format = "mp3";
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
          // Limit text length for abuse prevention (e.g., 500 chars)
          text = parsed.text.slice(0, 500);
        }
        if (typeof parsed.voice === "string") voice = parsed.voice;
        if (typeof parsed.format === "string") format = parsed.format;
      } catch (e) {
        logWarn("TTS", { ...meta, reason: "invalid_json", excerpt: body.slice(0, 400) });
        return res.status(400).json({ error: "Invalid JSON" });
      }
    }

    logStart("TTS", { ...meta, textLen: text.length, voice, format });

    // If no key, immediately signal browser fallback
    if (!process.env.OPENAI_API_KEY) {
      logWarn("TTS", { ...meta, reason: "missing_api_key_fallback_browser" });
      res.statusCode = 204; // No Content, use header to signal fallback
      res.setHeader("X-Solmate-TTS-Fallback", "browser");
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    // Call OpenAI TTS
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, format })
    });

    if (!upstream.ok) {
      const status = upstream.status;
      const errTxt = await upstream.text().catch(() => "");
      logErr("TTS", { ...meta, status, excerpt: errTxt.slice(0, 400) });

      // For auth/quota/other failures -> tell client to fall back to browser TTS
      res.statusCode = 204; // No Content
      res.setHeader("X-Solmate-TTS-Fallback", "browser");
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    // Stream bytes to the client (success)
    res.statusCode = 200;
    res.setHeader("Content-Type", format === "wav" ? "audio/wav" : "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    // Node.js 18+ may have .pipe, or a web stream (.getReader)
    if (upstream.body && typeof upstream.body.pipe === "function") {
      // Node.js readable stream
      upstream.body.pipe(res);
      upstream.body.on("end", () => {
        logOk("TTS", { ...meta, status: 200 });
      });
      upstream.body.on("error", (err) => {
        logErr("TTS", { ...meta, stream_error: String(err) });
        // fallback on stream error
        if (!res.headersSent) {
          res.statusCode = 204;
          res.setHeader("X-Solmate-TTS-Fallback", "browser");
          res.setHeader("Cache-Control", "no-store");
          res.end();
        }
      });
    } else if (upstream.body && upstream.body.getReader) {
      // Web stream (Deno, Cloudflare Workers, etc)
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
        logOk("TTS", { ...meta, status: 200 });
      } catch (err) {
        logErr("TTS", { ...meta, stream_error: String(err) });
        if (!res.headersSent) {
          res.statusCode = 204;
          res.setHeader("X-Solmate-TTS-Fallback", "browser");
          res.setHeader("Cache-Control", "no-store");
          res.end();
        }
      }
    } else {
      // Fallback: no body to stream
      logErr("TTS", { ...meta, reason: "no_stream" });
      res.statusCode = 204;
      res.setHeader("X-Solmate-TTS-Fallback", "browser");
      res.setHeader("Cache-Control", "no-store");
      res.end();
    }
  } catch (e) {
    logErr("TTS", { ...meta, error: String(e?.message || e) });
    // On unexpected errors, still cue browser fallback so the app keeps speaking
    res.statusCode = 204;
    res.setHeader("X-Solmate-TTS-Fallback", "browser");
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }
};
