// web/api/test.js
// Simple test endpoint with no dependencies to verify environment

module.exports = (req, res) => {
  // Set CORS headers manually
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  
  try {
    // Test response
    const response = {
      ok: true,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.url,
      environment: {
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasHelius: !!process.env.HELIUS_RPC_URL,
        nodeVersion: process.version,
        vercelEnv: process.env.VERCEL_ENV || "unknown",
        region: process.env.VERCEL_REGION || "unknown"
      },
      envVarNames: Object.keys(process.env).filter(key => 
        key.includes("OPENAI") || 
        key.includes("HELIUS") || 
        key.includes("SOLANA") ||
        key.includes("MAX_") ||
        key.includes("CHAT_") ||
        key.includes("TPS_") ||
        key.includes("PRICE_")
      )
    };
    
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(response, null, 2));
    
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ 
      ok: false, 
      error: error.message || "Unknown error",
      stack: error.stack
    }));
  }
};
