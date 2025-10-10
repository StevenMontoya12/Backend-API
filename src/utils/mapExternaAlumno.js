// src/utils/mapExternalAlumno.js
import { trim, toIsoDate, normalizeGenero, normalizeEstatus } from "./normalize.js";

// Recibe una fila externa (de CSV/JSON) y devuelve:
// { matricula, body } donde body coincide con lo que tu toAlumnoPayload espera.
export function mapExternalAlumno(row) {
  const nombres = trim(row.names ?? row.nombres);
  const apP = trim(row.paternal_last_name ?? "");
  const apM = trim(row.maternal_last_name ?? "");
  const apellidos = [apP, apM].filter(Boolean).join(" ").trim();

  // Fuente para la matrícula (ID de doc): student_number o clave
  const matricula = trim(row.student_number || row.clave);
  if (!matricula) throw new Error("Fila sin student_number/clave (matrícula obligatoria)");

  // Modalidad (opcional: re-mapea números/cadenas)
  const modalidadRaw = trim(row.modality_id ?? row.modalidad);
  const modalidad = (() => {
    const m = modalidadRaw.toLowerCase();
    if (["2", "mixta", "mixed", "hybrid"].includes(m)) return "mixta";
    if (["1", "presencial", "onsite"].includes(m)) return "presencial";
    if (["3", "online", "en linea", "en línea"].includes(m)) return "en línea";
    return modalidadRaw; // deja valor tal cual si no coincide
  })();

  const body = {
    // Campos base
    matricula,
    estatus: normalizeEstatus(row.is_active ?? row.estatus),
    nombres,
    apellidos,
    genero: normalizeGenero(row.gender ?? row.genero),
    fechaNacimiento: toIsoDate(row.date_of_birth ?? row.fechaNacimiento),
    curp: trim(row.CURP ?? row.curp),
    nacionalidad: trim(row.nationality ?? row.nacionalidad),
    clave: trim(row.clave ?? ""),

    grupoPrincipal: trim(row.school_grade_group_name ?? row.grupoPrincipal),
    fechaIngreso: toIsoDate(row.fechaIngreso ?? ""),
    modalidad,

    religion: trim(row.religion ?? ""),

    // Dirección
    calleNumero: trim(row.street ?? row.calleNumero),
    estado: trim(row.state_id ?? row.estado),
    municipio: trim(row.city_id ?? row.municipio),
    colonia: trim(row.district ?? row.colonia),
    codigoPostal: trim(row.zip_code ?? row.codigoPostal),

    // Contactos
    telefonoCasa: trim(row.phone ?? row.telefonoCasa),
    telefonoCelular: trim(row.cell_phone ?? row.telefonoCelular),
    contactoPrincipal: trim(row.principal_contact_name ?? row.contactoPrincipal),

    numeroHermanos: trim(row.numeroHermanos ?? ""),

    nombrePadre: trim(row.principal_contact_name ?? row.nombrePadre),
    apellidosPadre: trim(row.apellidosPadre ?? ""),
    telefonoPadre: trim(row.contact_phone ?? row.telefonoPadre),
    correoPadre: trim(row.contact_email ?? row.email ?? row.correoPadre),
    ocupacionPadre: trim(row.ocupacionPadre ?? ""),
    empresaPadre: trim(row.empresaPadre ?? ""),
    telefonoEmpresa: trim(row.telefonoEmpresa ?? ""),
    tokenPago: trim(row.tokenPago ?? ""),
    exalumno: trim(row.exalumno ?? "no"),
    correoFamiliar: trim(row.family_email ?? row.correoFamiliar),

    // Becas
    tipoBeca: trim(row.tipoBeca ?? ""),
    porcentajeBeca: trim(row.porcentajeBeca ?? ""),

    // Facturación (si no vienen, quedarán vacíos)
    nombreFactura: trim(row.nombreFactura ?? ""),
    calleNumeroFactura: trim(row.calleNumeroFactura ?? ""),
    coloniaFactura: trim(row.coloniaFactura ?? ""),
    estadoFactura: trim(row.estadoFactura ?? ""),
    municipioFactura: trim(row.municipioFactura ?? ""),
    codigoPostalFactura: trim(row.codigoPostalFactura ?? ""),
    telefonoCasaFactura: trim(row.telefonoCasaFactura ?? ""),
    emailFactura: trim(row.emailFactura ?? ""),
    rfc: trim(row.rfc ?? ""),
    numeroCuenta: trim(row.numeroCuenta ?? ""),
    tipoCobro: trim(row.tipoCobro ?? ""),
    usoCfdi: trim(row.usoCfdi ?? ""),
    requiereFactura: trim(row.requiereFactura ?? "no"),

    // Varios
    calificaciones: trim(row.calificaciones ?? ""),
    general: trim(row.school_level_name ?? row.general ?? row.school_fullname ?? ""),
    cobros: trim(row.cobros ?? ""),
  };

  return { matricula, body };
}
