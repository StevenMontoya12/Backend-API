import admin from "firebase-admin";
import { firestore } from "../src/firebase.js"; // ajusta la ruta a tu firebase.js real

function normMatricula(v) {
  return String(v || "").trim().toUpperCase();
}

async function run() {
  const col = firestore.collection("reportes");
  const snap = await col.get();

  let batch = firestore.batch();
  let count = 0;
  let updated = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};
    const m = normMatricula(data.alumnoMatricula);

    // si ya está bien, skip
    if (data.alumnoMatriculaNorm === m && data.alumnoMatricula === m) continue;

    batch.update(d.ref, {
      alumnoMatricula: m,
      alumnoMatriculaNorm: m,
    });

    updated++;
    count++;

    if (count >= 400) {
      await batch.commit();
      batch = firestore.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();

  console.log("✅ Migración lista. Docs actualizados:", updated);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
