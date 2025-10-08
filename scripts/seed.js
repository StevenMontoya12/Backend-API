// scripts/seed.js
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// Carga tu service account (descárgala en Firebase Console)
const serviceAccount = require(path.resolve("server/serviceAccountKey.json"));

// Si vas a usar el EMULADOR, ya lo hace el script de npm con FIRESTORE_EMULATOR_HOST
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Mapea tu shape plano (8 pasos del formulario) -> estructura en Firestore
function mapFrontToFirestore(f) {
  return {
    // Paso 1: Personal
    matricula: f.matricula,
    estatus: f.estatus,
    nombres: f.nombres,
    apellidos: f.apellidos,
    genero: f.genero,
    fechaNacimiento: f.fechaNacimiento,
    curp: f.curp,
    nacionalidad: f.nacionalidad,
    clave: f.clave,
    grupoPrincipal: f.grupoPrincipal,
    fechaIngreso: f.fechaIngreso,
    modalidad: f.modalidad,
    religion: f.religion,

    // Paso 2: Contacto
    direccion: {
      calleNumero: f.calleNumero,
      estado: f.estado,
      municipio: f.municipio,
      colonia: f.colonia,
      codigoPostal: f.codigoPostal,
    },
    contacto: {
      telefonoCasa: f.telefonoCasa,
      telefonoCelular: f.telefonoCelular,
      contactoPrincipal: f.contactoPrincipal,
    },

    // Paso 3: Hermanos
    hermanos: { numero: Number(f.numeroHermanos || 0) },

    // Paso 4: Familiar / Tutor
    tutor: {
      nombrePadre: f.nombrePadre,
      apellidosPadre: f.apellidosPadre,
      telefonoPadre: f.telefonoPadre,
      correoPadre: f.correoPadre,
      ocupacionPadre: f.ocupacionPadre,
      empresaPadre: f.empresaPadre,
      telefonoEmpresa: f.telefonoEmpresa,
      exalumno: f.exalumno,
      correoFamiliar: f.correoFamiliar,
    },
    tokenPago: f.tokenPago || "",

    // Paso 5: Becas
    beca: {
      tipo: f.tipoBeca,
      porcentaje: Number(f.porcentajeBeca || 0),
    },

    // Paso 6: Extracurricular
    extracurricular: { actividad: f.actividad },

    // Paso 7: Facturación
    facturacion: {
      requiereFactura: f.requiereFactura,
      nombre: f.nombreFactura,
      calleNumero: f.calleNumeroFactura,
      colonia: f.coloniaFactura,
      estado: f.estadoFactura,
      municipio: f.municipioFactura,
      codigoPostal: f.codigoPostalFactura,
      telefonoCasa: f.telefonoCasaFactura,
      email: f.emailFactura,
      rfc: f.rfc,
      numeroCuenta: f.numeroCuenta,
      tipoCobro: f.tipoCobro,
      usoCfdi: f.usoCfdi,
    },

    // Paso 8: Comentarios/Notas (tus textareas)
    notas: {
      calificaciones: f.calificaciones || "",
      general: f.general || "",
      cobros: f.cobros || "",
    },
  };
}

async function main() {
  const jsonPath = path.resolve("scripts/alumnos-seed.json");
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const lista = Array.isArray(raw.alumnos) ? raw.alumnos : [];

  const useMatriculaAsId = true;          // ✅ recomendable para evitar duplicados
  const mode = "upsert";                   // "create" (falla si existe) | "upsert" (crea/actualiza)

  const bw = db.bulkWriter();
  const now = FieldValue.serverTimestamp();

  for (const item of lista) {
    const data = { ...mapFrontToFirestore(item), meta: { creadoEn: now, actualizadoEn: now } };
    const ref = useMatriculaAsId
      ? db.collection("alumnos").doc(String(item.matricula))
      : db.collection("alumnos").doc();

    if (mode === "create") bw.create(ref, data);
    else bw.set(ref, data, { merge: true });
  }

  await bw.close();
  console.log(`✅ Seed completado: ${lista.length} alumnos`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error en seed:", err);
  process.exit(1);
});
