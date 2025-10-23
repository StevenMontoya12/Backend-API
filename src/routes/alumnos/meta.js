// src/routes/alumnos/meta.js
import { METAS_DOC, COL, nowIso, serverTS, inc } from "./helpers.js";

console.log("[alumnos/meta] loaded from", import.meta.url);

export function bumpMeta({ deltaTotal = 0, forceTouch = true } = {}) {
  const data = { lastUpdatedAt: nowIso(), updatedAtTs: serverTS() };
  if (forceTouch) data.version = inc(1);
  if (deltaTotal !== 0) data.total = inc(deltaTotal);
  return METAS_DOC.set(data, { merge: true });
}

export async function readMeta() {
  const snap = await METAS_DOC.get();
  if (!snap.exists) {
    const agg = await COL.count().get().catch(() => null);
    const total = agg ? agg.data().count : 0;
    const init = { version: 1, total, lastUpdatedAt: nowIso(), updatedAtTs: serverTS() };
    await METAS_DOC.set(init, { merge: false });
    return { version: 1, total, lastUpdatedAt: init.lastUpdatedAt };
  }
  const d = snap.data() || {};
  return {
    version: d.version ?? 1,
    total: d.total ?? undefined,
    lastUpdatedAt: d.lastUpdatedAt ?? null,
  };
}
