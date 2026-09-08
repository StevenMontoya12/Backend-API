// src/routes/auth.js
import { Router } from "express";
import jwt from "jsonwebtoken";
import { firestore, auth as adminAuth } from "../firebase.js";

const router = Router();

const JWT_SECRET = process.env.AUTH_JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    "AUTH_JWT_SECRET no está configurado en las variables de entorno"
  );
}

/* =========================================================
 * Helpers
 * ======================================================= */

function cleanStr(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return cleanStr(value).toLowerCase();
}

function alumnoIdFromDoc(doc) {
  const data = doc.data() || {};

  const matricula =
    data.matricula ||
    data.alumnoMatricula ||
    data.matriculaAlumno ||
    data.studentId ||
    doc.id;

  return cleanStr(matricula);
}

/**
 * Busca por el correo tal como lo entrega Google y también
 * por su versión en minúsculas.
 *
 * Firestore compara strings de forma exacta, por eso es
 * recomendable guardar siempre los correos en minúsculas.
 */
async function getDocsByEmail({
  collectionName,
  field,
  email,
}) {
  const values = Array.from(
    new Set([
      cleanStr(email),
      normalizeEmail(email),
    ])
  ).filter(Boolean);

  const snapshots = await Promise.all(
    values.map((value) =>
      firestore
        .collection(collectionName)
        .where(field, "==", value)
        .get()
    )
  );

  const documentsById = new Map();

  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      documentsById.set(doc.id, doc);
    }
  }

  return Array.from(documentsById.values());
}

function mapAlumnoForSession(doc) {
  const data = doc.data() || {};
  const matricula = alumnoIdFromDoc(doc);

  return {
    id: matricula,
    matricula,
    nombres: cleanStr(data.nombres),
    apellidos: cleanStr(data.apellidos),
    nivel: cleanStr(data.nivel),
    grado: cleanStr(data.grado),
    grupo: cleanStr(data.grupo),
    grupoPrincipal: cleanStr(data.grupoPrincipal),
    estatus: cleanStr(data.estatus || "activo"),
  };
}

/**
 * Busca todos los alumnos relacionados con el correo.
 *
 * Un alumno podría aparecer en correoPadre y correoFamiliar,
 * por eso se eliminan duplicados usando la matrícula.
 */
async function findAlumnosByEmail(email) {
  const [
    padreDocs,
    familiarDocs,
  ] = await Promise.all([
    getDocsByEmail({
      collectionName: "alumnos",
      field: "correoPadre",
      email,
    }),

    getDocsByEmail({
      collectionName: "alumnos",
      field: "correoFamiliar",
      email,
    }),
  ]);

  const documentsByMatricula = new Map();

  for (const doc of [...padreDocs, ...familiarDocs]) {
    const matricula = alumnoIdFromDoc(doc);

    if (!matricula) {
      continue;
    }

    documentsByMatricula.set(matricula, doc);
  }

  const documents = Array.from(documentsByMatricula.values());

  documents.sort((a, b) => {
    const alumnoA = a.data() || {};
    const alumnoB = b.data() || {};

    const nameA = `${alumnoA.nombres || ""} ${alumnoA.apellidos || ""}`
      .trim()
      .toLocaleLowerCase("es");

    const nameB = `${alumnoB.nombres || ""} ${alumnoB.apellidos || ""}`
      .trim()
      .toLocaleLowerCase("es");

    return nameA.localeCompare(nameB, "es");
  });

  return {
    documents,
    hijos: documents.map(mapAlumnoForSession),
  };
}

/**
 * Conservamos la búsqueda de colaboradores para no eliminar
 * el funcionamiento que ya tenías.
 *
 * Por ahora, cuando alguien tenga hijos, el rol principal
 * será "padre". Más adelante mostraremos la selección entre
 * modo colaborador y modo familiar.
 */
async function findColaboradorByEmail(email) {
  const documents = await getDocsByEmail({
    collectionName: "colaboradores",
    field: "correoInstitucional",
    email,
  });

  if (documents.length === 0) {
    return null;
  }

  const doc = documents[0];

  return {
    id: doc.id,
    data: doc.data() || {},
  };
}

function splitGoogleName(fullName) {
  const parts = cleanStr(fullName)
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      nombre: null,
      apellidos: null,
    };
  }

  return {
    nombre: parts[0] || null,
    apellidos:
      parts.length > 1
        ? parts.slice(1).join(" ")
        : null,
  };
}

/* =========================================================
 * POST /api/auth/google
 * ======================================================= */

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};

    if (!idToken) {
      return res.status(400).json({
        ok: false,
        error: "idToken_requerido",
        message: "El idToken es obligatorio.",
      });
    }

    /* -----------------------------------------------------
     * 1. Verificar token de Firebase
     * --------------------------------------------------- */

    let decoded;

    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch (error) {
      console.error(
        "[auth/google] Error verificando idToken:",
        error
      );

      return res.status(401).json({
        ok: false,
        error: "idToken_invalido",
        message: "La sesión de Google no es válida.",
      });
    }

    const email = normalizeEmail(decoded.email);
    const emailVerified = Boolean(decoded.email_verified);
    const firebaseUid = cleanStr(decoded.uid);

    if (!email || !emailVerified) {
      return res.status(403).json({
        ok: false,
        error: "email_no_verificado",
        message:
          "Se requiere una cuenta de Google con correo verificado.",
      });
    }

    if (!firebaseUid) {
      return res.status(401).json({
        ok: false,
        error: "firebase_uid_no_disponible",
        message:
          "No se pudo identificar la cuenta de Firebase.",
      });
    }

    /* -----------------------------------------------------
     * 2. Buscar hijos y colaborador
     * --------------------------------------------------- */

    const [
      alumnosResult,
      colaborador,
    ] = await Promise.all([
      findAlumnosByEmail(email),
      findColaboradorByEmail(email),
    ]);

    const hijos = alumnosResult.hijos;
    const alumnoDocuments = alumnosResult.documents;

    const esPadre = hijos.length > 0;
    const esColaborador = Boolean(colaborador);

    if (!esPadre && !esColaborador) {
      return res.status(403).json({
        ok: false,
        error: "not_authorized",
        message:
          "Este correo no está registrado como familiar o colaborador.",
      });
    }

    /*
     * En esta primera etapa damos prioridad al flujo familiar.
     * Si tiene hijos y también es colaborador:
     *
     * role  = "padre"
     * roles = ["padre", "colaborador"]
     */
    const roles = [];

    if (esPadre) {
      roles.push("padre");
    }

    if (esColaborador) {
      roles.push("colaborador");
    }

    const role = esPadre
      ? "padre"
      : "colaborador";

    const alumnoMatriculas = hijos.map(
      (hijo) => hijo.matricula
    );

    const alumnoMatriculaDefault =
      alumnoMatriculas[0] || null;

    /* -----------------------------------------------------
     * 3. Crear JWT
     * --------------------------------------------------- */

    const token = jwt.sign(
      {
        /*
         * sub ahora identifica a la persona/cuenta,
         * no a uno de sus hijos.
         */
        sub: firebaseUid,

        uid: firebaseUid,
        email,
        role,
        roles,

        colaboradorId:
          colaborador?.id || null,

        alumnoMatriculas,
        alumnoMatriculaDefault,
      },
      JWT_SECRET,
      {
        expiresIn: "8h",
        issuer: "coventryschool-api",
        audience: "coventryschool-app",
      }
    );

    /* -----------------------------------------------------
     * 4. Construir perfil familiar
     * --------------------------------------------------- */

    const firstAlumnoData =
      alumnoDocuments[0]?.data() || {};

    const googleName = splitGoogleName(
      decoded.name || ""
    );

    let nombre = null;
    let apellidos = null;

    if (esPadre) {
      nombre =
        cleanStr(firstAlumnoData.nombrePadre) ||
        googleName.nombre;

      apellidos =
        cleanStr(firstAlumnoData.apellidosPadre) ||
        googleName.apellidos;
    } else if (esColaborador) {
      const colaboradorData =
        colaborador?.data || {};

      nombre =
        cleanStr(
          colaboradorData.nombrePreferido ||
            colaboradorData.nombres
        ) ||
        googleName.nombre;

      apellidos =
        cleanStr(
          [
            colaboradorData.apellidoPaterno,
            colaboradorData.apellidoMaterno,
          ]
            .filter(Boolean)
            .join(" ")
        ) ||
        googleName.apellidos;
    }

    /*
     * profile.id conserva temporalmente la primera matrícula
     * para no romper tus pantallas actuales mientras hacemos
     * la migración completa.
     *
     * El identificador real de la cuenta es profile.uid.
     */
    const profileId =
      alumnoMatriculaDefault ||
      colaborador?.id ||
      firebaseUid;

    return res.json({
      ok: true,
      token,
      role,
      roles,
      email,

      profile: {
        id: profileId,
        uid: firebaseUid,
        role,
        roles,
        email,
        nombre,
        apellidos,
        colaboradorId:
          colaborador?.id || null,
      },

      hijos,
      alumnoMatriculaDefault,
    });
  } catch (error) {
    console.error(
      "[POST /api/auth/google] Error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "internal_error",
      message:
        "No se pudo completar el inicio de sesión.",
    });
  }
});

export default router;