// src/routes/push.js

import {Router} from "express";

import admin, {
  firestore,
} from "../firebase.js";

import {
  requireAuth,
  getAlumnoMatricula,
} from "../middleware/auth.js";

import {
  sendPushToAlumno,
} from "../services/pushService.js";

const router = Router();

function asStr(
  value,
  fallback = "",
) {
  return typeof value === "string"
    ? value
    : fallback;
}

function normMatricula(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeToken(value) {
  return String(value || "")
    .trim();
}

function normalizePlatform(value) {
  const platform =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    platform === "android" ||
    platform === "ios"
  ) {
    return platform;
  }

  return "unknown";
}

function normalizeDeviceId(value) {
  const deviceId =
    String(value || "")
      .trim();

  return deviceId || "default";
}

/*
 * Firestore no permite "/" dentro del ID
 * de un documento.
 */
function safeDocumentPart(value) {
  return String(value || "")
    .trim()
    .replaceAll("/", "_")
    .replaceAll(":", "_");
}

function getRole(req) {
  return String(
    req.authUser?.role ||
      req.user?.role ||
      "unknown",
  ).trim();
}

/*
 * Cuenta real del usuario.
 *
 * Para los tokens nuevos, req.authUser.sub
 * contiene el UID de Firebase.
 *
 * req.user.sub puede contener temporalmente
 * la matrícula seleccionada por compatibilidad.
 */
function getAccountId(req) {
  return String(
    req.authUser?.sub ||
      req.user?.accountSub ||
      req.user?.uid ||
      req.user?.sub ||
      "",
  ).trim();
}

function getAuthorizedMatriculas(req) {
  const source =
    req.authUser?.alumnoMatriculas ||
    req.user?.alumnoMatriculas ||
    [];

  if (!Array.isArray(source)) {
    return [];
  }

  return Array.from(
    new Set(
      source
        .map(normMatricula)
        .filter(Boolean),
    ),
  );
}

function addRefToDelete(
  map,
  document,
) {
  if (!document?.ref?.path) {
    return;
  }

  map.set(
    document.ref.path,
    document.ref,
  );
}

/**
 * POST /api/push/register
 *
 * body:
 * {
 *   token: string,
 *   platform?: "android" | "ios",
 *   deviceId?: string,
 *   alumnoMatricula?: string
 * }
 */
router.post(
  "/register",
  requireAuth,
  async (req, res) => {
    try {
      const token =
        normalizeToken(
          req.body?.token,
        );

      const platform =
        normalizePlatform(
          req.body?.platform,
        );

      const deviceId =
        normalizeDeviceId(
          req.body?.deviceId,
        );

      if (
        !token ||
        token.length < 20
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "token_invalido",
          });
      }

      const role =
        getRole(req);

      const accountId =
        getAccountId(req);

      if (!accountId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "accountId_invalido",
          });
      }

      if (
        role !== "padre" &&
        role !== "colaborador"
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "rol_no_autorizado",
          });
      }

      const authorizedMatriculas =
        getAuthorizedMatriculas(
          req,
        );

      let alumnoMatricula =
        null;

      if (role === "padre") {
        /*
         * getAlumnoMatricula obtiene la matrícula
         * elegida mediante X-Alumno-Matricula.
         *
         * El middleware ya verificó que pertenece
         * a la cuenta.
         */
        alumnoMatricula =
          normMatricula(
            getAlumnoMatricula(req),
          );

        const bodyMatricula =
          normMatricula(
            req.body
              ?.alumnoMatricula,
          );

        /*
         * El body y el header deben referirse
         * al mismo alumno.
         */
        if (
          bodyMatricula &&
          bodyMatricula !==
            alumnoMatricula
        ) {
          return res
            .status(403)
            .json({
              ok: false,
              error:
                "matricula_no_coincide",
            });
        }

        if (!alumnoMatricula) {
          return res
            .status(400)
            .json({
              ok: false,
              error:
                "matricula_invalida",
            });
        }

        /*
         * Defensa adicional, aunque requireAuth
         * ya realiza esta comprobación.
         */
        if (
          authorizedMatriculas
            .length > 0 &&
          !authorizedMatriculas
            .includes(
              alumnoMatricula,
            )
        ) {
          return res
            .status(403)
            .json({
              ok: false,
              error:
                "matricula_no_autorizada",
            });
        }
      }

      /*
       * Cada combinación:
       *
       * cuenta + dispositivo + alumno
       *
       * debe ser un documento distinto.
       */
      const docIdParts = [
        safeDocumentPart(role),
        safeDocumentPart(
          accountId,
        ),
        safeDocumentPart(
          deviceId,
        ),
      ];

      if (alumnoMatricula) {
        docIdParts.push(
          safeDocumentPart(
            alumnoMatricula,
          ),
        );
      } else {
        docIdParts.push(
          "account",
        );
      }

      const docId =
        docIdParts.join(":");

      const pushTokensCollection =
        firestore.collection(
          "pushTokens",
        );

      const ref =
        pushTokensCollection.doc(
          docId,
        );

      /*
       * Documentos antiguos o de otra cuenta
       * que deben borrarse.
       *
       * Importante:
       * NO se borran los documentos de hermanos
       * pertenecientes a la misma cuenta.
       */
      const refsToDelete =
        new Map();

      /*
       * El mismo token FCM pertenece a una sola
       * instalación de la app.
       *
       * Si estaba asociado a otra cuenta,
       * eliminamos esa asociación.
       *
       * Si pertenece a la misma cuenta,
       * conservamos todas sus matrículas.
       */
      const sameTokenSnapshot =
        await pushTokensCollection
          .where(
            "token",
            "==",
            token,
          )
          .get();

      sameTokenSnapshot.docs
        .forEach(document => {
          if (
            document.id === docId
          ) {
            return;
          }

          const data =
            document.data() || {};

          const storedAccountId =
            String(
              data.accountId || "",
            ).trim();

          const sameAccount =
            storedAccountId &&
            storedAccountId ===
              accountId;

          /*
           * Los documentos del sistema anterior
           * no tienen accountId, por lo que se
           * reemplazan al registrar el nuevo modelo.
           */
          if (!sameAccount) {
            addRefToDelete(
              refsToDelete,
              document,
            );
          }
        });

      /*
       * Limpia registros de cuentas anteriores
       * que hayan usado esta misma instalación.
       *
       * Solo se hace cuando deviceId es realmente
       * único. "default" podría ser compartido por
       * clientes antiguos.
       */
      if (
        deviceId !== "default"
      ) {
        const sameDeviceSnapshot =
          await pushTokensCollection
            .where(
              "deviceId",
              "==",
              deviceId,
            )
            .get();

        const authorizedSet =
          new Set(
            authorizedMatriculas,
          );

        sameDeviceSnapshot.docs
          .forEach(document => {
            if (
              document.id ===
              docId
            ) {
              return;
            }

            const data =
              document.data() || {};

            const storedAccountId =
              String(
                data.accountId ||
                  "",
              ).trim();

            const storedMatricula =
              normMatricula(
                data
                  .alumnoMatricula,
              );

            /*
             * La misma instalación inició sesión
             * con otra cuenta.
             */
            if (
              storedAccountId &&
              storedAccountId !==
                accountId
            ) {
              addRefToDelete(
                refsToDelete,
                document,
              );

              return;
            }

            /*
             * Una matrícula dejó de pertenecer
             * a la cuenta.
             */
            if (
              storedAccountId ===
                accountId &&
              role === "padre" &&
              storedMatricula &&
              authorizedSet.size >
                0 &&
              !authorizedSet.has(
                storedMatricula,
              )
            ) {
              addRefToDelete(
                refsToDelete,
                document,
              );
            }
          });
      }

      if (
        refsToDelete.size > 0
      ) {
        const deleteBatch =
          firestore.batch();

        refsToDelete.forEach(
          documentRef => {
            deleteBatch.delete(
              documentRef,
            );
          },
        );

        await deleteBatch.commit();
      }

      const existingDocument =
        await ref.get();

      const now =
        admin.firestore
          .FieldValue
          .serverTimestamp();

      const documentData = {
        role,

        /*
         * ID real de la cuenta:
         * UID Firebase.
         */
        accountId,

        /*
         * Se mantiene userId para compatibilidad,
         * pero ahora representa la cuenta,
         * no la matrícula.
         */
        userId: accountId,

        alumnoMatricula,

        token,
        platform,
        deviceId,
        updatedAt: now,
      };

      if (
        !existingDocument.exists
      ) {
        documentData.createdAt =
          now;
      }

      await ref.set(
        documentData,
        {
          merge: true,
        },
      );

      console.log(
        "[push/register] dispositivo vinculado",
        {
          role,
          accountId,
          alumnoMatricula,
          platform,
          deviceId,
          docId,
          deleted:
            refsToDelete.size,
        },
      );

      return res.json({
        ok: true,
        role,
        accountId,
        alumnoMatricula,
        platform,
        deviceId,
        docId,
      });
    } catch (error) {
      console.error(
        "[POST /api/push/register] error:",
        error,
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            String(error),
        });
    }
  },
);

/**
 * POST /api/push/test
 */
router.post(
  "/test",
  requireAuth,
  async (req, res) => {
    try {
      const role =
        getRole(req);

      if (
        role !== "padre" &&
        role !== "colaborador"
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "rol_no_autorizado",
          });
      }

      const alumnoMatricula =
        role === "padre"
          ? normMatricula(
              getAlumnoMatricula(
                req,
              ),
            )
          : normMatricula(
              req.body
                ?.alumnoMatricula,
            );

      if (!alumnoMatricula) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "alumnoMatricula_requerido",
          });
      }

      const title =
        asStr(
          req.body?.title,
          "Prueba Coventry",
        );

      const body =
        asStr(
          req.body?.body,
          "Si ves esto, ya llegan las notificaciones ✅",
        );

      const result =
        await sendPushToAlumno(
          alumnoMatricula,
          {
            title,
            body,
            data: {
              kind: "test",
              alumnoMatricula,
            },
          },
        );

      return res.json({
        ok: true,
        alumnoMatricula,
        result,
      });
    } catch (error) {
      console.error(
        "[POST /api/push/test] error:",
        error,
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            String(error),
        });
    }
  },
);

export default router;