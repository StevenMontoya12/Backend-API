// src/routes/auth.js
import { Router } from "express";
import jwt from "jsonwebtoken";
import { firestore, auth as adminAuth } from "../firebase.js";

const router = Router();

const JWT_SECRET = process.env.AUTH_JWT_SECRET || "cambia-esto-en-produccion";

// Buscar usuario por email en colaboradores o alumnos
async function findUserByEmail(email) {
  // 1) Colaboradores: correoInstitucional
  const colSnap = await firestore
    .collection("colaboradores")
    .where("correoInstitucional", "==", email)
    .limit(1)
    .get();

  if (!colSnap.empty) {
    const doc = colSnap.docs[0];
    return {
      role: "colaborador",
      id: doc.id,
      source: "colaboradores",
      data: doc.data(),
      matchField: "correoInstitucional",
    };
  }

  // 2) Alumnos: correoPadre (correo del padre/tutor)
  const padreSnap = await firestore
    .collection("alumnos")
    .where("correoPadre", "==", email)
    .limit(1)
    .get();

  if (!padreSnap.empty) {
    const doc = padreSnap.docs[0];
    return {
      role: "padre",
      id: doc.id,
      source: "alumnos",
      data: doc.data(),
      matchField: "correoPadre",
    };
  }

  // 3) Alumnos: correoFamiliar (correo “general” familiar)
  const famSnap = await firestore
    .collection("alumnos")
    .where("correoFamiliar", "==", email)
    .limit(1)
    .get();

  if (!famSnap.empty) {
    const doc = famSnap.docs[0];
    return {
      role: "padre",
      id: doc.id,
      source: "alumnos",
      data: doc.data(),
      matchField: "correoFamiliar",
    };
  }

  // Si nada coincide:
  return null;
}

// POST /api/auth/google
router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res
        .status(400)
        .json({ ok: false, error: "idToken requerido" });
    }

    // 1) Verificar token de Firebase (idToken del front)
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch (e) {
      console.error("[auth/google] verifyIdToken error:", e);
      return res
        .status(401)
        .json({ ok: false, error: "idToken inválido" });
    }

    const email = decoded.email;
    const emailVerified = decoded.email_verified;

    if (!email || !emailVerified) {
      return res.status(403).json({
        ok: false,
        error: "email_no_verificado",
        message: "Se requiere un correo verificado de Google.",
      });
    }

    // 2) Buscar en Firestore
    const found = await findUserByEmail(email);
    if (!found) {
      return res.status(403).json({
        ok: false,
        error: "not_authorized",
        message:
          "Este correo no está registrado como colaborador o familiar.",
      });
    }

    const { role, id, data, matchField } = found;

    // 3) Crear tu propio JWT (para proteger tus rutas)
    const token = jwt.sign(
      {
        sub: id,
        email,
        role,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    // 4) Perfil simplificado (lo que va al localStorage y lee el Navbar)
    let nombre = null;
    let apellidos = null;

    if (role === "colaborador") {
      // Colaboradores: nombrePreferido o nombres + apellidoPaterno
      nombre = data.nombrePreferido || data.nombres || null;
      apellidos =
        data.apellidoPaterno ||
        data.apellidos ||
        data.apellidoMaterno ||
        null;
    } else if (role === "padre") {
      // Padre/Tutor: SIEMPRE campos familiares de Step4Familiar
      //  - nombrePadre
      //  - apellidosPadre
      nombre = data.nombrePadre || null;
      apellidos = data.apellidosPadre || null;
    } else {
      // Fallback futuro
      nombre =
        data.nombrePadre ||
        data.nombrePreferido ||
        data.nombres ||
        null;
      apellidos =
        data.apellidosPadre ||
        data.apellidoPaterno ||
        data.apellidos ||
        null;
    }

    res.json({
      ok: true,
      token,
      role,
      email,
      profile: {
        id,
        role,
        email,
        nombre,
        apellidos,
        matchField, // para debug
      },
    });
  } catch (e) {
    console.error("[POST /api/auth/google] error:", e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
