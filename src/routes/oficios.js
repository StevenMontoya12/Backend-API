// src/routes/oficios.js  (v2 — soporta gruposDestinatarios)
import { Router } from "express";
import admin, { firestore } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPushToAlumno } from "../services/pushService.js";

const router = Router();
const COL = firestore.collection("oficios");
const DOC_ID = admin.firestore.FieldPath.documentId();

/* ─── Helpers ─────────────────────────────────────────── */
const normMat = (v) => String(v || "").trim().toUpperCase();
const clamp   = (s, n = 500) => typeof s === "string" ? s.slice(0, n) : String(s || "").slice(0, n);
const asInt   = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function toISOOrNull(v) {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(String(v).trim());
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

function matchQ(item, raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (!q) return true;
  return [item.titulo, item.descripcion, item.folio]
    .some((s) => String(s || "").toLowerCase().includes(q));
}

/* ─── POST /api/oficios ─────────────────────────────────
   Crea un oficio y manda push.
   modoDestinatarios:
     "todos"  → esParaTodos=true, destinatarios=["TODOS"]
     "grupos" → esParaTodos=false, gruposDestinatarios=[...]
               El backend busca alumnos que coincidan y manda push
     "manual" → esParaTodos=false, destinatarios=[mat, mat, ...]
   ─────────────────────────────────────────────────────── */
router.post("/", requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== "colaborador")
      return res.status(403).json({ ok: false, error: "solo_colaboradores" });

    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ ok: false, error: "titulo requerido" });

    const fechaEmisionISO = toISOOrNull(b.fechaEmision || new Date().toISOString());
    if (!fechaEmisionISO) return res.status(400).json({ ok: false, error: "fechaEmision inválida" });

    const now    = admin.firestore.FieldValue.serverTimestamp();
    const nowISO = new Date().toISOString();

    const esParaTodos = Boolean(b.esParaTodos);

    // Destinatarios manuales (matrículas)
    const destinatarios = esParaTodos ? ["TODOS"]
      : Array.isArray(b.destinatarios)
        ? b.destinatarios.map(normMat).filter(Boolean)
        : [];

    // Grupos seleccionados (array de strings "Nivel-Grado-Grupo")
    const gruposDestinatarios = Array.isArray(b.gruposDestinatarios)
      ? b.gruposDestinatarios.map((g) => clamp(String(g), 100))
      : [];

    // Adjuntos
    const adjuntos = Array.isArray(b.adjuntos)
      ? b.adjuntos.map((a) => ({
          nombre: clamp(a.nombre, 200),
          url:    clamp(a.url,    500),
          tipo:   clamp(a.tipo,    50),
          size:   Number(a.size || 0),
        }))
      : [];

    const payload = {
      folio:       clamp(b.folio, 100),
      titulo:      clamp(b.titulo, 300),
      descripcion: clamp(b.descripcion, 3000),
      categoria:   clamp(b.categoria || "general", 100),
      prioridad:   clamp(b.prioridad  || "normal",  50),

      esParaTodos,
      destinatarios,          // ["TODOS"] | [mat…]
      gruposDestinatarios,    // ["Primaria-3-A", "Primaria-3-B", …]

      adjuntos,
      fechaEmision:       fechaEmisionISO,
      fechaVigenciaHasta: b.fechaVigenciaHasta ? toISOOrNull(b.fechaVigenciaHasta) : null,

      requiereConfirmacion: Boolean(b.requiereConfirmacion),
      confirmadoPor: [],

      autorId:     clamp(String(req.user?.sub || ""), 100),
      autorNombre: clamp(b.autorNombre || req.user?.email || "", 200),

      visibleParaPadres: Boolean(b.visibleParaPadres ?? true),
      notificarPadres:   Boolean(b.notificarPadres   ?? true),

      estado: "activo",

      createdAt:    now,
      createdAtIso: nowISO,
      updatedAt:    now,
      updatedAtIso: nowISO,
    };

    const ref = await COL.add(payload);

    // ─── Push notifications ────────────────────────────────
    let pushResults = [];
    if (payload.visibleParaPadres && payload.notificarPadres) {
      try {
        const buildPushMsg = (matricula) => ({
          title: "📄 Nuevo oficio",
          body: payload.titulo || "Tienes un nuevo oficio disponible.",
          data: {
            kind: "oficio",
            oficioId: ref.id,
            categoria: payload.categoria,
            alumnoMatricula: normMat(matricula),
          },
        });

        if (esParaTodos) {
          // Todos los alumnos
          const snap = await firestore.collection("alumnos").select("matricula").limit(2000).get();
          const mats = snap.docs.map((d) => normMat(d.data()?.matricula)).filter(Boolean);
          for (const m of mats) {
            try { pushResults.push({ m, r: await sendPushToAlumno(m, buildPushMsg(m)) }); }
            catch (e) { console.error(`push err ${m}:`, e); }
          }

        } else if (gruposDestinatarios.length > 0) {
          // Enviar por grupos: buscar alumnos que coincidan en nivel-grado-grupo
          for (const grupoKey of gruposDestinatarios) {
            // grupoKey = "Primaria-3-A"
            const [nivel, grado, grupo] = grupoKey.split("-");
            if (!nivel || !grado || !grupo) continue;

            const snap = await firestore.collection("alumnos")
              .where("nivel", "==", nivel)
              .where("grado", "==", grado)
              .where("grupo", "==", grupo)
              .select("matricula")
              .limit(500)
              .get();

            const mats = snap.docs.map((d) => normMat(d.data()?.matricula)).filter(Boolean);
            for (const m of mats) {
              if (!pushResults.find((r) => r.m === m)) {
                try { pushResults.push({ m, r: await sendPushToAlumno(m, buildPushMsg(m)) }); }
                catch (e) { console.error(`push err ${m}:`, e); }
              }
            }
          }

        } else {
          // Destinatarios manuales (matrículas)
          for (const m of destinatarios) {
            try { pushResults.push({ m, r: await sendPushToAlumno(m, buildPushMsg(m)) }); }
            catch (e) { console.error(`push err ${m}:`, e); }
          }
        }
      } catch (e) {
        console.error("[oficios] push general error:", e);
      }
    }

    const saved = await ref.get();
    res.status(201).json({ ok: true, item: { id: saved.id, ...saved.data() }, pushCount: pushResults.length });

  } catch (e) {
    console.error("[POST /api/oficios]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ─── GET /api/oficios ──────────────────────────────────
   Colaborador: todos
   Padre:       esParaTodos=true  OR  destinatarios array-contains matricula
                (las dos queries se mergean en memoria)
   ─────────────────────────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    if (role !== "colaborador" && role !== "padre")
      return res.status(403).json({ ok: false, error: "no_autorizado" });

    const { q = "", categoria = "", prioridad = "", from = "", to = "", pageSize = "50", cursor = "" } = req.query;
    const limit = Math.min(200, Math.max(1, asInt(pageSize, 50)));

    // ── COLABORADOR ──────────────────────────────────────
    if (role === "colaborador") {
      let query = COL.orderBy("fechaEmision", "desc").orderBy(DOC_ID, "desc");
      if (categoria) query = query.where("categoria", "==", String(categoria));
      if (prioridad) query = query.where("prioridad", "==", String(prioridad));
      if (from) query = query.where("fechaEmision", ">=", new Date(`${from}T00:00:00.000Z`).toISOString());
      if (to)   query = query.where("fechaEmision", "<=", new Date(`${to}T23:59:59.999Z`).toISOString());
      if (cursor) {
        const [lf, li] = String(cursor).split("|");
        if (lf && li) query = query.startAfter(lf, li);
      }

      const snap = await query.limit(limit).get();
      let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (q) items = items.filter((it) => matchQ(it, q));

      let nextCursor = null;
      if (snap.docs.length) {
        const last = snap.docs[snap.docs.length - 1];
        nextCursor = `${String(last.data().fechaEmision || "")}|${last.id}`;
      }
      return res.json({ ok: true, items, nextCursor });
    }

    // ── PADRE ────────────────────────────────────────────
    const miMat = normMat(req.user?.sub || "");
    if (!miMat) return res.status(400).json({ ok: false, error: "matricula requerida" });

    // Query 1: oficios para todos
    const q1 = COL
      .where("esParaTodos", "==", true)
      .where("visibleParaPadres", "==", true)
      .orderBy("fechaEmision", "desc")
      .limit(limit);

    // Query 2: oficio personalizado donde el padre es destinatario
    const q2 = COL
      .where("visibleParaPadres", "==", true)
      .where("destinatarios", "array-contains", miMat)
      .orderBy("fechaEmision", "desc")
      .limit(limit);

    const [s1, s2] = await Promise.all([q1.get(), q2.get()]);

    const map = new Map();
    [...s1.docs, ...s2.docs].forEach((d) => {
      if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
    });

    let items = Array.from(map.values());
    items.sort((a, b) => new Date(b.fechaEmision || 0).getTime() - new Date(a.fechaEmision || 0).getTime());
    if (q) items = items.filter((it) => matchQ(it, q));
    if (categoria) items = items.filter((it) => it.categoria === categoria);
    if (prioridad) items = items.filter((it) => it.prioridad === prioridad);

    return res.json({ ok: true, items: items.slice(0, limit), nextCursor: null });

  } catch (e) {
    console.error("[GET /api/oficios]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ─── GET /api/oficios/:id ─────────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    if (role !== "colaborador" && role !== "padre")
      return res.status(403).json({ ok: false, error: "no_autorizado" });

    const doc = await COL.doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "not_found" });

    const item = { id: doc.id, ...doc.data() };

    if (role === "padre") {
      const miMat = normMat(req.user?.sub || "");
      const ok = item.esParaTodos ||
        (Array.isArray(item.destinatarios) && item.destinatarios.some((m) => normMat(m) === miMat));
      if (!ok || !item.visibleParaPadres) return res.status(403).json({ ok: false, error: "no_autorizado" });
    }

    res.json({ ok: true, item });
  } catch (e) {
    console.error("[GET /api/oficios/:id]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ─── PATCH /api/oficios/:id ──────────────────────────── */
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== "colaborador")
      return res.status(403).json({ ok: false, error: "solo_colaboradores" });

    const ref = COL.doc(req.params.id);
    if (!(await ref.get()).exists) return res.status(404).json({ ok: false, error: "not_found" });

    const b = req.body || {};
    const patch = {};
    if (b.titulo       !== undefined) patch.titulo       = clamp(b.titulo, 300);
    if (b.descripcion  !== undefined) patch.descripcion  = clamp(b.descripcion, 3000);
    if (b.categoria    !== undefined) patch.categoria    = clamp(b.categoria, 100);
    if (b.prioridad    !== undefined) patch.prioridad    = clamp(b.prioridad, 50);
    if (b.estado       !== undefined) patch.estado       = clamp(b.estado, 50);
    if (b.fechaVigenciaHasta !== undefined) patch.fechaVigenciaHasta = toISOOrNull(b.fechaVigenciaHasta);
    if (Array.isArray(b.adjuntos)) {
      patch.adjuntos = b.adjuntos.map((a) => ({ nombre: clamp(a.nombre, 200), url: clamp(a.url, 500), tipo: clamp(a.tipo, 50), size: Number(a.size || 0) }));
    }
    patch.updatedAt    = admin.firestore.FieldValue.serverTimestamp();
    patch.updatedAtIso = new Date().toISOString();

    await ref.update(patch);
    const updated = await ref.get();
    res.json({ ok: true, item: { id: updated.id, ...updated.data() } });
  } catch (e) {
    console.error("[PATCH /api/oficios/:id]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ─── DELETE /api/oficios/:id ─────────────────────────── */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== "colaborador")
      return res.status(403).json({ ok: false, error: "solo_colaboradores" });
    await COL.doc(req.params.id).delete();
    res.json({ ok: true, id: req.params.id });
  } catch (e) {
    console.error("[DELETE /api/oficios/:id]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ─── POST /api/oficios/:id/confirmar ────────────────── */
router.post("/:id/confirmar", requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== "padre")
      return res.status(403).json({ ok: false, error: "solo_padres" });

    const ref  = COL.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "not_found" });

    const item   = snap.data();
    const miMat  = normMat(req.user?.sub || "");
    const esOk   = item.esParaTodos || (Array.isArray(item.destinatarios) && item.destinatarios.some((m) => normMat(m) === miMat));
    if (!esOk) return res.status(403).json({ ok: false, error: "no_autorizado" });

    const confirmadoPor = Array.isArray(item.confirmadoPor) ? item.confirmadoPor : [];
    if (confirmadoPor.some((c) => normMat(c.matricula) === miMat))
      return res.json({ ok: true, message: "ya_confirmado" });

    confirmadoPor.push({ matricula: miMat, fecha: new Date().toISOString() });
    await ref.update({ confirmadoPor, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    res.json({ ok: true, message: "confirmado" });
  } catch (e) {
    console.error("[POST /api/oficios/:id/confirmar]", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;