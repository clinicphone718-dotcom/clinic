import 'dotenv/config';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const [emailArgument, password] = process.argv.slice(2);
const email = emailArgument?.trim().toLowerCase();
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const databaseId = process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || '(default)';

if (!email || !password || password.length < 6 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/create-first-admin.mjs <email> <motdepasse-min-6-caracteres>');
  process.exit(1);
}
if (!projectId) {
  console.error('Set FIREBASE_PROJECT_ID (or VITE_FIREBASE_PROJECT_ID).');
  process.exit(1);
}

function getCredential() {
  const configuredAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!configuredAccount) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error('Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.');
      process.exit(1);
    }
    return applicationDefault();
  }

  try {
    const rawJson = configuredAccount.trim().startsWith('{')
      ? configuredAccount
      : Buffer.from(configuredAccount, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(rawJson);
    if (!serviceAccount?.private_key || !serviceAccount?.client_email) throw new Error();
    return cert(serviceAccount);
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT must be valid service-account JSON or base64.');
    process.exit(1);
  }
}

const app = initializeApp({ credential: getCredential(), projectId });
const auth = getAuth(app);
const db = getFirestore(app, databaseId);

let existingAuthUser;
try {
  existingAuthUser = await auth.getUserByEmail(email);
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error;
}
if (existingAuthUser) {
  console.error('A Firebase Authentication account already exists for this email; refusing to overwrite it.');
  process.exit(1);
}
const existingProfile = await db.collection('users').where('email', '==', email).limit(1).get();
if (!existingProfile.empty) {
  console.error('A Firestore user profile already exists for this email; refusing to overwrite it.');
  process.exit(1);
}

console.log('Aperçu de la création :');
console.log(`Projet Firebase : ${projectId}`);
console.log(`Base Firestore : ${databaseId}`);
console.log(`Compte admin : ${email}`);
console.log('Le mot de passe fourni sera utilisé uniquement dans Firebase Authentication, jamais dans Firestore.');

const prompt = createInterface({ input: stdin, output: stdout });
const confirmation = await prompt.question('Confirmer en tapant OUI : ');
prompt.close();
if (confirmation !== 'OUI') {
  console.log('Aucune modification effectuée.');
  process.exit(0);
}

const user = await auth.createUser({ email, password, displayName: email.split('@')[0] });
try {
  await db.collection('users').doc(user.uid).create({
    uid: user.uid,
    email,
    name: user.displayName || email.split('@')[0],
    role: 'admin',
    status: 'active',
    ownerId: user.uid,
    allowedMenus: ['dashboard', 'reparation', 'products', 'pieces', 'clients', 'settings', 'startup', 'statistics', 'pos', 'sales', 'invoices', 'notes', 'users'],
    createdAt: new Date().toISOString(),
  });
} catch (error) {
  await auth.deleteUser(user.uid);
  throw error;
}
console.log('Premier profil admin créé. Attribuez séparément le claim superAdmin au compte de plateforme.');
