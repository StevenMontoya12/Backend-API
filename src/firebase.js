// src/firebase.js
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log("[FIREBASE] CWD =", process.cwd());
console.log("[FIREBASE] RAW GOOGLE_APPLICATION_CREDENTIALS =", process.env.GOOGLE_APPLICATION_CREDENTIALS);
console.log("[FIREBASE] CWD =", process.cwd());
console.log("[FIREBASE] RAW GOOGLE_APPLICATION_CREDENTIALS =", process.env.GOOGLE_APPLICATION_CREDENTIALS);

function normalizeEnvPath(p) {
  if (!p) return p;
  let out = p.trim();

  // quita comillas envolventes si las hubiera
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }

  // soporta file:///
  if (out.startsWith("file:///")) {
    out = out.replace(/^file:\/\//, "");
  }

  // decodifica %20, etc.
  try { out = decodeURIComponent(out); } catch {}

  return out;
}

function loadCredential() {
  console.log("[FIREBASE] (load) RAW =", process.env.GOOGLE_APPLICATION_CREDENTIALS);
  let p = normalizeEnvPath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log("[FIREBASE] (load) Normalized =", p);

  if (p) {
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    console.log("[FIREBASE] (load) isAbsolute?", path.isAbsolute(p), "abs =", abs);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `No se encontró el archivo de credenciales en:\n${abs}\n` +
        `Verifica el nombre y la ruta en .env (GOOGLE_APPLICATION_CREDENTIALS).`
      );
    }
    const json = JSON.parse(fs.readFileSync(abs, "utf8"));
    return admin.credential.cert(json);
  }

  return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: loadCredential(),
  });
}

export const firestore = admin.firestore();
export const auth = admin.auth();
export default admin;
