// src/routes/alumnos/handlers.js
import { strip } from "../../utils/normalize.js";
import { parse as parseCsv } from "csv-parse/sync";

// Usa el archivo correcto:
import { mapExternalAlumno as mapExternaAlumno } from "../../utils/mapExternaAlumno.js";

import {
  respondOk, respondErr, nowIso, clamp, cleanStr,
  serverTS, COL, TOMBSTONES, firestore
} from "./helpers.js";

import * as meta from "./meta.js";
const { readMeta, bumpMeta } = meta;

import { SEARCH_LIMIT_MAX, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, BATCH_SIZE } from "./constants.js";

import * as payload from "./payload.js";
console.log("[alumnos] payload.js exports =", Object.keys(payload));
// NO desestructures arriba; lo hacemos aquí después del log:
const { toAlumnoPayload, buildPatchFromBody } = payload;

import { buildListQuery, pushDocBasic } from "./search.js";

// ────────────────────────────────────────────────────────────────

export const getMeta = async (_req, res) => {
  const m = await readMeta();
  respondOk(res, m);
};

export const getChanges = async (req, res) => {
  const since = cleanStr(req.query.since);
  if (!since) return respondErr(res, 400, "since requerido (ISO date)");
  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) return respondErr(res, 400, "since inválido");

  const qUpdated = await COL.where("updatedAtTs", ">", sinceDate)
    .orderBy("updatedAtTs","asc").limit(1000).get();
  const updated = qUpdated.docs.map((d) => ({ id: d.id, ...d.data() }));

  const qDeleted = await TOMBSTONES.where("deletedAtTs", ">", sinceDate)
    .orderBy("deletedAtTs","asc").limit(1000).get();
  const deleted = qDeleted.docs.map((d) => d.id);

  respondOk(res, { since, now: nowIso(), updated, deleted });
};

export const search = async (req, res) => {
  const term = cleanStr(req.query.term);
  const limit = clamp(Number(req.query.limit || 10), 1, SEARCH_LIMIT_MAX);
  if (term.length < 2) return respondOk(res, { items: [] });

  const snap1 = await COL.orderBy("apellidos","asc").orderBy("__name__","asc")
    .startAt(term).endAt(term+"\uf8ff").limit(limit).get();
  const snap2 = await COL.orderBy("nombres","asc").orderBy("__name__","asc")
    .startAt(term).endAt(term+"\uf8ff").limit(limit).get();
  const byId  = await COL.doc(term).get();

  const map = new Map();
  snap1.docs.forEach((d) => pushDocBasic(map, d));
  snap2.docs.forEach((d) => pushDocBasic(map, d));
  if (byId.exists) pushDocBasic(map, byId);

  respondOk(res, { items: Array.from(map.values()).slice(0, limit) });
};

export const create = async (req, res) => {
  if (typeof toAlumnoPayload !== "function") {
    return respondErr(res, 500, "payload.toAlumnoPayload no está disponible");
  }

  const { f, nowISO } = toAlumnoPayload(req.body);
  if (!f.matricula) return respondErr(res, 400, "La matrícula es obligatoria");

  const ref = COL.doc(f.matricula);
  if ((await ref.get()).exists) return respondErr(res, 409, "La matrícula ya existe");

  const data = { ...f, createdAt: nowISO, createdAtTs: serverTS() };

  if (!Array.isArray(data.historialActividad) || data.historialActividad.length === 0) {
    data.historialActividad = [{
      fechaIso: nowISO, tipo: "alta", motivo: "Alta inicial", usuario: "sistema", notas: ""
    }];
  }

  await ref.set(data);
  await TOMBSTONES.doc(ref.id).delete().catch(() => {});
  await bumpMeta({ deltaTotal: +1, forceTouch: true });

  respondOk(res, { data: { id: ref.id, ...data } });
};

export const list = async (req, res) => {
  const pageSize = clamp(Number(req.query.pageSize || DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);
  const q = cleanStr(req.query.q);
  const hasQ = q.length >= 2;

  const saApellido = typeof req.query.saApellido === "string" ? req.query.saApellido : null;
  const saId       = typeof req.query.saId === "string" ? req.query.saId : null;
  const saNombre   = typeof req.query.saNombre === "string" ? req.query.saNombre : null;
  const saId2      = typeof req.query.saId2 === "string" ? req.query.saId2 : null;

  const metaState = await readMeta();
  const etag = `"alumnos:${metaState.version}|q=${hasQ ? q : ""}|ps=${pageSize}|a=${saApellido || ""}|i=${saId || ""}|n=${saNombre || ""}|i2=${saId2 || ""}"`;
  const inm = req.headers["if-none-match"];
  if (inm && inm === etag) return res.status(304).end();

  const qNorm = strip(q);
  const query = buildListQuery({ hasQ, qNorm, pageSize, saApellido, saId, saNombre, saId2 });

  const snap = await query.get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lastDoc = snap.docs[snap.docs.length - 1] || null;

  const next = lastDoc
    ? hasQ
      ? { saNombre: lastDoc.get("nombreIndex") || "", saId2: lastDoc.id }
      : { saApellido: lastDoc.get("apellidos") || "", saId: lastDoc.id }
    : null;

  res.setHeader("ETag", etag);
  respondOk(res, { items, next, total: metaState.total, pageSize });
};

export const getOne = async (req, res) => {
  const ref = COL.doc(req.params.matricula);
  const doc = await ref.get();
  if (!doc.exists) return respondErr(res, 404, "No encontrado");
  respondOk(res, { data: { id: doc.id, ...doc.data() } });
};

export const patch = async (req, res) => {
  if (typeof buildPatchFromBody !== "function") {
    return respondErr(res, 500, "payload.buildPatchFromBody no está disponible");
  }

  const id = req.params.matricula;
  const ref = COL.doc(id);
  const prev = await ref.get();
  if (!prev.exists) return respondErr(res, 404, "No encontrado");

  const patchObj = buildPatchFromBody(req.body);
  const prevData = prev.data() || {};
  const finalData = { ...prevData, ...patchObj };

  finalData.nombreIndex    = strip(`${finalData.nombres || ""} ${finalData.apellidos || ""}`);
  finalData.matriculaIndex = strip(id);
  finalData.correoIndex    = strip(finalData.correoFamiliar || "");
  finalData.updatedAt      = nowIso();
  finalData.updatedAtTs    = serverTS();

  await ref.set(finalData, { merge: false });
  await bumpMeta({ deltaTotal: 0, forceTouch: true });

  respondOk(res, { data: { id, ...finalData } });
};

export const remove = async (req, res) => {
  const id = req.params.matricula;
  await COL.doc(id).delete();

  const deletedAt = nowIso();
  await TOMBSTONES.doc(id).set({ id, deletedAt, deletedAtTs: serverTS() });

  await bumpMeta({ deltaTotal: -1, forceTouch: true });
  respondOk(res, { id });
};

export const bulkImport = async (req, res) => {
  const dryRun = String(req.query.dryRun || "false").toLowerCase() === "true";
  const merge  = String(req.query.merge  || "true").toLowerCase() === "true";
  const blockOverwrite = String(req.query.blockOverwrite || "false").toLowerCase() === "true";

  let rows = [];
  if (req.is("text/csv")) {
    rows = parseCsv(req.body, { columns: true, skip_empty_lines: true, trim: true });
  } else if (req.is("application/json")) {
    if (!Array.isArray(req.body)) return respondErr(res, 400, "Se esperaba un arreglo JSON");
    rows = req.body;
  } else {
    return respondErr(res, 415, "Content-Type no soportado (usa text/csv o application/json)");
  }

  if (!rows.length) return respondErr(res, 400, "No hay filas para importar");

  const converted = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const { matricula, body } = mapExternaAlumno(rows[i]);
      converted.push({ matricula, body });
    } catch (e) {
      errors.push({ index: i, error: String(e), row: rows[i] });
    }
  }
  if (errors.length) return respondErr(res, 400, { errors, validCount: converted.length });
  if (dryRun) return respondOk(res, { dryRun: true, count: converted.length });

  let written = 0;
  let deltaTotal = 0;

  for (let i = 0; i < converted.length; i += BATCH_SIZE) {
    const batch = firestore.batch();
    const slice = converted.slice(i, i + BATCH_SIZE);

    if (blockOverwrite) {
      const reads = await Promise.all(slice.map(({ matricula }) => COL.doc(matricula).get()));
      for (let j = 0; j < slice.length; j++) {
        if (reads[j].exists) return respondErr(res, 409, `La matrícula ya existe: ${slice[j].matricula}`);
      }
    }

    for (const { matricula, body } of slice) {
      const ref = COL.doc(matricula);

      const nombreIndex    = strip(`${body.nombres || ""} ${body.apellidos || ""}`);
      const matriculaIndex = strip(matricula || body.matricula || "");
      const correoIndex    = strip(body.correoFamiliar || "");
      const nowISO = nowIso();

      const data = {
        ...body,
        nombreIndex, matriculaIndex, correoIndex,
        updatedAt: nowISO, updatedAtTs: serverTS(),
        createdAt: nowISO, createdAtTs: serverTS(),
      };

      if (!merge) { batch.set(ref, data, { merge: false }); deltaTotal += 1; }
      else        { batch.set(ref, data, { merge: true  }); }

      batch.delete(TOMBSTONES.doc(matricula));
    }

    await batch.commit();
    written += slice.length;
  }

  await bumpMeta({ deltaTotal, forceTouch: true });
  respondOk(res, { written });
};
