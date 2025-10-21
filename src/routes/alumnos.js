// src/routes/alumnos.js
import { Router } from "express";
import { firestore } from "../firebase.js";
import { parse as parseCsv } from "csv-parse/sync";
import { mapExternalAlumno as mapExternaAlumno } from "../utils/mapExternaAlumno.js";
import admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { strip } from "../utils/normalize.js";

const router = Router();
const col = firestore.collection("alumnos");
const tombstones = firestore.collection("alumnos_deleted");
const metasDoc = firestore.doc("metas/alumnos");

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Asegura/actualiza doc meta (version/total) */
async function bumpMeta({ deltaTotal = 0, forceTouch = true } = {}) {
  const nowISO = new Date().toISOString();
  const data = {
    lastUpdatedAt: nowISO,
    updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (forceTouch) data.version = admin.firestore.FieldValue.increment(1);
  if (deltaTotal !== 0) data.total = admin.firestore.FieldValue.increment(deltaTotal);
  await metasDoc.set(data, { merge: true });
}

/** Lee meta defensivamente */
async function readMeta() {
  const snap = await metasDoc.get();
  if (!snap.exists) {
    const agg = await col.count().get().catch(() => null);
    const total = agg ? agg.data().count : 0;
    const nowISO = new Date().toISOString();
    const init = {
      version: 1,
      total,
      lastUpdatedAt: nowISO,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    };
    await metasDoc.set(init, { merge: false });
    return { version: 1, total, lastUpdatedAt: nowISO };
  }
  const d = snap.data() || {};
  return {
    version: d.version ?? 1,
    total: d.total ?? undefined,
    lastUpdatedAt: d.lastUpdatedAt ?? null,
  };
}

// ── Sanitizadores ───────────────────────────────────────────────
function sanitizeHistorialActividad(input) {
  if (!Array.isArray(input)) return [];
  const T = new Set(["alta", "baja", "cambio"]);
  const clean = (v) => (v == null ? "" : String(v).trim());

  return input
    .map((r) => {
      const fecha = new Date(r?.fechaIso ?? r?.fecha ?? "");
      const tipo = clean(r?.tipo || "").toLowerCase();
      if (!T.has(tipo)) return null;                 // tipo inválido
      if (Number.isNaN(fecha.getTime())) return null;// fecha inválida
      return {
        fechaIso: fecha.toISOString(),
        tipo,                                        // "alta" | "baja" | "cambio"
        motivo: clean(r?.motivo),
        usuario: clean(r?.usuario),
        notas: clean(r?.notas),
      };
    })
    .filter(Boolean);
}

/** Sanitiza array de hermanos (objetos planos con campos permitidos) */
function sanitizeHermanos(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((h) => {
      const id          = h?.id ? String(h.id).trim() : "";
      const matricula   = h?.matricula ? String(h.matricula).trim() : "";
      const nombres     = h?.nombres ? String(h.nombres).trim() : "";
      const apellidos   = h?.apellidos ? String(h.apellidos).trim() : "";
      const grupoPrin   = h?.grupoPrincipal ? String(h.grupoPrincipal).trim() : "";
      const nivel       = h?.nivel ? String(h.nivel).trim() : "";
      if (!id && !matricula) return null; // al menos uno para identificar
      return { id, matricula, nombres, apellidos, grupoPrincipal: grupoPrin, nivel };
    })
    .filter(Boolean);
}

/** Construye payload saneado */
function toAlumnoPayload(body) {
  const nowISO = new Date().toISOString();

  const f = {
    matricula: String(body.matricula || "").trim(),

    estatus: body.estatus || "activo",
    nombres: body.nombres || "",
    apellidos: body.apellidos || "",
    genero: body.genero || "",
    fechaNacimiento: body.fechaNacimiento || "",
    curp: body.curp || "",
    nacionalidad: body.nacionalidad || "",
    clave: body.clave || "",
    grupoPrincipal: body.grupoPrincipal || "",
    fechaIngreso: body.fechaIngreso || "",
    modalidad: body.modalidad || "",
    religion: body.religion || "",

    calleNumero: body.calleNumero || "",
    estado: body.estado || "",
    municipio: body.municipio || "",
    colonia: body.colonia || "",
    codigoPostal: body.codigoPostal || "",
    telefonoCasa: body.telefonoCasa || "",
    telefonoCelular: body.telefonoCelular || "",
    contactoPrincipal: body.contactoPrincipal || "",

    // número seguro
    numeroHermanos: Number.isFinite(Number(body.numeroHermanos)) ? Number(body.numeroHermanos) : 0,

    nombrePadre: body.nombrePadre || "",
    apellidosPadre: body.apellidosPadre || "",
    telefonoPadre: body.telefonoPadre || "",
    correoPadre: body.correoPadre || "",
    ocupacionPadre: body.ocupacionPadre || "",
    empresaPadre: body.empresaPadre || "",
    telefonoEmpresa: body.telefonoEmpresa || "",
    tokenPago: body.tokenPago || "",
    exalumno: body.exalumno || "no",
    correoFamiliar: body.correoFamiliar || "",

    tipoBeca: body.tipoBeca || "",
    porcentajeBeca: body.porcentajeBeca || "",

    actividad: body.actividad || "",

    nombreFactura: body.nombreFactura || "",
    calleNumeroFactura: body.calleNumeroFactura || "",
    coloniaFactura: body.coloniaFactura || "",
    estadoFactura: body.estadoFactura || "",
    municipioFactura: body.municipioFactura || "",
    codigoPostalFactura: body.codigoPostalFactura || "",
    telefonoCasaFactura: body.telefonoCasaFactura || "",
    emailFactura: body.emailFactura || "",
    rfc: body.rfc || "",
    numeroCuenta: body.numeroCuenta || "",
    tipoCobro: body.tipoCobro || "",
    usoCfdi: body.usoCfdi || "",
    requiereFactura: body.requiereFactura || "no",

    calificaciones: body.calificaciones || "",
    general: body.general || "",
    cobros: body.cobros || "",

    nivel: body.nivel || "",
    grado: body.grado || "",
    grupo: body.grupo || "",

    // historial de actividad
    historialActividad: sanitizeHistorialActividad(body.historialActividad),

    // 🔹 NUEVO: hermanos + flag
    hermanos: sanitizeHermanos(body.hermanos),
    hermanoEstudiaAqui: Boolean(body.hermanoEstudiaAqui),

    // índices normalizados
    nombreIndex: strip(`${body.nombres || ""} ${body.apellidos || ""}`),
    matriculaIndex: strip(body.matricula || ""),
    correoIndex: strip(body.correoFamiliar || ""),

    // sellos
    updatedAt: nowISO,
    updatedAtTs: admin.firestore.FieldValue.serverTimestamp(), // <— para queries por tiempo
  };

  return { f, nowISO };
}

/** Construye patch parcial desde body (solo campos presentes) */
function buildPatchFromBody(body) {
  const allowed = [
    "estatus","nombres","apellidos","genero","fechaNacimiento","curp","nacionalidad","clave",
    "grupoPrincipal","fechaIngreso","modalidad","religion","calleNumero","estado","municipio","colonia",
    "codigoPostal","telefonoCasa","telefonoCelular","contactoPrincipal","numeroHermanos","nombrePadre",
    "apellidosPadre","telefonoPadre","correoPadre","ocupacionPadre","empresaPadre","telefonoEmpresa",
    "tokenPago","exalumno","correoFamiliar","tipoBeca","porcentajeBeca","actividad","nombreFactura",
    "calleNumeroFactura","coloniaFactura","estadoFactura","municipioFactura","codigoPostalFactura",
    "telefonoCasaFactura","emailFactura","rfc","numeroCuenta","tipoCobro","usoCfdi","requiereFactura",
    "calificaciones","general","cobros","nivel","grado","grupo","historialActividad",
    // 🔹 agrega estos:
    "hermanos","hermanoEstudiaAqui"
  ];
  const patch = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      patch[k] = body[k];
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "matricula")) delete patch.matricula;

  // sanitiza historial si viene en el patch
  if (Object.prototype.hasOwnProperty.call(patch, "historialActividad")) {
    patch.historialActividad = sanitizeHistorialActividad(patch.historialActividad);
  }
  // 🔹 sanitiza hermanos si vienen
  if (Object.prototype.hasOwnProperty.call(patch, "hermanos")) {
    patch.hermanos = sanitizeHermanos(patch.hermanos);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "hermanoEstudiaAqui")) {
    patch.hermanoEstudiaAqui = Boolean(patch.hermanoEstudiaAqui);
  }
  // fuerza número
  if (Object.prototype.hasOwnProperty.call(patch, "numeroHermanos")) {
    patch.numeroHermanos = Number.isFinite(Number(patch.numeroHermanos))
      ? Number(patch.numeroHermanos)
      : 0;
  }

  return patch;
}

// ────────────────────────────────────────────────────────────────
/** Endpoints */
// ────────────────────────────────────────────────────────────────

// META — versión, total, última actualización
router.get("/meta", async (_req, res) => {
  try {
    const meta = await readMeta();
    res.json({ ok: true, ...meta });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// CHANGES — deltas desde un instante
router.get("/changes", async (req, res) => {
  try {
    const since = String(req.query.since || "").trim();
    if (!since) return res.status(400).json({ ok: false, error: "since requerido (ISO date)" });
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return res.status(400).json({ ok: false, error: "since inválido" });
    }

    const nowISO = new Date().toISOString();

    // updated
    const qUpdated = await col
      .where("updatedAtTs", ">", sinceDate)
      .orderBy("updatedAtTs", "asc")
      .limit(1000) // defensivo
      .get();

    const updated = qUpdated.docs.map((d) => ({ id: d.id, ...d.data() }));

    // deleted — leemos tombstones
    const qDeleted = await tombstones
      .where("deletedAtTs", ">", sinceDate)
      .orderBy("deletedAtTs", "asc")
      .limit(1000)
      .get();

    const deleted = qDeleted.docs.map((d) => d.id);

    res.json({ ok: true, since, now: nowISO, updated, deleted });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 🔎 BÚSQUEDA RÁPIDA (para Step3Hermanos) — DEBE IR ANTES DE "/:matricula"
router.get("/search", async (req, res) => {
  try {
    const term = String(req.query.term || "").trim();
    const limit = Math.min(Number(req.query.limit || 10), 50);

    if (term.length < 2) {
      return res.json({ ok: true, items: [] });
    }

    // 1) Prefijo por apellidos
    let q1 = col
      .orderBy("apellidos", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .startAt(term)
      .endAt(term + "\uf8ff")
      .limit(limit);
    const snap1 = await q1.get();

    // 2) Prefijo por nombres
    let q2 = col
      .orderBy("nombres", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .startAt(term)
      .endAt(term + "\uf8ff")
      .limit(limit);
    const snap2 = await q2.get();

    // 3) Match exacto por matrícula
    const byMatricula = await col.doc(term).get();

    const map = new Map();
    const pushDoc = (d) => {
      if (!d?.exists) return;
      const data = d.data() || {};
      map.set(d.id, {
        id: d.id,
        matricula: d.id,
        nombres: data.nombres || "",
        apellidos: data.apellidos || "",
        grupoPrincipal: data.grupoPrincipal || "",
        nivel: data.nivel || "",
      });
    };

    snap1.docs.forEach(pushDoc);
    snap2.docs.forEach(pushDoc);
    if (byMatricula.exists) pushDoc(byMatricula);

    const items = Array.from(map.values()).slice(0, limit);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Crear alumno
router.post("/", async (req, res) => {
  try {
    const { f, nowISO } = toAlumnoPayload(req.body);
    if (!f.matricula) {
      return res.status(400).json({ ok: false, error: "La matrícula es obligatoria" });
    }

    const ref = col.doc(f.matricula);
    const snap = await ref.get();
    if (snap.exists) {
      return res.status(409).json({ ok: false, error: "La matrícula ya existe" });
    }

    const data = { ...f, createdAt: nowISO, createdAtTs: admin.firestore.FieldValue.serverTimestamp() };

    // Alta automática si vino vacío
    if (!Array.isArray(data.historialActividad) || data.historialActividad.length === 0) {
      data.historialActividad = [{
        fechaIso: nowISO,
        tipo: "alta",
        motivo: "Alta inicial",
        usuario: "sistema",
        notas: ""
      }];
    }

    await ref.set(data);

    // limpia tombstone si existía
    await tombstones.doc(ref.id).delete().catch(() => {});

    // meta: +1 total, versión++
    await bumpMeta({ deltaTotal: +1, forceTouch: true });

    res.json({ ok: true, data: { id: ref.id, ...data } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * Listar alumnos con búsqueda+cursor.
 * Devuelve ETag basado en meta.version y los parámetros.
 */
router.get("/", async (req, res) => {
  try {
    const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
    const q = (req.query.q || "").toString().trim();
    const hasQ = q.length >= 2;

    // cursores
    const saApellido = typeof req.query.saApellido === "string" ? req.query.saApellido : null;
    const saId       = typeof req.query.saId === "string" ? req.query.saId : null;
    const saNombre   = typeof req.query.saNombre === "string" ? req.query.saNombre : null;
    const saId2      = typeof req.query.saId2 === "string" ? req.query.saId2 : null;

    // ETag (si versión no cambió y params tampoco, 304)
    const meta = await readMeta();
    const etag = `"alumnos:${meta.version}|q=${hasQ ? q : ""}|ps=${pageSize}|a=${saApellido || ""}|i=${saId || ""}|n=${saNombre || ""}|i2=${saId2 || ""}"`;
    const inm = req.headers["if-none-match"];
    if (inm && inm === etag) {
      res.status(304).end();
      return;
    }

    let query;
    if (hasQ) {
      const qNorm = strip(q);
      query = col
        .orderBy("nombreIndex", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .startAt(qNorm)
        .endAt(qNorm + "\uf8ff")
        .limit(pageSize);

      if (saNombre && saId2) query = query.startAfter(saNombre, saId2);
    } else {
      query = col
        .orderBy("apellidos", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .limit(pageSize);

      if (saApellido && saId) query = query.startAfter(saApellido, saId);
    }

    const snap = await query.get();

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const lastDoc = snap.docs[snap.docs.length - 1] || null;

    const next = lastDoc
      ? hasQ
        ? { saNombre: lastDoc.get("nombreIndex") || "", saId2: lastDoc.id }
        : { saApellido: lastDoc.get("apellidos") || "", saId: lastDoc.id }
      : null;

    res.setHeader("ETag", etag);
    res.json({
      ok: true,
      items,
      next,
      total: meta.total, // evita count() por request
      pageSize,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Obtener alumno por matrícula
router.get("/:matricula", async (req, res) => {
  try {
    const ref = col.doc(req.params.matricula);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "No encontrado" });
    res.json({ ok: true, data: { id: doc.id, ...doc.data() } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Patch (merge manual) + recalcular índices + sellos
router.patch("/:matricula", async (req, res) => {
  try {
    const id = req.params.matricula;
    const ref = col.doc(id);
    const prev = await ref.get();
    if (!prev.exists) return res.status(404).json({ ok: false, error: "No encontrado" });

    const patch = buildPatchFromBody(req.body);
    const prevData = prev.data() || {};
    const finalData = { ...prevData, ...patch };

    finalData.nombreIndex    = strip(`${finalData.nombres || ""} ${finalData.apellidos || ""}`);
    finalData.matriculaIndex = strip(id);
    finalData.correoIndex    = strip(finalData.correoFamiliar || "");
    finalData.updatedAt      = new Date().toISOString();
    finalData.updatedAtTs    = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(finalData, { merge: false });

    // meta: versión++
    await bumpMeta({ deltaTotal: 0, forceTouch: true });

    res.json({ ok: true, data: { id, ...finalData } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Eliminar — crea tombstone y decrementa total
router.delete("/:matricula", async (req, res) => {
  try {
    const id = req.params.matricula;

    // borra doc
    await col.doc(id).delete();

    // escribe tombstone
    const nowISO = new Date().toISOString();
    await tombstones.doc(id).set({
      id,
      deletedAt: nowISO,
      deletedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    });

    // meta: -1 total, versión++
    await bumpMeta({ deltaTotal: -1, forceTouch: true });

    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Import masivo
router.post("/import", async (req, res) => {
  try {
    const dryRun = String(req.query.dryRun || "false").toLowerCase() === "true";
    const merge = String(req.query.merge || "true").toLowerCase() === "true";
    const blockOverwrite = String(req.query.blockOverwrite || "false").toLowerCase() === "true";

    let rows = [];
    if (req.is("text/csv")) {
      const raw = req.body;
      rows = parseCsv(raw, { columns: true, skip_empty_lines: true, trim: true });
    } else if (req.is("application/json")) {
      if (!Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: "Se esperaba un arreglo JSON" });
      }
      rows = req.body;
    } else {
      return res.status(415).json({ ok: false, error: "Content-Type no soportado (usa text/csv o application/json)" });
    }

    if (!rows.length) return res.status(400).json({ ok: false, error: "No hay filas para importar" });

    const converted = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const { matricula, body } = mapExternaAlumno(rows[i]);
        converted.push({ matricula, body });
      } catch (e) {
        errors.push({ index: i, error: String(e), row: rows[i] });
      }
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, errors, validCount: converted.length });
    }

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, count: converted.length });
    }

    const BATCH_SIZE = 400;
    let written = 0;
    let deltaTotal = 0;

    for (let i = 0; i < converted.length; i += BATCH_SIZE) {
      const batch = firestore.batch();
      const slice = converted.slice(i, i + BATCH_SIZE);

      if (blockOverwrite) {
        const reads = await Promise.all(slice.map(({ matricula }) => col.doc(matricula).get()));
        for (let j = 0; j < slice.length; j++) {
          if (reads[j].exists) {
            return res.status(409).json({ ok: false, error: `La matrícula ya existe: ${slice[j].matricula}` });
          }
        }
      }

      for (const { matricula, body } of slice) {
        const ref = col.doc(matricula);

        const nombreIndex = strip(`${body.nombres || ""} ${body.apellidos || ""}`);
        const matriculaIndex = strip(matricula || body.matricula || "");
        const correoIndex = strip(body.correoFamiliar || "");
        const nowISO = new Date().toISOString();

        const data = {
          ...body,
          // asegura índices/sellos
          nombreIndex,
          matriculaIndex,
          correoIndex,
          // 🔹 si vino hermanos/hermanoEstudiaAqui en el import, sanitiza:
          hermanos: sanitizeHermanos(body.hermanos),
          hermanoEstudiaAqui: Boolean(body.hermanoEstudiaAqui),
          updatedAt: nowISO,
          updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: nowISO,
          createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (!merge) {
          batch.set(ref, data, { merge: false });
          deltaTotal += 1;
        } else {
          batch.set(ref, data, { merge: true });
        }

        // limpia tombstone si existía
        batch.delete(tombstones.doc(matricula));
      }

      await batch.commit();
      written += slice.length;
    }

    // meta: versión++, y ajusta total (aprox)
    await bumpMeta({ deltaTotal, forceTouch: true });

    res.json({ ok: true, written });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
