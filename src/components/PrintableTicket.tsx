import React, { forwardRef, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Invoice, StoreSettings } from '../types';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface Props {
  invoice: Invoice;
  ownerId?: string;
}

export const PrintableTicket = forwardRef<HTMLDivElement, Props>(({ invoice, ownerId }, ref) => {
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const finalOwnerId = ownerId || invoice.ownerId || 'store';
    const unsubscribe = onSnapshot(doc(db, 'settings', finalOwnerId), (snapshot) => {
      if (snapshot.exists()) {
        setStoreSettings(snapshot.data() as StoreSettings);
      }
    });
    return unsubscribe;
  }, [ownerId, invoice.ownerId]);

  let dateStr = '';
  try {
    if (invoice.date && typeof invoice.date.toDate === 'function') {
      dateStr = format(invoice.date.toDate(), 'dd/MM/yyyy HH:mm');
    } else if (invoice.date instanceof Date) {
      dateStr = format(invoice.date, 'dd/MM/yyyy HH:mm');
    } else if (typeof invoice.date === 'string') {
      dateStr = format(new Date(invoice.date), 'dd/MM/yyyy HH:mm');
    } else {
      dateStr = format(new Date(), 'dd/MM/yyyy HH:mm');
    }
  } catch (e) {
    dateStr = format(new Date(), 'dd/MM/yyyy HH:mm');
  }

  const storeName = storeSettings?.storeName || 'MARKET-POS';
  const storeAddress = storeSettings?.address || 'Superette & Épicerie';
  const storePhone = storeSettings?.phone || '';
  const currency = storeSettings?.currency || 'DT';

  return (
    <div ref={ref} className="p-5 w-[80mm] mx-auto bg-white text-black font-mono text-[12px] leading-tight">
      <div className="text-center font-bold text-[16px] uppercase">{storeName}</div>
      <div className="text-center">{storeAddress}</div>
      {storePhone && <div className="text-center">Tél: {storePhone}</div>}
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="text-center font-bold">TICKET DE CAISSE</div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div>Date: {dateStr}</div>
      <div>Ticket: {invoice.number}</div>
      <div>Client: {invoice.clientName}</div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="my-2 space-y-1">
        {invoice.items.map((item, index) => (
          <div key={index}>
            <div className="flex justify-between">
              <span className="max-w-[40mm] overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
              <span>{item.quantity} x {item.price.toFixed(3)}</span>
            </div>
            <div className="text-right">{item.total.toFixed(3)} {currency}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{invoice.total.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>Payé</span>
        <span>{invoice.paid.toFixed(3)} {currency}</span>
      </div>
      <div className="flex justify-between">
        <span>Reste</span>
        <span>{invoice.debt.toFixed(3)} {currency}</span>
      </div>
      <div className="border-t border-dashed border-black my-1"></div>
      <div className="text-center mt-5 text-[10px]">
        Merci de votre visite !<br />
        À bientôt chez {storeName}
      </div>
    </div>
  );
});

PrintableTicket.displayName = 'PrintableTicket';
