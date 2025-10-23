// src/routes/alumnos/helpers.js
import admin from "../../firebase.js";
import { firestore } from "../../firebase.js";

export const nowIso   = () => new Date().toISOString();
export const clamp    = (n, min, max) => Math.min(max, Math.max(min, n));
export const cleanStr = (v, d = "") => (v == null ? d : String(v).trim());

// HTTP helpers
export const respondOk  = (res, payload = {}) => res.json({ ok: true, ...payload });
export const respondErr = (res, code, error) =>
  res.status(code).json({ ok: false, error: typeof error === "string" ? error : String(error) });

// Firestore helpers
export const FV       = admin.firestore.FieldValue;
export const serverTS = () => FV.serverTimestamp();
export const inc      = (n) => FV.increment(n);

// Colecciones / docs
export const COL        = firestore.collection("alumnos");
export const TOMBSTONES = firestore.collection("alumnos_deleted");
export const METAS_DOC  = firestore.doc("metas/alumnos");

// Re-export útil
export { firestore };
export { FieldPath } from "firebase-admin/firestore";
