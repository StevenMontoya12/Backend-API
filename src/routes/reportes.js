// src/routes/reportes.js
import { Router } from "express";
import admin, { firestore } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPushToAlumno } from "../services/pushService.js";

const router = Router();

// ✅ Colección raíz (NO collectionGroup)
const col = firestore.collection("reportes");
const DOC_ID = admin.firestore.FieldPath.documentId();

function asInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function computeEstado(visibleHastaIso) {
  const t = new Date(visibleHastaIso).getTime();
  if (!Number.isFinite(t)) return "activo";
  return t < Date.now() ? "vencido" : "activo";
}

/** ✅ Normaliza matrícula (para evitar "a001 " vs "A001") */
function normMatricula(v) {
  return String(v || "").trim().toUpperCase();
}

/** ✅ Normaliza fechas a ISO UTC (con Z) SIEMPRE. */
function toISOOrNull(v) {
  if (typeof v !== "string" && typeof v !== "number") return null;

  const raw = String(v).trim();
  if (!raw) return null;

  const d = new Date(raw);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;

  return d.toISOString();
}

/** ✅ Para filtros from/to: Recibe YYYY-MM-DD y crea rango UTC completo. */
function dayStartUTC(yyyy_mm_dd) {
  return new Date(`${yyyy_mm_dd}T00:00:00.000Z`).toISOString();
}
function dayEndUTC(yyyy_mm_dd) {
  return new Date(`${yyyy_mm_dd}T23:59:59.999Z`).toISOString();
}

/** ✅ búsqueda simple (post-filter) */
function matchQ(item, qRaw) {
  const q = String(qRaw || "").trim().toLowerCase();
  if (!q) return true;

  const titulo = String(item.titulo || "").toLowerCase();
  const detalle = String(item.detalle || "").toLowerCase();

  return titulo.includes(q) || detalle.includes(q);
}

/**
 * GET /api/reportes
 * Query:
 *  - alumno: "A0089" => prefijo (startsWith) por default
 *  - alumnoExact=1 => match exacto (opcional)
 *  - includeAll=1: web -> no fuerza visibleParaPadre
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const {
      from = "",
      to = "",
      alumno = "",
      alumnoExact = "", // ✅ opcional (si algún día quieres exact)
      tipo = "",
      severidad = "",
      estado = "",
      q = "",
      pageSize = "50",
      cursor = "",
      includeAll = "",
    } = req.query;

    const limit = Math.min(200, Math.max(1, asInt(pageSize, 50)));
    const includeAllBool = String(includeAll) === "1";

    const alumnoRaw = String(alumno || "").trim();
    const hasAlumno = alumnoRaw.length > 0;

    const exactMode = hasAlumno && String(alumnoExact) === "1";
    const alumnoValue = hasAlumno ? normMatricula(alumnoRaw) : "";

    let query = col;

    // filtros de igualdad (siempre seguros)
    if (tipo) query = query.where("tipo", "==", String(tipo));
    if (severidad) query = query.where("severidad", "==", String(severidad));
    if (estado) query = query.where("estado", "==", String(estado));

    // ✅ móvil: por defecto solo visibles para padre (cuando NO es includeAll=1)
    if (!includeAllBool) {
      query = query.where("visibleParaPadre", "==", true);
    }

    if (hasAlumno) {
      if (exactMode) {
        // ✅ (Opcional) Exact match si mandas alumnoExact=1
        query = query.where("alumnoMatricula", "==", alumnoValue);

        // aquí SÍ podemos usar rangos de fechaEvento en Firestore
        if (from) query = query.where("fechaEvento", ">=", dayStartUTC(String(from)));
        if (to) query = query.where("fechaEvento", "<=", dayEndUTC(String(to)));

        query = query.orderBy("fechaEvento", "desc").orderBy(DOC_ID, "desc");

        if (cursor) {
          // cursor modo exact: fechaEvento|docId
          const [lastFechaEvento, lastDocId] = String(cursor).split("|");
          if (lastFechaEvento && lastDocId) query = query.startAfter(lastFechaEvento, lastDocId);
        }
      } else {
        /**
         * ✅ DEFAULT: PREFIJO (startsWith)
         * alumnoMatricula entre [prefix, prefix\uf8ff]
         */
        const end = alumnoValue + "\uf8ff";

        query = query
          .where("alumnoMatricula", ">=", alumnoValue)
          .where("alumnoMatricula", "<=", end)
          // cuando hay range en alumnoMatricula, el primer orderBy debe ser ese mismo campo
          .orderBy("alumnoMatricula", "asc")
          .orderBy("fechaEvento", "desc")
          .orderBy(DOC_ID, "desc");

        // ⚠️ Con range en alumnoMatricula NO metemos range de fechaEvento en Firestore.
        // from/to se aplica luego en memoria (post-filter).
        if (cursor) {
          // cursor modo prefijo: alumnoMatricula|fechaEvento|docId
          const [cM, cF, cId] = String(cursor).split("|");
          if (cM && cF && cId) query = query.startAfter(cM, cF, cId);
        }
      }
    } else {
      // ✅ sin alumno: filtros por fechaEvento normales
      if (from) query = query.where("fechaEvento", ">=", dayStartUTC(String(from)));
      if (to) query = query.where("fechaEvento", "<=", dayEndUTC(String(to)));

      query = query.orderBy("fechaEvento", "desc").orderBy(DOC_ID, "desc");

      if (cursor) {
        const [lastFechaEvento, lastDocId] = String(cursor).split("|");
        if (lastFechaEvento && lastDocId) query = query.startAfter(lastFechaEvento, lastDocId);
      }
    }

    const snap = await query.limit(limit).get();
    const rawItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // ✅ post-filters
    let items = rawItems;

    // si estamos en prefijo, aplicamos from/to aquí
    if (hasAlumno && !exactMode && (from || to)) {
      const a = from ? dayStartUTC(String(from)) : null;
      const b = to ? dayEndUTC(String(to)) : null;

      items = items.filter((it) => {
        const fe = String(it.fechaEvento || "");
        if (!fe) return false;
        if (a && fe < a) return false;
        if (b && fe > b) return false;
        return true;
      });
    }

    if (q) items = items.filter((it) => matchQ(it, q));

    // ✅ nextCursor (depende del modo)
    let nextCursor = null;
    if (snap.docs.length) {
      const last = snap.docs[snap.docs.length - 1];
      const data = last.data() || {};

      if (hasAlumno && !exactMode) {
        nextCursor = `${String(data.alumnoMatricula || "")}|${String(data.fechaEvento || "")}|${last.id}`;
      } else {
        nextCursor = `${String(data.fechaEvento || "")}|${last.id}`;
      }
    }

    res.json({ ok: true, items, nextCursor });
  } catch (e) {
    console.error("[GET /api/reportes] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * POST /api/reportes
 * ✅ manda push si notificarPadre=true y visibleParaPadre=true
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};

    if (!b.alumnoMatricula) return res.status(400).json({ ok: false, error: "alumnoMatricula requerido" });
    if (!b.titulo) return res.status(400).json({ ok: false, error: "titulo requerido" });
    if (!b.fechaEvento) return res.status(400).json({ ok: false, error: "fechaEvento requerido (ISO)" });
    if (!b.visibleHasta) return res.status(400).json({ ok: false, error: "visibleHasta requerido (ISO)" });

    const fechaEventoISO = toISOOrNull(b.fechaEvento);
    const visibleHastaISO = toISOOrNull(b.visibleHasta);

    if (!fechaEventoISO) return res.status(400).json({ ok: false, error: "fechaEvento inválido (ISO)" });
    if (!visibleHastaISO) return res.status(400).json({ ok: false, error: "visibleHasta inválido (ISO)" });

    const docRef = col.doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const matriculaNorm = normMatricula(b.alumnoMatricula);

    const payload = {
      alumnoMatricula: matriculaNorm,
      alumnoMatriculaNorm: matriculaNorm, // opcional (por si luego migras a búsquedas/index)

      alumnoNombre: b.alumnoNombre ? String(b.alumnoNombre) : "",
      grado: b.grado ? String(b.grado) : "",
      grupo: b.grupo ? String(b.grupo) : "",

      fechaEvento: fechaEventoISO,
      visibleHasta: visibleHastaISO,

      tipo: String(b.tipo || "otro"),
      severidad: String(b.severidad || "normal"),
      icon: String(b.icon || "bi-journal-text"),

      titulo: String(b.titulo || "").trim(),
      detalle: String(b.detalle || "").trim(),

      accionTomada: b.accionTomada ? String(b.accionTomada) : "",
      seguimiento: b.seguimiento ? String(b.seguimiento) : "",

      visibleParaPadre: Boolean(b.visibleParaPadre),
      notificarPadre: Boolean(b.notificarPadre),

      estado: computeEstado(visibleHastaISO),

      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(payload);

    let pushResult = null;
    if (payload.visibleParaPadre && payload.notificarPadre) {
      try {
        const title = payload.alumnoNombre ? `Nuevo reporte: ${payload.alumnoNombre}` : "Nuevo reporte";
        const body = payload.titulo || "Tienes un nuevo reporte.";

        pushResult = await sendPushToAlumno(payload.alumnoMatricula, {
          title,
          body,
          data: {
            kind: "reporte",
            reporteId: docRef.id,
            alumnoMatricula: payload.alumnoMatricula,
          },
        });
      } catch (e) {
        console.error("[reportes] push error:", e);
        pushResult = { ok: false, error: String(e) };
      }
    }

    const saved = await docRef.get();
    res.status(201).json({ ok: true, item: { id: saved.id, ...saved.data() }, push: pushResult });
  } catch (e) {
    console.error("[POST /api/reportes] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * PATCH /api/reportes/:id
 */
router.patch("/:id", requireAuth, async (req, res) => {
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

    if (b.alumnoMatricula != null) {
      const m = normMatricula(b.alumnoMatricula);
      patch.alumnoMatricula = m;
      patch.alumnoMatriculaNorm = m;
    }

    if (b.fechaEvento != null) {
      const iso = toISOOrNull(b.fechaEvento);
      if (!iso) return res.status(400).json({ ok: false, error: "fechaEvento inválido (ISO)" });
      patch.fechaEvento = iso;
    }

    if (b.visibleHasta != null) {
      const iso = toISOOrNull(b.visibleHasta);
      if (!iso) return res.status(400).json({ ok: false, error: "visibleHasta inválido (ISO)" });
      patch.visibleHasta = iso;
      patch.estado = computeEstado(iso);
    }

    await ref.update(patch);

    const after = await ref.get();
    res.json({ ok: true, item: { id: after.id, ...after.data() } });
  } catch (e) {
    console.error("[PATCH /api/reportes/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
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
