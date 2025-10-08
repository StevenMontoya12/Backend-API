// src/firebase.js
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  let p = normalizeEnvPath(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  if (p) {
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `No se encontró el archivo de credenciales en:\n${abs}\n` +
        `Verifica el nombre y la ruta en .env (GOOGLE_APPLICATION_CREDENTIALS).`
      );
    }
    const json = JSON.parse(fs.readFileSync(abs, "utf8"));
    return admin.credential.cert(json);
  }

  // fallback: Application Default Credentials
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
