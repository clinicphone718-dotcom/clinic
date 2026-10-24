import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { X, Volume2, VolumeX, Play, Pause } from 'lucide-react';
import { db } from '../firebase';
import type { StartupConfig, StartupItem, StartupSection, UserProfile } from '../types';
import { can } from '../lib/permissions';
import { isDirectAudioUrl } from '../lib/startup';

const DEFAULT_CONFIG: StartupConfig = {
  enabled: true,
  frequency: 'each_open',
  schedule: {
    coran: { allDay: true, start: '00:00', end: '23:59' },
    matin: { allDay: false, start: '05:00', end: '11:59' },
    soir: { allDay: false, start: '16:00', end: '22:00' },
    rizq: { allDay: false, start: '05:00', end: '22:00' },
  },
  volume: 0.5,
  loop: false,
  background: false,
};

function normalizeConfig(data: Partial<StartupConfig>): StartupConfig {
  const schedule = data.schedule || DEFAULT_CONFIG.schedule;
  return {
    ...DEFAULT_CONFIG,
    ...data,
    schedule: {
      coran: { ...DEFAULT_CONFIG.schedule.coran, ...schedule.coran },
      matin: { ...DEFAULT_CONFIG.schedule.matin, ...schedule.matin },
      soir: { ...DEFAULT_CONFIG.schedule.soir, ...schedule.soir },
      rizq: { ...DEFAULT_CONFIG.schedule.rizq, ...schedule.rizq },
    },
  };
}

interface StartupContextValue {
  config: StartupConfig;
  items: StartupItem[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  audioAllowed: boolean;
  openNow: () => void;
  audioPlaying: boolean;
  audioBlocked: boolean;
  audioMessage: string | null;
  muted: boolean;
  toggleAudio: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
}

const StartupContext = createContext<StartupContextValue | null>(null);

function getLocalMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function scheduleIncludes(schedule: StartupConfig['schedule'][StartupSection], now: Date): boolean {
  if (schedule.allDay) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = getLocalMinutes(schedule.start);
  const end = getLocalMinutes(schedule.end);
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}

function getSections(config: StartupConfig, now = new Date()): StartupSection[] {
  const sections: StartupSection[] = [];
  if (scheduleIncludes(config.schedule.matin, now)) sections.push('matin');
  if (scheduleIncludes(config.schedule.soir, now)) sections.push('soir');
  if (scheduleIncludes(config.schedule.rizq, now)) sections.push('rizq');
  if (scheduleIncludes(config.schedule.coran, now)) sections.push('coran');
  return sections;
}

function shouldOpen(config: StartupConfig, ownerId: string): boolean {
  if (!config.enabled) return false;
  const now = new Date();
  const sections = getSections(config, now);
  if (!sections.length) return false;
  if (config.frequency === 'each_open') return true;
  const period = sections.filter((section) => section === 'matin' || section === 'soir').join('-') || 'jour';
  const key = `phone-clinic-startup:${ownerId}:${now.toLocaleDateString('sv-SE')}:${period}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch {
    return true;
  }
  return true;
}

export function StartupProvider({
  userProfile,
  online,
  children,
}: {
  userProfile: UserProfile | null;
  online: boolean;
  children: ReactNode;
}) {
  const ownerId = userProfile?.ownerId || userProfile?.uid || '';
  const showScreen = can(userProfile, 'startup', 'showScreen');
  const audioAllowed = can(userProfile, 'startup', 'playAudio');
  const canManage = userProfile?.role === 'admin' && ownerId === userProfile.uid;
  const [config, setConfig] = useState<StartupConfig>(DEFAULT_CONFIG);
  const [items, setItems] = useState<StartupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('phone-clinic-startup-muted') === '1';
    } catch {
      return false;
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<StartupItem[]>([]);
  const indexRef = useRef(0);
  const failedRef = useRef(new Set<string>());
  const visitedRef = useRef(0);
  const openedRef = useRef(false);
  const audioOnlyStartedRef = useRef(false);
  const playTrackRef = useRef<(startIndex: number) => void>(() => undefined);
  const initializedConfigOwnerRef = useRef('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    setConfig(DEFAULT_CONFIG);
    setItems([]);
    openedRef.current = false;
    audioOnlyStartedRef.current = false;
    if (!ownerId || !online || (!showScreen && !audioAllowed && !canManage)) {
      setLoading(false);
      return;
    }
    const unsubscribeConfig = onSnapshot(
      doc(db, 'startup_config', ownerId),
      (snapshot) => {
        setConfig(snapshot.exists() ? normalizeConfig(snapshot.data() as Partial<StartupConfig>) : DEFAULT_CONFIG);
        setLoading(false);
        if (!snapshot.exists() && canManage && initializedConfigOwnerRef.current !== ownerId) {
          initializedConfigOwnerRef.current = ownerId;
          void setDoc(doc(db, 'startup_config', ownerId), {
            ownerId,
            ...DEFAULT_CONFIG,
            updatedAt: serverTimestamp(),
          }).catch((writeError) => {
            console.error('Unable to initialize startup configuration:', writeError);
            setError('Impossible d’initialiser les réglages Coran & Adhkar.');
          });
        }
      },
      (snapshotError) => {
        console.error('Unable to load startup configuration:', snapshotError);
        setError('Impossible de charger les réglages Coran & Adhkar.');
        setLoading(false);
      },
    );
    const unsubscribeItems = onSnapshot(
      query(collection(db, 'startup_items'), where('ownerId', '==', ownerId)),
      (snapshot) => {
        const loadedItems = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as StartupItem)
          .sort((a, b) => a.order - b.order);
        setItems(audioAllowed ? loadedItems : loadedItems.filter((item) => item.type !== 'audio'));
      },
      (snapshotError) => {
        console.error('Unable to load startup items:', snapshotError);
        setError('Impossible de charger le contenu Coran & Adhkar.');
      },
    );
    return () => {
      unsubscribeConfig();
      unsubscribeItems();
    };
  }, [ownerId, online, showScreen, audioAllowed, canManage]);

  const openNow = useCallback(() => {
    if (!showScreen || !online || loading || error || !shouldOpen(config, ownerId)) return;
    setOverlayOpen(true);
  }, [showScreen, online, loading, error, config, ownerId]);

  useEffect(() => {
    if (loading || !ownerId || !showScreen || !online || openedRef.current) return;
    openedRef.current = true;
    openNow();
  }, [loading, ownerId, showScreen, online, openNow]);

  const playlist = useMemo(() => {
    if (!audioAllowed) return [];
    const selected = new Set(getSections(config));
    return items.filter((item) =>
      item.active &&
      item.type === 'audio' &&
      isDirectAudioUrl(item.audioUrl || '') &&
      selected.has(item.section),
    );
  }, [audioAllowed, config, items]);

  useEffect(() => {
    if (
      showScreen ||
      !audioAllowed ||
      !online ||
      loading ||
      error ||
      !config.enabled ||
      !playlist.length ||
      audioOnlyStartedRef.current
    ) return;
    audioOnlyStartedRef.current = true;
    if (shouldOpen(config, ownerId)) playTrackRef.current(0);
  }, [showScreen, audioAllowed, online, loading, error, config, playlist, ownerId]);

  const playTrack = useCallback((startIndex: number) => {
    if (!audioAllowed || !playlistRef.current.length) return;
    const trackCount = playlistRef.current.length;
    let nextIndex = startIndex;
    let checked = 0;
    while (checked < trackCount && failedRef.current.has(playlistRef.current[nextIndex]?.id || '')) {
      nextIndex = (nextIndex + 1) % trackCount;
      checked += 1;
    }
    if (checked >= trackCount) {
      setAudioMessage('Aucune piste audio disponible.');
      setAudioPlaying(false);
      return;
    }
    indexRef.current = nextIndex;
    visitedRef.current += 1;
    const item = playlistRef.current[nextIndex];
    const audio = new Audio(item.audioUrl);
    audio.preload = 'none';
    audio.volume = config.volume;
    audio.muted = muted;
    audioRef.current?.pause();
    audioRef.current = audio;
    audio.onended = () => {
      const next = indexRef.current + 1;
      if (next < trackCount) playTrack(next);
      else if (config.loop) {
        failedRef.current.clear();
        visitedRef.current = 0;
        playTrack(0);
      } else {
        setAudioPlaying(false);
      }
    };
    audio.onerror = () => {
      if (failedRef.current.has(item.id)) return;
      failedRef.current.add(item.id);
      setAudioMessage(`Piste ignorée : ${item.title}`);
      if (visitedRef.current < trackCount) playTrack((nextIndex + 1) % trackCount);
      else setAudioPlaying(false);
    };
    void audio.play().then(() => {
      setAudioBlocked(false);
      setAudioPlaying(true);
      setAudioMessage(null);
    }).catch((playError: unknown) => {
      if (playError instanceof Error && playError.name === 'NotAllowedError') {
        setAudioBlocked(true);
        setAudioPlaying(false);
      } else {
        if (failedRef.current.has(item.id)) return;
        failedRef.current.add(item.id);
        setAudioMessage(`Piste ignorée : ${item.title}`);
        if (visitedRef.current < trackCount) playTrack((nextIndex + 1) % trackCount);
      }
    });
  }, [audioAllowed, config.loop, config.volume, muted]);
  playTrackRef.current = playTrack;

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    if (!overlayOpen || !audioAllowed || !playlist.length) return;
    failedRef.current.clear();
    visitedRef.current = 0;
    playTrackRef.current(0);
  }, [overlayOpen, audioAllowed, playlist]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = config.volume;
  }, [config.volume]);

  useEffect(() => {
    if (audioAllowed) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioPlaying(false);
    setAudioBlocked(false);
  }, [audioAllowed]);

  useEffect(() => {
    if (showScreen && config.enabled) return;
    setOverlayOpen(false);
  }, [showScreen, config.enabled]);

  useEffect(() => {
    if (audioAllowed && online && config.enabled && (overlayOpen || config.background)) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioPlaying(false);
  }, [audioAllowed, online, config.enabled, config.background, overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOverlay();
      else if (audioBlocked && audioAllowed) void resumeAudio();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const closeOverlay = () => {
    setOverlayOpen(false);
    if (!config.background) {
      audioRef.current?.pause();
      audioRef.current = null;
      setAudioPlaying(false);
    }
  };

  const resumeAudio = async () => {
    if (!audioAllowed) return;
    if (audioRef.current) {
      try {
        await audioRef.current.play();
        setAudioBlocked(false);
        setAudioPlaying(true);
      } catch (playError) {
        console.error('Unable to resume startup audio:', playError);
      }
    } else if (playlist.length) {
      playTrack(indexRef.current);
    }
  };

  const toggleAudio = () => {
    if (!audioAllowed) return;
    if (audioPlaying) {
      audioRef.current?.pause();
      setAudioPlaying(false);
    } else {
      void resumeAudio();
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
    try {
      localStorage.setItem('phone-clinic-startup-muted', next ? '1' : '0');
    } catch (storageError) {
      console.warn('Unable to save startup mute preference:', storageError);
    }
  };

  const setVolume = (volume: number) => {
    if (audioRef.current) audioRef.current.volume = volume;
    setConfig((previous) => ({ ...previous, volume }));
  };

  useEffect(() => {
    if (online) return;
    setOverlayOpen(false);
    audioRef.current?.pause();
    audioRef.current = null;
    setAudioPlaying(false);
  }, [online]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const value: StartupContextValue = {
    config, items, loading, error, canManage, audioAllowed, openNow,
    audioPlaying, audioBlocked, audioMessage, muted, toggleAudio, toggleMute, setVolume,
  };

  return (
    <StartupContext.Provider value={value}>
      {children}
      {overlayOpen && (
        <StartupOverlay
          config={config}
          items={items}
          audioAllowed={audioAllowed}
          audioBlocked={audioBlocked}
          audioMessage={audioMessage}
          onClose={closeOverlay}
          onResume={() => void resumeAudio()}
        />
      )}
    </StartupContext.Provider>
  );
}

export function useStartup(): StartupContextValue {
  const value = useContext(StartupContext);
  if (!value) throw new Error('useStartup must be used inside StartupProvider');
  return value;
}

function StartupOverlay({
  config,
  items,
  audioAllowed,
  audioBlocked,
  audioMessage,
  onClose,
  onResume,
}: {
  config: StartupConfig;
  items: StartupItem[];
  audioAllowed: boolean;
  audioBlocked: boolean;
  audioMessage: string | null;
  onClose: () => void;
  onResume: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [slideProgress, setSlideProgress] = useState(0);
  const now = new Date();
  const selectedSections = new Set(getSections(config, now));
  const slides = items.filter((item) =>
    item.active &&
    item.type !== 'audio' &&
    (item.type === 'image' ? Boolean(item.imageData) : Boolean(item.text)) &&
    selectedSections.has(item.section),
  );
  const period = selectedSections.has('soir') && !selectedSections.has('matin') ? 'soir' : 'matin';
  const palette = selectedSections.has('rizq') &&
    !selectedSections.has('matin') &&
    !selectedSections.has('soir')
    ? 'from-amber-950 via-amber-900 to-slate-950'
    : period === 'soir'
      ? 'from-indigo-950 via-slate-950 to-indigo-900'
      : 'from-amber-950 via-indigo-950 to-slate-950';
  const current = slides[index];

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2) return;
    setSlideProgress(0);
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const progress = Math.min((Date.now() - startedAt) / 12000, 1);
      setSlideProgress(progress);
      if (progress >= 1) setIndex((value) => (value + 1) % slides.length);
    }, 100);
    return () => window.clearInterval(interval);
  }, [index, slides.length]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coran & Adhkar"
      onClick={() => { if (audioBlocked && audioAllowed) onResume(); }}
      className={`fixed inset-0 z-[100] overflow-hidden bg-gradient-to-br ${palette} text-white`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.13]" aria-hidden="true">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="startup-geometry" width="72" height="72" patternUnits="userSpaceOnUse">
              <path d="M36 0 72 36 36 72 0 36z M36 12 60 36 36 60 12 36z M0 0l72 72m0-72L0 72" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#startup-geometry)" />
        </svg>
      </div>
      <button onClick={(event) => { event.stopPropagation(); onClose(); }} className="absolute right-5 top-5 z-10 rounded-full border border-white/20 bg-white/10 p-3 hover:bg-white/20" aria-label="Fermer">
        <X className="h-5 w-5" />
      </button>
      <button onClick={(event) => { event.stopPropagation(); onClose(); }} className="absolute left-5 top-5 z-10 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm font-semibold hover:bg-white/20">
        Passer
      </button>
      <div className="relative flex h-full flex-col items-center justify-center px-6 pb-20 pt-24 text-center">
        <p className="mb-8 text-xs font-semibold uppercase tracking-[0.35em] text-amber-200/80">Coran &amp; Adhkar</p>
        {current?.type === 'image' && current.imageData ? (
          <img src={current.imageData} alt={current.title} className="max-h-[70vh] max-w-full rounded-2xl object-contain shadow-2xl" />
        ) : current ? (
          <article className="max-w-5xl animate-in fade-in duration-700">
            <h1 className="font-arabic mb-6 text-2xl font-semibold text-amber-200 md:text-3xl" dir="rtl" lang="ar">{current.title}</h1>
            <p className="font-arabic text-3xl leading-[1.9] md:text-5xl md:leading-[1.9]" dir="rtl" lang="ar">{current.text}</p>
            {(current.repeat ?? 1) > 1 && <p className="mt-5 text-sm text-amber-100/80">التكرار: {current.repeat}</p>}
            {current.source && <p className="mt-6 text-xs text-white/60">{current.source}</p>}
          </article>
        ) : (
          <div className="max-w-xl">
            <p className="font-arabic text-3xl font-semibold text-amber-100" dir="rtl" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>
            <p className="mt-4 text-sm text-white/70">Aucun contenu actif pour cette période.</p>
          </div>
        )}
      </div>
      {audioBlocked && audioAllowed && (
        <button
          onClick={(event) => { event.stopPropagation(); onResume(); }}
          className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 px-8 py-5 text-2xl font-black text-slate-950 shadow-2xl"
        >
          ▶ بسم الله
        </button>
      )}
      {audioMessage && <p className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-4 py-2 text-xs text-white/80">{audioMessage}</p>}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4">
        {slides.length > 1 && (
          <>
            <button aria-label="Diapositive précédente" onClick={(event) => { event.stopPropagation(); setIndex((index + slides.length - 1) % slides.length); }} className="rounded-full bg-white/10 px-3 py-2">‹</button>
            <div className="flex gap-2">{slides.map((slide, slideIndex) => <button key={slide.id} aria-label={`Diapositive ${slideIndex + 1}`} onClick={(event) => { event.stopPropagation(); setIndex(slideIndex); }} className={`h-2 rounded-full transition-all ${slideIndex === index ? 'w-8 bg-amber-300' : 'w-2 bg-white/40'}`} />)}</div>
            <button aria-label="Diapositive suivante" onClick={(event) => { event.stopPropagation(); setIndex((index + 1) % slides.length); }} className="rounded-full bg-white/10 px-3 py-2">›</button>
          </>
        )}
        {slides.length > 1 && <div className="absolute -bottom-3 left-0 h-0.5 bg-amber-300 transition-[width]" style={{ width: `${slideProgress * 100}%` }} />}
      </div>
    </div>
  );
}

export function StartupMiniPlayer() {
  const { config, audioAllowed, audioPlaying, audioBlocked, muted, toggleAudio, toggleMute, setVolume } = useStartup();
  if ((!config.background && !audioBlocked) || !audioAllowed) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-2 py-1">
      <button className="rounded p-1 text-indigo-700" onClick={toggleAudio} aria-label={audioPlaying ? 'Pause audio' : 'Lire audio'}>
        {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button className="rounded p-1 text-indigo-700" onClick={toggleMute} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input aria-label="Volume audio" type="range" min="0" max="1" step="0.05" value={config.volume} onChange={(event) => setVolume(Number(event.target.value))} className="w-16 accent-indigo-600" />
    </div>
  );
}
