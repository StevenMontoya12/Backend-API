// src/routes/alumnos/sanitize.js
import { strip } from "../../utils/normalize.js";
import { TIPO_HIST_SET } from "./constants.js";

/** Convierte a número seguro; fallback si NaN/Infinity */
export function numFrom(v, fallback = 0) {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normaliza a cadena “segura” (trim); retorna "" si falsy */
export function cleanStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

/* ──────────────────────────────────────────────────────────
 * HERMANOS
 * Estructura esperada (flexible): { matricula?, id?, nombre|nombres, apellidos, nivel, grado, grupo, estudiaAqui? }
 * ────────────────────────────────────────────────────────── */
export function sanitizeHermano(x = {}) {
  if (!x || typeof x !== "object") return null;

  // ✅ Asegurar que PERSISTIMOS matricula (con fallback a id)
  const matricula = cleanStr(x.matricula || x.id || "");

  // Acepta "nombre" o "nombres" como fuente del nombre
  const nombre = cleanStr(x.nombre || x.nombres || "");
  const apellidos = cleanStr(x.apellidos || "");
  const nivel = cleanStr(x.nivel || "");
  const grado = cleanStr(x.grado || "");
  const grupo = cleanStr(x.grupo || "");
  const estudiaAqui = Boolean(x.estudiaAqui || x.hermanoEstudiaAqui);

  // Requerimos al menos algo significativo: nombre, apellidos o matricula
  if (!nombre && !apellidos && !matricula) return null;

  return {
    // 👇 Se guarda explícitamente la matrícula para que el front la vea al volver a leer
    matricula,
    // Mantén la clave "nombre" porque así la estás guardando en Firestore
    nombre,
    apellidos,
    nivel,
    grado,
    grupo,
    estudiaAqui,
    // índices opcionales
    nombreIndex: strip(`${nombre} ${apellidos}`),
  };
}

/* ──────────────────────────────────────────────────────────
 * HISTORIAL DE ACTIVIDAD (alumnos)
 * Item: { fechaIso, tipo: "alta"|"baja"|"cambio", motivo?, usuario?, notas? }
 * ────────────────────────────────────────────────────────── */
export function sanitizeHistorialActividad(list) {
  if (!Array.isArray(list)) return [];
  const out = [];

  for (const it of list) {
    if (!it || typeof it !== "object") continue;

    const fechaIso = cleanStr(it.fechaIso || it.fecha || "");
    const tipoRaw = cleanStr(it.tipo || "");
    const tipo = TIPO_HIST_SET.has(tipoRaw) ? tipoRaw : "cambio";

    // Validar fecha ISO básica
    const d = new Date(fechaIso);
    if (!fechaIso || Number.isNaN(d.getTime())) continue;

    out.push({
      fechaIso: d.toISOString(),
      tipo,
      motivo: cleanStr(it.motivo),
      usuario: cleanStr(it.usuario),
      notas: cleanStr(it.notas),
    });
  }
  return out;
}

/* ──────────────────────────────────────────────────────────
 * CONTACTOS FAMILIA (nuevo)
 * Item requerido: { nombre, telefono, parentesco? }
 * ────────────────────────────────────────────────────────── */
export function sanitizeContactoFamilia(x = {}) {
  if (!x || typeof x !== "object") return null;

  const nombre = cleanStr(x.nombre);
  const telefono = cleanStr(x.telefono);
  const parentesco = cleanStr(x.parentesco);

  // requeridos
  if (!nombre || !telefono) return null;

  return {
    nombre,
    telefono,
    parentesco,
    // índices opcionales para futuras búsquedas
    nombreIndex: strip(nombre),
    telefonoIndex: strip(telefono),
  };
}

export function sanitizeContactosFamilia(list) {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeContactoFamilia).filter(Boolean);
}

/* ──────────────────────────────────────────────────────────
 * makeParsers — requerido por beca.js
 * ────────────────────────────────────────────────────────── */
export function makeParsers(body = {}) {
  const src = body ?? {};

  function cleanStr(v) {
    if (v == null) return "";
    return String(v).trim();
  }

  function txt(key, def = "") {
    const v = cleanStr(src[key]);
    return v === "" ? def : v;
  }

  function bool(key) {
    const v = src[key];
    if (typeof v === "boolean") return v;
    const s = String(v ?? "").trim().toLowerCase();
    return s === "1" || s === "true" || s === "sí" || s === "si" || s === "yes";
  }

  function digits(key, { min = -Infinity, max = Infinity, allowEmpty = true } = {}) {
    const raw = src[key];
    if (allowEmpty && typeof raw === "string" && raw.trim() === "") return "";
    let n = Number(raw);
    if (!Number.isFinite(n)) n = 0;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  }

  function date(key) {
    const s = cleanStr(src[key]);
    if (!s) return "";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }

  function arr(key, allowList) {
    let out = [];
    const v = src[key];
    if (Array.isArray(v)) out = v.slice();
    else if (typeof v === "string") out = v.split(/[,\s]+/g).filter(Boolean);
    else if (v != null) out = [String(v)];

    out = out.map((x) => cleanStr(x));

    if (Array.isArray(allowList) || allowList instanceof Set) {
      const allowed = allowList instanceof Set ? allowList : new Set(allowList);
      out = out.filter((x) => allowed.has(x));
    }

    // dedupe
    const seen = new Set();
    return out.filter((x) => {
      if (seen.has(x)) return false;
      seen.add(x);
      return true;
    });
  }

  return { txt, bool, digits, date, arr };
}
