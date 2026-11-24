// src/routes/solicitudesSalida.js

import { Router } from "express";
import admin, { firestore } from "../firebase.js";

import {
  requireAuth,
  getAlumnoMatricula,
} from "../middleware/auth.js";

import { sendPushToAlumno } from "../services/pushService.js";

const router = Router();

const COL = firestore.collection("solicitudesSalida");
const ALUMNOS_COL = firestore.collection("alumnos");

const FV = admin.firestore.FieldValue;

let alumnosSearchCache = [];
let alumnosSearchCacheAt = 0;
const ALUMNOS_SEARCH_CACHE_TTL_MS = 5 * 60_000;

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function getAlumnosSearchIndex() {
  if (
    alumnosSearchCache.length &&
    Date.now() - alumnosSearchCacheAt < ALUMNOS_SEARCH_CACHE_TTL_MS
  ) {
    return alumnosSearchCache;
  }

  const snap = await ALUMNOS_COL.get();
  alumnosSearchCache = snap.docs.map((doc) => {
    const data = doc.data() || {};
    const nombres = cleanStr(data.nombres || data.nombre || "", 200);
    const apellidos = cleanStr(data.apellidos || "", 200);
    const nombre = `${nombres} ${apellidos}`.replace(/\s+/g, " ").trim();

    return {
      matricula: doc.id,
      nombre: nombre || doc.id,
      nivel: cleanStr(data.nivel, 100) || null,
      grado: cleanStr(data.grado, 100) || null,
      grupo: cleanStr(data.grupo, 100) || null,
      nombreBusqueda: normalizeSearch(`${nombre} ${doc.id}`),
    };
  });
  alumnosSearchCacheAt = Date.now();

  return alumnosSearchCache;
}

/* =========================================================
 * Estados
 * ======================================================= */

const ESTADOS_VALIDOS = new Set([
  "solicitado",
  "en_proceso",
  "listo",
  "entregado",
  "cancelado",
]);

const ESTADOS_ACTIVOS = [
  "solicitado",
  "en_proceso",
  "listo",
];

const TRANSICIONES = {
  solicitado: new Set([
    "en_proceso",
    "listo",
    "entregado",
    "cancelado",
  ]),

  en_proceso: new Set([
    "listo",
    "entregado",
    "cancelado",
  ]),

  listo: new Set([
    "entregado",
    "cancelado",
  ]),

  entregado: new Set([]),
  cancelado: new Set([]),
};

/* =========================================================
 * Helpers
 * ======================================================= */

function normMatricula(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function cleanStr(value, max = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function getRole(req) {
  return String(
    req.authUser?.role ||
      req.user?.role ||
      ""
  ).trim();
}

function getAccountId(req) {
  return String(
    req.authUser?.sub ||
      req.user?.accountSub ||
      req.user?.uid ||
      req.user?.sub ||
      ""
  ).trim();
}

function getUserEmail(req) {
  return String(
    req.authUser?.email ||
      req.user?.email ||
      ""
  )
    .trim()
    .toLowerCase();
}

function getColaboradorId(req) {
  return String(
    req.authUser?.colaboradorId ||
      req.user?.colaboradorId ||
      req.user?.sub ||
      ""
  ).trim();
}

function getColaboradorNombre(req) {
  const user =
    req.authUser ||
    req.user ||
    {};

  return cleanStr(
    user.nombreCompleto ||
      user.nombre ||
      user.email ||
      user.colaboradorId ||
      "Colaborador",
    200
  );
}

function getSelectedAlumnoMatricula(req) {
  try {
    return normMatricula(
      getAlumnoMatricula(req)
    );
  } catch (error) {
    console.error(
      "[solicitudesSalida] getAlumnoMatricula:",
      error
    );

    return "";
  }
}

function makeEstadoEvent({
  estado,
  actorRole,
  actorId,
  actorNombre,
  nota = "",
}) {
  return {
    estado,
    atIso: new Date().toISOString(),

    actorRole:
      cleanStr(actorRole, 50),

    actorId:
      cleanStr(actorId, 200),

    actorNombre:
      cleanStr(actorNombre, 200),

    nota:
      cleanStr(nota, 500),
  };
}

/* =========================================================
 * Snapshot alumno
 * ======================================================= */

async function getAlumnoSnapshot(
  matricula
) {
  const mat =
    normMatricula(
      matricula
    );

  if (!mat) {
    return null;
  }

  const doc =
    await ALUMNOS_COL
      .doc(mat)
      .get();

  if (!doc.exists) {
    return null;
  }

  const data =
    doc.data() || {};

  const nombres =
    data.nombres ||
    data.nombre ||
    "";

  const apellidos =
    data.apellidos ||
    "";

  const nombreCompleto =
    `${nombres} ${apellidos}`
      .replace(/\s+/g, " ")
      .trim();

  return {
    matricula:
      mat,

    nombre:
      nombreCompleto,

    nombres:
      cleanStr(
        nombres,
        200
      ),

    apellidos:
      cleanStr(
        apellidos,
        200
      ),

    nivel:
      cleanStr(
        data.nivel,
        100
      ),

    grado:
      cleanStr(
        data.grado,
        100
      ),

    grupo:
      cleanStr(
        data.grupo,
        100
      ),

    grupoPrincipal:
      cleanStr(
        data.grupoPrincipal,
        200
      ),
  };
}

/* =========================================================
 * Buscar solicitud activa
 * ======================================================= */

async function findActiveSolicitud(
  matricula
) {
  const mat =
    normMatricula(
      matricula
    );

  if (!mat) {
    return null;
  }

  const snapshots =
    await Promise.all(
      ESTADOS_ACTIVOS.map(
        (estado) =>
          COL
            .where(
              "alumnoMatricula",
              "==",
              mat
            )
            .where(
              "estado",
              "==",
              estado
            )
            .limit(1)
            .get()
      )
    );

  for (
    const snapshot of
      snapshots
  ) {
    if (
      !snapshot.empty
    ) {
      const doc =
        snapshot.docs[0];

      return {
        id: doc.id,
        ...doc.data(),
      };
    }
  }

  return null;
}

/* =========================================================
 * Push
 * ======================================================= */

async function sendEstadoPush({
  solicitudId,
  matricula,
  alumnoNombre,
  estado,
}) {
  let title = "";
  let body = "";

  switch (estado) {
    case "en_proceso":
      title =
        "👩‍🏫 Solicitud en proceso";

      body =
        alumnoNombre
          ? `Ya estamos atendiendo la solicitud de ${alumnoNombre}.`
          : "Ya estamos atendiendo tu solicitud.";

      break;

    case "listo":
      title =
        "🔔 Alumno listo";

      body =
        alumnoNombre
          ? `${alumnoNombre} está siendo preparado para su salida.`
          : "El alumno está siendo preparado para su salida.";

      break;

    case "entregado":
      title =
        "✅ Salida completada";

      body =
        alumnoNombre
          ? `La salida de ${alumnoNombre} ha sido registrada.`
          : "La salida ha sido registrada.";

      break;

    case "cancelado":
      title =
        "❌ Solicitud cancelada";

      body =
        alumnoNombre
          ? `La solicitud de salida de ${alumnoNombre} fue cancelada.`
          : "La solicitud de salida fue cancelada.";

      break;

    default:
      return null;
  }

  try {
    return await sendPushToAlumno(
      matricula,
      {
        title,
        body,

        data: {
          kind:
            "solicitud_salida",

          solicitudId,

          alumnoMatricula:
            matricula,

          estado,
        },
      }
    );
  } catch (error) {
    console.error(
      "[solicitudesSalida] push error:",
      error
    );

    return {
      ok: false,
      error:
        String(error),
    };
  }
}

/* =========================================================
 * POST /
 *
 * Padre solicita salida
 * ======================================================= */

router.post(
  "/",
  requireAuth,
  async (req, res) => {
    try {
      const role =
        getRole(req);

      if (
        role !== "padre"
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "solo_padres",
          });
      }

      /*
       * MUY IMPORTANTE:
       *
       * No tomamos matrícula del body.
       * Se usa el hijo seleccionado
       * autorizado por middleware.
       */
      const alumnoMatricula =
        getSelectedAlumnoMatricula(
          req
        );

      if (
        !alumnoMatricula
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "alumno_no_seleccionado",

            message:
              "Selecciona un hijo antes de solicitar la salida.",
          });
      }

      const alumno =
        await getAlumnoSnapshot(
          alumnoMatricula
        );

      if (!alumno) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "alumno_no_encontrado",
          });
      }

      /*
       * Evitar doble solicitud.
       */
      const activa =
        await findActiveSolicitud(
          alumnoMatricula
        );

      if (activa) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "solicitud_activa_existente",

            message:
              "Este alumno ya tiene una solicitud de salida activa.",

            item:
              activa,
          });
      }

      const now =
        FV.serverTimestamp();

      const nowIso =
        new Date()
          .toISOString();

      const accountId =
        getAccountId(req);

      const email =
        getUserEmail(req);

      const nota =
        cleanStr(
          req.body?.nota,
          500
        );

      const payload = {
        /* Alumno */

        alumnoMatricula,

        alumnoNombre:
          alumno.nombre ||
          null,

        alumnoNombres:
          alumno.nombres ||
          null,

        alumnoApellidos:
          alumno.apellidos ||
          null,

        alumnoNivel:
          alumno.nivel ||
          null,

        alumnoGrado:
          alumno.grado ||
          null,

        alumnoGrupo:
          alumno.grupo ||
          null,

        alumnoGrupoPrincipal:
          alumno.grupoPrincipal ||
          null,

        /* Solicitud */

        estado:
          "solicitado",

        nota,

        /* Familiar */

        accountId:
          accountId ||
          null,

        solicitanteEmail:
          email ||
          null,

        solicitanteTipo:
          "padre",

        /* Atención */

        atendidoPorId:
          null,

        atendidoPorNombre:
          null,

        /* Fechas */

        createdAt:
          now,

        createdAtIso:
          nowIso,

        updatedAt:
          now,

        updatedAtIso:
          nowIso,

        enProcesoAt:
          null,

        enProcesoAtIso:
          null,

        listoAt:
          null,

        listoAtIso:
          null,

        entregadoAt:
          null,

        entregadoAtIso:
          null,

        canceladoAt:
          null,

        canceladoAtIso:
          null,

        historialEstados: [
          makeEstadoEvent({
            estado:
              "solicitado",

            actorRole:
              "padre",

            actorId:
              accountId,

            actorNombre:
              email ||
              "Familiar",

            nota,
          }),
        ],
      };

      const ref =
        await COL.add(
          payload
        );

      const created =
        await ref.get();

      return res
        .status(201)
        .json({
          ok: true,

          item: {
            id:
              created.id,

            ...created.data(),
          },
        });
    } catch (error) {
      console.error(
        "[POST /api/solicitudes-salida] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            String(error),
        });
    }
  }
);

/* =========================================================
 * POST /manual
 *
 * Registro manual de salida por un colaborador.
 * Si ya existe una solicitud activa, la completa.
 * Si no existe, crea un registro finalizado para el historial.
 * ======================================================= */

router.post(
  "/manual",
  requireAuth,
  async (req, res) => {
    try {
      if (getRole(req) !== "colaborador") {
        return res.status(403).json({ ok: false, error: "solo_colaboradores" });
      }

      const alumnoMatricula = normMatricula(req.body?.alumnoMatricula);
      const puntoSalida = cleanStr(req.body?.puntoSalida, 100);
      const personaRecoge = cleanStr(req.body?.personaRecoge, 200);
      const motivo = cleanStr(req.body?.motivo, 500);
      const confirmado = req.body?.confirmado === true;

      if (!alumnoMatricula || !puntoSalida || !personaRecoge || !motivo) {
        return res.status(400).json({
          ok: false,
          error: "campos_requeridos",
          message: "Indica matrícula, salida, quién recoge y motivo.",
        });
      }

      if (!["Salida 1", "Salida 2", "Salida 3"].includes(puntoSalida)) {
        return res.status(400).json({ ok: false, error: "salida_invalida" });
      }

      if (!confirmado) {
        return res.status(400).json({ ok: false, error: "confirmacion_requerida" });
      }

      const alumno = await getAlumnoSnapshot(alumnoMatricula);
      if (!alumno) {
        return res.status(404).json({ ok: false, error: "alumno_no_encontrado" });
      }

      const colaboradorId = getColaboradorId(req);
      const colaboradorNombre = getColaboradorNombre(req);
      const now = FV.serverTimestamp();
      const nowIso = new Date().toISOString();
      const active = await findActiveSolicitud(alumnoMatricula);
      const ref = active ? COL.doc(active.id) : COL.doc();
      const qrRef = firestore.collection("qrScans").doc();
      const notaEvento = `Salida manual · ${puntoSalida} · Recoge: ${personaRecoge} · Motivo: ${motivo}`;
      const event = makeEstadoEvent({
        estado: "entregado",
        actorRole: "colaborador",
        actorId: colaboradorId,
        actorNombre: colaboradorNombre,
        nota: notaEvento,
      });

      const scanData = {
        alumnoMatricula,
        tipo: "salida",
        puntoControl: puntoSalida,
        fuente: "manual",
        colaboradorId,
        colaboradorNombre,
        raw: "",
        meta: { nota: puntoSalida, puntoControl: puntoSalida, personaRecoge, motivo },
        alumnoNombre: alumno.nombre || null,
        alumnoGrado: alumno.grado || null,
        alumnoGrupo: alumno.grupo || null,
        alumnoNivel: alumno.nivel || null,
        createdAt: now,
        createdAtIso: nowIso,
      };

      if (active) {
        const currentSnap = await ref.get();
        if (!currentSnap.exists || !ESTADOS_ACTIVOS.includes(String(currentSnap.data()?.estado || ""))) {
          return res.status(409).json({ ok: false, error: "solicitud_ya_actualizada" });
        }

        await ref.update({
          estado: "entregado",
          entregadoAt: now,
          entregadoAtIso: nowIso,
          updatedAt: now,
          updatedAtIso: nowIso,
          atendidoPorId: colaboradorId || null,
          atendidoPorNombre: colaboradorNombre || null,
          puntoSalida,
          salidaFuente: "manual",
          salidaAt: now,
          salidaAtIso: nowIso,
          salidaPorId: colaboradorId || null,
          salidaPorNombre: colaboradorNombre || null,
          personaRecoge,
          motivoSalida: motivo,
          qrScanId: qrRef.id,
          historialEstados: FV.arrayUnion(event),
        });
      } else {
        await ref.set({
          alumnoMatricula,
          alumnoNombre: alumno.nombre || null,
          alumnoNombres: alumno.nombres || null,
          alumnoApellidos: alumno.apellidos || null,
          alumnoNivel: alumno.nivel || null,
          alumnoGrado: alumno.grado || null,
          alumnoGrupo: alumno.grupo || null,
          alumnoGrupoPrincipal: alumno.grupoPrincipal || null,
          estado: "entregado",
          nota: "Salida registrada manualmente, sin solicitud familiar previa.",
          notaAtencion: notaEvento,
          accountId: null,
          solicitanteEmail: null,
          solicitanteTipo: "registro_manual",
          atendidoPorId: colaboradorId || null,
          atendidoPorNombre: colaboradorNombre || null,
          createdAt: now,
          createdAtIso: nowIso,
          updatedAt: now,
          updatedAtIso: nowIso,
          enProcesoAt: null,
          enProcesoAtIso: null,
          listoAt: null,
          listoAtIso: null,
          entregadoAt: now,
          entregadoAtIso: nowIso,
          canceladoAt: null,
          canceladoAtIso: null,
          puntoSalida,
          salidaFuente: "manual",
          salidaAt: now,
          salidaAtIso: nowIso,
          salidaPorId: colaboradorId || null,
          salidaPorNombre: colaboradorNombre || null,
          personaRecoge,
          motivoSalida: motivo,
          qrScanId: qrRef.id,
          historialEstados: [event],
        });
      }

      await qrRef.set({ ...scanData, solicitudId: ref.id });
      const push = await sendEstadoPush({
        solicitudId: ref.id,
        matricula: alumnoMatricula,
        alumnoNombre: alumno.nombre,
        estado: "entregado",
      });
      const saved = await ref.get();

      return res.status(active ? 200 : 201).json({
        ok: true,
        item: { id: saved.id, ...saved.data() },
        qrScanId: qrRef.id,
        createdManual: !active,
        push,
      });
    } catch (error) {
      console.error("[POST /api/solicitudes-salida/manual] error:", error);
      return res.status(500).json({ ok: false, error: String(error) });
    }
  }
);

/* =========================================================
 * GET /
 *
 * IMPORTANTE:
 *
 * activos=1:
 *      solicitudes activas
 *      ordenadas FIFO
 *      más antigua primero
 *
 * historial:
 *      más reciente primero
 * ======================================================= */

router.get(
  "/",
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
              "no_autorizado",
          });
      }

      const {
        estado = "",
        alumno = "",
        nivel = "",
        grado = "",
        grupo = "",
        q = "",
        from = "",
        to = "",
        activos = "",
        pageSize = "50",
      } = req.query;

      const limit =
        Math.min(
          200,
          Math.max(
            1,
            Number(
              pageSize
            ) || 50
          )
        );

      let alumnoMatricula =
        "";

      /* =========================
       * Padre
       * ======================= */

      if (
        role === "padre"
      ) {
        alumnoMatricula =
          getSelectedAlumnoMatricula(
            req
          );

        if (
          !alumnoMatricula
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "alumno_no_seleccionado",
            });
        }
      } else {
        alumnoMatricula =
          normMatricula(
            alumno
          );
      }

      let query =
        COL;

      if (
        alumnoMatricula
      ) {
        query =
          query.where(
            "alumnoMatricula",
            "==",
            alumnoMatricula
          );
      }

      /*
       * Solicitamos suficientes documentos.
       *
       * Después filtramos algunos campos
       * en memoria para evitar índices
       * compuestos innecesarios.
       */
      const scanLimit =
        Math.min(
          500,
          Math.max(
            limit * 5,
            100
          )
        );

      const snap =
        await query
          .limit(scanLimit)
          .get();

      let items =
        snap.docs.map(
          (doc) => ({
            id:
              doc.id,

            ...doc.data(),
          })
        );

      /* =========================
       * Filtro activos
       * ======================= */

      if (
        String(
          activos
        ) === "1"
      ) {
        items =
          items.filter(
            (item) =>
              ESTADOS_ACTIVOS.includes(
                String(
                  item.estado ||
                    ""
                )
              )
          );
      }

      /* =========================
       * Estado
       * ======================= */

      const estadoNorm =
        cleanStr(
          estado,
          50
        ).toLowerCase();

      if (
        estadoNorm
      ) {
        items =
          items.filter(
            (item) =>
              String(
                item.estado ||
                  ""
              )
                .toLowerCase() ===
              estadoNorm
          );
      }

      /* =========================
       * Nivel
       * ======================= */

      const nivelNorm =
        cleanStr(
          nivel,
          100
        ).toLowerCase();

      if (
        nivelNorm
      ) {
        items =
          items.filter(
            (item) =>
              String(
                item.alumnoNivel ||
                  ""
              )
                .toLowerCase() ===
              nivelNorm
          );
      }

      /* =========================
       * Grado
       * ======================= */

      const gradoNorm =
        cleanStr(
          grado,
          100
        ).toLowerCase();

      if (
        gradoNorm
      ) {
        items =
          items.filter(
            (item) =>
              String(
                item.alumnoGrado ||
                  ""
              )
                .toLowerCase() ===
              gradoNorm
          );
      }

      /* =========================
       * Grupo
       * ======================= */

      const grupoNorm =
        cleanStr(
          grupo,
          100
        ).toLowerCase();

      if (
        grupoNorm
      ) {
        items =
          items.filter(
            (item) =>
              String(
                item.alumnoGrupo ||
                  ""
              )
                .toLowerCase() ===
              grupoNorm
          );
      }

      /* =========================
       * Fecha inicial
       * ======================= */

      if (from) {
        const fromDate =
          new Date(
            `${from}T00:00:00.000Z`
          );

        if (
          Number.isFinite(
            fromDate.getTime()
          )
        ) {
          const min =
            fromDate.getTime();

          items =
            items.filter(
              (item) => {
                const time =
                  new Date(
                    item.createdAtIso
                  ).getTime();

                return (
                  Number.isFinite(
                    time
                  ) &&
                  time >= min
                );
              }
            );
        }
      }

      /* =========================
       * Fecha final
       * ======================= */

      if (to) {
        const toDate =
          new Date(
            `${to}T23:59:59.999Z`
          );

        if (
          Number.isFinite(
            toDate.getTime()
          )
        ) {
          const max =
            toDate.getTime();

          items =
            items.filter(
              (item) => {
                const time =
                  new Date(
                    item.createdAtIso
                  ).getTime();

                return (
                  Number.isFinite(
                    time
                  ) &&
                  time <= max
                );
              }
            );
        }
      }

      /* =========================
       * Buscador
       * ======================= */

      const search =
        cleanStr(
          q,
          200
        ).toLowerCase();

      if (
        search
      ) {
        items =
          items.filter(
            (item) => {
              const haystack =
                [
                  item.alumnoMatricula,
                  item.alumnoNombre,
                  item.alumnoNivel,
                  item.alumnoGrado,
                  item.alumnoGrupo,
                  item.estado,
                  item.solicitanteEmail,
                  item.atendidoPorNombre,
                ]
                  .join(" ")
                  .toLowerCase();

              return haystack.includes(
                search
              );
            }
          );
      }

      /* =====================================================
       * ORDEN
       *
       * Este es el punto importante.
       * =================================================== */

      if (
        String(
          activos
        ) === "1"
      ) {
        /*
         * FIFO
         *
         * El que pidió primero
         * aparece primero.
         */
        items.sort(
          (a, b) => {
            const ta =
              new Date(
                a.createdAtIso ||
                  0
              ).getTime();

            const tb =
              new Date(
                b.createdAtIso ||
                  0
              ).getTime();

            return ta - tb;
          }
        );
      } else {
        /*
         * HISTORIAL
         *
         * Lo más reciente
         * aparece arriba.
         */
        items.sort(
          (a, b) => {
            const ta =
              new Date(
                a.createdAtIso ||
                  0
              ).getTime();

            const tb =
              new Date(
                b.createdAtIso ||
                  0
              ).getTime();

            return tb - ta;
          }
        );
      }

      /*
       * Page size.
       */
      items =
        items.slice(
          0,
          limit
        );

      return res.json({
        ok: true,
        items,

        /*
         * Por ahora dejamos cursor null.
         *
         * Para solicitudes activas realmente
         * no queremos paginar una fila operacional:
         * necesitamos ver todas las solicitudes
         * activas importantes.
         */
        nextCursor:
          null,
      });
    } catch (error) {
      console.error(
        "[GET /api/solicitudes-salida] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            String(error),
        });
    }
  }
);

/* =========================================================
 * GET /buscar-alumnos?q=...
 * Busca alumnos por nombre completo o matrícula.
 * ======================================================= */

router.get(
  "/buscar-alumnos",
  requireAuth,
  async (req, res) => {
    try {
      if (getRole(req) !== "colaborador") {
        return res.status(403).json({ ok: false, error: "solo_colaboradores" });
      }

      const q = cleanStr(req.query?.q, 120);
      const query = normalizeSearch(q);
      if (query.length < 2) {
        return res.json({ ok: true, items: [] });
      }

      const alumnos = await getAlumnosSearchIndex();
      const items = alumnos
        .filter((alumno) => alumno.nombreBusqueda.includes(query))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        .slice(0, 15)
        .map(({ nombreBusqueda, ...alumno }) => alumno);

      return res.json({ ok: true, items });
    } catch (error) {
      console.error("[GET /api/solicitudes-salida/buscar-alumnos] error:", error);
      return res.status(500).json({ ok: false, error: String(error) });
    }
  }
);

/* =========================================================
 * GET /:id
 * ======================================================= */

router.get(
  "/:id",
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
              "no_autorizado",
          });
      }

      const id =
        cleanStr(
          req.params.id,
          200
        );

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "id_requerido",
          });
      }

      const doc =
        await COL
          .doc(id)
          .get();

      if (
        !doc.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "not_found",
          });
      }

      const item = {
        id:
          doc.id,

        ...doc.data(),
      };

      if (
        role === "padre"
      ) {
        const selected =
          getSelectedAlumnoMatricula(
            req
          );

        if (
          !selected ||
          selected !==
            normMatricula(
              item.alumnoMatricula
            )
        ) {
          return res
            .status(403)
            .json({
              ok: false,

              error:
                "no_autorizado",
            });
        }
      }

      return res.json({
        ok: true,
        item,
      });
    } catch (error) {
      console.error(
        "[GET /api/solicitudes-salida/:id] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            String(error),
        });
    }
  }
);

/* =========================================================
 * PATCH /:id/estado
 *
 * Colaborador cambia estado
 * ======================================================= */

router.patch(
  "/:id/estado",
  requireAuth,
  async (req, res) => {
    try {
      const role =
        getRole(req);

      if (
        role !==
        "colaborador"
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "solo_colaboradores",
          });
      }

      const id =
        cleanStr(
          req.params.id,
          200
        );

      const nuevoEstado =
        cleanStr(
          req.body?.estado,
          50
        ).toLowerCase();

      const nota =
        cleanStr(
          req.body?.nota,
          500
        );

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "id_requerido",
          });
      }

      if (
        !ESTADOS_VALIDOS.has(
          nuevoEstado
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "estado_invalido",

            estadosValidos:
              Array.from(
                ESTADOS_VALIDOS
              ),
          });
      }

      if (
        nuevoEstado ===
        "solicitado"
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "estado_no_permitido",
          });
      }

      const ref =
        COL.doc(id);

      const currentSnap =
        await ref.get();

      if (
        !currentSnap.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "not_found",
          });
      }

      const current =
        currentSnap.data() ||
        {};

      const estadoActual =
        String(
          current.estado ||
            "solicitado"
        ).toLowerCase();

      if (
        estadoActual ===
        nuevoEstado
      ) {
        return res.json({
          ok: true,

          item: {
            id:
              currentSnap.id,

            ...current,
          },

          unchanged:
            true,
        });
      }

      const permitidos =
        TRANSICIONES[
          estadoActual
        ];

      if (
        !permitidos ||
        !permitidos.has(
          nuevoEstado
        )
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "transicion_no_permitida",

            estadoActual,
            nuevoEstado,
          });
      }

      const now =
        FV.serverTimestamp();

      const nowIso =
        new Date()
          .toISOString();

      const colaboradorId =
        getColaboradorId(
          req
        );

      const colaboradorNombre =
        getColaboradorNombre(
          req
        );

      const patch = {
        estado:
          nuevoEstado,

        updatedAt:
          now,

        updatedAtIso:
          nowIso,

        atendidoPorId:
          colaboradorId ||
          null,

        atendidoPorNombre:
          colaboradorNombre ||
          null,

        historialEstados:
          FV.arrayUnion(
            makeEstadoEvent({
              estado:
                nuevoEstado,

              actorRole:
                "colaborador",

              actorId:
                colaboradorId,

              actorNombre:
                colaboradorNombre,

              nota,
            })
          ),
      };

      if (nota) {
        patch.notaAtencion =
          nota;
      }

      if (
        nuevoEstado ===
        "en_proceso"
      ) {
        patch.enProcesoAt =
          now;

        patch.enProcesoAtIso =
          nowIso;
      }

      if (
        nuevoEstado ===
        "listo"
      ) {
        patch.listoAt =
          now;

        patch.listoAtIso =
          nowIso;
      }

      if (
        nuevoEstado ===
        "entregado"
      ) {
        patch.entregadoAt =
          now;

        patch.entregadoAtIso =
          nowIso;
      }

      if (
        nuevoEstado ===
        "cancelado"
      ) {
        patch.canceladoAt =
          now;

        patch.canceladoAtIso =
          nowIso;
      }

      await ref.update(
        patch
      );

      const push =
        await sendEstadoPush({
          solicitudId:
            id,

          matricula:
            normMatricula(
              current.alumnoMatricula
            ),

          alumnoNombre:
            current.alumnoNombre ||
            "",

          estado:
            nuevoEstado,
        });

      const updated =
        await ref.get();

      return res.json({
        ok: true,

        item: {
          id:
            updated.id,

          ...updated.data(),
        },

        push,
      });
    } catch (error) {
      console.error(
        "[PATCH /api/solicitudes-salida/:id/estado] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            String(error),
        });
    }
  }
);

/* =========================================================
 * POST /:id/cancelar
 *
 * Padre cancela su propia solicitud.
 * ======================================================= */

router.post(
  "/:id/cancelar",
  requireAuth,
  async (req, res) => {
    try {
      const role =
        getRole(req);

      if (
        role !== "padre"
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "solo_padres",
          });
      }

      const id =
        cleanStr(
          req.params.id,
          200
        );

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "id_requerido",
          });
      }

      const selectedMatricula =
        getSelectedAlumnoMatricula(
          req
        );

      if (
        !selectedMatricula
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "alumno_no_seleccionado",
          });
      }

      const ref =
        COL.doc(id);

      const snap =
        await ref.get();

      if (
        !snap.exists
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "not_found",
          });
      }

      const current =
        snap.data() ||
        {};

      const solicitudMatricula =
        normMatricula(
          current.alumnoMatricula
        );

      if (
        solicitudMatricula !==
        selectedMatricula
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "no_autorizado",
          });
      }

      /*
       * Una vez que el colegio empezó
       * a atenderlo, el padre ya no puede
       * cancelar desde la app.
       */
      if (
        current.estado !==
        "solicitado"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "solicitud_ya_en_proceso",

            estado:
              current.estado,
          });
      }

      const now =
        FV.serverTimestamp();

      const nowIso =
        new Date()
          .toISOString();

      const accountId =
        getAccountId(req);

      const email =
        getUserEmail(req);

      await ref.update({
        estado:
          "cancelado",

        canceladoAt:
          now,

        canceladoAtIso:
          nowIso,

        updatedAt:
          now,

        updatedAtIso:
          nowIso,

        historialEstados:
          FV.arrayUnion(
            makeEstadoEvent({
              estado:
                "cancelado",

              actorRole:
                "padre",

              actorId:
                accountId,

              actorNombre:
                email ||
                "Familiar",

              nota:
                "Cancelado por el familiar",
            })
          ),
      });

      const updated =
        await ref.get();

      return res.json({
        ok: true,

        item: {
          id:
            updated.id,

          ...updated.data(),
        },
      });
    } catch (error) {
      console.error(
        "[POST /api/solicitudes-salida/:id/cancelar] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            String(error),
        });
    }
  }
);

export default router;