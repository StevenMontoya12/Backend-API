// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import alumnosRouter from "./routes/alumnos.js";
import gruposRouter from "./routes/grupos.js"; // 👈 Asegúrate que este path y el nombre del archivo coinciden exacto (minúsculas)

import { firestore } from "./firebase.js";

const app = express();

// Log de arranque
console.log("[BOOT] starting API…");

// CORS
app.use(cors());

// Parsers
app.use(express.json({ limit: "20mb" }));
app.use("/api/alumnos/import", express.text({ type: "text/csv", limit: "50mb" }));

// Healthchecks
app.get("/", (_req, res) => res.json({ ok: true, message: "API Colegio" }));

// Ruta debug para saber qué build corre
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
    await firestore.collection("test").doc("server").set({ ok: true, at: new Date() });
    res.json({ ok: true });
  } catch (e) {
    console.error("[/db-test] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===== Rutas =====
console.log("[BOOT] mounting /api/alumnos");
app.use("/api/alumnos", alumnosRouter);

console.log("[BOOT] mounting /api/grupos");
app.use("/api/grupos", gruposRouter); // 👈 aquí se monta

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("[UNCAUGHT ERROR]", err);
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});

// Server
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`🚀 API on :${PORT}`));
