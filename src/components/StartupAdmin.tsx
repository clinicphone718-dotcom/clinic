import { useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ArrowDown, ArrowUp, ImagePlus, Music2, Plus, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import type { StartupItem, StartupSection, UserProfile } from '../types';
import { adhkarLibrary } from '../data/adhkar';
import { verses } from '../data/verses';
import { isDirectAudioUrl } from '../lib/startup';
import { useStartup } from './StartupProvider';

const SECTION_LABELS: Record<StartupSection, string> = {
  coran: 'Coran',
  matin: 'Adhkar du matin',
  soir: 'Adhkar du soir',
  rizq: 'Rizq',
};

const EMPTY_FORM = {
  type: 'text' as 'text' | 'image' | 'audio',
  title: '',
  text: '',
  source: '',
  repeat: 1,
  imageData: '',
  audioUrl: '',
};

async function compressImage(file: File): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire cette image."));
    };
    element.src = url;
  });
  const scale = Math.min(1, 1280 / image.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error("Compression d'image indisponible dans ce navigateur.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) {
    const result = canvas.toDataURL('image/webp', quality);
    if (result.startsWith('data:image/webp') && result.length <= 400_000) return result;
  }
  for (const quality of [0.8, 0.68, 0.55, 0.4, 0.3]) {
    const result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= 400_000) return result;
  }
  throw new Error("Cette image dépasse la limite de 400 Ko après compression.");
}

export default function StartupAdmin({ userProfile }: { userProfile: UserProfile | null }) {
  const { config, items, error } = useStartup();
  const ownerId = userProfile?.ownerId || userProfile?.uid || '';
  const [section, setSection] = useState<StartupSection>('coran');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioPreview = useRef<HTMLAudioElement | null>(null);
  const sectionItems = items.filter((item) => item.section === section);

  const saveConfig = async (updates: Partial<typeof config>) => {
    try {
      await setDoc(doc(db, 'startup_config', ownerId), {
        ownerId,
        ...updates,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setMessage('Réglage enregistré.');
    } catch (saveError) {
      console.error('Unable to save startup settings:', saveError);
      setMessage('Impossible d’enregistrer les réglages.');
    }
  };

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setMessage('');
    } catch (actionError) {
      console.error('Unable to update startup content:', actionError);
      setMessage('Impossible de modifier ce contenu.');
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setPreviewImage('');
    setEditingId(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!ownerId) return setMessage('Propriétaire du magasin introuvable.');
    if (!form.title.trim()) return setMessage('Le titre est obligatoire.');
    if (form.type === 'text' && !form.text.trim()) return setMessage('Le texte est obligatoire.');
    if (form.type === 'image' && !form.imageData) return setMessage('Choisissez une image.');
    if (form.type === 'audio' && !isDirectAudioUrl(form.audioUrl)) {
      return setMessage('Utilisez un lien HTTPS direct vers un fichier .mp3 ou .m4a. YouTube n’est pas accepté.');
    }
    if (form.type === 'image' && form.imageData.length > 400_000) {
      return setMessage("L’image compressée dépasse la limite de 400 Ko.");
    }
    if (form.type === 'image' && !editingId && items.filter((item) => item.type === 'image').length >= 15) {
      return setMessage('La limite de 15 images par magasin est atteinte.');
    }

    setBusy(true);
    try {
      const payload = {
        ownerId,
        section,
        type: form.type,
        title: form.title.trim(),
        text: form.type === 'text' ? form.text.trim() : '',
        source: form.source.trim(),
        repeat: Math.max(1, Number(form.repeat) || 1),
        imageData: form.type === 'image' ? form.imageData : '',
        audioUrl: form.type === 'audio' ? form.audioUrl.trim() : '',
        order: editingId ? items.find((item) => item.id === editingId)?.order || 0 : items.length,
        active: items.find((item) => item.id === editingId)?.active ?? true,
        ...(editingId ? {} : { createdAt: serverTimestamp() }),
      };
      if (editingId) await updateDoc(doc(db, 'startup_items', editingId), payload);
      else await addDoc(collection(db, 'startup_items'), payload);
      resetForm();
      setMessage('Contenu enregistré.');
    } catch (saveError) {
      console.error('Unable to save startup content:', saveError);
      setMessage('Impossible d’enregistrer le contenu.');
    } finally {
      setBusy(false);
    }
  };

  const importLibrary = async () => {
    setBusy(true);
    setMessage('');
    try {
      const base = section === 'coran'
        ? verses.map((verse) => ({
          section,
          type: 'text' as const,
          title: verse.title,
          text: verse.text,
          source: verse.source,
          repeat: 1,
        }))
        : adhkarLibrary.filter((item) => item.section === section);
      const existing = new Set(sectionItems.map((item) => `${item.source}|${item.title}`));
      const toAdd = base.filter((item) => !existing.has(`${item.source}|${item.title}`));
      if (!toAdd.length) {
        setMessage('La bibliothèque est déjà ajoutée.');
        return;
      }
      const batch = writeBatch(db);
      toAdd.forEach((item, index) => {
        const ref = doc(collection(db, 'startup_items'));
        batch.set(ref, {
          ...item,
          ownerId,
          active: item.text !== '',
          order: items.length + index,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setMessage(`${toAdd.length} élément(s) ajouté(s) depuis la bibliothèque.`);
    } catch (importError) {
      console.error('Unable to import startup library:', importError);
      setMessage('Impossible d’ajouter la bibliothèque.');
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async (item: StartupItem, direction: -1 | 1) => {
    const index = sectionItems.findIndex((current) => current.id === item.id);
    const target = sectionItems[index + direction];
    if (!target) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'startup_items', item.id), { order: target.order });
    batch.update(doc(db, 'startup_items', target.id), { order: item.order });
    await batch.commit();
  };

  const beginEdit = (item: StartupItem) => {
    setEditingId(item.id);
    setForm({
      type: item.type === 'image' || item.type === 'audio' ? item.type : 'text',
      title: item.title,
      text: item.text || '',
      source: item.source || '',
      repeat: item.repeat || 1,
      imageData: item.imageData || '',
      audioUrl: item.audioUrl || '',
    });
    setPreviewImage(item.imageData || '');
  };

  const testAudio = () => {
    setMessage('');
    if (!isDirectAudioUrl(form.audioUrl)) return setMessage('Lien audio invalide : HTTPS et fichier .mp3/.m4a obligatoires.');
    const audio = new Audio(form.audioUrl);
    audioPreview.current?.pause();
    audioPreview.current = audio;
    audio.volume = config.volume;
    void audio.play().then(() => {
      setMessage('Test audio en cours (5 secondes).');
      window.setTimeout(() => audio.pause(), 5000);
    }).catch((audioError: unknown) => {
      console.error('Audio test failed:', audioError);
      setMessage('Impossible de lire cette piste audio.');
    });
  };

  const uploadImage = async (file?: File) => {
    if (!file) return;
    setMessage('');
    try {
      const imageData = await compressImage(file);
      setForm((current) => ({ ...current, type: 'image', imageData }));
      setPreviewImage(imageData);
    } catch (imageError) {
      setMessage(imageError instanceof Error ? imageError.message : "Impossible de traiter l’image.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Coran &amp; Adhkar</h1>
        <p className="mt-1 text-sm text-slate-500">Gérez les contenus et l’écran d’ouverture de votre magasin.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-black uppercase tracking-wider text-slate-700">Réglages généraux</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={config.enabled} onChange={(event) => void saveConfig({ enabled: event.target.checked })} />
            Activer l’écran d’ouverture
          </label>
          <label className="text-sm font-semibold">Fréquence
            <select value={config.frequency} onChange={(event) => void saveConfig({ frequency: event.target.value as typeof config.frequency })} className="mt-1 block w-full rounded-lg border p-2">
              <option value="each_open">À chaque ouverture</option>
              <option value="daily_period">Une fois par période et par jour</option>
            </select>
          </label>
          <label className="text-sm font-semibold">Volume par défaut
            <input type="range" min="0" max="1" step="0.05" value={config.volume} onChange={(event) => void saveConfig({ volume: Number(event.target.value) })} className="mt-3 block w-full" />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.loop} onChange={(event) => void saveConfig({ loop: event.target.checked })} />Lecture en boucle</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.background} onChange={(event) => void saveConfig({ background: event.target.checked })} />Continuer l’audio en arrière-plan après la fermeture de l’écran</label>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {(['matin', 'soir', 'rizq', 'coran'] as StartupSection[]).map((key) => (
            <div key={key} className="rounded-xl border border-slate-100 p-3">
              <p className="mb-2 text-xs font-black uppercase text-slate-600">{SECTION_LABELS[key]}</p>
              <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={config.schedule[key].allDay} onChange={(event) => void saveConfig({ schedule: { ...config.schedule, [key]: { ...config.schedule[key], allDay: event.target.checked } } })} />Toute la journée</label>
              <div className="flex gap-2">
                <input aria-label={`Début ${SECTION_LABELS[key]}`} type="time" value={config.schedule[key].start} onChange={(event) => void saveConfig({ schedule: { ...config.schedule, [key]: { ...config.schedule[key], start: event.target.value } } })} className="rounded border p-1 text-sm" />
                <input aria-label={`Fin ${SECTION_LABELS[key]}`} type="time" value={config.schedule[key].end} onChange={(event) => void saveConfig({ schedule: { ...config.schedule, [key]: { ...config.schedule[key], end: event.target.value } } })} className="rounded border p-1 text-sm" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {(['coran', 'matin', 'soir', 'rizq'] as StartupSection[]).map((key) => (
          <button key={key} onClick={() => { setSection(key); resetForm(); }} className={`rounded-xl px-4 py-2 text-sm font-bold ${section === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}>{SECTION_LABELS[key]}</button>
        ))}
      </div>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-slate-800">{SECTION_LABELS[section]}</h2>
            <button onClick={() => void importLibrary()} disabled={busy} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50">Ajouter depuis la bibliothèque</button>
          </div>
          {sectionItems.map((item, index) => (
            <article key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {item.type === 'audio' ? <Music2 className="h-4 w-4 text-indigo-500" /> : item.type === 'image' ? <ImagePlus className="h-4 w-4 text-amber-500" /> : null}
                  <h3 className="truncate font-bold text-slate-800">{item.title}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.active ? 'Actif' : 'Désactivé'}</span>
                </div>
                {item.type === 'text' && <p className="font-arabic mt-2 line-clamp-2 text-right text-lg text-slate-600" dir="rtl">{item.text}</p>}
                {item.source && <p className="mt-2 text-xs text-slate-400">{item.source}</p>}
                {item.type === 'audio' && <p className="mt-2 truncate text-xs text-slate-500">{item.audioUrl}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <button aria-label="Monter" disabled={index === 0} onClick={() => void runAction(() => moveItem(item, -1))} className="rounded p-2 text-slate-500 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button aria-label="Descendre" disabled={index === sectionItems.length - 1} onClick={() => void runAction(() => moveItem(item, 1))} className="rounded p-2 text-slate-500 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button aria-label="Activer/désactiver" onClick={() => void runAction(() => updateDoc(doc(db, 'startup_items', item.id), { active: !item.active }))} className="rounded px-2 text-xs font-bold text-indigo-600">{item.active ? 'Désactiver' : 'Activer'}</button>
                <button aria-label="Modifier" onClick={() => beginEdit(item)} className="rounded px-2 text-xs font-bold text-indigo-600">Modifier</button>
                <button aria-label="Supprimer" onClick={() => void runAction(() => deleteDoc(doc(db, 'startup_items', item.id)))} className="rounded p-2 text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!sectionItems.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-400">Aucun contenu dans cette section.</p>}
        </div>

        <form onSubmit={saveItem} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-800">{editingId ? 'Modifier le contenu' : 'Ajouter un contenu'}</h2>
          <label className="block text-xs font-bold text-slate-600">Type
            <select value={form.type} onChange={(event) => { const type = event.target.value as typeof form.type; setForm({ ...form, type }); }} className="mt-1 w-full rounded-lg border p-2">
              <option value="text">Slide texte</option>
              <option value="image">Slide image</option>
              <option value="audio">Piste audio par lien</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">Titre
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 w-full rounded-lg border p-2" required />
          </label>
          {form.type === 'text' && <>
            <label className="block text-xs font-bold text-slate-600">Texte arabe
              <textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} dir="rtl" rows={5} className="font-arabic mt-1 w-full rounded-lg border p-2 text-lg" required />
            </label>
            <label className="block text-xs font-bold text-slate-600">Source
              <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
            <label className="block text-xs font-bold text-slate-600">Répétitions
              <input type="number" min="1" value={form.repeat} onChange={(event) => setForm({ ...form, repeat: Number(event.target.value) })} className="mt-1 w-full rounded-lg border p-2" />
            </label>
          </>}
          {form.type === 'image' && <>
            <input ref={fileInput} type="file" accept="image/*" onChange={(event) => void uploadImage(event.target.files?.[0])} className="block w-full text-xs" />
            <p className="text-xs text-slate-500">Compression locale, largeur maximale 1280 px et taille maximale 400 Ko.</p>
            {previewImage && <img src={previewImage} alt="Aperçu avant enregistrement" className="max-h-56 rounded-lg object-contain" />}
          </>}
          {form.type === 'audio' && <>
            <label className="block text-xs font-bold text-slate-600">URL directe HTTPS (.mp3 ou .m4a)
              <input type="url" value={form.audioUrl} onChange={(event) => setForm({ ...form, audioUrl: event.target.value })} className="mt-1 w-full rounded-lg border p-2" placeholder="https://exemple.tld/recitation.mp3" />
            </label>
            <button type="button" onClick={testAudio} className="rounded-lg border px-3 py-2 text-xs font-bold text-indigo-700">Tester (5 secondes)</button>
          </>}
          {message && <p role="status" className="text-sm text-indigo-700">{message}</p>}
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} type="submit" className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            {editingId && <button type="button" onClick={resetForm} className="rounded-lg border px-4 py-2 text-sm font-bold text-slate-600">Annuler</button>}
          </div>
        </form>
      </section>
    </div>
  );
}
