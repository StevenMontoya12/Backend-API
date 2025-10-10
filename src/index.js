// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import alumnosRouter from "./routes/alumnos.js";
import { firestore } from "./firebase.js";

const app = express();

/* ===== CORS =====
 * Opción A: abierto (desarrollo/local)
 */
app.use(cors());

/* // Opción B: whitelist (prod)
const whitelist = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4000",
  "https://tu-frontend.prod.com"
];
app.use(
  cors({
    origin(origin, cb) {
      // permite herramientas como curl / Postman sin origin
      if (!origin || whitelist.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
*/

/* ===== Body parsers =====
 * JSON global (10–20MB por si importas JSON grande)
 */
app.use(express.json({ limit: "20mb" }));

/* CSV SOLO para la ruta de import (evita interferir con otros endpoints)
 * Importante: este middleware debe ir ANTES de montar el router y scopeado a la ruta exacta.
 */
app.use("/api/alumnos/import", express.text({ type: "text/csv", limit: "50mb" }));

/* ===== Healthcheck ===== */
app.get("/", (_req, res) => res.json({ ok: true, message: "API Colegio" }));

/* ===== Ruta de prueba Firestore ===== */
app.get("/db-test", async (_req, res) => {
  try {
    await firestore.collection("test").doc("server").set({ ok: true, at: new Date() });
    res.json({ ok: true });
  } catch (e) {
    console.error("[/db-test] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ===== Rutas ===== */
app.use("/api/alumnos", alumnosRouter);

/* ===== 404 y manejo de errores ===== */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found" });
});

app.use((err, _req, res, _next) => {
  console.error("[UNCAUGHT ERROR]", err);
  res.status(500).json({ ok: false, error: String(err?.message || err) });
});

/* ===== Server ===== */
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`🚀 API on :${PORT}`));
