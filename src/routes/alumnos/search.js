// src/routes/alumnos/search.js
import { FieldPath, COL } from "./helpers.js";

export const pushDocBasic = (map, d) => {
  if (!d?.exists) return;
  const data = d.data() || {};
  map.set(d.id, {
    id: d.id,
    matricula: d.id,
    nombres: data.nombres || "",
    apellidos: data.apellidos || "",
    grupoPrincipal: data.grupoPrincipal || "",
    nivel: data.nivel || undefined,
    grado: data.grado || undefined,
  });
};

export function buildListQuery({ hasQ, qNorm, pageSize, saApellido, saId, saNombre, saId2 }) {
  if (hasQ) {
    let query = COL
      .orderBy("nombreIndex", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .startAt(qNorm)
      .endAt(qNorm + "\uf8ff")
      .limit(pageSize);
    if (saNombre && saId2) query = query.startAfter(saNombre, saId2);
    return query;
  }
  let query = COL
    .orderBy("apellidos", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(pageSize);
  if (saApellido && saId) query = query.startAfter(saApellido, saId);
  return query;
}
