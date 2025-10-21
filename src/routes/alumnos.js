// src/routes/alumnos.js
import { Router } from "express";
import { firestore } from "../firebase.js";
import { parse as parseCsv } from "csv-parse/sync";
import admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { strip } from "../utils/normalize.js";
// (opcional) mapper de import masivo
import { mapExternalAlumno as mapExternaAlumno } from "../utils/mapExternaAlumno.js";

const router = Router();
const col = firestore.collection("alumnos");
const tombstones = firestore.collection("alumnos_deleted");
const metasDoc = firestore.doc("metas/alumnos");

// ────────────────────────────────────────────────────────────────
// Helpers de meta
// ────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────
// Sanitizadores
// ────────────────────────────────────────────────────────────────
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function sanitizeHistorialActividad(input) {
  if (!Array.isArray(input)) return [];
  const T = new Set(["alta", "baja", "cambio"]);
  const clean = (v) => (v == null ? "" : String(v).trim());

  return input
    .map((r) => {
      const fecha = new Date(r?.fechaIso ?? r?.fecha ?? "");
      const tipo = clean(r?.tipo || "").toLowerCase();
      if (!T.has(tipo)) return null;
      if (Number.isNaN(fecha.getTime())) return null;
      return {
        fechaIso: fecha.toISOString(),
        tipo,
        motivo: clean(r?.motivo),
        usuario: clean(r?.usuario),
        notas: clean(r?.notas),
      };
    })
    .filter(Boolean);
}

// cada hermano guardado en el doc del alumno
function sanitizeHermano(h) {
  if (!h) return null;
  const id = String(h.id || h.matricula || "").trim();
  if (!id) return null;
  const out = {
    id,
    matricula: String(h.matricula || id).trim(),
    nombres: String(h.nombres || "").trim(),
    apellidos: String(h.apellidos || "").trim(),
    grupoPrincipal: String(h.grupoPrincipal || "").trim(),
  };
  if (h.nivel) out.nivel = String(h.nivel);
  if (h.grado) out.grado = String(h.grado);
  return out;
}

/**
 * Normaliza TODOS los campos de la sección de Becas que llegan desde el front.
 * Se devuelven EN PLANO (no anidados) para mantener compatibilidad con el front actual.
 */
function sanitizeBecaFlat(body) {
  const txt = (k, d = "") => (body[k] == null ? d : String(body[k]).trim());
  const bool = (k) => Boolean(body[k]);
  const digits = (k, { min = 0, max = Infinity, allowEmpty = true } = {}) => {
    const raw = String(body[k] ?? "");
    const only = raw.replace(/[^\d]/g, "");
    if (allowEmpty && only === "") return "";
    let n = Number(only);
    if (Number.isNaN(n)) n = 0;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  };
  const date = (k) => {
    const v = String(body[k] ?? "").trim();
    if (!v) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : v.slice(0, 10); // yyyy-mm-dd
  };
  const arr = (k, allow = []) => {
    const v = Array.isArray(body[k]) ? body[k] : [];
    const S = new Set(allow);
    return v.map(String).filter((x) => S.has(x));
  };

  // valores permitidos
  const aplicaAllow = [
    "colegiatura",
    "inscripcion",
    "reinscripcion",
    "transporte",
    "comedor",
    "materiales",
    "actividades",
  ];

  const out = {
    tipoBeca: txt("tipoBeca"),
    tipoBecaOtro: txt("tipoBecaOtro"),
    fuenteBeca: txt("fuenteBeca"),
    convenioEmpresa: txt("convenioEmpresa"),
    patrocinador: txt("patrocinador"),
    folioBeca: txt("folioBeca"),

    porcentajeBeca: digits("porcentajeBeca", { min: 0, max: 100, allowEmpty: false }), // 0–100
    topeMensual: digits("topeMensual", { min: 0, allowEmpty: true }),

    vigenciaInicio: date("vigenciaInicio"),
    vigenciaFin: date("vigenciaFin"),

    aplicaA: arr("aplicaA", aplicaAllow),

    estatusBeca: txt("estatusBeca", "activa"),
    renovable: bool("renovable"),

    requiereServicio: bool("requiereServicio"),
    horasServicio: digits("horasServicio", { min: 0, allowEmpty: true }),

    promedioMinimo: digits("promedioMinimo", { min: 0, max: 100, allowEmpty: true }),
    observacionesBeca: txt("observacionesBeca"),
  };

  // Si tipoBeca no es "Otra", limpiar especificar
  if (out.tipoBeca !== "Otra") out.tipoBecaOtro = "";
  // Condicionales por fuente
  if (out.fuenteBeca !== "Convenio empresarial") out.convenioEmpresa = "";
  if (out.fuenteBeca !== "Fundación / Patrocinio") out.patrocinador = "";

  // Si vigencias vienen invertidas, corrige
  if (out.vigenciaInicio && out.vigenciaFin) {
    const a = new Date(out.vigenciaInicio);
    const b = new Date(out.vigenciaFin);
    if (a > b) {
      const tmp = out.vigenciaInicio;
      out.vigenciaInicio = out.vigenciaFin;
      out.vigenciaFin = tmp;
    }
  }

  return out;
}

// payload de alta/edición completo
function toAlumnoPayload(body) {
  const nowISO = new Date().toISOString();

  const hermanos = Array.isArray(body.hermanos)
    ? body.hermanos.map(sanitizeHermano).filter(Boolean)
    : [];

  // —— Becas (campos en plano) ——
  const beca = sanitizeBecaFlat(body);

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

    numeroHermanos: Number.isFinite(Number(body.numeroHermanos)) ? Number(body.numeroHermanos) : 0,
    hermanoEstudiaAqui: Boolean(body.hermanoEstudiaAqui),
    hermanos, // ← guardado real

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

    // ====== BECAS (todos planos) ======
    ...beca,

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

    // (opcionales si los manejas)
    nivel: body.nivel || "",
    grado: body.grado || "",
    grupo: body.grupo || "",

    // historial + índices + sellos
    historialActividad: sanitizeHistorialActividad(body.historialActividad),
    nombreIndex: strip(`${body.nombres || ""} ${body.apellidos || ""}`),
    matriculaIndex: strip(body.matricula || ""),
    correoIndex: strip(body.correoFamiliar || ""),
    updatedAt: nowISO,
    updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
  };

  return { f, nowISO };
}

/** Construye patch parcial (solo campos presentes) + sanitiza. */
function buildPatchFromBody(body) {
  // lista blanca base
  const allowed = [
    "estatus","nombres","apellidos","genero","fechaNacimiento","curp","nacionalidad","clave",
    "grupoPrincipal","fechaIngreso","modalidad","religion","calleNumero","estado","municipio","colonia",
    "codigoPostal","telefonoCasa","telefonoCelular","contactoPrincipal","numeroHermanos","nombrePadre",
    "apellidosPadre","telefonoPadre","correoPadre","ocupacionPadre","empresaPadre","telefonoEmpresa",
    "tokenPago","exalumno","correoFamiliar","actividad","nombreFactura",
    "calleNumeroFactura","coloniaFactura","estadoFactura","municipioFactura","codigoPostalFactura",
    "telefonoCasaFactura","emailFactura","rfc","numeroCuenta","tipoCobro","usoCfdi","requiereFactura",
    "calificaciones","general","cobros","nivel","grado","grupo","historialActividad",
    // hermanos
    "hermanos","hermanoEstudiaAqui",
    // ===== BECAS (nuevos, planos) =====
    "tipoBeca","tipoBecaOtro","fuenteBeca","convenioEmpresa","patrocinador","folioBeca",
    "porcentajeBeca","topeMensual","vigenciaInicio","vigenciaFin","aplicaA",
    "estatusBeca","renovable","requiereServicio","horasServicio","promedioMinimo","observacionesBeca",
  ];

  const patch = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "matricula")) delete patch.matricula;

  // sanitiza estructuras
  if (Object.prototype.hasOwnProperty.call(patch, "historialActividad")) {
    patch.historialActividad = sanitizeHistorialActividad(patch.historialActividad);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "hermanos")) {
    patch.hermanos = Array.isArray(patch.hermanos)
      ? patch.hermanos.map(sanitizeHermano).filter(Boolean)
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "hermanoEstudiaAqui")) {
    patch.hermanoEstudiaAqui = Boolean(patch.hermanoEstudiaAqui);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "numeroHermanos")) {
    patch.numeroHermanos = Number.isFinite(Number(patch.numeroHermanos))
      ? Number(patch.numeroHermanos)
      : 0;
  }

  // sanitiza todos los campos de beca en plano (solo si llegaron)
  const becaFromBody = sanitizeBecaFlat({ ...patch, ...body });
  for (const k of Object.keys(becaFromBody)) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      patch[k] = becaFromBody[k];
    }
  }

  return patch;
}

// ────────────────────────────────────────────────────────────────
// Endpoints
// ────────────────────────────────────────────────────────────────

// META
router.get("/meta", async (_req, res) => {
  try {
    const meta = await readMeta();
    res.json({ ok: true, ...meta });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// CHANGES
router.get("/changes", async (req, res) => {
  try {
    const since = String(req.query.since || "").trim();
    if (!since) return res.status(400).json({ ok: false, error: "since requerido (ISO date)" });
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return res.status(400).json({ ok: false, error: "since inválido" });
    }

    const nowISO = new Date().toISOString();

    const qUpdated = await col
      .where("updatedAtTs", ">", sinceDate)
      .orderBy("updatedAtTs", "asc")
      .limit(1000)
      .get();
    const updated = qUpdated.docs.map((d) => ({ id: d.id, ...d.data() }));

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

// 🔎 búsqueda ligera para hermanos
router.get("/search", async (req, res) => {
  try {
    const term = String(req.query.term || "").trim();
    const limit = Math.min(Number(req.query.limit || 10), 50);
    if (term.length < 2) return res.json({ ok: true, items: [] });

    const push = (map, d) => {
      if (!d?.exists) return;
      const data = d.data() || {};
      map.set(d.id, {
        id: d.id,
        matricula: d.id,
        nombres: data.nombres || "",
        apellidos: data.apellidos || "",
        grupoPrincipal: data.grupoPrincipal || "",
        nivel: data.nivel || undefined,
        grado: data.grado || undefined,
      });
    };

    // por apellidos
    let q1 = col
      .orderBy("apellidos", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .startAt(term)
      .endAt(term + "\uf8ff")
      .limit(limit);
    const snap1 = await q1.get();

    // por nombres
    let q2 = col
      .orderBy("nombres", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .startAt(term)
      .endAt(term + "\uf8ff")
      .limit(limit);
    const snap2 = await q2.get();

    // matrícula exacta
    const byId = await col.doc(term).get();

    const map = new Map();
    snap1.docs.forEach((d) => push(map, d));
    snap2.docs.forEach((d) => push(map, d));
    if (byId.exists) push(map, byId);

    const items = Array.from(map.values()).slice(0, limit);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Crear
router.post("/", async (req, res) => {
  try {
    const { f, nowISO } = toAlumnoPayload(req.body);
    if (!f.matricula) return res.status(400).json({ ok: false, error: "La matrícula es obligatoria" });

    const ref = col.doc(f.matricula);
    if ((await ref.get()).exists) {
      return res.status(409).json({ ok: false, error: "La matrícula ya existe" });
    }

    const data = {
      ...f,
      createdAt: nowISO,
      createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
    };

    // auto-historial si viene vacío
    if (!Array.isArray(data.historialActividad) || data.historialActividad.length === 0) {
      data.historialActividad = [{
        fechaIso: nowISO, tipo: "alta", motivo: "Alta inicial", usuario: "sistema", notas: ""
      }];
    }

    await ref.set(data);
    await tombstones.doc(ref.id).delete().catch(() => {});
    await bumpMeta({ deltaTotal: +1, forceTouch: true });

    res.json({ ok: true, data: { id: ref.id, ...data } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Listar (búsqueda y cursor)
router.get("/", async (req, res) => {
  try {
    const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
    const q = (req.query.q || "").toString().trim();
    const hasQ = q.length >= 2;

    const saApellido = typeof req.query.saApellido === "string" ? req.query.saApellido : null;
    const saId       = typeof req.query.saId === "string" ? req.query.saId : null;
    const saNombre   = typeof req.query.saNombre === "string" ? req.query.saNombre : null;
    const saId2      = typeof req.query.saId2 === "string" ? req.query.saId2 : null;

    const meta = await readMeta();
    const etag = `"alumnos:${meta.version}|q=${hasQ ? q : ""}|ps=${pageSize}|a=${saApellido || ""}|i=${saId || ""}|n=${saNombre || ""}|i2=${saId2 || ""}"`;
    const inm = req.headers["if-none-match"];
    if (inm && inm === etag) return res.status(304).end();

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
    res.json({ ok: true, items, next, total: meta.total, pageSize });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Obtener por matrícula
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

// Patch/merge (recalcula índices)
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
    await bumpMeta({ deltaTotal: 0, forceTouch: true });

    res.json({ ok: true, data: { id, ...finalData } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Eliminar
router.delete("/:matricula", async (req, res) => {
  try {
    const id = req.params.matricula;
    await col.doc(id).delete();

    const nowISO = new Date().toISOString();
    await tombstones.doc(id).set({
      id,
      deletedAt: nowISO,
      deletedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    });

    await bumpMeta({ deltaTotal: -1, forceTouch: true });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Import masivo (opcional)
router.post("/import", async (req, res) => {
  try {
    const dryRun = String(req.query.dryRun || "false").toLowerCase() === "true";
    const merge = String(req.query.merge || "true").toLowerCase() === "true";
    const blockOverwrite = String(req.query.blockOverwrite || "false").toLowerCase() === "true";

    let rows = [];
    if (req.is("text/csv")) {
      rows = parseCsv(req.body, { columns: true, skip_empty_lines: true, trim: true });
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
    if (errors.length) return res.status(400).json({ ok: false, errors, validCount: converted.length });
    if (dryRun) return res.json({ ok: true, dryRun: true, count: converted.length });

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

        // TIP: si importas también becas, puedes pasar sanitizeBecaFlat(body) aquí
        const data = {
          ...body,
          nombreIndex,
          matriculaIndex,
          correoIndex,
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

        batch.delete(tombstones.doc(matricula));
      }

      await batch.commit();
      written += slice.length;
    }

    await bumpMeta({ deltaTotal, forceTouch: true });
    res.json({ ok: true, written });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
