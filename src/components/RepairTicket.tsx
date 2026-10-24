import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Repair, StoreSettings } from '../types';
import { APP_NAME } from '../config/brand';

interface RepairTicketProps {
  repair: Repair;
  ownerId?: string;
}

export function RepairTicket({ repair, ownerId }: RepairTicketProps) {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    const finalOwnerId = ownerId || repair.ownerId || 'store';
    const unsubscribe = onSnapshot(doc(db, 'settings', finalOwnerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    });

    return () => unsubscribe();
  }, [ownerId, repair.ownerId]);

  const formatDate = (value: any) => {
    try {
      if (!value) return format(new Date(), 'dd/MM/yyyy HH:mm');
      if (typeof value.toDate === 'function') return format(value.toDate(), 'dd/MM/yyyy HH:mm');
      if (value instanceof Date) return format(value, 'dd/MM/yyyy HH:mm');
      if (typeof value === 'string') return format(new Date(value), 'dd/MM/yyyy HH:mm');
      return format(new Date(value), 'dd/MM/yyyy HH:mm');
    } catch {
      return format(new Date(), 'dd/MM/yyyy HH:mm');
    }
  };

  const storeName = storeSettings?.storeName || APP_NAME;
  const storeAddress = storeSettings?.address || 'Tunisie';
  const storePhone = storeSettings?.phone || '';
  const currency = storeSettings?.currency || 'DT';

  return (
    <div className="w-[80mm] mx-auto bg-white text-black font-mono text-[12px] leading-tight p-4 print:p-0">
      <div className="text-center font-bold text-[16px] uppercase">{storeName}</div>
      <div className="text-center text-[11px]">{storeAddress}</div>
      {storePhone && <div className="text-center text-[11px]">Tél: {storePhone}</div>}
      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center font-bold uppercase">Bon de dépôt / Réparation</div>
      <div className="border-t border-dashed border-black my-2" />

      <div>Date: {formatDate(repair.date)}</div>
      <div>Réf: {repair.number}</div>
      <div>Client: {repair.clientName || '—'}</div>
      {repair.clientPhone && <div>Tél: {repair.clientPhone}</div>}
      <div>Appareil: {repair.deviceBrand || ''} {repair.deviceModel || ''}</div>
      {repair.imei && <div>IMEI: {repair.imei}</div>}
      {repair.deviceCondition && <div>État: {repair.deviceCondition}</div>}
      {repair.accessories && <div>Accessoires: {repair.accessories}</div>}

      <div className="border-t border-dashed border-black my-2" />
      <div className="font-bold">Panne:</div>
      <div>{repair.problem || '—'}</div>

      {repair.diagnostic && (
        <>
          <div className="font-bold mt-2">Diagnostic:</div>
          <div>{repair.diagnostic}</div>
        </>
      )}

      {repair.parts && repair.parts.length > 0 && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div className="font-bold">Pièces</div>
          {repair.parts.map((part, index) => (
            <div key={`${part.productId}-${index}`} className="flex justify-between gap-2">
              <span>{part.name} x {part.quantity}</span>
              <span>{part.total.toFixed(2)} {currency}</span>
            </div>
          ))}
        </>
      )}

      <div className="border-t border-dashed border-black my-2" />
      <div className="flex justify-between font-bold">
        <span>Total</span>
        <span>{Number(repair.total || 0).toFixed(2)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>Payé</span>
        <span>{Number(repair.paid || 0).toFixed(2)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>Reste</span>
        <span>{Number(repair.debt || 0).toFixed(2)} {currency}</span>
      </div>
      {repair.discount && repair.discount > 0 && (
        <div className="flex justify-between">
          <span>Remise</span>
          <span>{Number(repair.discount).toFixed(2)} {currency}</span>
        </div>
      )}

      <div className="border-t border-dashed border-black my-2" />
      <div className="text-center mt-4 text-[10px]">
        Merci de votre confiance.<br />
        {storeName}
      </div>
    </div>
  );
}

export default RepairTicket;
