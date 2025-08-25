// web/api/tps.js
const { setCors, preflight, rateLimit, logStart, logOk, logWarn, logErr } = require("./_utils.js");

// Constants
const CACHE_DURATION = 10; // Cache for 10 seconds
const DEFAULT_TPS = null; // Return null if unable to fetch

// Get RPC URL from environment
function getRPCUrl() {
    const url = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    
    if (!url) {
        return null;
    }
    
    // Ensure it's a valid URL
    try {
        new URL(url);
        return url;
    } catch {
        return null;
    }
}

module.exports = async (req, res) => {
    // Handle preflight
    if (preflight(req, res)) return;
    
    // Set CORS
    setCors(res, req.headers.origin);
    
    // Rate limiting for TPS endpoint
    const rateLimitConfig = { max: 30, windowMs: 60000 }; // 30 requests per minute
    if (rateLimit(req, res, "tps", rateLimitConfig)) return;
    
    const meta = {
        route: "/api/tps",
        method: req.method,
        ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
        region: process.env.VERCEL_REGION
    };
    
    try {
        // Only allow GET requests
        if (req.method !== "GET") {
            logWarn("TPS", { ...meta, reason: "method_not_allowed" });
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        
        logStart("TPS", meta);
        
        // Get RPC URL
        const rpcUrl = getRPCUrl();
        if (!rpcUrl) {
            logWarn("TPS", { ...meta, reason: "no_rpc_url" });
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            return res.end(JSON.stringify({ 
                error: "TPS service not configured",
                tps: DEFAULT_TPS 
            }));
        }
        
        // Prepare RPC request
        const rpcRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "getRecentPerformanceSamples",
            params: [1] // Get 1 sample (most recent)
        };
        
        // Make RPC request with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        let rpcResponse;
        try {
            rpcResponse = await fetch(rpcUrl, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(rpcRequest),
                signal: controller.signal
            });
        } catch (e) {
            clearTimeout(timeout);
            
            if (e.name === 'AbortError') {
                logErr("TPS", { ...meta, reason: "timeout" });
                res.statusCode = 504;
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                return res.end(JSON.stringify({ 
                    error: "Request timeout",
                    tps: DEFAULT_TPS 
                }));
            }
            
            throw e;
        }
        
        clearTimeout(timeout);
        
        // Parse response
        let rpcData;
        try {
            const responseText = await rpcResponse.text();
            rpcData = JSON.parse(responseText);
        } catch (e) {
            logErr("TPS", { ...meta, reason: "invalid_json_response" });
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            return res.end(JSON.stringify({ 
                error: "Invalid response from RPC",
                tps: DEFAULT_TPS 
            }));
        }
        
        // Check for RPC errors
        if (rpcData.error) {
            logErr("TPS", { 
                ...meta, 
                reason: "rpc_error", 
                error: rpcData.error.message || rpcData.error 
            });
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            return res.end(JSON.stringify({ 
                error: "RPC error",
                tps: DEFAULT_TPS 
            }));
        }
        
        // Calculate TPS from performance sample
        let tps = DEFAULT_TPS;
        
        if (rpcData.result && Array.isArray(rpcData.result) && rpcData.result.length > 0) {
            const sample = rpcData.result[0];
            
            if (sample && sample.numTransactions && sample.samplePeriodSecs) {
                // Calculate TPS: transactions / seconds
                tps = Math.round(sample.numTransactions / sample.samplePeriodSecs);
                
                // Sanity check - TPS should be reasonable (between 0 and 100,000)
                if (tps < 0 || tps > 100000) {
                    logWarn("TPS", { 
                        ...meta, 
                        reason: "unreasonable_tps", 
                        calculatedTps: tps 
                    });
                    tps = DEFAULT_TPS;
                }
            }
        }
        
        // Prepare response
        const response = {
            tps,
            timestamp: new Date().toISOString(),
            network: process.env.SOLANA_NETWORK || "mainnet-beta"
        };
        
        // Add raw data in development mode
        if (process.env.NODE_ENV === "development") {
            response.raw = rpcData.result;
        }
        
        logOk("TPS", { 
            ...meta, 
            status: rpcResponse.status,
            tps
        });
        
        // Send response with caching
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", `public, max-age=${CACHE_DURATION}, s-maxage=${CACHE_DURATION}`);
        res.setHeader("X-TPS-Source", "solana-rpc");
        
        return res.end(JSON.stringify(response));
        
    } catch (error) {
        logErr("TPS", { 
            ...meta, 
            error: String(error?.message || error),
            stack: error?.stack
        });
        
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify({ 
            error: "An unexpected error occurred",
            tps: DEFAULT_TPS
        }));
    }
};
