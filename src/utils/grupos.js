// src/utils/grupos.js
import admin from "firebase-admin";
import { strip, trim } from "./normalize.js";

/** Normaliza + valida y arma payload base para crear/editar */
export function toGrupoPayload(body = {}) {
  const nowISO = new Date().toISOString();

  const nivel        = trim(body.nivel);
  const grado        = trim(body.grado);
  const nombreGrupo  = trim(body.nombreGrupo);
  const capacidad    = Number.isFinite(Number(body.capacidad)) ? Number(body.capacidad) : NaN;
  const alumnosTotal = Number.isFinite(Number(body.alumnosTotal)) ? Number(body.alumnosTotal) : 0;

  const faltantes = [];
  if (!nivel)       faltantes.push("nivel");
  if (!grado)       faltantes.push("grado");
  if (!nombreGrupo) faltantes.push("nombreGrupo");
  if (faltantes.length) return { error: `Campos requeridos faltantes: ${faltantes.join(", ")}` };

  if (!Number.isFinite(capacidad) || capacidad <= 0) {
    return { error: "capacidad debe ser número > 0" };
  }
  if (alumnosTotal < 0) return { error: "alumnosTotal no puede ser negativo" };
  if (alumnosTotal > capacidad) return { error: "alumnosTotal no puede exceder capacidad" };

  const nivelIndex  = strip(nivel);
  const gradoIndex  = strip(grado);
  const grupoIndex  = strip(nombreGrupo);
  const searchIndex = strip(`${nivel} ${grado} ${nombreGrupo}`);

  const data = {
    nivel, grado, nombreGrupo,
    capacidad, alumnosTotal,
    nivelIndex, gradoIndex, grupoIndex, searchIndex,
    updatedAt: nowISO,
    updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
  };

  return { data, nowISO };
}

/** Patch seguro: solo campos permitidos + recalcula índices si cambian */
export function buildPatchFromBody(body = {}) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, "nivel"))        out.nivel        = trim(body.nivel);
  if (Object.prototype.hasOwnProperty.call(body, "grado"))        out.grado        = trim(body.grado);
  if (Object.prototype.hasOwnProperty.call(body, "nombreGrupo"))  out.nombreGrupo  = trim(body.nombreGrupo);
  if (Object.prototype.hasOwnProperty.call(body, "capacidad"))    out.capacidad    = Number(body.capacidad);
  if (Object.prototype.hasOwnProperty.call(body, "alumnosTotal")) out.alumnosTotal = Number(body.alumnosTotal);

  if (Object.prototype.hasOwnProperty.call(out, "nivel"))       out.nivelIndex = strip(out.nivel || "");
  if (Object.prototype.hasOwnProperty.call(out, "grado"))       out.gradoIndex = strip(out.grado || "");
  if (Object.prototype.hasOwnProperty.call(out, "nombreGrupo")) out.grupoIndex = strip(out.nombreGrupo || "");
  return out;
}

/** (Opcional) Mapear una fila externa (CSV/JSON) a body de grupo */
export function mapExternalGrupo(row = {}) {
  const nivel        = trim(row.school_level_name ?? row.nivel);
  const grado        = trim(row.school_grade_name ?? row.grado);
  const nombreGrupo  = trim(row.school_grade_group_name ?? row.nombreGrupo);
  const capacidad    = row.capacidad ?? 30;
  const alumnosTotal = row.alumnosTotal ?? 0;

  return { nivel, grado, nombreGrupo, capacidad, alumnosTotal };
}
