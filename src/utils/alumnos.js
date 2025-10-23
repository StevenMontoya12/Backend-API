// src/utils/alumnos.js
// 🔁 Shim de compatibilidad para no romper imports antiguos.
// Reexporta el router y utilidades desde la nueva ubicación.

export { default } from "../routes/alumnos/index.js"; // default: router

export { importAlumnos } from "../routes/alumnos/importer.js";