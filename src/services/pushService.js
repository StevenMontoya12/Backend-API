// src/services/pushService.js
import admin, { firestore } from "../firebase.js";

function asStr(v, def = "") {
  return typeof v === "string" ? v : def;
}

// 🔥 Helper: manda push a todos los tokens de un alumno (matrícula)
export async function sendPushToAlumno(alumnoMatricula, payload) {
  const matricula = String(alumnoMatricula);

  const snap = await firestore
    .collection("pushTokens")
    .where("alumnoMatricula", "==", matricula)
    .get();

  const tokens = snap.docs
    .map((d) => d.data()?.token)
    .filter((t) => typeof t === "string" && t.length > 10);

  if (!tokens.length) {
    return { ok: false, reason: "no_tokens", sent: 0 };
  }

  const message = {
    tokens,
    notification: {
      title: asStr(payload?.title, "Nuevo reporte"),
      body: asStr(payload?.body, "Tienes un reporte nuevo."),
    },
    data: Object.fromEntries(
      Object.entries(payload?.data || {}).map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: "high",
      notification: { channelId: "default" },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };

  const resp = await admin.messaging().sendEachForMulticast(message);

  // Limpieza de tokens inválidos
  const invalidTokens = [];
  resp.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = r.error?.code || "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-argument")
      ) {
        invalidTokens.push(tokens[idx]);
      }
    }
  });

  if (invalidTokens.length) {
    const delSnap = await firestore
      .collection("pushTokens")
      .where("alumnoMatricula", "==", matricula)
      .get();

    const batch = firestore.batch();
    delSnap.docs.forEach((d) => {
      const t = d.data()?.token;
      if (invalidTokens.includes(t)) batch.delete(d.ref);
    });
    await batch.commit().catch(() => {});
  }

  return {
    ok: true,
    sent: resp.successCount,
    failed: resp.failureCount,
  };
}
