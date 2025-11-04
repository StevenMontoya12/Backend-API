// src/routes/alumnos/beca.js
import { BECA_APLICA_ALLOW } from "./constants.js";
import { makeParsers } from "./sanitize.js";

/**
 * Normaliza los campos de beca en forma "flat".
 * Devuelve solo los campos de beca, listos para merge.
 */
export function sanitizeBecaFlat(body = {}) {
  const { txt, bool, digits, date, arr } = makeParsers(body);

  const out = {
    tipoBeca: txt("tipoBeca"),
    tipoBecaOtro: txt("tipoBecaOtro"),
    fuenteBeca: txt("fuenteBeca"),
    convenioEmpresa: txt("convenioEmpresa"),
    patrocinador: txt("patrocinador"),
    folioBeca: txt("folioBeca"),

    porcentajeBeca: digits("porcentajeBeca", { min: 0, max: 100, allowEmpty: false }),
    topeMensual: digits("topeMensual", { min: 0, allowEmpty: true }),

    vigenciaInicio: date("vigenciaInicio"), // ISO o ""
    vigenciaFin: date("vigenciaFin"),       // ISO o ""

    aplicaA: arr("aplicaA", BECA_APLICA_ALLOW),

    estatusBeca: txt("estatusBeca", "activa"),
    renovable: bool("renovable"),
    requiereServicio: bool("requiereServicio"),
    horasServicio: digits("horasServicio", { min: 0, allowEmpty: true }),
    promedioMinimo: digits("promedioMinimo", { min: 0, max: 100, allowEmpty: true }),
    observacionesBeca: txt("observacionesBeca"),
  };

  // Limpiezas dependientes
  if (out.tipoBeca !== "Otra") out.tipoBecaOtro = "";
  if (out.fuenteBeca !== "Convenio empresarial") out.convenioEmpresa = "";
  if (out.fuenteBeca !== "Fundación / Patrocinio") out.patrocinador = "";

  // Corrige rango de fechas si vienen invertidas
  if (out.vigenciaInicio && out.vigenciaFin) {
    const a = new Date(out.vigenciaInicio);
    const b = new Date(out.vigenciaFin);
    if (a > b) [out.vigenciaInicio, out.vigenciaFin] = [out.vigenciaFin, out.vigenciaInicio];
  }

  return out;
}

// opcional: también exportar como default (no afecta a tu import nombrado)
export default sanitizeBecaFlat;
