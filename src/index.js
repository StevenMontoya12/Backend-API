import "dotenv/config";
import express from "express";
import cors from "cors";
import alumnosRouter from "./routes/alumnos.js";
import { firestore } from "./firebase.js"; // 👈 importa Firestore

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.json({ ok: true, message: "API Colegio" }));

// 👇 Ruta de prueba: escribe un doc en Firestore
app.get("/db-test", async (_req, res) => {
  console.log("[/db-test] hit", new Date().toISOString()); // 👈 LOG
  try {
    await firestore.collection("test").doc("server").set({ ok: true, at: new Date() });
    res.json({ ok: true });
  } catch (e) {
    console.error("[/db-test] error:", e); // 👈 LOG
    res.status(500).json({ ok: false, error: String(e) });
  }
});


app.use("/api/alumnos", alumnosRouter);

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`🚀 API on :${PORT}`));
