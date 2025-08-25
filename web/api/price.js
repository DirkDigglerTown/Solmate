// web/api/price.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Constants
const JUPITER_API = "https://lite-api.jup.ag/price/v3";
const DEFAULT_TOKEN = "So11111111111111111111111111111111111111112"; // SOL
const MAX_TOKENS = 10; // Maximum number of tokens to query at once
const CACHE_DURATION = 20; // Cache for 20 seconds

// Validate token IDs
function validateTokenIds(ids) {
    if (!ids || typeof ids !== "string") {
        return {
            valid: false,
            error: "Token IDs required",
            sanitized: DEFAULT_TOKEN
        };
    }
    
    // Split and clean token IDs
    const tokenList = ids.split(",")
        .map(id => id.trim())
        .filter(id => id.length > 0)
        .slice(0, MAX_TOKENS); // Limit number of tokens
    
    if (tokenList.length === 0) {
        return {
            valid: false,
            error: "No valid token IDs provided",
            sanitized: DEFAULT_TOKEN
        };
    }
    
    // Basic validation for token addresses (44 characters for Solana addresses)
    const validTokens = tokenList.filter(id => {
        return id.length >= 32 && id.length <= 44 && /^[A-Za-z0-9]+$/.test(id);
    });
    
    if (validTokens.length === 0) {
        return {
            valid: false,
            error: "Invalid token ID format",
            sanitized: DEFAULT_TOKEN
        };
    }
    
    return {
        valid: true,
        sanitized: validTokens.join(",")
    };
}

module.exports = async (req, res) => {
    // Handle preflight
    if (preflight(req, res)) return;
    
    // Set CORS
    setCors(res, req.headers.origin);
    
    // Rate limiting for price endpoint (more lenient as it's called frequently)
    const rateLimitConfig = { max: 60, windowMs: 60000 }; // 60 requests per minute
    if (rateLimit(req, res, "price", rateLimitConfig)) return;
    
    const meta = {
        route: "/api/price",
        method: req.method,
        ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
        ua: req.headers["user-agent"]?.substring(0, 100), // Limit UA length in logs
        region: process.env.VERCEL_REGION
    };
    
    try {
        // Only allow GET requests
        if (req.method !== "GET") {
            logWarn("PRICE", { ...meta, reason: "method_not_allowed" });
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        
        // Parse query parameters
        const url = new URL(req.url, "http://localhost");
        const ids = url.searchParams.get("ids");
        
        // Validate token IDs
        const validation = validateTokenIds(ids);
        if (!validation.valid && ids !== null) {
            logWarn("PRICE", { ...meta, reason: "validation_failed", error: validation.error });
        }
        
        const tokenIds = validation.sanitized;
        
        logStart("PRICE", { ...meta, ids: tokenIds });
        
        // Make request to Jupiter API with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        let jupiterResponse;
        try {
            jupiterResponse = await fetch(`${JUPITER_API}?ids=${encodeURIComponent(tokenIds)}`, {
                headers: { 
                    "Accept": "application/json",
                    "User-Agent": "Solmate/1.0" // Identify our app to Jupiter
                },
                signal: controller.signal
            });
        } catch (e) {
            clearTimeout(timeout);
            
            if (e.name === 'AbortError') {
                logErr("PRICE", { ...meta, reason: "timeout" });
                res.statusCode = 504;
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                return res.end(JSON.stringify({ error: "Request timeout" }));
            }
            
            throw e;
        }
        
        clearTimeout(timeout);
        
        const responseText = await jupiterResponse.text();
        
        // Handle Jupiter API errors
        if (!jupiterResponse.ok) {
            logErr("PRICE", { 
                ...meta, 
                status: jupiterResponse.status, 
                error: responseText.substring(0, 200) 
            });
            
            // Don't expose upstream errors to client
            res.statusCode = jupiterResponse.status === 429 ? 429 : 503;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            
            const errorMessage = jupiterResponse.status === 429 
                ? "Rate limit exceeded. Please try again later."
                : "Price service temporarily unavailable";
            
            return res.end(JSON.stringify({ error: errorMessage }));
        }
        
        // Parse response
        let priceData;
        try {
            priceData = JSON.parse(responseText);
        } catch (e) {
            logErr("PRICE", { ...meta, reason: "invalid_json_response" });
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            return res.end(JSON.stringify({ error: "Invalid response from price service" }));
        }
        
        // Validate response structure
        if (!priceData || typeof priceData !== "object") {
            logErr("PRICE", { ...meta, reason: "invalid_response_structure" });
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            return res.end(JSON.stringify({ error: "Invalid price data" }));
        }
        
        // Transform response to ensure consistent structure
        const response = {};
        for (const [tokenId, data] of Object.entries(priceData)) {
            if (data && typeof data === "object") {
                response[tokenId] = {
                    usdPrice: data.usdPrice || data.price || null,
                    decimals: data.decimals || null,
                    priceChange24h: data.priceChange24h || null
                };
            }
        }
        
        logOk("PRICE", { 
            ...meta, 
            status: jupiterResponse.status,
            tokens: Object.keys(response).length
        });
        
        // Set cache headers
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_DURATION}, s-maxage=${CACHE_DURATION}`);
        res.setHeader("X-Price-Source", "jupiter-v3");
        
        return res.end(JSON.stringify(response));
        
    } catch (error) {
        logErr("PRICE", { 
            ...meta, 
            error: String(error?.message || error),
            stack: error?.stack
        });
        
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify({ 
            error: "An unexpected error occurred",
            fallback: { [DEFAULT_TOKEN]: { usdPrice: null } }
        }));
    }
};
