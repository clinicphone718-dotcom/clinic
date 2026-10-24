import { db } from '../firebase';
import { 
  collection, 
  doc, 
  runTransaction, 
  waitForPendingWrites, 
  serverTimestamp,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { Sale, Invoice } from '../types';

export interface PendingOperation {
  id: string;
  type: 'CREATE_SALE' | 'REPLENISH_STOCK' | 'DELETE_SALE';
  data: any;
  timestamp: number;
}

const STORAGE_KEY = 'pending_offline_operations';

export function getPendingOperations(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error reading offline queue:', e);
    return [];
  }
}

export function savePendingOperations(ops: PendingOperation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
    // Dispatch custom event to notify components
    window.dispatchEvent(new Event('offline-operations-changed'));
  } catch (e) {
    console.error('Error saving offline queue:', e);
  }
}

export function addPendingOperation(type: PendingOperation['type'], data: any) {
  const ops = getPendingOperations();
  const newOp: PendingOperation = {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    type,
    data,
    timestamp: Date.now()
  };
  ops.push(newOp);
  savePendingOperations(ops);
  return newOp;
}

export function removePendingOperation(id: string) {
  const ops = getPendingOperations();
  const filtered = ops.filter(op => op.id !== id);
  savePendingOperations(filtered);
}

// Global flag to prevent concurrent synchronization cycles
let isSyncing = false;

export async function syncPendingOperations(
  userProfile: any,
  onProgress?: (count: number) => void
): Promise<{ success: boolean; syncedCount: number; errors: string[] }> {
  if (isSyncing) return { success: false, syncedCount: 0, errors: ['Sync already in progress'] };
  isSyncing = true;

  const ops = getPendingOperations();
  if (ops.length === 0) {
    isSyncing = false;
    return { success: true, syncedCount: 0, errors: [] };
  }

  const ownerId = userProfile?.ownerId || userProfile?.uid || 'no_user_auth';
  let syncedCount = 0;
  const errors: string[] = [];

  try {
    // 1. Wait for Firestore to upload all pending raw writes to the server
    await waitForPendingWrites(db);

    // Sort operations by timestamp so we process them in order
    ops.sort((a, b) => a.timestamp - b.timestamp);

    for (const op of ops) {
      try {
        if (onProgress) {
          onProgress(ops.length - syncedCount);
        }

        if (op.type === 'CREATE_SALE') {
          const { sale, invoice } = op.data;

          // Process the offline invoice number replacement inside a server-authoritative transaction
          await runTransaction(db, async (transaction) => {
            const invoiceRef = doc(db, 'invoices', invoice.id);
            const invoiceSnap = await transaction.get(invoiceRef);

            if (invoiceSnap.exists()) {
              const currentInvoiceData = invoiceSnap.data();
              // Only replace if it is still a temporary/offline invoice number
              if (currentInvoiceData.number && (currentInvoiceData.number.startsWith('FAC-TEMP') || currentInvoiceData.number.startsWith('FAC-OFFLINE'))) {
                // Read current official counter
                const counterRef = doc(db, 'counters', `invoices_${ownerId}`);
                const counterSnap = await transaction.get(counterRef);
                let nextNum = 1;
                if (counterSnap.exists()) {
                  nextNum = (counterSnap.data().lastNum || 0) + 1;
                }
                const year = new Date().getFullYear();
                const officialInvoiceNumber = `FAC-${year}-${nextNum.toString().padStart(4, '0')}`;

                // Update counter
                transaction.set(counterRef, { lastNum: nextNum }, { merge: true });

                // Update invoice with the official serial number
                transaction.update(invoiceRef, { 
                  number: officialInvoiceNumber,
                  syncedAt: serverTimestamp()
                });

              }
            }
          });
        }

        // Success! Remove from local queue
        removePendingOperation(op.id);
        syncedCount++;
      } catch (err: any) {
        console.error(`[SYNC ERROR] Failed to sync operation ${op.id} (${op.type}):`, err);
        errors.push(`Opération ${op.type} : ${err.message || err}`);
      }
    }
  } catch (err: any) {
    console.error('[SYNC ERROR] Firestore synchronization failed:', err);
    errors.push(`Erreur de connexion Firestore : ${err.message || err}`);
  } finally {
    isSyncing = false;
  }

  return {
    success: errors.length === 0,
    syncedCount,
    errors
  };
}
