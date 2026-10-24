import 'dotenv/config';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const [emailArgument, action = 'grant'] = process.argv.slice(2);
const email = emailArgument?.trim().toLowerCase();

if (!email || !['grant', 'revoke'].includes(action)) {
  console.error('Usage: node scripts/set-super-admin.mjs <email> [grant|revoke]');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
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
const user = await auth.getUserByEmail(email);
const nextClaims = { ...(user.customClaims || {}) };
if (action === 'grant') nextClaims.superAdmin = true;
else delete nextClaims.superAdmin;

console.log(`Action: ${action === 'grant' ? 'attribuer' : 'retirer'} le claim superAdmin`);
console.log(`Compte ciblé: ${user.email}`);
console.log(`Projet Firebase: ${projectId}`);

const prompt = createInterface({ input: stdin, output: stdout });
const confirmation = await prompt.question('Confirmer en tapant OUI : ');
prompt.close();
if (confirmation !== 'OUI') {
  console.log('Aucune modification effectuée.');
  process.exit(0);
}

await auth.setCustomUserClaims(user.uid, nextClaims);
console.log('Claim superAdmin mis à jour. Le compte doit renouveler son jeton ou se reconnecter.');
