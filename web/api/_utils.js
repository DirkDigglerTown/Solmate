// web/api/_utils.js
module.exports = {
  setCors: (res, origin) => {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  },
  
  preflight: (req, res) => {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.statusCode = 204;
      res.end();
      return true;
    }
    return false;
  },
  
  rateLimit: () => false, // Disable for now to test
  
  logStart: (tag, data) => console.log(tag, "start", data),
  logOk: (tag, data) => console.log(tag, "ok", data),
  logWarn: (tag, data) => console.warn(tag, "warn", data),
  logErr: (tag, data) => console.error(tag, "error", data)
};
