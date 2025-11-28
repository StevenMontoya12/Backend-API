// src/routes/colaboradores.js
import { Router } from "express";
import { firestore } from "../firebase.js";

const router = Router();
const COL = "colaboradores";

/* =========================
   Helpers (sanitización)
   ========================= */
const isPlainObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clampStr = (s, n = 300) => (typeof s === "string" ? s.slice(0, n) : s);

/** Elimina cualquier undefined en objetos/anidaciones */
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

/* =========================
   Normalización de payload
   ========================= */
const pickColaborador = (body) => {
  const out = {};

  // ===== Laboral
  out.nombres             = clampStr(body.nombres);
  out.apellidoPaterno     = clampStr(body.apellidoPaterno);
  out.apellidoMaterno     = clampStr(body.apellidoMaterno);
  out.nombrePreferido     = clampStr(body.nombrePreferido);
  out.correoInstitucional = clampStr(body.correoInstitucional);
  out.noEmpleado          = clampStr(body.noEmpleado);
  out.posicion            = clampStr(body.posicion);
  out.categoriaPuesto     = clampStr(body.categoriaPuesto);
  out.esquemaTrabajo      = clampStr(body.esquemaTrabajo);
  out.horasTrabajo        = Number(body.horasTrabajo ?? 0);
  out.extension           = clampStr(body.extension);
  out.jefeInmediato       = clampStr(body.jefeInmediato);
  out.director            = clampStr(body.director);
  out.direccion           = clampStr(body.direccion);
  out.fechaIngreso        = clampStr(body.fechaIngreso);
  out.fechaBaja           = clampStr(body.fechaBaja);
  out.estatus             = clampStr(body.estatus ?? "Activo");

  // ===== Personales
  out.fechaNacimiento = clampStr(body.fechaNacimiento);
  out.nss             = clampStr(body.nss);
  out.curp            = clampStr(body.curp);
  out.rfc             = clampStr(body.rfc);
  out.genero          = clampStr(body.genero);
  out.estadoCivil     = clampStr(body.estadoCivil);
  out.gradoEstudios   = clampStr(body.gradoEstudios);
  out.tallaCamisa     = clampStr(body.tallaCamisa);
  out.pasatiempos     = clampStr(body.pasatiempos, 2000);
  out.pastelFavorito  = clampStr(body.pastelFavorito);

  // ===== Médicos
  out.tipoSangre           = clampStr(body.tipoSangre);
  out.alergias             = clampStr(body.alergias, 2000);
  out.tratamientoMedico    = clampStr(body.tratamientoMedico, 2000);
  out.enfermedadesCronicas = isPlainObj(body.enfermedadesCronicas)
    ? {
        asma: !!body.enfermedadesCronicas.asma,
        diabetes: !!body.enfermedadesCronicas.diabetes,
        otra: clampStr(body.enfermedadesCronicas.otra),
      }
    : { asma: false, diabetes: false, otra: "" };

  // Historial médico
  out.historialMedico = Array.isArray(body.historialMedico)
    ? body.historialMedico.map((e) => ({
        fechaIso: clampStr(e.fechaIso),
        tipo: clampStr(e.tipo),
        descripcion: clampStr(e.descripcion, 1000),
        registradoPor: clampStr(e.registradoPor),
        observaciones: clampStr(e.observaciones, 1000),
      }))
    : [];

  // ===== Contacto
  out.telCel        = clampStr(body.telCel);
  out.telCasa       = clampStr(body.telCasa);
  out.emailPersonal = clampStr(body.emailPersonal);
  out.calleNumero   = clampStr(body.calleNumero);
  out.colonia       = clampStr(body.colonia);
  out.codigoPostal  = clampStr(body.codigoPostal);
  out.estado        = clampStr(body.estado);
  out.municipio     = clampStr(body.municipio);
  out.contactosEmergencia = Array.isArray(body.contactosEmergencia)
    ? body.contactosEmergencia.map((c) => ({
        nombre: clampStr(c.nombre),
        telefono: clampStr(c.telefono),
        parentesco: clampStr(c.parentesco),
      }))
    : [];

  // ===== Familia
  if (Array.isArray(body.familia)) {
    out.familia = body.familia.map((m) => ({
      nombre: clampStr(m.nombre),
      parentesco: clampStr(m.parentesco),
      edad: Number(m.edad ?? 0),
      telefono: clampStr(m.telefono),
      escolaridad: clampStr(m.escolaridad),
      viveConEl: !!m.viveConEl,
      observaciones: clampStr(m.observaciones, 1000),
    }));
  }

  // ===== Dependientes
  if (Array.isArray(body.dependientes)) {
    out.dependientes = body.dependientes.map((d) => ({
      nombres: clampStr(d.nombres),
      aPaterno: clampStr(d.aPaterno),
      aMaterno: clampStr(d.aMaterno),
      fechaNacIso: clampStr(d.fechaNacIso),
      parentesco: clampStr(d.parentesco),
      estudiante: !!d.estudiante,
    }));
  }

  // ===== Documentos (solo metadatos)
  if (isPlainObj(body.documentos)) {
    const docOut = {};
    for (const [k, v] of Object.entries(body.documentos)) {
      docOut[k] = {
        fileName: clampStr(v?.fileName),
        mime: clampStr(v?.mime),
        size: Number(v?.size ?? 0),
        status: ["ok", "faltante", "revisar"].includes(v?.status)
          ? v.status
          : "faltante",
      };
    }
    out.documentos = docOut;
  }

  // Comentarios finales
  out.comentarios = clampStr(body.comentarios, 2000);

  return out;
};

/* ================
   Rutas CRUD
   ================ */

/**
 * GET /api/colaboradores
 * ?limit=50
 * ?q=texto         → filtro por nombre/apellidos/correo
 * ?onlyDocentes=1  → preferentemente registros cuyo puesto incluya "docente"
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 200);
    const qText = String(req.query.q || "").trim();

    const onlyDocentesRaw = String(req.query.onlyDocentes || "").toLowerCase();
    const onlyDocentes =
      onlyDocentesRaw === "1" ||
      onlyDocentesRaw === "true" ||
      onlyDocentesRaw === "yes";

    const snap = await firestore
      .collection(COL)
      .orderBy("apellidoPaterno", "asc")
      .limit(limit)
      .get();

    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const norm = (s = "") =>
      s
        .toString()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();

    // 🔎 filtro por texto libre
    if (qText) {
      const nq = norm(qText);
      items = items.filter((c) => {
        const blobs = [
          c.nombres,
          c.apellidoPaterno,
          c.apellidoMaterno,
          c.nombrePreferido,
          c.correoInstitucional,
          c.noEmpleado,
        ];
        return blobs.some((b) => norm(b).includes(nq));
      });
    }

    // 🔹 solo docentes (por posicion / categoriaPuesto)
    if (onlyDocentes) {
      const filtrados = items.filter((c) => {
        const pos = (c.posicion || "").toString().toLowerCase();
        const cat = (c.categoriaPuesto || "").toString().toLowerCase();
        return pos.includes("docente") || cat.includes("docente");
      });

      // Si no hay ninguno marcado como docente, devolvemos todos
      if (filtrados.length > 0) {
        items = filtrados;
      }
    }

    res.json({ ok: true, items, nextCursor: null });
  } catch (e) {
    console.error("[GET /colaboradores] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/colaboradores/:id
router.get("/:id", async (req, res) => {
  try {
    const d = await firestore.collection(COL).doc(req.params.id).get();
    if (!d.exists) {
      return res.status(404).json({ ok: false, error: "No encontrado" });
    }
    res.json({ ok: true, item: { id: d.id, ...d.data() } });
  } catch (e) {
    console.error("[GET /colaboradores/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/colaboradores
router.post("/", async (req, res) => {
  try {
    const raw = pickColaborador(req.body);
    const data = stripUndefinedDeep(raw);

    if (!data.noEmpleado) {
      return res
        .status(400)
        .json({ ok: false, error: "noEmpleado es requerido" });
    }
    if (!data.posicion) {
      return res
        .status(400)
        .json({ ok: false, error: "posicion es requerida" });
    }

    const dup = await firestore
      .collection(COL)
      .where("noEmpleado", "==", data.noEmpleado)
      .limit(1)
      .get();
    if (!dup.empty) {
      return res
        .status(409)
        .json({ ok: false, error: "noEmpleado ya existe" });
    }

    data.createdAt = new Date();
    data.updatedAt = new Date();

    const ref = await firestore.collection(COL).add(data);
    res.status(201).json({ ok: true, id: ref.id });
  } catch (e) {
    console.error("[POST /colaboradores] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// PUT /api/colaboradores/:id
router.put("/:id", async (req, res) => {
  try {
    const raw = pickColaborador(req.body);
    const data = stripUndefinedDeep(raw);
    data.updatedAt = new Date();

    await firestore.collection(COL).doc(req.params.id).set(data, { merge: false });
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /colaboradores/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// PATCH /api/colaboradores/:id
router.patch("/:id", async (req, res) => {
  try {
    const raw = pickColaborador(req.body);
    const data = stripUndefinedDeep(raw);
    data.updatedAt = new Date();

    await firestore.collection(COL).doc(req.params.id).set(data, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error("[PATCH /colaboradores/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// DELETE /api/colaboradores/:id
router.delete("/:id", async (req, res) => {
  try {
    await firestore.collection(COL).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /colaboradores/:id] error:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
