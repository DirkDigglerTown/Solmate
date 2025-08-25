// web/api/tts.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Constants
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TTS_LENGTH) || 500;
const ALLOWED_VOICES = ["verse", "alloy", "aria", "echo", "fable", "onyx", "nova", "shimmer"];
const ALLOWED_FORMATS = ["mp3", "opus", "aac", "flac"];
const DEFAULT_VOICE = "nova";
const DEFAULT_FORMAT = "mp3";

// Validate and sanitize input
function validateInput(text, voice, format) {
    const errors = [];
    
    // Validate text
    if (!text || typeof text !== "string") {
        errors.push("Text is required and must be a string");
    } else if (text.length > MAX_TEXT_LENGTH) {
        errors.push(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
    } else if (text.trim().length === 0) {
        errors.push("Text cannot be empty");
    }
    
    // Validate voice
    if (voice && !ALLOWED_VOICES.includes(voice)) {
        errors.push(`Invalid voice. Allowed: ${ALLOWED_VOICES.join(", ")}`);
    }
    
    // Validate format
    if (format && !ALLOWED_FORMATS.includes(format)) {
        errors.push(`Invalid format. Allowed: ${ALLOWED_FORMATS.join(", ")}`);
    }
    
    return {
        valid: errors.length === 0,
        errors,
        sanitized: {
            text: text ? text.trim().substring(0, MAX_TEXT_LENGTH) : "",
            voice: ALLOWED_VOICES.includes(voice) ? voice : DEFAULT_VOICE,
            format: ALLOWED_FORMATS.includes(format) ? format : DEFAULT_FORMAT
        }
    };
}

module.exports = async (req, res) => {
    // Handle preflight
    if (preflight(req, res)) return;
    
    // Set CORS
    setCors(res, req.headers.origin);
    
    // Rate limiting for TTS
    const rateLimitConfig = { max: 20, windowMs: 60000 }; // 20 requests per minute
    if (rateLimit(req, res, "tts", rateLimitConfig)) return;
    
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const meta = {
        route: "/api/tts",
        method: req.method,
        ip,
        ua: req.headers["user-agent"],
        region: process.env.VERCEL_REGION,
    };
    
    try {
        // Method validation
        if (req.method !== "POST") {
            logWarn("TTS", { ...meta, reason: "method_not_allowed" });
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        
        logStart("TTS", meta);
        
        // Parse body
        let body = "";
        for await (const chunk of req) body += chunk;
        
        let parsedBody = {};
        try {
            parsedBody = body ? JSON.parse(body) : {};
        } catch (e) {
            logWarn("TTS", { ...meta, reason: "invalid_json" });
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
        }
        
        const { text, voice, format } = parsedBody;
        
        // Validate input
        const validation = validateInput(text, voice, format);
        if (!validation.valid) {
            logWarn("TTS", { ...meta, reason: "validation_failed", errors: validation.errors });
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ 
                error: "Validation failed", 
                details: validation.errors 
            }));
        }
        
        const { sanitized } = validation;
        
        // Check if API key exists
        if (!process.env.OPENAI_API_KEY) {
            logWarn("TTS", { ...meta, reason: "missing_api_key_fallback_browser" });
            // Signal client to use browser TTS as fallback
            res.statusCode = 204;
            res.setHeader("X-Solmate-TTS-Fallback", "browser");
            res.setHeader("Cache-Control", "no-store");
            return res.end();
        }
        
        // Make OpenAI TTS request with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000); // 20 second timeout
        
        let upstream;
        try {
            upstream = await fetch("https://api.openai.com/v1/audio/speech", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    model: "gpt-4o-mini-tts", 
                    voice: sanitized.voice, 
                    input: sanitized.text, 
                    format: sanitized.format 
                }),
                signal: controller.signal
            });
        } catch (e) {
            clearTimeout(timeout);
            
            if (e.name === 'AbortError') {
                logErr("TTS", { ...meta, reason: "timeout" });
            } else {
                logErr("TTS", { ...meta, error: e.message });
            }
            
            // Fallback to browser TTS
            res.statusCode = 204;
            res.setHeader("X-Solmate-TTS-Fallback", "browser");
            res.setHeader("Cache-Control", "no-store");
            return res.end();
        }
        
        clearTimeout(timeout);
        
        // Handle OpenAI API errors
        if (!upstream.ok) {
            const status = upstream.status;
            const errorText = await upstream.text().catch(() => "");
            
            logErr("TTS", { 
                ...meta, 
                status, 
                error: errorText.substring(0, 200) 
            });
            
            // For any API error, fallback to browser TTS
            res.statusCode = 204;
            res.setHeader("X-Solmate-TTS-Fallback", "browser");
            res.setHeader("Cache-Control", "no-store");
            return res.end();
        }
        
        // Get content type from upstream
        const contentType = upstream.headers.get("content-type") || "audio/mpeg";
        
        // Stream the audio to client
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "private, max-age=3600"); // Cache for 1 hour
        
        // Stream the response
        try {
            const reader = upstream.body.getReader();
            let totalBytes = 0;
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                totalBytes += value.length;
                
                // Limit response size to prevent abuse (5MB max)
                if (totalBytes > 5 * 1024 * 1024) {
                    logErr("TTS", { ...meta, reason: "response_too_large", bytes: totalBytes });
                    res.end();
                    break;
                }
                
                res.write(Buffer.from(value));
            }
            
            res.end();
            
            logOk("TTS", { 
                ...meta, 
                status: 200, 
                voice: sanitized.voice,
                format: sanitized.format,
                textLen: sanitized.text.length,
                bytes: totalBytes
            });
            
        } catch (streamError) {
            logErr("TTS", { ...meta, stream_error: streamError.message });
            
            if (!res.headersSent) {
                res.statusCode = 204;
                res.setHeader("X-Solmate-TTS-Fallback", "browser");
                res.setHeader("Cache-Control", "no-store");
            }
            res.end();
        }
        
    } catch (error) {
        logErr("TTS", { 
            ...meta, 
            error: String(error?.message || error),
            stack: error?.stack
        });
        
        // On any unexpected error, fallback to browser TTS
        res.statusCode = 204;
        res.setHeader("X-Solmate-TTS-Fallback", "browser");
        res.setHeader("Cache-Control", "no-store");
        return res.end();
    }
};
