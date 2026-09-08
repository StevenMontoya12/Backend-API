import { Router } from "express";
import admin, { firestore } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPushToAlumno } from "../services/pushService.js";

const router = Router();
const COL = firestore.collection("calendarioEventos");
const ALUMNOS_COL = firestore.collection("alumnos");

function nowIso() {
  return new Date().toISOString();
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "si", "sí", "yes"].includes(s)) return true;
    if (["0", "false", "no"].includes(s)) return false;
  }
  return fallback;
}

function parseCsv(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => cleanStr(x)).filter(Boolean);
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function normMatricula(v) {
  return cleanStr(v).toUpperCase();
}

function normKey(v) {
  return cleanStr(v).toLowerCase();
}

function parseDateLike(v) {
  const s = cleanStr(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function buildCursorPayload(doc) {
  const data = doc.data() || {};
  return Buffer.from(
    JSON.stringify({
      id: doc.id,
      fechaInicio: data.fechaInicio || "",
      createdAtIso: data.createdAtIso || "",
    })
  ).toString("base64");
}

async function resolveCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = JSON.parse(Buffer.from(String(cursor), "base64").toString("utf8"));
    if (raw?.id) {
      const snap = await COL.doc(String(raw.id)).get();
      if (snap.exists) return snap;
    }
  } catch {}
  return null;
}

function canManage(user) {
  return user?.role === "colaborador";
}

function getActor(user) {
  return {
    id: String(user?.sub || ""),
    nombre:
      user?.nombreCompleto ||
      user?.nombre ||
      user?.email ||
      String(user?.sub || "Sistema"),
  };
}

function mapItem(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    titulo: d.titulo || "",
    descripcion: d.descripcion || "",
    tipo: d.tipo || "general",
    color: d.color || "azul",
    lugar: d.lugar || "",
    allDay: !!d.allDay,
    fechaInicio: d.fechaInicio || "",
    fechaFin: d.fechaFin || "",
    estado: d.estado || "activo",
    esParaTodos: !!d.esParaTodos,
    destinatarios: Array.isArray(d.destinatarios) ? d.destinatarios : [],
    gruposDestinatarios: Array.isArray(d.gruposDestinatarios) ? d.gruposDestinatarios : [],
    visibleParaPadres: !!d.visibleParaPadres,
    notificarPadres: !!d.notificarPadres,
    creadoPorId: d.creadoPorId || "",
    creadoPorNombre: d.creadoPorNombre || "",
    createdAtIso: d.createdAtIso || "",
    updatedAtIso: d.updatedAtIso || "",
  };
}

async function alumnosByGrupoKeys(groupKeys = []) {
  const keys = uniq(groupKeys.map((x) => cleanStr(x))).filter(Boolean);
  if (!keys.length) return [];

  const snap = await ALUMNOS_COL.get();
  const items = [];

  snap.forEach((doc) => {
    const a = doc.data() || {};
    const matricula = normMatricula(a.matricula || doc.id);
    if (!matricula) return;

    const nivel = cleanStr(a.nivel);
    const grado = cleanStr(a.grado);
    const grupo = cleanStr(a.grupo);
    const key = `${nivel}-${grado}-${grupo}`;

    if (keys.includes(key)) items.push(matricula);
  });

  return uniq(items);
}

async function allAlumnosMatriculas() {
  const snap = await ALUMNOS_COL.get();
  const mats = [];
  snap.forEach((doc) => {
    const a = doc.data() || {};
    const matricula = normMatricula(a.matricula || doc.id);
    if (matricula) mats.push(matricula);
  });
  return uniq(mats);
}

async function listVisibleForPadre(matricula, baseItems) {
  const mat = normMatricula(matricula);
  return baseItems.filter((item) => {
    if (!item.visibleParaPadres) return false;
    if (item.estado !== "activo") return false;
    if (item.esParaTodos) return true;
    if (item.destinatarios.includes(mat)) return true;
    return false;
  });
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const role = req.user?.role || "";
    const q = cleanStr(req.query.q);
    const tipo = cleanStr(req.query.tipo);
    const from = cleanStr(req.query.from);
    const to = cleanStr(req.query.to);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "20", 10) || 20, 1), 100);
    const cursor = cleanStr(req.query.cursor);

    let ref = COL.orderBy("fechaInicio", "desc").orderBy("createdAtIso", "desc");

    const cursorSnap = await resolveCursor(cursor);
    if (cursorSnap) ref = ref.startAfter(cursorSnap);

    const snap = await ref.limit(pageSize).get();
    let items = snap.docs.map(mapItem);

    if (q) {
      const qq = q.toLowerCase();
      items = items.filter((x) =>
        [x.titulo, x.descripcion, x.lugar, x.tipo].some((v) =>
          String(v || "").toLowerCase().includes(qq)
        )
      );
    }

    if (tipo) {
      items = items.filter((x) => normKey(x.tipo) === normKey(tipo));
    }

    if (from) {
      const fromD = parseDateLike(from);
      if (fromD) {
        items = items.filter(
          (x) => parseDateLike(x.fechaInicio)?.getTime() >= fromD.getTime()
        );
      }
    }

    if (to) {
      const toD = parseDateLike(to);
      if (toD) {
        items = items.filter(
          (x) => parseDateLike(x.fechaInicio)?.getTime() <= toD.getTime()
        );
      }
    }

    if (role === "padre") {
      items = await listVisibleForPadre(String(req.user?.sub || ""), items);
    }

    const nextCursor =
      snap.size === pageSize && snap.docs.length
        ? buildCursorPayload(snap.docs[snap.docs.length - 1])
        : null;

    return res.json({ ok: true, items, nextCursor });
  } catch (e) {
    console.error("[calendario/list]", e);
    return res.status(500).json({ ok: false, error: "No se pudieron cargar los eventos" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const snap = await COL.doc(String(req.params.id)).get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: "Evento no encontrado" });
    }

    const item = mapItem(snap);

    if (req.user?.role === "padre") {
      const mat = normMatricula(req.user?.sub || "");
      const allowed =
        item.visibleParaPadres &&
        item.estado === "activo" &&
        (item.esParaTodos || item.destinatarios.includes(mat));

      if (!allowed) {
        return res.status(403).json({ ok: false, error: "No autorizado" });
      }
    }

    return res.json({ ok: true, item });
  } catch (e) {
    console.error("[calendario/get]", e);
    return res.status(500).json({ ok: false, error: "No se pudo cargar el evento" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    if (!canManage(req.user)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const actor = getActor(req.user);
    const titulo = cleanStr(req.body?.titulo);
    const descripcion = cleanStr(req.body?.descripcion);
    const tipo = cleanStr(req.body?.tipo || "general") || "general";
    const color = cleanStr(req.body?.color || "azul") || "azul";
    const lugar = cleanStr(req.body?.lugar);
    const allDay = toBool(req.body?.allDay, false);
    const fechaInicio = cleanStr(req.body?.fechaInicio);
    const fechaFin = cleanStr(req.body?.fechaFin || req.body?.fechaInicio);
    const visibleParaPadres = toBool(req.body?.visibleParaPadres, true);
    const notificarPadres = toBool(req.body?.notificarPadres, true);
    const esParaTodos = toBool(req.body?.esParaTodos, true);
    const destinatariosRaw = parseCsv(req.body?.destinatarios).map(normMatricula);
    const gruposDestinatarios = parseCsv(req.body?.gruposDestinatarios);

    if (!titulo) {
      return res.status(400).json({ ok: false, error: "El título es requerido" });
    }
    if (!fechaInicio) {
      return res.status(400).json({ ok: false, error: "La fecha de inicio es requerida" });
    }

    let destinatarios = [];
    if (esParaTodos) {
      destinatarios = await allAlumnosMatriculas();
    } else if (gruposDestinatarios.length > 0) {
      destinatarios = await alumnosByGrupoKeys(gruposDestinatarios);
    } else {
      destinatarios = uniq(destinatariosRaw);
    }

    if (!esParaTodos && destinatarios.length === 0) {
      return res.status(400).json({ ok: false, error: "Debes indicar destinatarios o grupos" });
    }

    const createdAtIso = nowIso();
    const docRef = COL.doc();

    const data = {
      titulo,
      descripcion,
      tipo,
      color,
      lugar,
      allDay,
      fechaInicio,
      fechaFin,
      estado: "activo",
      esParaTodos,
      destinatarios,
      gruposDestinatarios,
      visibleParaPadres,
      notificarPadres,
      creadoPorId: actor.id,
      creadoPorNombre: actor.nombre,
      createdAtIso,
      updatedAtIso: createdAtIso,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await docRef.set(data);

    let pushResults = [];
    if (visibleParaPadres && notificarPadres) {
      pushResults = await Promise.allSettled(
        destinatarios.map((mat) =>
          sendPushToAlumno(mat, {
            title: `📅 ${titulo}`,
            body: allDay
              ? "Se agregó un nuevo evento al calendario escolar."
              : `Nuevo evento programado para ${fechaInicio}`,
            data: {
              kind: "calendario",
              type: "calendario",
              eventId: docRef.id,
              alumnoMatricula: normMatricula(mat),
            },
          })
        )
      );
    }

    const saved = await docRef.get();
    return res.status(201).json({ ok: true, item: mapItem(saved), pushResults });
  } catch (e) {
    console.error("[calendario/create]", e);
    return res.status(500).json({ ok: false, error: "No se pudo crear el evento" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    if (!canManage(req.user)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const ref = COL.doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: "Evento no encontrado" });
    }

    const patch = {};
    const fields = [
      "titulo",
      "descripcion",
      "tipo",
      "color",
      "lugar",
      "fechaInicio",
      "fechaFin",
      "estado",
    ];

    for (const f of fields) {
      if (req.body?.[f] !== undefined) patch[f] = cleanStr(req.body[f]);
    }

    if (req.body?.allDay !== undefined) patch.allDay = toBool(req.body.allDay);
    if (req.body?.visibleParaPadres !== undefined)
      patch.visibleParaPadres = toBool(req.body.visibleParaPadres);
    if (req.body?.notificarPadres !== undefined)
      patch.notificarPadres = toBool(req.body.notificarPadres);

    if (req.body?.esParaTodos !== undefined) {
      patch.esParaTodos = toBool(req.body.esParaTodos);
      if (patch.esParaTodos) {
        patch.destinatarios = await allAlumnosMatriculas();
        patch.gruposDestinatarios = [];
      }
    }

    if (req.body?.gruposDestinatarios !== undefined) {
      const keys = parseCsv(req.body.gruposDestinatarios);
      patch.gruposDestinatarios = keys;
      patch.destinatarios = await alumnosByGrupoKeys(keys);
      patch.esParaTodos = false;
    }

    if (req.body?.destinatarios !== undefined) {
      patch.destinatarios = uniq(parseCsv(req.body.destinatarios).map(normMatricula));
      patch.gruposDestinatarios = [];
      patch.esParaTodos = false;
    }

    patch.updatedAtIso = nowIso();
    patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await ref.set(patch, { merge: true });
    const saved = await ref.get();
    return res.json({ ok: true, item: mapItem(saved) });
  } catch (e) {
    console.error("[calendario/update]", e);
    return res.status(500).json({ ok: false, error: "No se pudo actualizar el evento" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (!canManage(req.user)) {
      return res.status(403).json({ ok: false, error: "No autorizado" });
    }

    const ref = COL.doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: "Evento no encontrado" });
    }

    await ref.delete();
    return res.json({ ok: true, id: String(req.params.id) });
  } catch (e) {
    console.error("[calendario/delete]", e);
    return res.status(500).json({ ok: false, error: "No se pudo eliminar el evento" });
  }
});

export default router;