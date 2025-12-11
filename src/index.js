// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import alumnosRouter from "./routes/alumnos.js";
import gruposRouter from "./routes/grupos.js";
import colaboradoresRouter from "./routes/colaboradores.js";
import curriculoRouter from "./routes/curriculo.js";
import authRouter from "./routes/auth.js";

import { firestore } from "./firebase.js";
import os from "os";

const app = express();

// Log de arranque
console.log("[BOOT] starting API…");

// CORS
app.use(cors());

// Parsers
app.use(express.json({ limit: "20mb" }));
app.use(
  "/api/alumnos/import",
  express.text({ type: "text/csv", limit: "50mb" })
);

// Healthcheck
app.get("/", (_req, res) =>
  res.json({ ok: true, message: "API Colegio" })
);

// Ruta debug
app.get("/__whoami", (_req, res) => {
  res.json({
    ok: true,
    cwd: process.cwd(),
    now: new Date().toISOString(),
    message: "running src/index.js",
  });
});

// Firestore test
app.get("/db-test", async (_req, res) => {
  try {
    await firestore
      .collection("test")
      .doc("server")
      .set({ ok: true, at: new Date() });
    res.json({ ok: true });
  } catch (e) {
    console.error("[/db-test] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===== Rutas (SOLO AQUÍ, una vez) =====
console.log("[BOOT] mounting /api/auth");
app.use("/api/auth", authRouter);

console.log("[BOOT] mounting /api/alumnos");
app.use("/api/alumnos", alumnosRouter);

console.log("[BOOT] mounting /api/grupos");
app.use("/api/grupos", gruposRouter);

console.log("[BOOT] mounting /api/colaboradores");
app.use("/api/colaboradores", colaboradoresRouter);

console.log("[BOOT] mounting /api/curriculo");
app.use("/api/curriculo", curriculoRouter);

// 404 (DESPUÉS de todas las rutas)
app.use((req, res) => {
  res
    .status(404)
    .json({ ok: false, error: "Not Found", path: req.path });
});

// Error handler (al final)
app.use((err, _req, res, _next) => {
  console.error("[UNCAUGHT ERROR]", err);
  res
    .status(500)
    .json({ ok: false, error: String(err?.message || err) });
});

// ===== Server =====
const PORT = Number(process.env.PORT || 4000);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 API disponible en:`);
  console.log(`→ Local:   http://localhost:${PORT}`);
  console.log(`→ Red LAN: http://${getLocalIP()}:${PORT}`);
});

// Función auxiliar para mostrar IP local
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "unknown";
}
