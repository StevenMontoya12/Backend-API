import { Router } from "express";
import { firestore } from "../firebase.js";
import { parse as parseCsv } from "csv-parse/sync";
import { mapExternalAlumno } from "../utils/mapExternaAlumno.js";
import admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore"; // 👈 para documentId()

const router = Router();
const col = firestore.collection("alumnos");

// util: sanitizar y defaults
function toAlumnoPayload(body) {
  const now = new Date().toISOString();

  // Clona y fuerza strings para evitar undefined
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

    updatedAt: now,
  };

  return { f, now };
}

// Crear alumno (ID = matrícula)
router.post("/", async (req, res) => {
  try {
    const { f, now } = toAlumnoPayload(req.body);

    if (!f.matricula) {
      return res.status(400).json({ ok: false, error: "La matrícula es obligatoria" });
    }

    const ref = col.doc(f.matricula);
    const snap = await ref.get();
    if (snap.exists) {
      // Si quieres permitir overwrite, elimina este bloque
      return res.status(409).json({ ok: false, error: "La matrícula ya existe" });
    }

    await ref.set({ ...f, createdAt: now });
    res.json({ ok: true, id: ref.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * Listar alumnos
 * - Paginación con cursor doble (apellidos + documentId)
 * - Parámetros:
 *    - pageSize: tamaño de página (default 50, máx 500)
 *    - saApellido, saId: cursores de la página anterior
 *    - all=true: (opcional) trae TODO en lotes sin tocar el front
 */
router.get("/", async (req, res) => {
  try {
    const fetchAll = String(req.query.all || "false").toLowerCase() === "true";

    const pageSize = Math.min(Number(req.query.pageSize || 50), 500);
    const saApellido = typeof req.query.saApellido === "string" ? req.query.saApellido : null;
    const saId       = typeof req.query.saId === "string" ? req.query.saId : null;

    const getPage = async (apellidoCursor, idCursor) => {
      let q = col
        .orderBy("apellidos", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .limit(pageSize);

      if (apellidoCursor !== null && idCursor !== null) {
        q = q.startAfter(apellidoCursor, idCursor);
      }

      const snap = await q.get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const last = snap.docs[snap.docs.length - 1] || null;
      const next = last
        ? { saApellido: (last.get("apellidos") ?? ""), saId: last.id }
        : null;

      return { items, next };
    };

    if (!fetchAll) {
      const { items, next } = await getPage(saApellido, saId);
      return res.json({ ok: true, items, next, pageSize });
    }

    // Modo all=true: itera hasta traer todo (útil mientras ajustas el front)
    let allItems = [];
    let cursorApe = saApellido ?? null;
    let cursorId  = saId ?? null;

    for (let i = 0; i < 200; i++) { // tope de seguridad
      const { items, next } = await getPage(cursorApe, cursorId);
      allItems = allItems.concat(items);
      if (!next) break;
      cursorApe = next.saApellido;
      cursorId  = next.saId;
    }

    return res.json({ ok: true, items: allItems, next: null, pageSize });
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

// Actualizar (merge) por matrícula
router.patch("/:matricula", async (req, res) => {
  try {
    const { f, now } = toAlumnoPayload(req.body);
    const ref = col.doc(req.params.matricula);

    // Evita que cambien la matrícula del doc
    delete f.matricula;

    await ref.set({ ...f, updatedAt: now }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Eliminar
router.delete("/:matricula", async (req, res) => {
  try {
    await col.doc(req.params.matricula).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Import masivo: CSV (text/csv) o JSON (application/json)
// Query:
//   ?dryRun=true        -> valida y NO escribe
//   ?merge=true         -> upsert (conserva campos previos)
//   ?blockOverwrite=true-> si existe y merge=true, falla
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
        const { matricula, body } = mapExternalAlumno(rows[i]);
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
        const data = { ...body, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
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
