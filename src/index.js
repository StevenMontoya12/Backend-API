// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import os from "os";

import alumnosRouter from "./routes/alumnos.js";
import gruposRouter from "./routes/grupos.js";
import colaboradoresRouter from "./routes/colaboradores.js";
import curriculoRouter from "./routes/curriculo.js";
import authRouter from "./routes/auth.js";
import reportesRouter from "./routes/reportes.js";
import pushRouter from "./routes/push.js";
import qrRouter from "./routes/qr.js";
import oficiosRouter from "./routes/oficios.js";
import calendarioRouter from "./routes/calendario.js";

import { firestore } from "./firebase.js";

const app = express();

console.log("[BOOT] starting API…");

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/api/alumnos/import", express.text({ type: "text/csv", limit: "50mb" }));

app.get("/", (_req, res) => res.json({ ok: true, message: "API Colegio" }));

app.get("/__whoami", (_req, res) => {
  res.json({
    ok: true,
    cwd: process.cwd(),
    now: new Date().toISOString(),
    message: "running src/index.js",
  });
});

app.get("/db-test", async (_req, res) => {
  try {
    await firestore.collection("test").doc("server").set({ ok: true, at: new Date() });
    res.json({ ok: true });
  } catch (e) {
    console.error("[/db-test] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

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

console.log("[BOOT] mounting /api/reportes");
app.use("/api/reportes", reportesRouter);

console.log("[BOOT] mounting /api/push");
app.use("/api/push", pushRouter);

console.log("[BOOT] mounting /api/qr");
app.use("/api/qr", qrRouter);

console.log("[BOOT] mounting /api/oficios");
app.use("/api/oficios", oficiosRouter);

console.log("[BOOT] mounting /api/calendario");
app.use("/api/calendario", calendarioRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

app.use((err, _req, res, _next) => {
  console.error("[UNCAUGHT ERROR]", err);
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});

const PORT = Number(process.env.PORT || 4000);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 API disponible en:`);
  console.log(`→ Local:   http://localhost:${PORT}`);
  console.log(`→ Red LAN: http://${getLocalIP()}:${PORT}`);
});

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "unknown";
}