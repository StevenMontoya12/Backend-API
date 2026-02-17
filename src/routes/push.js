// src/routes/push.js
import { Router } from "express";
import admin, { firestore } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPushToAlumno } from "../services/pushService.js";

const router = Router();

function asStr(v, def = "") {
  return typeof v === "string" ? v : def;
}

/**
 * POST /api/push/register
 * body: { token: string, platform?: string, deviceId?: string, alumnoMatricula?: string }
 */
router.post("/register", requireAuth, async (req, res) => {
  try {
    const {
      token,
      platform = "unknown",
      deviceId = "default",
      alumnoMatricula: alumnoMatriculaBody,
    } = req.body || {};

    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, error: "token requerido" });
    }

    const role = req.user?.role || "unknown";
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(400).json({ ok: false, error: "userId inválido" });
    }

    const alumnoMatricula =
      role === "padre"
        ? String(alumnoMatriculaBody || userId)
        : null;

    const docId = `${role}:${userId}:${deviceId}`;
    const ref = firestore.collection("pushTokens").doc(docId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(
      {
        role,
        userId: String(userId),
        alumnoMatricula,
        token,
        platform,
        deviceId,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/push/register] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * POST /api/push/test
 * body: { alumnoMatricula?: string, title?: string, body?: string }
 */
router.post("/test", requireAuth, async (req, res) => {
  try {
    const alumnoMatricula = String(req.body?.alumnoMatricula || req.user?.sub || "");
    if (!alumnoMatricula) {
      return res.status(400).json({ ok: false, error: "alumnoMatricula requerido" });
    }

    const title = asStr(req.body?.title, "Prueba Coventry");
    const body = asStr(req.body?.body, "Si ves esto, ya llegan push ✅");

    const result = await sendPushToAlumno(alumnoMatricula, {
      title,
      body,
      data: { kind: "test", alumnoMatricula },
    });

    res.json({ ok: true, result });
  } catch (e) {
    console.error("[POST /api/push/test] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
