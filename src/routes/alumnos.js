import { Router } from "express";
import { firestore } from "../firebase.js";

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

// Listar alumnos (paginación simple con ?limit=&startAfter=)
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const startAfter = req.query.startAfter;

    let q = col.orderBy("apellidos").limit(limit);
    if (startAfter) q = q.startAfter(startAfter);

    const snap = await q.get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, data, nextStartAfter: data.at(-1)?.apellidos || null });
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

export default router;
