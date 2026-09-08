// src/middleware/auth.js
import jwt from "jsonwebtoken";

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

function normalizeMatricula(value) {
  return cleanStr(value).toUpperCase();
}

function getBearerToken(req) {
  const header = cleanStr(
    req.headers.authorization
  );

  if (!header) {
    return null;
  }

  const [type, token] = header.split(/\s+/);

  if (
    type?.toLowerCase() !== "bearer" ||
    !token
  ) {
    return null;
  }

  return token;
}

function normalizeRoles(payload) {
  const roles = Array.isArray(payload?.roles)
    ? payload.roles
    : payload?.role
      ? [payload.role]
      : [];

  return Array.from(
    new Set(
      roles
        .map((role) => cleanStr(role))
        .filter(Boolean)
    )
  );
}

function normalizeAlumnoMatriculas(payload) {
  const values = Array.isArray(
    payload?.alumnoMatriculas
  )
    ? payload.alumnoMatriculas
    : [];

  return Array.from(
    new Set(
      values
        .map((matricula) =>
          cleanStr(matricula)
        )
        .filter(Boolean)
    )
  );
}

function getRequestedMatricula(req) {
  /*
   * Orden de prioridad:
   *
   * 1. Header X-Alumno-Matricula
   * 2. Query alumno
   * 3. Query matricula
   * 4. Body alumnoMatricula
   */
  return cleanStr(
    req.headers["x-alumno-matricula"] ||
      req.query?.alumno ||
      req.query?.matricula ||
      req.body?.alumnoMatricula ||
      ""
  );
}

function createAllowedMatriculaMap(
  alumnoMatriculas
) {
  const map = new Map();

  for (const matricula of alumnoMatriculas) {
    const normalized =
      normalizeMatricula(matricula);

    if (!normalized) {
      continue;
    }

    /*
     * La llave sirve para comparar sin importar
     * mayúsculas/minúsculas.
     *
     * El valor conserva la matrícula original.
     */
    map.set(normalized, matricula);
  }

  return map;
}

/* =========================================================
 * requireAuth
 * ======================================================= */

export function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "missing_token",
        message:
          "Debes iniciar sesión para continuar.",
      });
    }

    const payload = jwt.verify(
      token,
      JWT_SECRET,
      {
        issuer: "coventryschool-api",
        audience: "coventryschool-app",
      }
    );

    const roles = normalizeRoles(payload);

    const alumnoMatriculas =
      normalizeAlumnoMatriculas(payload);

    const allowedMap =
      createAllowedMatriculaMap(
        alumnoMatriculas
      );

    const requestedMatricula =
      getRequestedMatricula(req);

    const esPadre =
      roles.includes("padre");

    let alumnoMatricula = null;

    if (requestedMatricula) {
      const normalizedRequested =
        normalizeMatricula(
          requestedMatricula
        );

      const authorizedOriginal =
        allowedMap.get(normalizedRequested);

      /*
       * Si la cuenta tiene rol padre, no puede
       * solicitar una matrícula que no esté en
       * su JWT.
       */
      if (
        esPadre &&
        !authorizedOriginal
      ) {
        return res.status(403).json({
          ok: false,
          error: "alumno_no_autorizado",
          message:
            "No tienes acceso al alumno seleccionado.",
        });
      }

      alumnoMatricula =
        authorizedOriginal ||
        requestedMatricula;
    } else {
      /*
       * Compatibilidad temporal:
       *
       * Mientras migramos todas las rutas, si no llega
       * X-Alumno-Matricula se usará la primera matrícula.
       */
      alumnoMatricula =
        cleanStr(
          payload.alumnoMatriculaDefault
        ) ||
        alumnoMatriculas[0] ||
        null;
    }

    /*
     * req.authUser conserva el payload real.
     *
     * Aquí authUser.sub es el UID de Firebase.
     */
    req.authUser = {
      ...payload,
      roles,
      alumnoMatriculas,
    };

    /*
     * req.user mantiene compatibilidad con tus rutas
     * actuales, porque calendario, reportes y otras
     * todavía interpretan req.user.sub como matrícula.
     *
     * En la segunda parte quitaremos esta compatibilidad
     * y cada ruta usará req.alumnoMatricula.
     */
    req.user = {
      ...payload,

      uid: cleanStr(
        payload.uid || payload.sub
      ),

      accountSub: cleanStr(payload.sub),

      roles,
      alumnoMatriculas,

      sub:
        alumnoMatricula ||
        cleanStr(payload.sub),
    };

    req.alumnoMatricula =
      alumnoMatricula;

    return next();
  } catch (error) {
    console.error(
      "[AUTH] Token inválido:",
      error?.message || error
    );

    return res.status(401).json({
      ok: false,
      error: "invalid_token",
      message:
        "La sesión expiró o no es válida.",
    });
  }
}

/* =========================================================
 * requireRole
 *
 * Uso:
 *
 * router.post(
 *   "/",
 *   requireAuth,
 *   requireRole("colaborador"),
 *   handler
 * );
 * ======================================================= */

export function requireRole(
  ...allowedRoles
) {
  const allowed = new Set(
    allowedRoles
      .flat()
      .map((role) => cleanStr(role))
      .filter(Boolean)
  );

  return function roleMiddleware(
    req,
    res,
    next
  ) {
    const roles = normalizeRoles(
      req.authUser || req.user
    );

    const authorized = roles.some(
      (role) => allowed.has(role)
    );

    if (!authorized) {
      return res.status(403).json({
        ok: false,
        error: "forbidden_role",
        message:
          "No tienes permisos para realizar esta acción.",
      });
    }

    return next();
  };
}

/* =========================================================
 * requireAlumnoAccess
 *
 * Debe colocarse después de requireAuth.
 *
 * Uso:
 *
 * router.get(
 *   "/",
 *   requireAuth,
 *   requireAlumnoAccess,
 *   handler
 * );
 * ======================================================= */

export function requireAlumnoAccess(
  req,
  res,
  next
) {
  const authUser =
    req.authUser || req.user;

  if (!authUser) {
    return res.status(401).json({
      ok: false,
      error: "missing_auth_context",
      message:
        "No existe una sesión válida.",
    });
  }

  const roles = normalizeRoles(authUser);

  if (!roles.includes("padre")) {
    return res.status(403).json({
      ok: false,
      error: "parent_role_required",
      message:
        "Esta información pertenece al área familiar.",
    });
  }

  const matricula = cleanStr(
    req.alumnoMatricula
  );

  if (!matricula) {
    return res.status(400).json({
      ok: false,
      error: "alumno_no_seleccionado",
      message:
        "Debes seleccionar un alumno.",
    });
  }

  const allowedMap =
    createAllowedMatriculaMap(
      normalizeAlumnoMatriculas(
        authUser
      )
    );

  if (
    !allowedMap.has(
      normalizeMatricula(matricula)
    )
  ) {
    return res.status(403).json({
      ok: false,
      error: "alumno_no_autorizado",
      message:
        "No tienes acceso a este alumno.",
    });
  }

  return next();
}

export function getAlumnoMatricula(req) {
  return cleanStr(
    req.alumnoMatricula
  );
}