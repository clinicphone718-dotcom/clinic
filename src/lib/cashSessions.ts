import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Transaction,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { CashSession, CashSessionTotals, UserProfile } from '../types';
import { computeExpectedCash, EMPTY_CASH_SESSION_TOTALS } from './cashSessionMath';

export interface ActiveCashSession {
  id: string;
  ref: ReturnType<typeof doc>;
  data: CashSession;
}

export interface CashSessionChanges {
  sales?: number;
  cash?: number;
  debtsCollected?: number;
  debtsCollectedCash?: number;
  repairsCollected?: number;
  repairsCollectedCash?: number;
  expenses?: number;
  expensesCash?: number;
}

export function cashSessionOwnerId(profile: UserProfile | null): string | undefined {
  return profile?.role === 'admin' ? profile.uid : profile?.ownerId || profile?.uid;
}

export async function requireOpenCashSession(
  transaction: Transaction,
  userId: string,
  ownerId: string,
): Promise<ActiveCashSession> {
  const lockRef = doc(db, 'cash_session_locks', userId);
  const lockSnapshot = await transaction.get(lockRef);
  const sessionId = lockSnapshot.data()?.sessionId;
  if (!lockSnapshot.exists() || typeof sessionId !== 'string' || !sessionId) {
    throw new Error('Aucune caisse ouverte. Ouvrez une session de caisse avant de continuer.');
  }

  const ref = doc(db, 'cash_sessions', sessionId);
  const sessionSnapshot = await transaction.get(ref);
  if (!sessionSnapshot.exists()) {
    throw new Error('La session de caisse active est introuvable. Contactez un administrateur.');
  }
  const data = { id: sessionSnapshot.id, ...sessionSnapshot.data() } as CashSession;
  if (data.status !== 'open' || data.openedBy !== userId || data.ownerId !== ownerId) {
    throw new Error('La session de caisse n’est plus ouverte. Ouvrez une nouvelle session.');
  }
  return { id: sessionSnapshot.id, ref, data };
}

export function addCashSessionTotals(
  transaction: Transaction,
  session: ActiveCashSession,
  changes: CashSessionChanges,
): void {
  const totals = { ...EMPTY_CASH_SESSION_TOTALS, ...session.data.totals };
  for (const [key, amount] of Object.entries(changes) as Array<[keyof CashSessionChanges, number]>) {
    if (amount !== undefined) totals[key] = Math.round((totals[key] + amount + Number.EPSILON) * 1000) / 1000;
  }
  transaction.update(session.ref, { totals });
}

export async function openCashSession(
  userId: string,
  ownerId: string,
  openingFloat: number,
): Promise<void> {
  const lockRef = doc(db, 'cash_session_locks', userId);
  const sessionRef = doc(collection(db, 'cash_sessions'));
  await runTransaction(db, async transaction => {
    const lockSnapshot = await transaction.get(lockRef);
    if (lockSnapshot.exists()) {
      const activeId = lockSnapshot.data()?.sessionId;
      if (typeof activeId === 'string' && activeId) {
        const currentSnapshot = await transaction.get(doc(db, 'cash_sessions', activeId));
        if (currentSnapshot.exists() && currentSnapshot.data().status === 'open') {
          throw new Error('Vous avez déjà une session de caisse ouverte.');
        }
      }
      throw new Error('Le verrou de caisse est incohérent. Demandez à un administrateur de vérifier les sessions.');
    }
    const session: Omit<CashSession, 'id'> = {
      ownerId,
      openedBy: userId,
      openedAt: serverTimestamp(),
      openingFloat: Math.round((openingFloat + Number.EPSILON) * 1000) / 1000,
      status: 'open',
      totals: { ...EMPTY_CASH_SESSION_TOTALS },
    };
    transaction.set(sessionRef, session);
    transaction.set(lockRef, { ownerId, sessionId: sessionRef.id });
  });
}

export async function closeCashSession(
  userId: string,
  sessionId: string,
  countedCash: number,
): Promise<{ expectedCash: number; difference: number }> {
  const lockRef = doc(db, 'cash_session_locks', userId);
  const sessionRef = doc(db, 'cash_sessions', sessionId);
  return runTransaction(db, async transaction => {
    const lockSnapshot = await transaction.get(lockRef);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!lockSnapshot.exists() || lockSnapshot.data()?.sessionId !== sessionId) {
      throw new Error('Cette session n’est plus la session active de votre compte.');
    }
    if (!sessionSnapshot.exists() || sessionSnapshot.data().status !== 'open') {
      throw new Error('Cette session est déjà fermée ou introuvable.');
    }
    const session = sessionSnapshot.data() as CashSession;
    const expectedCash = computeExpectedCash(session);
    const difference = Math.round((countedCash - expectedCash + Number.EPSILON) * 1000) / 1000;
    transaction.update(sessionRef, {
      status: 'closed',
      closedAt: serverTimestamp(),
      countedCash,
      expectedCash,
      difference,
    });
    transaction.delete(lockRef);
    return { expectedCash, difference };
  });
}

export function useCashSession(profile: UserProfile | null): {
  session: CashSession | null;
  loading: boolean;
  error: string | null;
} {
  const userId = profile?.uid || auth.currentUser?.uid;
  const ownerId = cashSessionOwnerId(profile);
  const [session, setSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(null);
    setError(null);
    if (!userId || !ownerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let unsubscribeSession: (() => void) | undefined;
    const unsubscribeLock = onSnapshot(doc(db, 'cash_session_locks', userId), lockSnapshot => {
      unsubscribeSession?.();
      unsubscribeSession = undefined;
      const sessionId = lockSnapshot.data()?.sessionId;
      if (!lockSnapshot.exists() || typeof sessionId !== 'string') {
        setSession(null);
        setLoading(false);
        return;
      }
      unsubscribeSession = onSnapshot(doc(db, 'cash_sessions', sessionId), sessionSnapshot => {
        const next = sessionSnapshot.exists()
          ? { id: sessionSnapshot.id, ...sessionSnapshot.data() } as CashSession
          : null;
        setSession(next?.status === 'open' ? next : null);
        setLoading(false);
        setError(null);
      }, cause => {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : 'Impossible de lire la session de caisse.');
      });
    }, cause => {
      setLoading(false);
      setError(cause instanceof Error ? cause.message : 'Impossible de lire la caisse active.');
    });
    return () => {
      unsubscribeLock();
      unsubscribeSession?.();
    };
  }, [userId, ownerId]);

  return { session, loading, error };
}
