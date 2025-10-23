// src/routes/alumnos/beca.js
import { BECA_APLICA_ALLOW } from "./constants.js";
import { makeParsers } from "./sanitize.js";

export function sanitizeBecaFlat(body) {
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
    vigenciaInicio: date("vigenciaInicio"),
    vigenciaFin: date("vigenciaFin"),
    aplicaA: arr("aplicaA", BECA_APLICA_ALLOW),
    estatusBeca: txt("estatusBeca", "activa"),
    renovable: bool("renovable"),
    requiereServicio: bool("requiereServicio"),
    horasServicio: digits("horasServicio", { min: 0, allowEmpty: true }),
    promedioMinimo: digits("promedioMinimo", { min: 0, max: 100, allowEmpty: true }),
    observacionesBeca: txt("observacionesBeca"),
  };

  if (out.tipoBeca !== "Otra") out.tipoBecaOtro = "";
  if (out.fuenteBeca !== "Convenio empresarial") out.convenioEmpresa = "";
  if (out.fuenteBeca !== "Fundación / Patrocinio") out.patrocinador = "";

  if (out.vigenciaInicio && out.vigenciaFin) {
    const a = new Date(out.vigenciaInicio);
    const b = new Date(out.vigenciaFin);
    if (a > b) [out.vigenciaInicio, out.vigenciaFin] = [out.vigenciaFin, out.vigenciaInicio];
  }
  return out;
}
