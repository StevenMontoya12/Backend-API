// routes/alumnos.js
import { Router } from "express";
import { firestore } from "../firebase.js";
import { parse as parseCsv } from "csv-parse/sync";
import { mapExternalAlumno } from "../utils/mapExternaAlumno.js";
import admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { strip } from "../utils/normalize.js";

const router = Router();
const col = firestore.collection("alumnos");

// Sanitiza + defaults + índices normalizados
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

    // 🔎 índices normalizados
    nombreIndex: strip(`${body.nombres || ""} ${body.apellidos || ""}`),
    matriculaIndex: strip(body.matricula || ""),
    correoIndex: strip(body.correoFamiliar || ""),

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
      return res.status(409).json({ ok: false, error: "La matrícula ya existe" });
    }

    await ref.set({ ...f, createdAt: now });
    res.json({ ok: true, id: ref.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * Listar alumnos con búsqueda por prefijo y paginación por cursor compuesto.
 * Query:
 *  - q: string (>=2) para buscar por nombreIndex (prefijo)
 *  - pageSize: tamaño de página (default 50, máx 100)
 *  - cursores:
 *     * sin q: saApellido, saId
 *     * con q: saNombre, saId2   (nombreIndex + __name__)
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

    let query;

    if (hasQ) {
      const qNorm = strip(q);
      // Prefijo: nombreIndex ∈ [qNorm, qNorm + \uf8ff]
      query = col
        .orderBy("nombreIndex", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .startAt(qNorm)
        .endAt(qNorm + "\uf8ff")
        .limit(pageSize);

      if (saNombre && saId2) {
        query = query.startAfter(saNombre, saId2);
      }
    } else {
      // Lista sin filtro con orden estable
      query = col
        .orderBy("apellidos", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .limit(pageSize);

      if (saApellido && saId) {
        query = query.startAfter(saApellido, saId);
      }
    }

    // Página + total (si está disponible count())
    const [snap, agg] = await Promise.all([
      query.get(),
      col.count().get().catch(() => null),
    ]);

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const lastDoc = snap.docs[snap.docs.length - 1] || null;

    const next = lastDoc
      ? hasQ
        ? { saNombre: lastDoc.get("nombreIndex") || "", saId2: lastDoc.id }
        : { saApellido: lastDoc.get("apellidos") || "", saId: lastDoc.id }
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

        // 🔎 asegura índices normalizados en import
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