// src/routes/alumnos/constants.js
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const SEARCH_LIMIT_MAX = 50;
export const BATCH_SIZE = 400;

export const BECA_APLICA_ALLOW = Object.freeze([
  "colegiatura","inscripcion","reinscripcion","transporte","comedor","materiales","actividades",
]);

export const PATCH_ALLOWED = new Set([
  "estatus","nombres","apellidos","genero","fechaNacimiento","curp","nacionalidad","clave",
  "grupoPrincipal","fechaIngreso","modalidad","religion","calleNumero","estado","municipio","colonia",
  "codigoPostal","telefonoCasa","telefonoCelular","contactoPrincipal","numeroHermanos","nombrePadre",
  "apellidosPadre","telefonoPadre","correoPadre","ocupacionPadre","empresaPadre","telefonoEmpresa",
  "tokenPago","exalumno","correoFamiliar","actividad","nombreFactura",
  "calleNumeroFactura","coloniaFactura","estadoFactura","municipioFactura","codigoPostalFactura",
  "telefonoCasaFactura","emailFactura","rfc","numeroCuenta","tipoCobro","usoCfdi","requiereFactura",
  "calificaciones","general","cobros","nivel","grado","grupo","historialActividad",
  "hermanos","hermanoEstudiaAqui",
  "tipoBeca","tipoBecaOtro","fuenteBeca","convenioEmpresa","patrocinador","folioBeca",
  "porcentajeBeca","topeMensual","vigenciaInicio","vigenciaFin","aplicaA",
  "estatusBeca","renovable","requiereServicio","horasServicio","promedioMinimo","observacionesBeca",
]);

export const TIPO_HIST_SET = new Set(["alta","baja","cambio"]);
