// src/routes/colaboradores.js
import { Router } from "express";
import { firestore } from "../firebase.js";

const router = Router();
const COL = "colaboradores";
const MAX_LIST = 500;

/* =========================================================
 * Helpers
 * ======================================================= */

const hasOwn = (obj, key) =>
  Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const isPlainObj = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const clampStr = (value, max = 300) =>
  typeof value === "string" ? value.slice(0, max) : value;

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }

  if (value && typeof value === "object") {
    const out = {};

    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        out[key] = stripUndefinedDeep(item);
      }
    }

    return out;
  }

  return value;
}

const norm = (value = "") =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

function pickColaborador(body = {}) {
  const out = {};

  // ===== Laboral / identidad
  out.nombres = clampStr(body.nombres);
  out.apellidoPaterno = clampStr(body.apellidoPaterno);
  out.apellidoMaterno = clampStr(body.apellidoMaterno);
  out.nombrePreferido = clampStr(body.nombrePreferido);

  out.correoInstitucional = clampStr(
    body.correoInstitucional
  );

  out.email = clampStr(
    body.email ?? body.correoInstitucional
  );

  out.noEmpleado = clampStr(body.noEmpleado);
  out.posicion = clampStr(body.posicion);
  out.categoriaPuesto = clampStr(body.categoriaPuesto);
  out.esquemaTrabajo = clampStr(body.esquemaTrabajo);

  out.horasTrabajo = safeNumber(
    body.horasTrabajo,
    0
  );

  out.extension = clampStr(body.extension);
  out.jefeInmediato = clampStr(body.jefeInmediato);
  out.director = clampStr(body.director);
  out.direccion = clampStr(body.direccion);
  out.fechaIngreso = clampStr(body.fechaIngreso);
  out.fechaBaja = clampStr(body.fechaBaja);
  out.estatus = clampStr(body.estatus ?? "Activo");

  // ===== Personales
  out.fechaNacimiento = clampStr(body.fechaNacimiento);
  out.nss = clampStr(body.nss);
  out.curp = clampStr(body.curp);
  out.rfc = clampStr(body.rfc);
  out.genero = clampStr(body.genero);
  out.estadoCivil = clampStr(body.estadoCivil);
  out.gradoEstudios = clampStr(body.gradoEstudios);
  out.tallaCamisa = clampStr(body.tallaCamisa);

  out.pasatiempos = clampStr(
    body.pasatiempos,
    2000
  );

  out.pastelFavorito = clampStr(
    body.pastelFavorito
  );

  out.postalFavorito = clampStr(
    body.postalFavorito
  );

  // ===== Médicos
  out.tipoSangre = clampStr(body.tipoSangre);

  out.alergias = clampStr(
    body.alergias,
    2000
  );

  out.tratamientoMedico = clampStr(
    body.tratamientoMedico,
    2000
  );

  out.enfermedadesCronicas =
    isPlainObj(body.enfermedadesCronicas)
      ? {
          asma:
            !!body.enfermedadesCronicas.asma,

          diabetes:
            !!body.enfermedadesCronicas.diabetes,

          otra: clampStr(
            body.enfermedadesCronicas.otra
          ),
        }
      : {
          asma: false,
          diabetes: false,
          otra: "",
        };

  out.historialMedico =
    Array.isArray(body.historialMedico)
      ? body.historialMedico.map((item) => ({
          fechaIso: clampStr(item?.fechaIso),

          tipo: clampStr(item?.tipo),

          descripcion: clampStr(
            item?.descripcion,
            1000
          ),

          registradoPor: clampStr(
            item?.registradoPor
          ),

          observaciones: clampStr(
            item?.observaciones,
            1000
          ),
        }))
      : [];

  // ===== Contacto
  out.telCel = clampStr(body.telCel);
  out.telCasa = clampStr(body.telCasa);
  out.emailPersonal = clampStr(body.emailPersonal);
  out.calleNumero = clampStr(body.calleNumero);
  out.colonia = clampStr(body.colonia);
  out.codigoPostal = clampStr(body.codigoPostal);
  out.estado = clampStr(body.estado);
  out.municipio = clampStr(body.municipio);

  out.contactosEmergencia =
    Array.isArray(body.contactosEmergencia)
      ? body.contactosEmergencia.map(
          (contacto) => ({
            nombre: clampStr(
              contacto?.nombre
            ),

            telefono: clampStr(
              contacto?.telefono
            ),

            parentesco: clampStr(
              contacto?.parentesco
            ),
          })
        )
      : [];

  // ===== Familia
  out.familia =
    Array.isArray(body.familia)
      ? body.familia.map((miembro) => ({
          nombre: clampStr(miembro?.nombre),

          parentesco: clampStr(
            miembro?.parentesco
          ),

          edad: safeNumber(
            miembro?.edad,
            0
          ),

          telefono: clampStr(
            miembro?.telefono
          ),

          escolaridad: clampStr(
            miembro?.escolaridad
          ),

          viveConEl:
            !!miembro?.viveConEl,

          observaciones: clampStr(
            miembro?.observaciones,
            1000
          ),
        }))
      : [];

  // ===== Dependientes
  out.dependientes =
    Array.isArray(body.dependientes)
      ? body.dependientes.map(
          (dependiente) => ({
            nombres: clampStr(
              dependiente?.nombres
            ),

            aPaterno: clampStr(
              dependiente?.aPaterno
            ),

            aMaterno: clampStr(
              dependiente?.aMaterno
            ),

            fechaNacIso: clampStr(
              dependiente?.fechaNacIso
            ),

            parentesco: clampStr(
              dependiente?.parentesco
            ),

            estudiante:
              !!dependiente?.estudiante,
          })
        )
      : [];

  // ===== Documentos
  if (isPlainObj(body.documentos)) {
    const documentos = {};

    for (
      const [key, value] of
      Object.entries(body.documentos)
    ) {
      documentos[key] = {
        fileName: clampStr(
          value?.fileName
        ),

        mime: clampStr(
          value?.mime
        ),

        size: safeNumber(
          value?.size,
          0
        ),

        status: [
          "ok",
          "faltante",
          "revisar",
        ].includes(value?.status)
          ? value.status
          : "faltante",
      };
    }

    out.documentos = documentos;
  } else {
    out.documentos = {};
  }

  out.comentarios = clampStr(
    body.comentarios,
    2000
  );

  return stripUndefinedDeep(out);
}

/* =========================================================
 * VALIDACIONES
 * ======================================================= */

function validateRequired(data) {
  const noEmpleado =
    String(data?.noEmpleado ?? "").trim();

  const posicion =
    String(data?.posicion ?? "").trim();

  if (!noEmpleado) {
    return "noEmpleado es requerido";
  }

  if (!posicion) {
    return "posicion es requerida";
  }

  return null;
}

/* =========================================================
 * BUSCAR POR FIRESTORE ID O NÚMERO DE EMPLEADO
 * ======================================================= */

async function findByIdOrNoEmpleado(idOrNo) {
  const key =
    String(idOrNo ?? "").trim();

  if (!key) {
    return null;
  }

  /*
   * Primero se intenta como ID real
   * del documento de Firestore.
   */
  try {
    const ref =
      firestore
        .collection(COL)
        .doc(key);

    const snap =
      await ref.get();

    if (snap.exists) {
      return {
        ref,
        snap,
      };
    }
  } catch {
    // continúa con noEmpleado
  }

  /*
   * Si no existe como ID,
   * intentamos por noEmpleado.
   */
  const query =
    await firestore
      .collection(COL)
      .where(
        "noEmpleado",
        "==",
        key
      )
      .limit(1)
      .get();

  if (query.empty) {
    return null;
  }

  const snap =
    query.docs[0];

  return {
    ref: snap.ref,
    snap,
  };
}

/* =========================================================
 * VALIDAR NÚMERO DE EMPLEADO DUPLICADO
 * ======================================================= */

async function noEmpleadoDisponible(
  noEmpleado,
  currentId = null
) {
  const query =
    await firestore
      .collection(COL)
      .where(
        "noEmpleado",
        "==",
        noEmpleado
      )
      .limit(5)
      .get();

  return !query.docs.some(
    (doc) =>
      doc.id !== currentId
  );
}

/* =========================================================
 * HEALTH
 *
 * Prueba:
 *
 * GET /api/colaboradores/_health
 * ======================================================= */

router.get(
  "/_health",
  (_req, res) => {
    res.json({
      ok: true,
      route: "colaboradores",
    });
  }
);

/* =========================================================
 * GET LISTA
 *
 * GET /api/colaboradores
 * ======================================================= */

router.get("/", async (req, res) => {
  try {
    const requestedLimit =
      req.query.limit ??
      req.query.pageSize ??
      MAX_LIST;

    const parsedLimit =
      Number(requestedLimit);

    const limit =
      Number.isFinite(parsedLimit) &&
      parsedLimit > 0
        ? Math.min(
            Math.floor(parsedLimit),
            MAX_LIST
          )
        : MAX_LIST;

    const qText =
      String(
        req.query.q ?? ""
      ).trim();

    const onlyDocentesRaw =
      String(
        req.query.onlyDocentes ?? ""
      ).toLowerCase();

    const onlyDocentes =
      ["1", "true", "yes"].includes(
        onlyDocentesRaw
      );

    /*
     * Traemos todos y ordenamos
     * en memoria.
     */
    const snap =
      await firestore
        .collection(COL)
        .limit(MAX_LIST)
        .get();

    let items =
      snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

    items.sort((a, b) => {
      const apellidoA =
        norm(a.apellidoPaterno);

      const apellidoB =
        norm(b.apellidoPaterno);

      if (
        apellidoA !== apellidoB
      ) {
        return apellidoA.localeCompare(
          apellidoB,
          "es"
        );
      }

      return norm(a.nombres)
        .localeCompare(
          norm(b.nombres),
          "es"
        );
    });

    /* ===== Buscar ===== */

    if (qText) {
      const q =
        norm(qText);

      items =
        items.filter((c) =>
          [
            c.nombres,
            c.apellidoPaterno,
            c.apellidoMaterno,
            c.nombrePreferido,
            c.correoInstitucional,
            c.email,
            c.noEmpleado,
            c.posicion,
            c.categoriaPuesto,
            c.jefeInmediato,
          ].some(
            (value) =>
              norm(value).includes(q)
          )
        );
    }

    /* ===== Solo docentes ===== */

    if (onlyDocentes) {
      const docentes =
        items.filter((c) => {
          const posicion =
            norm(c.posicion);

          const categoria =
            norm(
              c.categoriaPuesto
            );

          return (
            posicion.includes(
              "docente"
            ) ||
            categoria.includes(
              "docente"
            )
          );
        });

      if (docentes.length > 0) {
        items = docentes;
      }
    }

    items =
      items.slice(0, limit);

    return res.json({
      ok: true,
      items,
      nextCursor: null,
    });
  } catch (error) {
    console.error(
      "[GET /colaboradores] error:",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,
        error: String(error),
      });
  }
});

/* =========================================================
 * GET UNO
 *
 * GET /api/colaboradores/:id
 * ======================================================= */

router.get(
  "/:id",
  async (req, res) => {
    try {
      const found =
        await findByIdOrNoEmpleado(
          req.params.id
        );

      if (!found) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Colaborador no encontrado",
          });
      }

      return res.json({
        ok: true,

        item: {
          id: found.snap.id,
          ...found.snap.data(),
        },
      });
    } catch (error) {
      console.error(
        "[GET /colaboradores/:id] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error: String(error),
        });
    }
  }
);

/* =========================================================
 * CREAR
 *
 * POST /api/colaboradores
 * ======================================================= */

router.post(
  "/",
  async (req, res) => {
    try {
      const data =
        pickColaborador(
          req.body ?? {}
        );

      const validationError =
        validateRequired(data);

      if (validationError) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              validationError,
          });
      }

      const available =
        await noEmpleadoDisponible(
          data.noEmpleado
        );

      if (!available) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "noEmpleado ya existe",
          });
      }

      const now =
        new Date();

      const ref =
        await firestore
          .collection(COL)
          .add({
            ...data,

            createdAt: now,
            updatedAt: now,
          });

      return res
        .status(201)
        .json({
          ok: true,
          id: ref.id,
        });
    } catch (error) {
      console.error(
        "[POST /colaboradores] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error: String(error),
        });
    }
  }
);

/* =========================================================
 * ACTUALIZAR COMPLETO
 *
 * PUT /api/colaboradores/:id
 * ======================================================= */

router.put(
  "/:id",
  async (req, res) => {
    try {
      const found =
        await findByIdOrNoEmpleado(
          req.params.id
        );

      if (!found) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Colaborador no encontrado",
          });
      }

      const data =
        pickColaborador(
          req.body ?? {}
        );

      const validationError =
        validateRequired(data);

      if (validationError) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              validationError,
          });
      }

      const available =
        await noEmpleadoDisponible(
          data.noEmpleado,
          found.snap.id
        );

      if (!available) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "noEmpleado ya existe en otro colaborador",
          });
      }

      const current =
        found.snap.data() ?? {};

      await found.ref.set(
        {
          ...data,

          createdAt:
            current.createdAt ??
            new Date(),

          updatedAt:
            new Date(),
        },
        {
          merge: false,
        }
      );

      return res.json({
        ok: true,
        id: found.ref.id,
      });
    } catch (error) {
      console.error(
        "[PUT /colaboradores/:id] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error: String(error),
        });
    }
  }
);

/* =========================================================
 * PATCH
 *
 * PATCH /api/colaboradores/:id
 * ======================================================= */

router.patch(
  "/:id",
  async (req, res) => {
    try {
      const found =
        await findByIdOrNoEmpleado(
          req.params.id
        );

      if (!found) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Colaborador no encontrado",
          });
      }

      const current =
        found.snap.data() ?? {};

      const incoming =
        req.body ?? {};

      const mergedInput = {
        ...current,
        ...incoming,

        enfermedadesCronicas:
          hasOwn(
            incoming,
            "enfermedadesCronicas"
          )
            ? {
                ...(
                  current.enfermedadesCronicas ??
                  {}
                ),

                ...(
                  incoming.enfermedadesCronicas ??
                  {}
                ),
              }
            : current.enfermedadesCronicas,

        documentos:
          hasOwn(
            incoming,
            "documentos"
          )
            ? {
                ...(
                  current.documentos ??
                  {}
                ),

                ...(
                  incoming.documentos ??
                  {}
                ),
              }
            : current.documentos,
      };

      const data =
        pickColaborador(
          mergedInput
        );

      const validationError =
        validateRequired(data);

      if (validationError) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              validationError,
          });
      }

      const available =
        await noEmpleadoDisponible(
          data.noEmpleado,
          found.snap.id
        );

      if (!available) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "noEmpleado ya existe en otro colaborador",
          });
      }

      await found.ref.set(
        {
          ...data,

          createdAt:
            current.createdAt ??
            new Date(),

          updatedAt:
            new Date(),
        },
        {
          merge: false,
        }
      );

      return res.json({
        ok: true,
        id: found.ref.id,
      });
    } catch (error) {
      console.error(
        "[PATCH /colaboradores/:id] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error: String(error),
        });
    }
  }
);

/* =========================================================
 * ELIMINAR
 *
 * DELETE /api/colaboradores/:id
 * ======================================================= */

router.delete(
  "/:id",
  async (req, res) => {
    try {
      const found =
        await findByIdOrNoEmpleado(
          req.params.id
        );

      if (!found) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Colaborador no encontrado",
          });
      }

      await found.ref.delete();

      return res.json({
        ok: true,
        id: found.ref.id,
      });
    } catch (error) {
      console.error(
        "[DELETE /colaboradores/:id] error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error: String(error),
        });
    }
  }
);

export default router;