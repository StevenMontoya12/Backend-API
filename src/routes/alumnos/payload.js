// src/routes/alumnos/payload.js
import { strip } from "../../utils/normalize.js";
import { sanitizeBecaFlat } from "./beca.js";
import {
  sanitizeHermano,
  sanitizeHistorialActividad,
  numFrom,
  cleanStr,
} from "./sanitize.js";
import { serverTS, nowIso } from "./helpers.js";
import { PATCH_ALLOWED } from "./constants.js";

console.log("[alumnos/payload] loaded from", import.meta.url);

export function toAlumnoPayload(body = {}) {
  const nowISO = nowIso();

  const hermanos = Array.isArray(body.hermanos)
    ? body.hermanos.map(sanitizeHermano).filter(Boolean)
    : [];

  const beca = sanitizeBecaFlat(body);

  const f = {
    matricula: cleanStr(body.matricula),

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

    numeroHermanos: numFrom(body.numeroHermanos, 0),
    hermanoEstudiaAqui: Boolean(body.hermanoEstudiaAqui),
    hermanos,

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

    nivel: body.nivel || "",
    grado: body.grado || "",
    grupo: body.grupo || "",

    historialActividad: sanitizeHistorialActividad(body.historialActividad),

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

  // Normaliza beca SOLO para campos presentes
  const becaFromBody = sanitizeBecaFlat({ ...patch, ...body });
  for (const k of Object.keys(becaFromBody)) {
    if (k in patch) patch[k] = becaFromBody[k];
  }

  return patch;
}
