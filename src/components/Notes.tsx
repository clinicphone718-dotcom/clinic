import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Note, UserProfile } from '../types';
import { handleFirestoreError, OperationType } from '../App';
import { Plus, Search, Edit2, Trash2, X, Calendar, StickyNote, Clock, Bell, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface NotesProps {
  userProfile: UserProfile | null;
}

export default function Notes({ userProfile }: NotesProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'upcoming' | 'past'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const ownerId = (userProfile?.role === 'admin' ? userProfile?.uid : userProfile?.ownerId) || userProfile?.uid || auth.currentUser?.uid;

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    date: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (!auth.currentUser || !ownerId) return;
    // Listen for notes of this owner, sort client-side to prevent needing a composite index
    const q = query(collection(db, 'notes'), where('ownerId', '==', ownerId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsedNotes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Note));
      parsedNotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setNotes(parsedNotes);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notes');
    });

    return () => {
      unsubscribe();
    };
  }, [ownerId]);

  const getNoteStatus = (noteDateStr: string) => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (noteDateStr === todayStr) {
      return { label: "Aujourd'hui", color: "bg-amber-50 text-amber-700 border-amber-200/60" };
    } else if (noteDateStr > todayStr) {
      return { label: "À venir", color: "bg-emerald-50 text-emerald-700 border-emerald-200/60" };
    } else {
      return { label: "Passé", color: "bg-slate-50 text-slate-500 border-slate-200/60" };
    }
  };

  const filteredNotes = notes.filter(note => {
    // Search keyword match
    const matchesSearch = 
      note.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      note.content.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    // Date status match
    const todayStr = new Date().toISOString().split('T')[0];
    if (dateFilter === 'today') return note.date === todayStr;
    if (dateFilter === 'upcoming') return note.date > todayStr;
    if (dateFilter === 'past') return note.date < todayStr;
    
    return true;
  });

  const openModal = (note?: Note) => {
    if (note) {
      setEditingNote(note);
      setFormData({
        title: note.title,
        content: note.content,
        date: note.date
      });
    } else {
      setEditingNote(null);
      setFormData({
        title: '',
        content: '',
        date: new Date().toISOString().split('T')[0]
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingNote(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;

    try {
      const activeUserId = userProfile?.uid || ownerId;
      if (editingNote) {
        await updateDoc(doc(db, 'notes', editingNote.id), {
          title: formData.title,
          content: formData.content,
          date: formData.date,
          ownerId,
          userId: activeUserId
        });
      } else {
        await addDoc(collection(db, 'notes'), {
          title: formData.title,
          content: formData.content,
          date: formData.date,
          createdAt: serverTimestamp(),
          ownerId,
          userId: activeUserId
        });
      }
      closeModal();
    } catch (error) {
      handleFirestoreError(error, editingNote ? OperationType.UPDATE : OperationType.CREATE, 'notes');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce mémo ?')) return;
    try {
      await deleteDoc(doc(db, 'notes', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'notes');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-xs">
        <div className="space-y-1">
          <h1 className="text-3xl font-black font-display tracking-tight text-slate-900 flex items-center gap-2">
            <StickyNote className="w-8 h-8 text-indigo-600 animate-pulse" />
            Mémos & Notes
          </h1>
          <p className="text-sm text-slate-500 font-semibold">
            Ajoutez, planifiez et organisez vos tâches, rappels ou notes de magasin importantes.
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider px-5 py-3 rounded-2xl transition-all duration-300 shadow-md shadow-indigo-600/10 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Ajouter un mémo
        </button>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher mémos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50/50 border border-slate-100 rounded-xl text-xs font-semibold placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-sans"
          />
        </div>

        {/* Date category filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {(['all', 'today', 'upcoming', 'past'] as const).map((filter) => {
            const label = filter === 'all' ? 'Tous' : filter === 'today' ? "Aujourd'hui" : filter === 'upcoming' ? 'À venir' : 'Passés';
            const isActive = dateFilter === filter;
            return (
              <button
                key={filter}
                onClick={() => setDateFilter(filter)}
                className={cn(
                  "px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 shrink-0",
                  isActive
                    ? "bg-slate-900 border-slate-900 text-white shadow-xs"
                    : "bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-800"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of notes */}
      {loading ? (
        <div className="flex items-center justify-center p-12 bg-white rounded-3xl border border-slate-100">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-slate-100">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-50 border border-slate-100 text-slate-400 mb-4">
            <Calendar className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-slate-500 font-extrabold text-sm uppercase tracking-wide">Aucun mémo trouvé</p>
          <p className="text-slate-400 text-xs mt-1">Commencez par ajouter un mémo ou une note planifiée.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredNotes.map((note) => {
            const status = getNoteStatus(note.date);
            return (
              <div
                key={note.id}
                className="group relative bg-white border border-slate-100 p-6 rounded-3xl hover:shadow-lg hover:shadow-slate-100/40 hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between"
              >
                {/* Actions header hover */}
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                  <button
                    onClick={() => openModal(note)}
                    title="Modifier"
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-indigo-600 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    title="Supprimer"
                    className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-500 hover:text-rose-600 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Status & Date */}
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border",
                      status.color
                    )}>
                      {status.label}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1 font-bold">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {note.date}
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="space-y-1.5">
                    <h3 className="text-md font-black text-slate-800 tracking-tight group-hover:text-indigo-600 transition-colors font-display">
                      {note.title}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed whitespace-pre-wrap font-sans">
                      {note.content}
                    </p>
                  </div>
                </div>

                {/* Footer status bar */}
                <div className="border-t border-slate-50 mt-4 pt-3 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Rappel planifié
                  </span>
                  
                  {/* Shortcut action in mobile when hover controls are hidden */}
                  <div className="flex group-hover:hidden items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-300" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Creation / Editing Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl border border-slate-100 shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-lg font-black font-display text-slate-900 flex items-center gap-2">
                <StickyNote className="w-5 h-5 text-indigo-600" />
                {editingNote ? "Modifier le mémo" : "Nouveau mémo / Note"}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 hover:bg-slate-200/50 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Titre du mémo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Penser à approvisionner les boissons, Réunion..."
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all placeholder-slate-400 font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Description / Note</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Écrivez les détails de votre mémorandum..."
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all placeholder-slate-400 leading-relaxed font-sans"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Date d'échéance / Rappel</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200/60 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-mono"
                  />
                </div>
              </div>

              {/* Modal Footer actions */}
              <div className="pt-4 border-t border-slate-50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-slate-900 border border-slate-900 text-white hover:bg-slate-850 transition-all shadow-md shadow-slate-900/10"
                >
                  {editingNote ? "Mettre à jour" : "Ajouter mémo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
