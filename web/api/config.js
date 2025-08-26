// web/api/config.js
// Serves public configuration to the client without exposing sensitive keys

const { setCors, preflight, rateLimit, logStart, logOk, logErr } = require("./_utils.js");

module.exports = async (req, res) => {
    // Handle preflight requests
    if (preflight(req, res)) return;
    
    // Set CORS headers
    setCors(res, req.headers.origin);
    
    // Apply rate limiting (more generous for config endpoint)
    if (rateLimit(req, res, "config", { max: 20, windowMs: 60000 })) return;
    
    const meta = {
        route: "/api/config",
        method: req.method,
        ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
        ua: req.headers["user-agent"],
        region: process.env.VERCEL_REGION,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
    };
    
    try {
        logStart("CONFIG", meta);
        
        // Only allow GET requests
        if (req.method !== "GET") {
            logErr("CONFIG", { ...meta, reason: "method_not_allowed" });
            res.setHeader("Content-Type", "application/json");
            res.statusCode = 405;
            return res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        
        // Build WebSocket URL from environment variable
        let wsUrl = null;
        if (process.env.HELIUS_RPC_URL) {
            // Extract API key from RPC URL and convert to WebSocket URL
            const match = process.env.HELIUS_RPC_URL.match(/api-key=([^&]+)/);
            if (match && match[1]) {
                wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${match[1]}`;
            }
        }
        
        // Public configuration object
        const config = {
            // WebSocket configuration (only if available)
            wsUrl: wsUrl || null,
            
            // API endpoints (relative URLs only)
            apiEndpoints: {
                chat: "/api/chat",
                tts: "/api/tts",
                price: "/api/price",
                tps: "/api/tps",
                health: "/api/health",
                config: "/api/config"
            },
            
            // Client-side limits
            maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH) || 500,
            maxConversationSize: parseInt(process.env.MAX_CONVERSATION_SIZE) || 50,
            maxAudioQueueSize: parseInt(process.env.MAX_AUDIO_QUEUE_SIZE) || 10,
            
            // Update intervals (in milliseconds)
            priceUpdateInterval: parseInt(process.env.PRICE_UPDATE_INTERVAL) || 30000,
            tpsUpdateInterval: parseInt(process.env.TPS_UPDATE_INTERVAL) || 60000,
            
            // Feature flags
            features: {
                enableWebSocket: !!wsUrl,
                enableVoiceChat: !!process.env.OPENAI_API_KEY,
                enablePriceTracking: true,
                enableDebugMode: process.env.NODE_ENV === "development",
                enableAnalytics: process.env.ENABLE_ANALYTICS === "true"
            },
            
            // Model configuration (without exposing API keys)
            models: {
                chat: process.env.OPENAI_MODEL || "gpt-4o-mini",
                tts: {
                    model: "gpt-4o-mini-tts",
                    voices: ["verse", "alloy", "aria", "echo", "fable", "onyx", "nova", "shimmer"],
                    defaultVoice: "nova"
                }
            },
            
            // VRM configuration
            vrm: {
                paths: [
                    "/assets/avatar/solmate.vrm",
                    "https://raw.githubusercontent.com/DirkDigglerTown/solmate/main/web/assets/avatar/solmate.vrm"
                ],
                fallbackEnabled: true,
                animationsEnabled: true
            },
            
            // Solana configuration
            solana: {
                network: process.env.SOLANA_NETWORK || "mainnet-beta",
                explorerUrl: "https://solscan.io",
                solMintAddress: "So11111111111111111111111111111111111111112"
            },
            
            // UI configuration
            ui: {
                theme: "dark",
                language: "en",
                showDebugInfo: process.env.NODE_ENV === "development",
                animationSpeed: 1.0
            },
            
            // System prompt for chat
            systemPrompt: `You are Solmate, a helpful and witty Solana Companion. Be helpful and add humor when appropriate. Focus on Solana, crypto, DeFi, NFTs, and web3 topics, but answer any question. Keep responses concise and engaging. Always remind users: Not financial advice.`,
            
            // Version information
            version: {
                app: process.env.npm_package_version || "2.0.0",
                api: "1.0.0",
                commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown",
                deployedAt: process.env.VERCEL_ENV || "development"
            }
        };
        
        // Add development-only configuration
        if (process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview") {
            config.debug = {
                environment: process.env.VERCEL_ENV || "local",
                region: process.env.VERCEL_REGION || "unknown",
                hasOpenAI: !!process.env.OPENAI_API_KEY,
                hasHelius: !!process.env.HELIUS_RPC_URL,
                nodeVersion: process.version
            };
        }
        
        // Set appropriate cache headers
        const cacheTime = process.env.NODE_ENV === "production" ? 300 : 0; // 5 minutes in production, no cache in dev
        res.setHeader("Cache-Control", `public, max-age=${cacheTime}`);
        res.setHeader("Content-Type", "application/json");
        
        logOk("CONFIG", { 
            ...meta, 
            status: 200,
            features: config.features,
            version: config.version
        });
        
        res.statusCode = 200;
        return res.end(JSON.stringify(config, null, 2));
        
    } catch (error) {
        logErr("CONFIG", { 
            ...meta, 
            error: String(error?.message || error),
            stack: error?.stack
        });
        
        // Return minimal config on error
        const fallbackConfig = {
            apiEndpoints: {
                chat: "/api/chat",
                tts: "/api/tts",
                price: "/api/price",
                tps: "/api/tps",
                health: "/api/health"
            },
            maxMessageLength: 500,
            maxConversationSize: 50,
            features: {
                enableWebSocket: false,
                enableVoiceChat: false,
                enablePriceTracking: true
            },
            error: "Configuration partially loaded"
        };
        
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.statusCode = 500;
        return res.end(JSON.stringify(fallbackConfig));
    }
};
