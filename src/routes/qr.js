// src/routes/qr.js
import { Router } from "express";
import admin, { firestore } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPushToAlumno } from "../services/pushService.js";

const router = Router();

const COL = firestore.collection("qrScans");
const ALUMNOS_COL = firestore.collection("alumnos"); // ajusta si se llama distinto

/* =========================
   Helpers
   ========================= */

function normMatricula(v) {
  return String(v || "").trim().toUpperCase();
}

function getColaboradorNombre(req) {
  const u = req.user || {};
  return (
    u.nombreCompleto ||
    u.nombre ||
    u.email ||
    String(u.sub || "colaborador")
  );
}

// "MAT:A001" o "A001"
function parseMatFromQr(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m1 = s.match(/^mat\s*:\s*(.+)$/i);
  if (m1 && m1[1]) return normMatricula(m1[1]);
  return normMatricula(s);
}

// 🔎 Busca alumno para snapshot (nombre/grado/grupo/nivel)
async function getAlumnoSnapshotByMatricula(matricula) {
  const m = normMatricula(matricula);
  if (!m) return null;

  const snap = await ALUMNOS_COL.where("matricula", "==", m).limit(1).get();
  if (snap.empty) return null;

  const data = snap.docs[0].data() || {};
  const nombres = data.nombres || data.nombre || "";
  const apellidos = data.apellidos || "";
  const alumnoNombre = `${nombres} ${apellidos}`.trim();

  return {
    alumnoNombre: alumnoNombre || null,
    alumnoGrado: data.grado || null,
    alumnoGrupo: data.grupo || null,
    alumnoNivel: data.nivel || null,
  };
}

/* =========================
   POST /api/qr/scan
   ✅ Solo colaboradores
   ========================= */
router.post("/scan", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    if (role !== "colaborador") {
      return res.status(403).json({ ok: false, error: "solo_colaboradores" });
    }

    const body = req.body || {};
    const code = body.code ?? (body.matricula ? `MAT:${body.matricula}` : "");
    const tipo = String(body.tipo || "entrada");

    const meta =
      body.meta && typeof body.meta === "object"
        ? body.meta
        : { nota: body.nota ?? "" };

    const alumnoMatricula = parseMatFromQr(code);
    if (!alumnoMatricula) {
      return res.status(400).json({ ok: false, error: "qr_invalido" });
    }

    // snapshot alumno
    let alumnoSnap = null;
    try {
      alumnoSnap = await getAlumnoSnapshotByMatricula(alumnoMatricula);
    } catch (e) {
      console.error("[qr/scan] alumno lookup error:", e);
      alumnoSnap = null;
    }

    const colaboradorId = String(req.user?.sub || "");
    const colaboradorNombre = getColaboradorNombre(req);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();

    const payload = {
      alumnoMatricula,
      tipo,
      colaboradorId,
      colaboradorNombre,
      raw: String(code || ""),
      meta,

      alumnoNombre: alumnoSnap?.alumnoNombre ?? null,
      alumnoGrado: alumnoSnap?.alumnoGrado ?? null,
      alumnoGrupo: alumnoSnap?.alumnoGrupo ?? null,
      alumnoNivel: alumnoSnap?.alumnoNivel ?? null,

      createdAt: now,
      createdAtIso: nowIso,
    };

    const ref = await COL.add(payload);

    // Push (mejor mensaje)
    let pushResult = null;
    try {
      const tipoLower = String(tipo || "").toLowerCase();
      const title = tipoLower.includes("salida")
        ? "🚪 Salida registrada"
        : "✅ Entrada registrada";

      const quien = colaboradorNombre ? ` por ${colaboradorNombre}` : "";
      const alumno = alumnoSnap?.alumnoNombre
        ? `${alumnoSnap.alumnoNombre} (${alumnoMatricula})`
        : alumnoMatricula;

      const msg = `${alumno}${quien}.`;

      pushResult = await sendPushToAlumno(alumnoMatricula, {
        title,
        body: msg,
        data: {
          kind: "qr",
          scanId: ref.id,
          alumnoMatricula,
          tipo,
          colaboradorId,
        },
      });
    } catch (e) {
      console.error("[qr/scan] push error:", e);
      pushResult = { ok: false, error: String(e) };
    }

    const snap = await ref.get();
    return res.status(201).json({
      ok: true,
      item: { id: snap.id, ...snap.data() },
      push: pushResult,
    });
  } catch (e) {
    console.error("[POST /api/qr/scan] error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =========================
   GET /api/qr/history
   ✅ colaborador:
      - si manda alumno => filtra por alumno
      - si NO manda alumno => modo general (todos)
   ✅ padre:
      - SIEMPRE forzado a su propio hijo (req.user.sub)
   Query:
   alumno?, from?, to?, tipo?, q?, grado?, grupo?, nivel?, pageSize?, cursor?
   ========================= */
router.get("/history", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;

    if (role !== "colaborador" && role !== "padre") {
      return res.status(403).json({ ok: false, error: "no_autorizado" });
    }

    const {
      alumno = "",
      tipo = "",
      from = "",
      to = "",
      q = "",
      grado = "",
      grupo = "",
      nivel = "",
      pageSize = "50",
      cursor = "",
    } = req.query;

    const limit = Math.min(200, Math.max(1, Number(pageSize) || 50));

    // ✅ PADRE: alumno siempre = sub
    // ✅ COLABORADOR: alumno viene del query (puede estar vacío)
    const alumnoForced =
      role === "padre" ? String(req.user?.sub || "") : String(alumno || "");

    const alumnoNorm = alumnoForced ? normMatricula(alumnoForced) : "";

    // ── Armado base de query ──
    let query;

    if (role === "padre") {
      // Padre debe tener matrícula sí o sí (viene del token)
      if (!alumnoNorm) {
        return res.status(400).json({ ok: false, error: "alumno requerido" });
      }

      query = COL.where("alumnoMatricula", "==", alumnoNorm).orderBy(
        "createdAtIso",
        "desc"
      );
    } else {
      // Colaborador: si hay alumno filtra, si no hay alumno lista todo
      query = alumnoNorm
        ? COL.where("alumnoMatricula", "==", alumnoNorm).orderBy(
            "createdAtIso",
            "desc"
          )
        : COL.orderBy("createdAtIso", "desc");
    }

    // filtros Firestore (pueden pedir índice si combinas varios)
    if (tipo) query = query.where("tipo", "==", String(tipo));

    if (from) {
      const isoFrom = new Date(`${from}T00:00:00.000Z`).toISOString();
      query = query.where("createdAtIso", ">=", isoFrom);
    }
    if (to) {
      const isoTo = new Date(`${to}T23:59:59.999Z`).toISOString();
      query = query.where("createdAtIso", "<=", isoTo);
    }

    // Cursor: "iso|docId" o solo docId
    let cursorId = "";
    if (cursor) {
      const parts = String(cursor).split("|");
      cursorId = parts.length === 2 ? parts[1] : String(cursor);
    }
    if (cursorId) {
      const cursorSnap = await COL.doc(cursorId).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(limit).get();
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // filtros extra en memoria (NO requieren índices)
    const qs = String(q || "").trim().toLowerCase();
    const g = String(grado || "").trim().toLowerCase();
    const gr = String(grupo || "").trim().toLowerCase();
    const nv = String(nivel || "").trim().toLowerCase();

    if (qs || g || gr || nv) {
      items = items.filter((it) => {
        const itGrado = String(it.alumnoGrado || "").toLowerCase();
        const itGrupo = String(it.alumnoGrupo || "").toLowerCase();
        const itNivel = String(it.alumnoNivel || "").toLowerCase();

        if (g && itGrado !== g) return false;
        if (gr && itGrupo !== gr) return false;
        if (nv && itNivel !== nv) return false;

        if (qs) {
          const hay = `${it.alumnoMatricula || ""} ${it.alumnoNombre || ""} ${
            it.colaboradorNombre || ""
          } ${it.raw || ""} ${it.tipo || ""}`.toLowerCase();
          if (!hay.includes(qs)) return false;
        }

        return true;
      });
    }

    let nextCursor = null;
    if (snap.docs.length) {
      const last = snap.docs[snap.docs.length - 1];
      const d = last.data() || {};
      nextCursor = `${String(d.createdAtIso || "")}|${last.id}`;
    }

    return res.json({ ok: true, items, nextCursor });
  } catch (e) {
    console.error("[GET /api/qr/history] error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =========================
   GET /api/qr/history/:id
   ✅ colaborador: ok
   ✅ padre: solo si el scan pertenece a su matrícula (sub)
   ========================= */
router.get("/history/:id", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;

    if (role !== "colaborador" && role !== "padre") {
      return res.status(403).json({ ok: false, error: "no_autorizado" });
    }

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id_requerido" });

    const doc = await COL.doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const item = { id: doc.id, ...doc.data() };

    // ✅ padre: validar matrícula (sub) vs item.alumnoMatricula
    if (role === "padre") {
      const myMat = normMatricula(req.user?.sub || "");
      const itMat = normMatricula(item.alumnoMatricula || "");
      if (!myMat || itMat !== myMat) {
        return res.status(403).json({ ok: false, error: "no_autorizado" });
      }
    }

    return res.json({ ok: true, item });
  } catch (e) {
    console.error("[GET /api/qr/history/:id] error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
