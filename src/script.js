import { firestore } from './firebase.js';

(async () => {
  try {
    const docRef = firestore.collection('test').doc('demo');
    await docRef.set({ mensaje: 'Conexión exitosa ✅', fecha: new Date() });
    console.log('Documento creado correctamente');
    process.exit(0);
  } catch (e) {
    console.error('Error escribiendo en Firestore:', e);
    process.exit(1);
  }
})();
