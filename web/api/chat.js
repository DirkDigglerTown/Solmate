// web/api/chat.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Constants
const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH) || 500;
const MAX_MESSAGES = parseInt(process.env.MAX_CONVERSATION_SIZE) || 50;
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 700;
const TEMPERATURE = parseFloat(process.env.CHAT_TEMPERATURE) || 0.6;

// Input validation
function validateMessages(messages) {
    if (!Array.isArray(messages)) {
        return { valid: false, error: "Messages must be an array" };
    }
    
    if (messages.length === 0) {
        return { valid: false, error: "Messages array cannot be empty" };
    }
    
    if (messages.length > MAX_MESSAGES) {
        return { valid: false, error: `Maximum ${MAX_MESSAGES} messages allowed` };
    }
    
    for (const msg of messages) {
        if (!msg.role || !msg.content) {
            return { valid: false, error: "Each message must have role and content" };
        }
        
        if (typeof msg.content !== 'string') {
            return { valid: false, error: "Message content must be a string" };
        }
        
        if (msg.content.length > MAX_MESSAGE_LENGTH) {
            return { valid: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` };
        }
        
        if (!['system', 'user', 'assistant'].includes(msg.role)) {
            return { valid: false, error: "Invalid message role" };
        }
    }
    
    return { valid: true };
}

// Sanitize content to prevent injection
function sanitizeContent(content) {
    // Remove any potential prompt injection attempts
    return content
        .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
        .replace(/[^\x20-\x7E\n\r\t]/g, '') // Remove non-printable characters
        .trim()
        .substring(0, MAX_MESSAGE_LENGTH);
}

// Read request body
async function readJsonBody(req) {
    if (req.body && typeof req.body === "object") return req.body;
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { 
        return raw ? JSON.parse(raw) : {}; 
    } catch { 
        return {}; 
    }
}

module.exports = async (req, res) => {
    // Handle preflight
    if (preflight(req, res)) return;
    
    // Set CORS
    setCors(res, req.headers.origin);
    
    // Rate limiting - stricter for chat endpoint
    const rateLimitConfig = { max: 10, windowMs: 60000 }; // 10 requests per minute
    if (rateLimit(req, res, "chat", rateLimitConfig)) return;
    
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const meta = {
        route: "/api/chat",
        method: req.method,
        ip,
        ua: req.headers["user-agent"],
        region: process.env.VERCEL_REGION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    };
    
    try {
        // Method validation
        if (req.method !== "POST") {
            logWarn("CHAT", { ...meta, reason: "method_not_allowed" });
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        
        // Check API key
        if (!process.env.OPENAI_API_KEY) {
            logErr("CHAT", { ...meta, reason: "missing_api_key" });
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Chat service temporarily unavailable" }));
        }
        
        logStart("CHAT", meta);
        
        // Parse and validate body
        const body = await readJsonBody(req);
        const { messages, temperature = TEMPERATURE, max_tokens = MAX_TOKENS, model } = body || {};
        
        // Validate messages
        const validation = validateMessages(messages);
        if (!validation.valid) {
            logWarn("CHAT", { ...meta, reason: "validation_failed", error: validation.error });
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: validation.error }));
        }
        
        // Sanitize all message content
        const sanitizedMessages = messages.map(msg => ({
            role: msg.role,
            content: sanitizeContent(msg.content)
        }));
        
        // Prepare models with fallback
        const primaryModel = model || process.env.OPENAI_MODEL || "gpt-4o-mini";
        const fallbackModel = "gpt-3.5-turbo";
        
        // OpenAI API call function
        async function callOpenAI(useModel, messages) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            
            try {
                const response = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: useModel,
                        temperature: Math.min(Math.max(temperature, 0), 2), // Clamp temperature
                        max_tokens: Math.min(max_tokens, 2000), // Cap max tokens
                        messages: messages,
                        user: ip.substring(0, 8) // Anonymous user identifier for abuse detection
                    }),
                    signal: controller.signal,
                });
                
                clearTimeout(timeout);
                return response;
            } catch (e) {
                clearTimeout(timeout);
                throw e;
            }
        }
        
        // Try primary model
        let upstream = await callOpenAI(primaryModel, sanitizedMessages);
        let responseText = await upstream.text();
        
        // Retry with fallback on quota errors
        if (!upstream.ok && upstream.status === 429) {
            logWarn("CHAT", { ...meta, reason: "quota_exceeded", retryingWith: fallbackModel });
            upstream = await callOpenAI(fallbackModel, sanitizedMessages);
            responseText = await upstream.text();
        }
        
        // Handle errors
        if (!upstream.ok) {
            let errorData;
            try { 
                errorData = JSON.parse(responseText); 
            } catch {
                errorData = { error: "upstream_error", detail: responseText.substring(0, 200) };
            }
            
            logErr("CHAT", { 
                ...meta, 
                status: upstream.status, 
                error: errorData.error?.message || errorData.error || "Unknown error"
            });
            
            res.statusCode = upstream.status === 429 ? 503 : upstream.status;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            
            // Don't expose internal errors to client
            const clientError = upstream.status === 429 
                ? "Service temporarily unavailable due to high demand"
                : "An error occurred processing your request";
            
            return res.end(JSON.stringify({ error: clientError }));
        }
        
        // Parse successful response
        let data;
        try { 
            data = JSON.parse(responseText); 
        } catch { 
            data = {}; 
        }
        
        const content = data?.choices?.[0]?.message?.content ?? "";
        const usage = data?.usage || null;
        const modelUsed = data?.model || primaryModel;
        
        // Validate response content
        if (!content || content.trim().length === 0) {
            logErr("CHAT", { ...meta, reason: "empty_response" });
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Failed to generate response" }));
        }
        
        // Sanitize response
        const sanitizedResponse = content
            .substring(0, 1000) // Limit response length
            .replace(/[^\x20-\x7E\n\r\t]/g, ''); // Remove non-printable characters
        
        logOk("CHAT", { 
            ...meta, 
            status: upstream.status, 
            usage, 
            modelUsed, 
            contentLen: sanitizedResponse.length 
        });
        
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify({ 
            content: sanitizedResponse, 
            usage, 
            model: modelUsed 
        }));
        
    } catch (error) {
        logErr("CHAT", { 
            ...meta, 
            error: String(error?.message || error),
            stack: error?.stack
        });
        
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify({ 
            error: "An unexpected error occurred" 
        }));
    }
};
