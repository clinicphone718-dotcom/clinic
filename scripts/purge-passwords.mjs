import 'dotenv/config';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const databaseId = process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || '(default)';
if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID) and GOOGLE_APPLICATION_CREDENTIALS.');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app, databaseId);
const snapshot = await db.collection('users').get();
const candidates = snapshot.docs.filter(document => Object.hasOwn(document.data(), 'password'));

console.log(`Aperçu : ${candidates.length} document(s) users contiennent le champ password.`);
for (const document of candidates) {
  const profile = document.data();
  console.log(`- ${document.id} (${profile.email || 'email absent'})`);
}
if (candidates.length === 0) {
  console.log('Aucune modification nécessaire.');
  process.exit(0);
}

const prompt = createInterface({ input: stdin, output: stdout });
const firstConfirmation = await prompt.question('Pour continuer, tapez SAUVEGARDER : ');
if (firstConfirmation !== 'SAUVEGARDER') {
  prompt.close();
  console.log('Aucune modification effectuée.');
  process.exit(0);
}

const backupDirectory = path.resolve('backups');
await mkdir(backupDirectory, { recursive: true });
const backupPath = path.join(backupDirectory, `users-password-purge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(backupPath, JSON.stringify({
  projectId,
  databaseId,
  createdAt: new Date().toISOString(),
  documents: candidates.map(document => ({ id: document.id, data: document.data() })),
}, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`Sauvegarde locale créée : ${backupPath}`);
console.log('Protégez ce fichier : il contient les anciennes valeurs du champ supprimé.');

const finalConfirmation = await prompt.question('La sauvegarde est terminée. Tapez SUPPRIMER pour retirer les champs : ');
prompt.close();
if (finalConfirmation !== 'SUPPRIMER') {
  console.log('Aucune donnée Firestore modifiée; la sauvegarde locale est conservée.');
  process.exit(0);
}

for (let start = 0; start < candidates.length; start += 450) {
  const batch = db.batch();
  for (const document of candidates.slice(start, start + 450)) {
    batch.update(document.ref, { password: FieldValue.delete() });
  }
  await batch.commit();
}
console.log(`${candidates.length} champ(s) password retiré(s).`);
