// src/services/pushService.js

import admin, {
  firestore,
} from "../firebase.js";

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

function normalizeData(data) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(data)
      .filter(
        ([key]) =>
          typeof key === "string" &&
          key.length > 0,
      )
      .map(
        ([key, value]) => [
          key,
          String(value ?? ""),
        ],
      ),
  );
}

/**
 * Envía una notificación a todos los
 * dispositivos vinculados con una matrícula.
 */
export async function sendPushToAlumno(
  alumnoMatricula,
  payload,
) {
  const matricula =
    normMatricula(
      alumnoMatricula,
    );

  if (!matricula) {
    return {
      ok: false,
      reason:
        "matricula_invalida",
      sent: 0,
      failed: 0,
    };
  }

  const snapshot =
    await firestore
      .collection(
        "pushTokens",
      )
      .where(
        "alumnoMatricula",
        "==",
        matricula,
      )
      .get();

  /*
   * Un mismo token puede aparecer en documentos
   * antiguos o duplicados. Firebase solo debe
   * recibirlo una vez.
   */
  const tokens =
    Array.from(
      new Set(
        snapshot.docs
          .map(document =>
            document
              .data()
              ?.token,
          )
          .filter(
            token =>
              typeof token ===
                "string" &&
              token.trim()
                .length > 10,
          )
          .map(token =>
            token.trim(),
          ),
      ),
    );

  if (
    tokens.length === 0
  ) {
    return {
      ok: false,
      reason: "no_tokens",
      sent: 0,
      failed: 0,
      matricula,
    };
  }

  const message = {
    tokens,

    notification: {
      title:
        asStr(
          payload?.title,
          "Nuevo reporte",
        ),

      body:
        asStr(
          payload?.body,
          "Tienes un reporte nuevo.",
        ),
    },

    data:
      normalizeData(
        payload?.data,
      ),

    android: {
      priority: "high",

      notification: {
        channelId:
          "default",
      },
    },

    apns: {
      payload: {
        aps: {
          sound:
            "default",
        },
      },
    },
  };

  const response =
    await admin
      .messaging()
      .sendEachForMulticast(
        message,
      );

  const invalidTokens = [];

  response.responses
    .forEach(
      (
        result,
        index,
      ) => {
        if (result.success) {
          return;
        }

        const code =
          result.error?.code ||
          "";

        if (
          code.includes(
            "registration-token-not-registered",
          ) ||
          code.includes(
            "invalid-argument",
          )
        ) {
          invalidTokens.push(
            tokens[index],
          );
        }
      },
    );

  if (
    invalidTokens.length > 0
  ) {
    const invalidSet =
      new Set(
        invalidTokens,
      );

    const deleteBatch =
      firestore.batch();

    let deleteCount = 0;

    snapshot.docs
      .forEach(document => {
        const token =
          document
            .data()
            ?.token;

        if (
          typeof token ===
            "string" &&
          invalidSet.has(
            token.trim(),
          )
        ) {
          deleteBatch.delete(
            document.ref,
          );

          deleteCount += 1;
        }
      });

    if (deleteCount > 0) {
      await deleteBatch
        .commit()
        .catch(error => {
          console.warn(
            "[pushService] No se pudieron limpiar tokens:",
            error,
          );
        });
    }
  }

  console.log(
    "[pushService] envío completado",
    {
      matricula,
      tokens:
        tokens.length,
      sent:
        response.successCount,
      failed:
        response.failureCount,
      invalid:
        invalidTokens.length,
    },
  );

  return {
    ok: true,
    matricula,
    devices:
      tokens.length,
    sent:
      response.successCount,
    failed:
      response.failureCount,
    invalid:
      invalidTokens.length,
  };
}