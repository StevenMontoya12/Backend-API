// src/routes/alumnos/sanitize.js
import { TIPO_HIST_SET } from "./constants.js";
import { cleanStr } from "./helpers.js";

export { cleanStr };
export const boolFrom = (v) => Boolean(v);
export const numFrom  = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function sanitizeHistorialActividad(input) {
  if (!Array.isArray(input)) return [];
  return input.map((r) => {
    const fecha = new Date(r?.fechaIso ?? r?.fecha ?? "");
    const tipo = cleanStr(r?.tipo).toLowerCase();
    if (!TIPO_HIST_SET.has(tipo)) return null;
    if (Number.isNaN(fecha.getTime())) return null;
    return {
      fechaIso: fecha.toISOString(),
      tipo,
      motivo: cleanStr(r?.motivo),
      usuario: cleanStr(r?.usuario),
      notas: cleanStr(r?.notas),
    };
  }).filter(Boolean);
}

export function sanitizeHermano(h) {
  if (!h) return null;
  const id = cleanStr(h.id || h.matricula);
  if (!id) return null;
  const out = {
    id,
    matricula: cleanStr(h.matricula || id),
    nombres: cleanStr(h.nombres),
    apellidos: cleanStr(h.apellidos),
    grupoPrincipal: cleanStr(h.grupoPrincipal),
  };
  if (h.nivel) out.nivel = String(h.nivel);
  if (h.grado) out.grado = String(h.grado);
  return out;
}

export const makeParsers = (src) => {
  const txt = (k, d = "") => cleanStr(src[k], d);
  const bool = (k) => Boolean(src[k]);
  const digits = (k, { min = 0, max = Infinity, allowEmpty = true } = {}) => {
    const raw = String(src[k] ?? "");
    const only = raw.replace(/[^\d]/g, "");
    if (allowEmpty && only === "") return "";
    let n = Number(only);
    if (Number.isNaN(n)) n = 0;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  };
  const date = (k) => {
    const v = cleanStr(src[k]);
    if (!v) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : v.slice(0, 10);
  };
  const arr = (k, allow = []) => {
    const v = Array.isArray(src[k]) ? src[k] : [];
    const S = new Set(allow);
    return v.map(String).filter((x) => S.has(x));
  };
  return { txt, bool, digits, date, arr };
};
