// src/utils/normalize.js
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);

export const trim = (v) => (v == null ? "" : String(v).trim());

// Normaliza para indexar/buscar por prefijo (sin acentos, minúsculas)
export const strip = (s = "") =>
  String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export const toIsoDate = (v) => {
  const s = trim(v);
  if (!s) return "";
  const d = dayjs(s);
  return d.isValid() ? d.format("YYYY-MM-DD") : s;
};

export const normalizeGenero = (g) => {
  const s = trim(g).toLowerCase();
  if (!s) return "";
  if (["m", "masculino", "male", "hombre"].includes(s)) return "masculino";
  if (["f", "femenino", "female", "mujer"].includes(s)) return "femenino";
  return s;
};

export const normalizeEstatus = (isActive) => {
  const s = trim(isActive).toLowerCase();
  if (["true","1","si","sí","activo","yes"].includes(s)) return "activo";
  if (["false","0","no","inactivo"].includes(s)) return "inactivo";
  if (typeof isActive === "boolean") return isActive ? "activo" : "inactivo";
  return "activo";
};
