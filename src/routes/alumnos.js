// routes/alumnos.js
import { Router } from "express";
import { firestore } from "../firebase.js";
import { parse as parseCsv } from "csv-parse/sync";
import { mapExternalAlumno as mapExternaAlumno } from "../utils/mapExternaAlumno.js";
import admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { strip } from "../utils/normalize.js";

const router = Router();

/** 🔴 Evitar cache HTTP en todas las respuestas de este router */
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

const col = firestore.collection("alumnos");

/** ========================= Helpers ========================= */
function toAlumnoPayload(body) {
  const now = new Date().toISOString();

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

    numeroHermanos: body.numeroHermanos || "",

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

    // índices normalizados
    nombreIndex: strip(`${body.nombres || ""} ${body.apellidos || ""}`),
    matriculaIndex: strip(body.matricula || ""),
    correoIndex: strip(body.correoFamiliar || ""),

    updatedAt: now,
  };

  return { f, now };
}

function buildPatchFromBody(body) {
  const allowed = [
    "estatus","nombres","apellidos","genero","fechaNacimiento","curp","nacionalidad","clave",
    "grupoPrincipal","fechaIngreso","modalidad","religion","calleNumero","estado","municipio","colonia",
    "codigoPostal","telefonoCasa","telefonoCelular","contactoPrincipal","numeroHermanos","nombrePadre",
    "apellidosPadre","telefonoPadre","correoPadre","ocupacionPadre","empresaPadre","telefonoEmpresa",
    "tokenPago","exalumno","correoFamiliar","tipoBeca","porcentajeBeca","actividad","nombreFactura",
    "calleNumeroFactura","coloniaFactura","estadoFactura","municipioFactura","codigoPostalFactura",
    "telefonoCasaFactura","emailFactura","rfc","numeroCuenta","tipoCobro","usoCfdi","requiereFactura",
    "calificaciones","general","cobros","nivel","grado","grupo"
  ];
  const patch = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k];
  }
  if (Object.prototype.hasOwnProperty.call(patch, "matricula")) delete patch.matricula;
  return patch;
}

/** ========================= Endpoints ========================= */

// Crear
router.post("/", async (req, res) => {
  try {
    const { f, now } = toAlumnoPayload(req.body);
    if (!f.matricula) return res.status(400).json({ ok: false, error: "La matrícula es obligatoria" });

    const ref = col.doc(f.matricula);
    const snap = await ref.get();
    if (snap.exists) return res.status(409).json({ ok: false, error: "La matrícula ya existe" });

    const data = { ...f, createdAt: now };
    await ref.set(data);
    res.json({ ok: true, data: { id: ref.id, ...data } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Listado con búsqueda/paginación (prefijo sobre nombreIndex)
router.get("/", async (req, res) => {
  try {
    const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
    const q = (req.query.q || "").toString().trim();
    const hasQ = q.length >= 2;

    const saApellido = typeof req.query.saApellido === "string" ? req.query.saApellido : null;
    const saId       = typeof req.query.saId === "string" ? req.query.saId : null;
    const saNombre   = typeof req.query.saNombre === "string" ? req.query.saNombre : null;
    const saId2      = typeof req.query.saId2 === "string" ? req.query.saId2 : null;

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

    const [snap, agg] = await Promise.all([
      query.get(),
      col.count().get().catch(() => null),
    ]);

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const last = snap.docs[snap.docs.length - 1] || null;

    const next = last
      ? hasQ
        ? { saNombre: last.get("nombreIndex") || "", saId2: last.id }
        : { saApellido: last.get("apellidos") || "", saId: last.id }
      : null;

    res.json({
      ok: true,
      items,
      next,
      total: agg ? agg.data().count : undefined,
      pageSize,
    });
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

// Actualizar (merge real) + recalcular índices
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

    await ref.set(finalData, { merge: false });
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
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Import masivo (CSV / JSON)
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

    if (errors.length) return res.status(400).json({ ok: false, errors, validCount: converted.length });
    if (dryRun) return res.json({ ok: true, dryRun: true, count: converted.length });

    const BATCH_SIZE = 400;
    let written = 0;
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
        const data = {
          ...body,
          nombreIndex,
          matriculaIndex,
          correoIndex,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (!merge) {
          batch.set(ref, { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false });
        } else {
          batch.set(ref, { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
      }

      await batch.commit();
      written += slice.length;
    }

    res.json({ ok: true, written });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
