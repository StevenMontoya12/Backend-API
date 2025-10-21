// src/routes/grupos.js
import { Router } from "express";
import admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { firestore } from "../firebase.js";
import { strip } from "../utils/normalize.js";
import { toGrupoPayload, buildPatchFromBody, mapExternalGrupo } from "../utils/grupos.js";
import { parse as parseCsv } from "csv-parse/sync";

const router = Router();

const col = firestore.collection("grupos");
const tombstones = firestore.collection("grupos_deleted");
const metasDoc = firestore.doc("metas/grupos");

// ────────────────────────────────────────────────────────────────
// Ping de diagnóstico (DEBE ir antes de cualquier "/:id")
// ────────────────────────────────────────────────────────────────
router.get("/__ping", (_req, res) => {
  res.json({ ok: true, router: "grupos", now: new Date().toISOString() });
});

// ────────────────────────────────────────────────────────────────
// Helpers de meta (versionado y total)
// ────────────────────────────────────────────────────────────────
async function bumpMeta({ deltaTotal = 0, forceTouch = true } = {}) {
  const nowISO = new Date().toISOString();
  const data = {
    lastUpdatedAt: nowISO,
    updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (forceTouch) data.version = admin.firestore.FieldValue.increment(1);
  if (deltaTotal !== 0) data.total = admin.firestore.FieldValue.increment(deltaTotal);
  await metasDoc.set(data, { merge: true });
}

async function readMeta() {
  const snap = await metasDoc.get();
  if (!snap.exists) {
    const agg = await col.count().get().catch(() => null);
    const total = agg ? agg.data().count : 0;
    const nowISO = new Date().toISOString();
    const init = {
      version: 1,
      total,
      lastUpdatedAt: nowISO,
      updatedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    };
    await metasDoc.set(init, { merge: false });
    return { version: 1, total, lastUpdatedAt: nowISO };
  }
  const d = snap.data() || {};
  return {
    version: d.version ?? 1,
    total: d.total ?? undefined,
    lastUpdatedAt: d.lastUpdatedAt ?? null,
  };
}

// ────────────────────────────────────────────────────────────────
// Endpoints
// ────────────────────────────────────────────────────────────────

// META — versión, total, última actualización
router.get("/meta", async (_req, res) => {
  try {
    const meta = await readMeta();
    res.json({ ok: true, ...meta });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// CHANGES — deltas desde un instante
router.get("/changes", async (req, res) => {
  try {
    const since = String(req.query.since || "").trim();
    if (!since) return res.status(400).json({ ok: false, error: "since requerido (ISO date)" });
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return res.status(400).json({ ok: false, error: "since inválido" });
    }

    const nowISO = new Date().toISOString();

    // updated (>= since)
    const qUpdated = await col
      .where("updatedAtTs", ">", sinceDate)
      .orderBy("updatedAtTs", "asc")
      .limit(1000)
      .get();

    const updated = qUpdated.docs.map((d) => ({ id: d.id, ...d.data() }));

    // deleted (tombstones)
    const qDeleted = await tombstones
      .where("deletedAtTs", ">", sinceDate)
      .orderBy("deletedAtTs", "asc")
      .limit(1000)
      .get();

    const deleted = qDeleted.docs.map((d) => d.id);

    res.json({ ok: true, since, now: nowISO, updated, deleted });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Crear grupo (id autogenerado)
router.post("/", async (req, res) => {
  try {
    const { data, error, nowISO } = toGrupoPayload(req.body);
    if (error) return res.status(400).json({ ok: false, error });

    const doc = {
      ...data,
      createdAt: nowISO,
      createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await col.add(doc);

    // por si había tombstone previo
    await tombstones.doc(ref.id).delete().catch(() => {});

    await bumpMeta({ deltaTotal: +1, forceTouch: true });
    res.json({ ok: true, data: { id: ref.id, ...doc } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/**
 * Listado con búsqueda y cursor
 * Params:
 *  - q (opcional): prefijo normalizado (nivel/grado/grupo)
 *  - pageSize (<=100)
 *  - saKey, saId: cursores de la página anterior
 */
router.get("/", async (req, res) => {
  try {
    const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
    const q = (req.query.q || "").toString().trim();
    const hasQ = q.length >= 2;

    // cursores
    const saKey = typeof req.query.saKey === "string" ? req.query.saKey : null; // searchIndex o grupoIndex
    const saId  = typeof req.query.saId  === "string" ? req.query.saId  : null;

    // ETag por meta.version y params
    const meta = await readMeta();
    const etag = `"grupos:${meta.version}|q=${hasQ ? q : ""}|ps=${pageSize}|k=${saKey || ""}|i=${saId || ""}"`;
    const inm = req.headers["if-none-match"];
    if (inm && inm === etag) {
      res.status(304).end();
      return;
    }

    let query;
    if (hasQ) {
      // búsqueda por prefijo (normalizada)
      const qNorm = strip(q);
      query = col
        .orderBy("searchIndex", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .startAt(qNorm)
        .endAt(qNorm + "\uf8ff")
        .limit(pageSize);

      if (saKey && saId) query = query.startAfter(saKey, saId);
    } else {
      // orden bonito: nivel -> grado -> grupo
      query = col
        .orderBy("nivelIndex", "asc")
        .orderBy("gradoIndex", "asc")
        .orderBy("grupoIndex", "asc")
        .orderBy(FieldPath.documentId(), "asc")
        .limit(pageSize);

      if (saKey && saId) query = query.startAfter(saKey, saId);
    }

    const snap = await query.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const last = snap.docs[snap.docs.length - 1] || null;
    const next = last
      ? {
          saKey: hasQ ? (last.get("searchIndex") || "") : (last.get("grupoIndex") || ""),
          saId: last.id,
        }
      : null;

    res.setHeader("ETag", etag);
    res.json({ ok: true, items, next, total: meta.total, pageSize });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Obtener por id
router.get("/:id", async (req, res) => {
  try {
    const ref = col.doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "No encontrado" });
    res.json({ ok: true, data: { id: doc.id, ...doc.data() } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Patch/merge por id
router.patch("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const ref = col.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "No encontrado" });

    const patch = buildPatchFromBody(req.body);
    const prev = snap.data() || {};
    const merged = { ...prev, ...patch };

    const cap = Number(merged.capacidad);
    const tot = Number(merged.alumnosTotal ?? 0);
    if (!merged.nivel || !merged.grado || !merged.nombreGrupo) {
      return res.status(400).json({ ok: false, error: "nivel, grado y nombreGrupo son obligatorios" });
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      return res.status(400).json({ ok: false, error: "capacidad inválida" });
    }
    if (tot < 0 || tot > cap) {
      return res.status(400).json({ ok: false, error: "alumnosTotal inválido" });
    }

    merged.searchIndex = strip(`${merged.nivel} ${merged.grado} ${merged.nombreGrupo}`);
    merged.updatedAt = new Date().toISOString();
    merged.updatedAtTs = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(merged, { merge: false });
    await bumpMeta({ deltaTotal: 0, forceTouch: true });

    res.json({ ok: true, data: { id, ...merged } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Eliminar por id (tombstone + meta)
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // borra doc
    await col.doc(id).delete();

    // tombstone
    const nowISO = new Date().toISOString();
    await tombstones.doc(id).set({
      id,
      deletedAt: nowISO,
      deletedAtTs: admin.firestore.FieldValue.serverTimestamp(),
    });

    await bumpMeta({ deltaTotal: -1, forceTouch: true });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// (Opcional) Import masivo
router.post("/import", async (req, res) => {
  try {
    const dryRun = String(req.query.dryRun || "false").toLowerCase() === "true";
    let rows = [];

    if (req.is("text/csv")) {
      rows = parseCsv(req.body, { columns: true, skip_empty_lines: true, trim: true });
    } else if (req.is("application/json")) {
      if (!Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: "Se esperaba un arreglo JSON" });
      }
      rows = req.body;
    } else {
      return res.status(415).json({ ok: false, error: "Content-Type no soportado (usa text/csv o application/json)" });
    }

    if (!rows.length) return res.status(400).json({ ok: false, error: "No hay filas para importar" });

    const bodies = rows.map(mapExternalGrupo).map((b) => toGrupoPayload(b));
    const errors = bodies
      .map((r, i) => (r.error ? { index: i, error: r.error } : null))
      .filter(Boolean);
    if (errors.length) return res.status(400).json({ ok: false, errors });

    if (dryRun) return res.json({ ok: true, dryRun: true, count: bodies.length });

    const BATCH_SIZE = 400;
    for (let i = 0; i < bodies.length; i += BATCH_SIZE) {
      const batch = firestore.batch();
      const slice = bodies.slice(i, i + BATCH_SIZE);

      for (const r of slice) {
        const doc = {
          ...r.data,
          createdAt: r.nowISO,
          createdAtTs: admin.firestore.FieldValue.serverTimestamp(),
        };
        const ref = col.doc(); // id auto
        batch.set(ref, doc, { merge: false });
        batch.delete(tombstones.doc(ref.id));
      }
      await batch.commit();
    }

    await bumpMeta({ deltaTotal: bodies.length, forceTouch: true });
    res.json({ ok: true, written: bodies.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
