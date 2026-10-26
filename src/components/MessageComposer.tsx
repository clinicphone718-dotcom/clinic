import { useEffect, useState } from 'react';
import { MessageCircle, MessageSquare, X } from 'lucide-react';
import type { MessageTemplateKey } from '../lib/messages';
import {
  buildMessageUrl,
  DEFAULT_MESSAGE_TEMPLATES,
  type MessageChannel,
  MESSAGE_TEMPLATE_OPTIONS,
  normalizeMessagePhone,
  renderMessageTemplate,
} from '../lib/messages';

interface MessageComposerProps {
  phone?: string;
  clientName: string;
  appareil?: string;
  numero?: string;
  montantRestant: string;
  nomMagasin: string;
  indicatif?: string;
  templates?: Partial<Record<MessageTemplateKey, string>>;
  defaultTemplate?: MessageTemplateKey;
  onLog?: (channel: MessageChannel, template: MessageTemplateKey) => Promise<void>;
}

export default function MessageComposer({
  phone,
  clientName,
  appareil = '',
  numero = '',
  montantRestant,
  nomMagasin,
  indicatif = '216',
  templates,
  defaultTemplate = 'appareil_recu',
  onLog,
}: MessageComposerProps) {
  const [channel, setChannel] = useState<MessageChannel | null>(null);
  const [templateKey, setTemplateKey] = useState<MessageTemplateKey>(defaultTemplate);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const normalizedPhone = normalizeMessagePhone(phone || '', indicatif);

  const buildMessage = (key: MessageTemplateKey) => renderMessageTemplate(
    templates?.[key] || DEFAULT_MESSAGE_TEMPLATES[key],
    {
      client: clientName || 'Client',
      appareil,
      numero,
      montant_restant: montantRestant,
      nom_magasin: nomMagasin || 'Magasin',
    },
  );

  useEffect(() => {
    setTemplateKey(defaultTemplate);
    setMessage(buildMessage(defaultTemplate));
  }, [defaultTemplate, clientName, appareil, numero, montantRestant, nomMagasin, templates]);

  const openComposer = (selectedChannel: MessageChannel) => {
    setError('');
    setTemplateKey(defaultTemplate);
    setMessage(buildMessage(defaultTemplate));
    setChannel(selectedChannel);
  };

  const launchMessage = async () => {
    if (!normalizedPhone) {
      setError('Numéro de téléphone invalide ou absent.');
      return;
    }
    if (!message.trim()) {
      setError('Le message ne peut pas être vide.');
      return;
    }

    if (!channel) return;
    const targetUrl = buildMessageUrl(channel, normalizedPhone, message);
    const link = document.createElement('a');
    link.href = targetUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();

    try {
      if (onLog) await onLog(channel, templateKey);
      setChannel(null);
    } catch {
      setError('L’application de messagerie a été ouverte, mais le journal de la réparation n’a pas pu être enregistré.');
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          disabled={!normalizedPhone}
          onClick={() => openComposer('WhatsApp')}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
          title={normalizedPhone ? 'Préparer un message WhatsApp' : 'Numéro de téléphone absent'}
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </button>
        <button
          type="button"
          disabled={!normalizedPhone}
          onClick={() => openComposer('SMS')}
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
          title={normalizedPhone ? 'Préparer un SMS' : 'Numéro de téléphone absent'}
        >
          <MessageSquare className="h-4 w-4" />
          SMS
        </button>
      </div>

      {channel && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation" onClick={() => setChannel(null)}>
          <section
            className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="message-composer-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 id="message-composer-title" className="text-lg font-black text-slate-900">Préparer un message {channel}</h2>
                <p className="mt-1 text-xs text-slate-500">À : +{normalizedPhone}. Vérifiez et modifiez le texte avant l’envoi dans l’application.</p>
              </div>
              <button type="button" onClick={() => setChannel(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Fermer">
                <X className="h-5 w-5" />
              </button>
            </header>

            <label className="block space-y-1 text-xs font-bold text-slate-600">
              Modèle
              <select
                value={templateKey}
                onChange={(event) => {
                  const key = event.target.value as MessageTemplateKey;
                  setTemplateKey(key);
                  setMessage(buildMessage(key));
                  setError('');
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                {MESSAGE_TEMPLATE_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>

            <label className="block space-y-1 text-xs font-bold text-slate-600">
              Message (modifiable)
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={6} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium" />
            </label>
            <p className="text-xs text-slate-500">L’application s’ouvre avec le message prérempli. L’envoi final doit être confirmé dans WhatsApp ou l’application SMS.</p>
            {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setChannel(null)} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700">Annuler</button>
              <button type="button" onClick={() => void launchMessage()} className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700">
                Ouvrir {channel}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
