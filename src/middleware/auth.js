// src/middleware/auth.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.AUTH_JWT_SECRET || "cambia-esto-en-produccion";

export function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ ok: false, error: "missing_token" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    // payload esperado: { sub, email, role, iat, exp }
    req.user = payload;

    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}
