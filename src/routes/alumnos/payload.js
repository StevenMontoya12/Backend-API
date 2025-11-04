// src/routes/alumnos/payload.js
import { strip } from "../../utils/normalize.js";
import { sanitizeBecaFlat } from "./beca.js";
import {
  sanitizeHermano,
  sanitizeHistorialActividad,
  numFrom,
  cleanStr,
  sanitizeContactosFamilia, // 👈 nuevo
} from "./sanitize.js";
import { serverTS, nowIso } from "./helpers.js";
import { PATCH_ALLOWED } from "./constants.js";

console.log("[alumnos/payload] loaded from", import.meta.url);

export function toAlumnoPayload(body = {}) {
  const nowISO = nowIso();

  const hermanos = Array.isArray(body.hermanos)
    ? body.hermanos.map(sanitizeHermano).filter(Boolean)
    : [];

  // 👇 nuevo: normalizamos contactos de familia
  const contactosFamilia = sanitizeContactosFamilia(body.contactosFamilia);

  const beca = sanitizeBecaFlat(body);

  const f = {
    // Identidad / estado base
    matricula: cleanStr(body.matricula),
    estatus: body.estatus || "activo",

    // Datos personales
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

    // Contacto y domicilio
    calleNumero: body.calleNumero || "",
    estado: body.estado || "",
    municipio: body.municipio || "",
    colonia: body.colonia || "",
    codigoPostal: body.codigoPostal || "",
    telefonoCasa: body.telefonoCasa || "",
    telefonoCelular: body.telefonoCelular || "",
    contactoPrincipal: body.contactoPrincipal || "",

    // Familia y hermanos
    numeroHermanos: numFrom(body.numeroHermanos, 0),
    hermanoEstudiaAqui: Boolean(body.hermanoEstudiaAqui),
    hermanos,

    // Tutor/Padre
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

    // Beca (normalizada)
    ...beca,

    // Otros
    actividad: body.actividad || "",

    // Facturación
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

    // Academia / agrupación
    calificaciones: body.calificaciones || "",
    general: body.general || "",
    cobros: body.cobros || "",
    nivel: body.nivel || "",
    grado: body.grado || "",
    grupo: body.grupo || "",

    // Historial (normalizado)
    historialActividad: sanitizeHistorialActividad(body.historialActividad),

    // 👇 nuevo: lista de contactos familiares
    contactosFamilia,

    // índices y metadatos comunes
    nombreIndex: strip(`${body.nombres || ""} ${body.apellidos || ""}`),
    matriculaIndex: strip(body.matricula || ""),
    correoIndex: strip(body.correoFamiliar || ""),
    updatedAt: nowISO,
    updatedAtTs: serverTS(),
  };

  return { f, nowISO };
}

export function buildPatchFromBody(body = {}) {
  const patch = {};
  for (const k of Object.keys(body)) {
    if (PATCH_ALLOWED.has(k)) patch[k] = body[k];
  }

  // Normaliza según los campos presentes en el PATCH
  if ("historialActividad" in patch) {
    patch.historialActividad = sanitizeHistorialActividad(patch.historialActividad);
  }

  if ("hermanos" in patch) {
    patch.hermanos = Array.isArray(patch.hermanos)
      ? patch.hermanos.map(sanitizeHermano).filter(Boolean)
      : [];
  }

  if ("hermanoEstudiaAqui" in patch) {
    patch.hermanoEstudiaAqui = Boolean(patch.hermanoEstudiaAqui);
  }

  if ("numeroHermanos" in patch) {
    patch.numeroHermanos = numFrom(patch.numeroHermanos, 0);
  }

  // 👇 nuevo: sanea si llega en el PATCH
  if ("contactosFamilia" in patch) {
    patch.contactosFamilia = sanitizeContactosFamilia(patch.contactosFamilia);
  }

  // Normaliza beca SOLO para los campos presentes
  const becaFromBody = sanitizeBecaFlat({ ...patch, ...body });
  for (const k of Object.keys(becaFromBody)) {
    if (k in patch) patch[k] = becaFromBody[k];
  }

  return patch;
}
