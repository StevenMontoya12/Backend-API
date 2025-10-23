// src/routes/alumnos/index.js
import { Router } from "express";
import { respondErr } from "./helpers.js";
import * as h from "./handlers.js";

const router = Router();

// Diagnóstico: ver qué handlers hay
console.log("[alumnos] handlers keys:", Object.keys(h));

const safe = (name) => {
  const fn = h[name];
  if (typeof fn !== "function") {
    console.error(`[alumnos] WARNING: handler "${name}" es ${typeof fn}`);
    return (_req, res) => respondErr(res, 500, `Handler "${name}" no está definido`);
  }
  return (req, res, next) => {
    try {
      const p = fn(req, res, next);
      if (p && typeof p.then === "function") p.then(() => void 0).catch(next);
    } catch (err) { next(err); }
  };
};

router.get("/meta",          safe("getMeta"));
router.get("/changes",       safe("getChanges"));
router.get("/search",        safe("search"));
router.post("/",             safe("create"));
router.get("/",              safe("list"));
router.get("/:matricula",    safe("getOne"));
router.patch("/:matricula",  safe("patch"));
router.delete("/:matricula", safe("remove"));
router.post("/import",       safe("bulkImport"));

router.use((err, _req, res, _next) => {
  console.error("[alumnos:error]", err);
  respondErr(res, 500, err?.message || err);
});

export default router;
