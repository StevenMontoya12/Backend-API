// src/routes/curriculo.js
import { Router } from "express";
import admin from "firebase-admin";
import { firestore } from "../firebase.js";

const router = Router();
const col = firestore.collection("curriculo");

// ─────────────────────────────
// Helpers básicos
// ─────────────────────────────
const clampStr = (s, n = 300) =>
  typeof s === "string"
    ? s.slice(0, n)
    : typeof s === "number"
    ? String(s).slice(0, n)
    : "";

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

function pickAsignatura(body = {}) {
  const out = {};

  // claves de contexto
  out.ciclo = clampStr(body.ciclo);
  out.grupoId = clampStr(body.grupoId);

  // fila tipo área o asignatura
  out.esArea = !!body.esArea;
  out.areaNombre = clampStr(body.areaNombre, 200); // "Por definir 1", "Global", etc.
  out.nombre = clampStr(body.nombre, 200); // "Español", "Inglés", etc.
  out.abreviatura = clampStr(body.abreviatura, 50);

  // profesor
  out.profesorId = clampStr(body.profesorId, 100);
  // compat vieja
  out.profesorNombre = clampStr(body.profesorNombre, 200);
  // nuevo campo
  out.profesor = clampStr(body.profesor, 200);

  // otros campos
  out.objetivos = clampStr(body.objetivos, 2000);

  // número de sesiones (opcional)
  if (body.sesiones !== undefined && body.sesiones !== null) {
    const n = Number(body.sesiones);
    if (Number.isFinite(n)) out.sesiones = n;
  }

  // para orden en la tabla (puedes manipularlo desde el front)
  out.orden = Number.isFinite(Number(body.orden))
    ? Number(body.orden)
    : 0;

  return out;
}

// ─────────────────────────────
// Ping rápido
// ─────────────────────────────
router.get("/__ping", (_req, res) => {
  res.json({ ok: true, router: "curriculo", now: new Date().toISOString() });
});

// ─────────────────────────────
// GET /api/curriculo
// ?ciclo=2024-2025&grupoId=abc&pageSize=100
// ─────────────────────────────
router.get("/", async (req, res) => {
  try {
    const ciclo = String(req.query.ciclo || "").trim();
    const grupoId = String(req.query.grupoId || "").trim();
    const pageSize = Math.min(Number(req.query.pageSize || 100), 200);

    // ciclo sigue siendo obligatorio
    if (!ciclo) {
      return res
        .status(400)
        .json({ ok: false, error: "ciclo es requerido" });
    }

    // si grupoId viene vacío, devolvemos lista vacía sin error
    if (!grupoId) {
      return res.json({ ok: true, items: [] });
    }

    let q = col
      .where("ciclo", "==", ciclo)
      .where("grupoId", "==", grupoId)
      .orderBy("orden", "asc")
      .limit(pageSize);

    const snap = await q.get();
    const items = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        // normalizamos para el front: siempre haya `profesor`
        profesor: data.profesor || data.profesorNombre || "",
      };
    });

    res.json({ ok: true, items });
  } catch (e) {
    console.error("[GET /curriculo] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ─────────────────────────────
// POST /api/curriculo
// body: { ciclo, grupoId, esArea, areaNombre, nombre, ... }
// ─────────────────────────────
router.post("/", async (req, res) => {
  try {
    const raw = pickAsignatura(req.body);
    const data = stripUndefinedDeep(raw);

    if (!data.ciclo || !data.grupoId) {
      return res
        .status(400)
        .json({ ok: false, error: "ciclo y grupoId son requeridos" });
    }

    // Reglas mínimas:
    // - si es área, exigir areaNombre
    // - si NO es área, exigir nombre
    if (data.esArea) {
      if (!data.areaNombre) {
        return res.status(400).json({
          ok: false,
          error: "areaNombre es requerido para esArea=true",
        });
      }
    } else {
      if (!data.nombre) {
        return res.status(400).json({
          ok: false,
          error: "nombre es requerido para asignaturas",
        });
      }
    }

    const now = new Date().toISOString();
    data.createdAt = now;
    data.updatedAt = now;
    data.createdAtTs = admin.firestore.FieldValue.serverTimestamp();
    data.updatedAtTs = admin.firestore.FieldValue.serverTimestamp();

    const ref = await col.add(data);
    res
      .status(201)
      .json({ ok: true, id: ref.id, item: { id: ref.id, ...data } });
  } catch (e) {
    console.error("[POST /curriculo] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ─────────────────────────────
// PATCH /api/curriculo/:id
//  ⚠️ SOLO actualiza campos puntuales (no toca ciclo/grupoId)
// ─────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const ref = col.doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: "No encontrado" });
    }

    const body = req.body || {};
    const data = {};

    // profesor
    if (typeof body.profesor === "string") {
      data.profesor = clampStr(body.profesor, 200);
      data.profesorNombre = data.profesor; // por compat
    }
    if (typeof body.profesorId === "string") {
      data.profesorId = clampStr(body.profesorId, 100);
    }

    // abreviatura
    if (typeof body.abreviatura === "string") {
      data.abreviatura = clampStr(body.abreviatura, 50);
    }
    // objetivos
    if (typeof body.objetivos === "string") {
      data.objetivos = clampStr(body.objetivos, 2000);
    }
    // orden
    if (body.orden !== undefined && body.orden !== null) {
      const n = Number(body.orden);
      if (Number.isFinite(n)) data.orden = n;
    }
    // sesiones
    if (body.sesiones !== undefined && body.sesiones !== null) {
      const n = Number(body.sesiones);
      if (Number.isFinite(n)) data.sesiones = n;
    }

    const cleaned = stripUndefinedDeep(data);
    cleaned.updatedAt = new Date().toISOString();
    cleaned.updatedAtTs = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(cleaned, { merge: true });

    const merged = { id, ...snap.data(), ...cleaned };
    res.json({ ok: true, item: merged });
  } catch (e) {
    console.error("[PATCH /curriculo/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ─────────────────────────────
// DELETE /api/curriculo/:id
// ─────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await col.doc(id).delete();
    res.json({ ok: true, id });
  } catch (e) {
    console.error("[DELETE /curriculo/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
