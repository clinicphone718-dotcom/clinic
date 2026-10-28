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
import { doc, onSnapshot } from 'firebase/firestore';
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { db } from '../firebase';
import type { StartupConfig, StartupItem, StartupSection, UserProfile } from '../types';
import { can } from '../lib/permissions';
import { isDirectAudioUrl } from '../lib/startup';
import { verses } from '../data/verses';

const firstVerse = verses[0];
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
  background: true,
  welcomeTitle: firstVerse.title,
  welcomeText: firstVerse.text,
  welcomeSource: firstVerse.source,
  audioUrl: '',
};

function normalizeConfig(data: Partial<StartupConfig>): StartupConfig {
  const schedule = data.schedule || DEFAULT_CONFIG.schedule;
  return {
    ...DEFAULT_CONFIG,
    ...data,
    welcomeTitle: data.welcomeTitle || DEFAULT_CONFIG.welcomeTitle,
    welcomeText: data.welcomeText || DEFAULT_CONFIG.welcomeText,
    welcomeSource: data.welcomeSource || DEFAULT_CONFIG.welcomeSource,
    audioUrl: data.audioUrl || '',
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

function shouldOpen(config: StartupConfig, ownerId: string): boolean {
  if (!config.enabled) return false;
  const now = new Date();
  const activePeriods = (['matin', 'soir', 'rizq', 'coran'] as StartupSection[])
    .filter((section) => scheduleIncludes(config.schedule[section], now));
  if (!activePeriods.length) return false;
  if (config.frequency === 'each_open') return true;
  const period = activePeriods.includes('soir') && !activePeriods.includes('matin') ? 'soir' : 'jour';
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
  const openedRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setConfig(DEFAULT_CONFIG);
    setItems([]);
    openedRef.current = false;
    if (!ownerId || !online || (!showScreen && !audioAllowed && !canManage)) {
      setLoading(false);
      return;
    }

    const unsubscribeConfig = onSnapshot(
      doc(db, 'startup_config', ownerId),
      (snapshot) => {
        setConfig(snapshot.exists() ? normalizeConfig(snapshot.data() as Partial<StartupConfig>) : DEFAULT_CONFIG);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Unable to load startup configuration:', snapshotError);
        setError('Impossible de charger les réglages Coran & Adhkar.');
        setLoading(false);
      },
    );

    return () => unsubscribeConfig();
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

  const selectedAudioUrl = useMemo(
    () => audioAllowed && isDirectAudioUrl(config.audioUrl || '') ? config.audioUrl || '' : '',
    [audioAllowed, config.audioUrl],
  );

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setAudioPlaying(false);
  }, []);

  const playAudio = useCallback(async () => {
    if (!audioAllowed) return;
    if (!selectedAudioUrl) {
      setAudioMessage('أضف مقطعًا صوتيًا من الإعدادات');
      setAudioPlaying(false);
      return;
    }

    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    audio.preload = 'none';
    audio.loop = config.loop;
    audio.volume = config.volume;
    audio.muted = muted;
    if (audio.src !== selectedAudioUrl) audio.src = selectedAudioUrl;
    audio.onended = () => {
      // Les liens générés pour AlQuran.cloud peuvent enchaîner les sourates
      // sans ajouter de champ à la configuration Firestore existante.
      const playlistMatch = (audio.currentSrc || audio.src).match(/^(https:\/\/cdn\.islamic\.network\/quran\/audio-surah\/128\/ar\.alafasy\/)(\d+)\.mp3(?:[?#].*)?$/i);
      if (!config.loop && playlistMatch) {
        const currentSurah = Number(playlistMatch[2]);
        const nextSurah = currentSurah >= 114 ? 1 : currentSurah + 1;
        const nextUrl = `${playlistMatch[1]}${nextSurah}.mp3`;
        audio.src = nextUrl;
        audio.play().then(() => {
          setAudioPlaying(true);
          setAudioMessage(null);
        }).catch(() => {
          setAudioPlaying(false);
          setAudioMessage('La sourate suivante n’a pas pu démarrer. Appuyez sur Lecture pour réessayer.');
        });
        return;
      }
      setAudioPlaying(false);
    };
    audio.onerror = () => {
      setAudioPlaying(false);
      setAudioMessage('تعذر تشغيل المقطع الصوتي. تحقق من الرابط أو من اتصال الإنترنت.');
    };
    try {
      await audio.play();
      setAudioBlocked(false);
      setAudioPlaying(true);
      setAudioMessage(null);
    } catch (playError) {
      setAudioPlaying(false);
      setAudioBlocked(playError instanceof Error && playError.name === 'NotAllowedError');
      setAudioMessage('تعذر بدء الصوت. اضغط على زر التشغيل للمحاولة مجددًا.');
    }
  }, [audioAllowed, selectedAudioUrl, config.loop, config.volume, muted]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = config.volume;
      audioRef.current.loop = config.loop;
    }
  }, [config.volume, config.loop]);

  useEffect(() => {
    if (!audioAllowed) {
      stopAudio();
      audioRef.current = null;
      setAudioBlocked(false);
      return;
    }
    if (audioRef.current && audioRef.current.src !== selectedAudioUrl) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      setAudioPlaying(false);
    }
  }, [audioAllowed, selectedAudioUrl, stopAudio]);

  useEffect(() => {
    if (!config.enabled) {
      setOverlayOpen(false);
      stopAudio();
    }
  }, [config.enabled, stopAudio]);

  useEffect(() => {
    if (online) return;
    setOverlayOpen(false);
    stopAudio();
  }, [online, stopAudio]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const toggleAudio = useCallback(() => {
    if (audioPlaying) stopAudio();
    else void playAudio();
  }, [audioPlaying, stopAudio, playAudio]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
    try {
      localStorage.setItem('phone-clinic-startup-muted', next ? '1' : '0');
    } catch (storageError) {
      console.warn('Unable to save startup mute preference:', storageError);
    }
  }, [muted]);

  const setVolume = (volume: number) => {
    if (audioRef.current) audioRef.current.volume = volume;
    setConfig((previous) => ({ ...previous, volume }));
  };

  const closeOverlay = () => setOverlayOpen(false);
  const enterApp = () => {
    if (audioAllowed && selectedAudioUrl) void playAudio();
    else if (audioAllowed) setAudioMessage('أضف مقطعًا صوتيًا من الإعدادات');
    setOverlayOpen(false);
  };

  const value: StartupContextValue = {
    config,
    items,
    loading,
    error,
    canManage,
    audioAllowed,
    openNow,
    audioPlaying,
    audioBlocked,
    audioMessage,
    muted,
    toggleAudio,
    toggleMute,
    setVolume,
  };

  return (
    <StartupContext.Provider value={value}>
      {children}
      <StartupMiniPlayer />
      {overlayOpen && (
        <StartupOverlay
          config={config}
          audioAllowed={audioAllowed}
          hasAudio={Boolean(selectedAudioUrl)}
          audioMessage={audioMessage}
          onClose={closeOverlay}
          onEnter={enterApp}
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
  audioAllowed,
  hasAudio,
  audioMessage,
  onClose,
  onEnter,
}: {
  config: StartupConfig;
  audioAllowed: boolean;
  hasAudio: boolean;
  audioMessage: string | null;
  onClose: () => void;
  onEnter: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coran & Adhkar"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-gradient-to-br from-amber-950 via-indigo-950 to-slate-950 px-5 text-white"
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
      <button onClick={onClose} className="absolute right-5 top-5 z-10 rounded-full border border-white/20 bg-white/10 p-3 hover:bg-white/20" aria-label="Fermer">
        <X className="h-5 w-5" />
      </button>
      <main className="relative flex w-full max-w-5xl flex-col items-center text-center">
        <p className="mb-8 text-xs font-semibold uppercase tracking-[0.35em] text-amber-200/80">Coran &amp; Adhkar</p>
        <article className="animate-in fade-in duration-700">
          <h1 className="font-arabic mb-6 text-2xl font-semibold text-amber-200 md:text-3xl" dir="rtl" lang="ar">
            {config.welcomeTitle || firstVerse.title}
          </h1>
          <p className="font-arabic text-3xl leading-[1.9] md:text-5xl md:leading-[1.9]" dir="rtl" lang="ar">
            {config.welcomeText || firstVerse.text}
          </p>
          {config.welcomeSource && <p className="mt-6 text-xs text-white/60">{config.welcomeSource}</p>}
        </article>
        {!audioAllowed ? (
          <p className="mt-8 text-sm text-white/70">الصوت غير مفعّل لهذا الحساب.</p>
        ) : !hasAudio ? (
          <p className="mt-8 text-sm text-amber-100/80">أضف مقطعًا صوتيًا من الإعدادات</p>
        ) : audioMessage ? (
          <p role="status" className="mt-8 text-sm text-amber-100/80">{audioMessage}</p>
        ) : null}
        <button
          onClick={onEnter}
          className="mt-10 rounded-full border border-amber-200/40 bg-amber-300 px-10 py-4 text-lg font-black text-slate-950 shadow-xl shadow-amber-950/30 transition hover:bg-amber-200"
        >
          دخول
        </button>
      </main>
    </div>
  );
}

export function StartupMiniPlayer() {
  const { config, audioAllowed, audioPlaying, muted, toggleAudio, toggleMute } = useStartup();
  if (!config.enabled || !audioAllowed || !isDirectAudioUrl(config.audioUrl || '')) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-indigo-100 bg-white/95 px-2 py-1 shadow-lg backdrop-blur">
      <button className="rounded-full p-2 text-indigo-700 hover:bg-indigo-50" onClick={toggleAudio} aria-label={audioPlaying ? 'إيقاف الصوت' : 'تشغيل الصوت'}>
        {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button className="rounded-full p-2 text-indigo-700 hover:bg-indigo-50" onClick={toggleMute} aria-label={muted ? 'تشغيل الصوت' : 'كتم الصوت'}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
