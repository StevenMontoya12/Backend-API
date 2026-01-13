// src/routes/reportes.js
import { Router } from "express";
import admin, { firestore } from "../firebase.js";

const router = Router();
const col = firestore.collection("reportes");

function asInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function computeEstado(visibleHastaIso) {
  const t = new Date(visibleHastaIso).getTime();
  if (!Number.isFinite(t)) return "activo";
  return t < Date.now() ? "vencido" : "activo";
}

/**
 * GET /api/reportes
 * Query params:
 * - from, to (YYYY-MM-DD) opcional (filtra por fechaEvento)
 * - alumno (matrícula)
 * - tipo, severidad, estado
 * - pageSize (default 50)
 * - cursor (id del último doc)
 */
router.get("/", async (req, res) => {
  try {
    const {
      from = "",
      to = "",
      alumno = "",
      tipo = "",
      severidad = "",
      estado = "",
      pageSize = "50",
      cursor = "",
      // q por ahora no lo usamos en Firestore (luego lo hacemos con índices / search)
    } = req.query;

    let q = col.orderBy("fechaEvento", "desc");

    // filtros exactos (estos sí funcionan directo)
    if (alumno) q = q.where("alumnoMatricula", "==", String(alumno));
    if (tipo) q = q.where("tipo", "==", String(tipo));
    if (severidad) q = q.where("severidad", "==", String(severidad));
    if (estado) q = q.where("estado", "==", String(estado));

    // filtros por rango de fecha (YYYY-MM-DD)
    // convertimos a ISO para comparar por string ISO (recomendado guardar fechaEvento ISO)
    if (from) {
      const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
      q = q.where("fechaEvento", ">=", fromIso);
    }
    if (to) {
      const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
      q = q.where("fechaEvento", "<=", toIso);
    }

    // cursor por id (paginación)
    if (cursor) {
      const snapCursor = await col.doc(String(cursor)).get();
      if (snapCursor.exists) q = q.startAfter(snapCursor);
    }

    const limit = Math.min(200, Math.max(1, asInt(pageSize, 50)));
    const snap = await q.limit(limit).get();

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;

    res.json({ ok: true, items, nextCursor });
  } catch (e) {
    console.error("[GET /api/reportes] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * POST /api/reportes
 */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};

    // validación mínima (lo puedes endurecer)
    if (!b.alumnoMatricula) {
      return res.status(400).json({ ok: false, error: "alumnoMatricula requerido" });
    }
    if (!b.titulo) {
      return res.status(400).json({ ok: false, error: "titulo requerido" });
    }
    if (!b.fechaEvento) {
      return res.status(400).json({ ok: false, error: "fechaEvento requerido (ISO)" });
    }
    if (!b.visibleHasta) {
      return res.status(400).json({ ok: false, error: "visibleHasta requerido (ISO)" });
    }

    const docRef = col.doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const payload = {
      alumnoMatricula: String(b.alumnoMatricula),
      alumnoNombre: b.alumnoNombre ? String(b.alumnoNombre) : "",
      grado: b.grado ? String(b.grado) : "",
      grupo: b.grupo ? String(b.grupo) : "",

      fechaEvento: String(b.fechaEvento),
      visibleHasta: String(b.visibleHasta),

      tipo: String(b.tipo || "otro"),
      severidad: String(b.severidad || "normal"),
      icon: String(b.icon || "bi-journal-text"),

      titulo: String(b.titulo || "").trim(),
      detalle: String(b.detalle || "").trim(),

      accionTomada: b.accionTomada ? String(b.accionTomada) : "",
      seguimiento: b.seguimiento ? String(b.seguimiento) : "",

      visibleParaPadre: Boolean(b.visibleParaPadre),
      notificarPadre: Boolean(b.notificarPadre),

      estado: computeEstado(String(b.visibleHasta)),

      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(payload);

    const saved = await docRef.get();
    res.status(201).json({ ok: true, item: { id: saved.id, ...saved.data() } });
  } catch (e) {
    console.error("[POST /api/reportes] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * PATCH /api/reportes/:id
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body || {};

    const ref = col.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "reporte no existe" });

    const patch = {
      ...b,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // si cambió visibleHasta, recompute estado
    if (typeof b.visibleHasta === "string") {
      patch.estado = computeEstado(b.visibleHasta);
    }

    await ref.update(patch);

    const after = await ref.get();
    res.json({ ok: true, item: { id: after.id, ...after.data() } });
  } catch (e) {
    console.error("[PATCH /api/reportes/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * DELETE /api/reportes/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await col.doc(id).delete();
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/reportes/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
