// web/api/tts.js
// Fixed TTS API with proper validation and fallback handling

const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Constants
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TTS_LENGTH) || 1000;
const ALLOWED_VOICES = ["nova"]; // Single cute female voice
const ALLOWED_FORMATS = ["mp3", "opus", "aac", "flac"];
const DEFAULT_VOICE = "nova";
const DEFAULT_FORMAT = "mp3";

// Validate and sanitize input
function validateInput(text, voice, format) {
    const errors = [];
    
    // Validate text
    if (!text) {
        errors.push("Text is required");
    } else if (typeof text !== "string") {
        errors.push("Text must be a string");
    } else if (text.trim().length === 0) {
        errors.push("Text cannot be empty");
    } else if (text.length > MAX_TEXT_LENGTH) {
        errors.push(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
    }
    
    // Validate voice (always use our single female voice)
    const validVoice = DEFAULT_VOICE;
    
    // Validate format
    const validFormat = ALLOWED_FORMATS.includes(format) ? format : DEFAULT_FORMAT;
    
    return {
        valid: errors.length === 0,
        errors,
        sanitized: {
            text: text ? text.trim().substring(0, MAX_TEXT_LENGTH) : "",
            voice: validVoice,
            format: validFormat
        }
    };
}

module.exports = async (req, res) => {
    // Handle preflight
    if (preflight(req, res)) return;
    
    // Set CORS
    setCors(res, req.headers.origin);
    
    // Rate limiting for TTS
    const rateLimitConfig = { max: 30, windowMs: 60000 }; // 30 requests per minute
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
        
        // Parse body with better error handling
        let body = "";
        try {
            for await (const chunk of req) {
                body += chunk;
            }
        } catch (readError) {
            logWarn("TTS", { ...meta, reason: "body_read_error", error: readError.message });
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Failed to read request body" }));
        }
        
        let parsedBody = {};
        if (body.trim()) {
            try {
                parsedBody = JSON.parse(body);
            } catch (parseError) {
                logWarn("TTS", { ...meta, reason: "invalid_json", error: parseError.message });
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                return res.end(JSON.stringify({ 
                    error: "Invalid JSON in request body",
                    details: "Expected valid JSON with 'text' field"
                }));
            }
        }
        
        const { text, voice, format } = parsedBody;
        
        // Validate input
        const validation = validateInput(text, voice, format);
        if (!validation.valid) {
            logWarn("TTS", { 
                ...meta, 
                reason: "validation_failed", 
                errors: validation.errors,
                receivedText: typeof text,
                textLength: text ? text.length : 0
            });
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ 
                error: "Validation failed", 
                details: validation.errors,
                hint: "Send JSON with 'text' field containing the text to speak"
            }));
        }
        
        const { sanitized } = validation;
        
        // Check if OpenAI API key exists
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
            logWarn("TTS", { ...meta, reason: "missing_api_key_fallback_browser" });
            // Signal client to use browser TTS as fallback
            res.statusCode = 204;
            res.setHeader("X-Solmate-TTS-Fallback", "browser");
            res.setHeader("Cache-Control", "no-store");
            return res.end();
        }
        
        // Make OpenAI TTS request with timeout and better error handling
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        let upstream;
        try {
            upstream = await fetch("https://api.openai.com/v1/audio/speech", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                    "User-Agent": "Solmate/1.0"
                },
                body: JSON.stringify({ 
                    model: "tts-1", // Use the correct TTS model name
                    voice: sanitized.voice, 
                    input: sanitized.text,
                    response_format: sanitized.format
                }),
                signal: controller.signal
            });
        } catch (fetchError) {
            clearTimeout(timeout);
            
            let reason = "fetch_error";
            if (fetchError.name === 'AbortError') {
                reason = "timeout";
            }
            
            logErr("TTS", { 
                ...meta, 
                reason,
                error: fetchError.message,
                textLength: sanitized.text.length
            });
            
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
            let errorText = "";
            
            try {
                errorText = await upstream.text();
            } catch (textError) {
                errorText = "Could not read error response";
            }
            
            logErr("TTS", { 
                ...meta, 
                status, 
                error: errorText.substring(0, 500),
                textLength: sanitized.text.length,
                voice: sanitized.voice
            });
            
            // For any OpenAI API error, fallback to browser TTS
            res.statusCode = 204;
            res.setHeader("X-Solmate-TTS-Fallback", "browser");
            res.setHeader("Cache-Control", "no-store");
            return res.end();
        }
        
        // Get content type from upstream
        const contentType = upstream.headers.get("content-type") || 
                          (sanitized.format === "mp3" ? "audio/mpeg" : 
                           sanitized.format === "opus" ? "audio/ogg" :
                           sanitized.format === "aac" ? "audio/aac" :
                           sanitized.format === "flac" ? "audio/flac" : "audio/mpeg");
        
        // Stream the audio to client with size limits
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "private, max-age=3600"); // Cache for 1 hour
        res.setHeader("X-Solmate-TTS-Success", "openai");
        
        try {
            const reader = upstream.body.getReader();
            let totalBytes = 0;
            const maxBytes = 10 * 1024 * 1024; // 10MB limit
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                totalBytes += value.length;
                
                // Prevent abuse with size limit
                if (totalBytes > maxBytes) {
                    logErr("TTS", { 
                        ...meta, 
                        reason: "response_too_large", 
                        bytes: totalBytes,
                        textLength: sanitized.text.length
                    });
                    res.destroy();
                    return;
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
                bytes: totalBytes,
                source: "openai"
            });
            
        } catch (streamError) {
            logErr("TTS", { 
                ...meta, 
                stream_error: streamError.message,
                textLength: sanitized.text.length
            });
            
            // If streaming fails, fallback
            if (!res.headersSent) {
                res.statusCode = 204;
                res.setHeader("X-Solmate-TTS-Fallback", "browser");
                res.setHeader("Cache-Control", "no-store");
                res.end();
            }
        }
        
    } catch (error) {
        logErr("TTS", { 
            ...meta, 
            error: String(error?.message || error),
            stack: error?.stack?.substring(0, 1000) // Limit stack trace size
        });
        
        // On any unexpected error, fallback to browser TTS
        if (!res.headersSent) {
            res.statusCode = 204;
            res.setHeader("X-Solmate-TTS-Fallback", "browser");
            res.setHeader("Cache-Control", "no-store");
            res.end();
        }
    }
};
