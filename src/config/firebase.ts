import type { FirebaseOptions } from 'firebase/app';

const rawConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const MISSING_FIREBASE_CONFIG = Object.entries(rawConfig)
  .filter(([, value]) => !value?.trim())
  .map(([key]) => key);

export const firebaseConfig: FirebaseOptions = {
  apiKey: rawConfig.apiKey || 'missing-firebase-api-key',
  authDomain: rawConfig.authDomain || 'missing-firebase-auth-domain',
  projectId: rawConfig.projectId || 'missing-firebase-project-id',
  appId: rawConfig.appId || 'missing-firebase-app-id',
  storageBucket: rawConfig.storageBucket || 'missing-firebase-storage-bucket',
  messagingSenderId: rawConfig.messagingSenderId || 'missing-firebase-messaging-sender-id',
};

export const firestoreDatabaseId =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID?.trim() || '(default)';

export const ALLOW_SELF_SIGNUP =
  import.meta.env.VITE_ALLOW_SELF_SIGNUP?.trim().toLowerCase() === 'true';
