import {
  AUDIO_PREFS_KEY,
  AUTO_FOCUS_TYPE_KEY,
  DAILY_PACE_KEY,
  DEFAULT_GOOGLE_CLIENT_ID,
  IDB_NAME,
  IDB_STORE,
  IDB_VERSION,
  THEME_MODE_LABELS,
  USER_PREFS_KEY,
  VERB_STATS_KEY,
  VOCAB_STATS_KEY,
  getTodayDateStr,
  normalizeStudyLevel,
  parseLevelNumber
} from './constants.js';

// Shared mutable application state
export const appState = {
  deck: [],
  deletedCardIds: new Set(),
  loadedPackUrls: new Set(),
  managePageLimit: 100,

  studyLevel: 'ALL',
  studyTheme: 'ALL',
  studyMode: 'DUE', // 'DUE' | 'ALL'
  currentCardId: null,
  isRevealed: false,
  typedAnswers: [],
  expectedAnswers: [],
  activeBlankInputIndex: 0,
  autoFocusType: false,

  spanishVoices: [],
  activeAudioElement: null,
  cloudAudioCache: new Map(),

  dailyPace: {
    date: getTodayDateStr(),
    introducedCount: 0,
    dailyLimit: 20,
    limitUpdatedAt: 0
  },

  userPrefs: {
    themeMode: 'light',
    fontSize: 'normal',
    studyLevel: 'ALL',
    studyTheme: 'ALL',
    studyMode: 'DUE',
    studySubTab: 'chunks', // 'chunks' | 'vocab' | 'conjugation'
    activeTab: 'study',
    lastCardId: null,
    autoSpeak: true,
    autoFocusType: false,
    wordLookupEnabled: false, // Strictly default OFF unless user enables
    voiceInput: {
      enabled: false,
      lang: 'es-US',
      autoSubmit: false, // Default OFF: fills input box and waits for Enter
      autoSubmitDelaySec: 3, // Default 3-second silence delay when autoSubmit is enabled
      autoAccents: true // Default ON: auto-restore Spanish accents in voice mode
    },
    vocabPrefs: {
      level: 'ALL',
      theme: 'ALL',
      direction: 'mixed',
      pool: 'both',
      length: 20,
      weakOnly: false
    },
    conjPrefs: {
      level: 'ALL',
      tense: 'present',
      category: 'ALL',
      weakOnly: false
    },
    updatedAt: 0
  },

  audioPrefs: {
    selectedVoiceName: '',
    gcpApiKey: '',
    gcpVoiceName: 'es-US-Neural2-B',
    forceGcp: false,
    updatedAt: 0
  },

  // Per-item Vocab Quiz & Verb Conjugation telemetry (stored locally + synced to Drive)
  vocabStats: {},
  verbStats: {},

  // Cached external study datasets
  vocabPack: null, // { meta, words, phrases, wordMap, wordNormMap, phraseMap, quizWords, quizPhrases }
  verbsPack: null, // { meta, verbs }

  googleAuthState: {
    clientId: DEFAULT_GOOGLE_CLIENT_ID,
    accessToken: '',
    tokenExpiresAt: 0,
    userEmail: '',
    userName: '',
    driveFileId: '',
    driveBackupFileId: '',
    lastSyncedAt: '',
    lastPayloadBytes: 0
  },
  tokenClient: null,
  driveSyncTimeout: null,
  isDriveSyncing: false,

  // Speaking Challenge State
  currentPrompt: null,
  currentRequiredChunks: [],
  timerMode: 'SPEAK_2', // 'SPEAK_2' | 'SPEAK_4' | 'SPEAK_CUSTOM' | 'PREP'
  customSpeakMinutes: 3,
  timeRemaining: 120,
  timerInterval: null
};

// Cross-module callback registry to avoid circular ESM imports
export const appHooks = {
  scheduleDriveAutoSync: () => {},
  updateStats: () => {},
  renderManageTable: () => {},
  selectNextCard: () => {},
  renderFlashcard: () => {},
  populateVoices: () => {},
  updateAudioBadgeUI: () => {},
  switchTab: () => {},
  switchStudySubTab: () => {},
  hideWordLookupPopover: () => {},
  onVocabStatsUpdated: () => {},
  onVerbStatsUpdated: () => {},
  onSharedLevelChanged: () => {},
  refreshStudySubTabOnSync: () => {},
  onVoicePrefsChanged: () => {},
  stopActiveVoiceSession: () => {}
};

// ==================== INDEXEDDB HELPERS ====================
let appDbPromise = null;
let idbWriteQueue = Promise.resolve();

export function enqueueIdbWrite(taskFn) {
  idbWriteQueue = idbWriteQueue.then(taskFn).catch((err) => {
    console.error('IndexedDB write error:', err);
  });
  return idbWriteQueue;
}

export function openAppDb() {
  if (appDbPromise) return appDbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  appDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
  return appDbPromise;
}

export async function idbGet(key) {
  const db = await openAppDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch (err) {
      resolve(undefined);
    }
  });
}

export async function idbSet(key, value) {
  const db = await openAppDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (err) {
      resolve(false);
    }
  });
}

// ==================== APPEARANCE & USER PREFS ====================
export function applyAppearancePrefs() {
  const theme = THEME_MODE_LABELS[appState.userPrefs.themeMode] ? appState.userPrefs.themeMode : 'light';
  const fontSize = ['normal', 'large', 'xlarge'].includes(appState.userPrefs.fontSize)
    ? appState.userPrefs.fontSize
    : 'normal';

  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font-size', fontSize);

  const headerBadge = document.getElementById('header-theme-badge');
  if (headerBadge) {
    headerBadge.textContent = THEME_MODE_LABELS[theme] || 'Light';
  }

  document.querySelectorAll('.theme-option-btn').forEach((btn) => {
    const isSelected = btn.dataset.themeOption === theme;
    btn.className = isSelected
      ? 'theme-option-btn text-left p-3 rounded-2xl border-2 border-indigo-500 bg-indigo-50/60 transition cursor-pointer'
      : 'theme-option-btn text-left p-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition cursor-pointer';
  });

  document.querySelectorAll('.font-size-btn').forEach((btn) => {
    const isSelected = btn.dataset.fontSize === fontSize;
    btn.className = isSelected
      ? 'font-size-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white transition cursor-pointer'
      : 'font-size-btn px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer';
  });
}

export function syncStudyModeButtonsUI(mode) {
  const dueBtn = document.getElementById('mode-due-btn');
  const allBtn = document.getElementById('mode-all-btn');
  if (!dueBtn || !allBtn) return;
  if (mode === 'DUE') {
    dueBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-indigo-700 shadow-xs transition';
    allBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
  } else {
    allBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-indigo-700 shadow-xs transition';
    dueBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
  }
}

export function resolveUnifiedStudyLevel(prefsObj) {
  const p = prefsObj || appState.userPrefs || {};
  const sLvl = normalizeStudyLevel(p.studyLevel);
  const vLvl = normalizeStudyLevel(p.vocabPrefs?.level);
  const cLvl = normalizeStudyLevel(p.conjPrefs?.level);
  if (p.sharedLevelUnified) return sLvl;
  if (sLvl !== 'ALL') return sLvl;
  if (vLvl !== 'ALL') return vLvl;
  if (cLvl !== 'ALL') return cLvl;
  return sLvl;
}

export function applySharedLevelToPrefsAndUI(levelVal) {
  const lvl = normalizeStudyLevel(levelVal);
  appState.studyLevel = lvl;
  appState.userPrefs.studyLevel = lvl;
  appState.userPrefs.sharedLevelUnified = true;
  if (!appState.userPrefs.vocabPrefs) appState.userPrefs.vocabPrefs = {};
  if (!appState.userPrefs.conjPrefs) appState.userPrefs.conjPrefs = {};
  appState.userPrefs.vocabPrefs.level = lvl;
  appState.userPrefs.conjPrefs.level = lvl;

  const levelSelect = document.getElementById('study-level-filter');
  if (levelSelect) levelSelect.value = lvl;
  const vocabLevel = document.getElementById('vocab-level-filter');
  if (vocabLevel) vocabLevel.value = lvl;
  const conjLevel = document.getElementById('conj-level-filter');
  if (conjLevel) conjLevel.value = lvl;
  return lvl;
}

export function setSharedStudyLevel(newLevel, options = {}) {
  const lvl = applySharedLevelToPrefsAndUI(newLevel);
  const triggerSync = options.triggerCloudSync !== false;
  const bumpTs = options.bumpTimestamp !== false;
  saveUserPrefs(triggerSync, bumpTs);
  if (options.notify !== false) {
    appHooks.onSharedLevelChanged(lvl, options.source || 'user');
  }
  return lvl;
}

export function normalizeVoiceInputPrefs(rawVoice) {
  const src = rawVoice && typeof rawVoice === 'object' ? rawVoice : {};
  const delayNum = Number(src.autoSubmitDelaySec);
  const clampedDelay = Number.isFinite(delayNum) ? Math.min(10, Math.max(1, Math.round(delayNum))) : 3;
  return {
    enabled: Boolean(src.enabled),
    lang: typeof src.lang === 'string' && src.lang.trim() ? src.lang.trim() : 'es-US',
    autoSubmit: Boolean(src.autoSubmit),
    autoSubmitDelaySec: clampedDelay,
    autoAccents: src.autoAccents !== false
  };
}

export function syncUserPrefsToUI() {
  const prefs = appState.userPrefs;
  const unifiedLevel = resolveUnifiedStudyLevel(prefs);
  applySharedLevelToPrefsAndUI(unifiedLevel);
  prefs.voiceInput = normalizeVoiceInputPrefs(prefs.voiceInput);

  appState.studyTheme = prefs.studyTheme || 'ALL';
  appState.studyMode = prefs.studyMode === 'ALL' ? 'ALL' : 'DUE';
  appState.autoFocusType = Boolean(prefs.autoFocusType);

  const themeSelect = document.getElementById('study-theme-filter');
  if (themeSelect) themeSelect.value = appState.studyTheme;
  syncStudyModeButtonsUI(appState.studyMode);

  const autoTts = document.getElementById('auto-tts-checkbox');
  const settingsAutoTts = document.getElementById('settings-auto-tts-checkbox');
  if (autoTts) autoTts.checked = prefs.autoSpeak !== false;
  if (settingsAutoTts) settingsAutoTts.checked = prefs.autoSpeak !== false;

  const autoFocusCb = document.getElementById('auto-focus-type-checkbox');
  const settingsAutoFocusCb = document.getElementById('settings-auto-focus-checkbox');
  if (autoFocusCb) autoFocusCb.checked = appState.autoFocusType;
  if (settingsAutoFocusCb) settingsAutoFocusCb.checked = appState.autoFocusType;

  const wordLookupCb = document.getElementById('word-lookup-checkbox');
  const settingsWordLookupCb = document.getElementById('settings-word-lookup-checkbox');
  const lookupEnabled = Boolean(prefs.wordLookupEnabled);
  if (wordLookupCb) wordLookupCb.checked = lookupEnabled;
  if (settingsWordLookupCb) settingsWordLookupCb.checked = lookupEnabled;

  // Sync Voice Input Mode controls across Study sub-tabs & Settings
  const vi = prefs.voiceInput;
  for (const id of [
    'chunks-voice-mode-checkbox',
    'vocab-voice-mode-checkbox',
    'conj-voice-mode-checkbox',
    'settings-voice-mode-checkbox'
  ]) {
    const el = document.getElementById(id);
    if (el) el.checked = vi.enabled;
  }
  const sttLangSel = document.getElementById('settings-stt-lang-select');
  if (sttLangSel) sttLangSel.value = vi.lang;
  const autoAccentsCb = document.getElementById('settings-voice-accents-checkbox');
  if (autoAccentsCb) autoAccentsCb.checked = vi.autoAccents;
  const autoSubCb = document.getElementById('settings-voice-autosubmit-checkbox');
  if (autoSubCb) autoSubCb.checked = vi.autoSubmit;
  const autoSubDelayEl = document.getElementById('settings-voice-delay-input');
  if (autoSubDelayEl) autoSubDelayEl.value = String(vi.autoSubmitDelaySec);

  // Sync Vocab Quiz filter controls if present
  const vp = prefs.vocabPrefs || {};
  const vocabTheme = document.getElementById('vocab-theme-filter');
  const vocabDir = document.getElementById('vocab-direction-select');
  const vocabPool = document.getElementById('vocab-pool-select');
  const vocabLen = document.getElementById('vocab-length-select');
  const vocabWeak = document.getElementById('vocab-weak-only-checkbox');
  if (vocabTheme && vp.theme !== undefined) vocabTheme.value = String(vp.theme);
  if (vocabDir && vp.direction !== undefined) vocabDir.value = String(vp.direction);
  if (vocabPool && vp.pool !== undefined) vocabPool.value = String(vp.pool);
  if (vocabLen && vp.length !== undefined) vocabLen.value = String(vp.length);
  if (vocabWeak) vocabWeak.checked = Boolean(vp.weakOnly);

  // Sync Conjugation filter controls if present
  const cp = prefs.conjPrefs || {};
  const conjTense = document.getElementById('conj-tense-select');
  const conjCat = document.getElementById('conj-category-select');
  const conjWeak = document.getElementById('conj-weak-only-checkbox');
  if (conjTense && cp.tense !== undefined) conjTense.value = String(cp.tense);
  if (conjCat && cp.category !== undefined) conjCat.value = String(cp.category);
  if (conjWeak) conjWeak.checked = Boolean(cp.weakOnly);

  applyAppearancePrefs();
}

export function loadUserPrefs() {
  try {
    const raw = localStorage.getItem(USER_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appState.userPrefs = {
        ...appState.userPrefs,
        ...parsed,
        voiceInput: normalizeVoiceInputPrefs({ ...appState.userPrefs.voiceInput, ...(parsed.voiceInput || {}) }),
        vocabPrefs: { ...appState.userPrefs.vocabPrefs, ...(parsed.vocabPrefs || {}) },
        conjPrefs: { ...appState.userPrefs.conjPrefs, ...(parsed.conjPrefs || {}) }
      };
      // Enforce default-off unless explicitly true
      appState.userPrefs.wordLookupEnabled = Boolean(parsed.wordLookupEnabled);
      const unified = resolveUnifiedStudyLevel(appState.userPrefs);
      appState.userPrefs.studyLevel = unified;
      appState.userPrefs.vocabPrefs.level = unified;
      appState.userPrefs.conjPrefs.level = unified;
    } else {
      const legacyFocus = localStorage.getItem(AUTO_FOCUS_TYPE_KEY);
      if (legacyFocus === 'true') {
        appState.userPrefs.autoFocusType = true;
      }
    }
  } catch (err) {
    console.error('Failed to load user prefs:', err);
  }
  syncUserPrefsToUI();
}

export function saveUserPrefs(triggerCloudSync = false, bumpTimestamp = true) {
  if (bumpTimestamp) {
    appState.userPrefs.updatedAt = Date.now();
  }
  try {
    localStorage.setItem(USER_PREFS_KEY, JSON.stringify(appState.userPrefs));
  } catch (err) {
    console.error('Failed to save user prefs:', err);
  }
  if (triggerCloudSync) {
    appHooks.scheduleDriveAutoSync();
  }
}

// ==================== DAILY PACE & SRS QUEUE ====================
export function syncDailyLimitSelectsUI() {
  const val = String(appState.dailyPace.dailyLimit || 20);
  const limitSelect = document.getElementById('daily-new-limit-select');
  const settingsLimitSelect = document.getElementById('settings-daily-limit-select');
  if (limitSelect) limitSelect.value = val;
  if (settingsLimitSelect) settingsLimitSelect.value = val;
}

export function loadDailyPace() {
  try {
    const raw = localStorage.getItem(DAILY_PACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appState.dailyPace = { ...appState.dailyPace, ...parsed };
      if (!parsed.upgradedTo20 && !parsed.limitUpdatedAt && (appState.dailyPace.dailyLimit === 10 || appState.dailyPace.dailyLimit === 15)) {
        appState.dailyPace.dailyLimit = 20;
        appState.dailyPace.upgradedTo20 = true;
        saveDailyPace(false);
      }
    }
  } catch (err) {
    console.error('Failed to load daily pace:', err);
  }
  const today = getTodayDateStr();
  if (appState.dailyPace.date !== today) {
    appState.dailyPace.date = today;
    appState.dailyPace.introducedCount = 0;
    saveDailyPace(false);
  }
  syncDailyLimitSelectsUI();
}

export function saveDailyPace(triggerCloudSync = false) {
  try {
    localStorage.setItem(DAILY_PACE_KEY, JSON.stringify(appState.dailyPace));
  } catch (err) {
    console.error('Failed to save daily pace:', err);
  }
  syncDailyLimitSelectsUI();
  appHooks.updateStats();
  if (triggerCloudSync) {
    appHooks.scheduleDriveAutoSync();
  }
}

export function getRemainingNewAllowance() {
  const today = getTodayDateStr();
  if (appState.dailyPace.date !== today) {
    appState.dailyPace.date = today;
    appState.dailyPace.introducedCount = 0;
    saveDailyPace(false);
  }
  const limit = Number(appState.dailyPace.dailyLimit) || 20;
  return Math.max(0, limit - (appState.dailyPace.introducedCount || 0));
}

export function getEffectiveDueCards(themeFilter = 'ALL', levelFilter = 'ALL') {
  const now = Date.now();
  const themeCards = appState.deck.filter(
    (c) =>
      (themeFilter === 'ALL' || c.theme === themeFilter) &&
      (levelFilter === 'ALL' || String(parseLevelNumber(c.level, 2)) === String(levelFilter))
  );

  const dueReviews = themeCards
    .filter((c) => (c.reps || 0) > 0 && (c.dueDate || 0) <= now)
    .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

  const newAllowance = getRemainingNewAllowance();
  const newCardsAvailable = themeCards
    .filter((c) => (c.reps || 0) === 0 && (c.dueDate || 0) <= now)
    .slice(0, newAllowance);

  return [...dueReviews, ...newCardsAvailable];
}

// ==================== AUDIO PREFS ====================
export function loadAudioPrefs() {
  try {
    const raw = localStorage.getItem(AUDIO_PREFS_KEY);
    if (raw) {
      appState.audioPrefs = { ...appState.audioPrefs, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('Error loading audio prefs:', err);
  }
}

export function saveAudioPrefs(triggerCloudSync = false, bumpTimestamp = true) {
  if (bumpTimestamp) {
    appState.audioPrefs.updatedAt = Date.now();
  }
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(appState.audioPrefs));
  } catch (err) {
    console.error('Error saving audio prefs:', err);
  }
  appHooks.updateAudioBadgeUI();
  if (triggerCloudSync) {
    appHooks.scheduleDriveAutoSync();
  }
}

// ==================== VOCAB & VERB TELEMETRY ====================
export function loadVocabStats() {
  try {
    const raw = localStorage.getItem(VOCAB_STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') appState.vocabStats = parsed;
    }
  } catch (err) {
    console.error('Failed to load vocab stats:', err);
  }
}

export function saveVocabStats(triggerCloudSync = false) {
  try {
    localStorage.setItem(VOCAB_STATS_KEY, JSON.stringify(appState.vocabStats));
  } catch (err) {
    console.error('Failed to save vocab stats:', err);
  }
  if (triggerCloudSync) {
    appHooks.scheduleDriveAutoSync();
  }
}

export function loadVerbStats() {
  try {
    const raw = localStorage.getItem(VERB_STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') appState.verbStats = parsed;
    }
  } catch (err) {
    console.error('Failed to load verb stats:', err);
  }
}

export function saveVerbStats(triggerCloudSync = false) {
  try {
    localStorage.setItem(VERB_STATS_KEY, JSON.stringify(appState.verbStats));
  } catch (err) {
    console.error('Failed to save verb stats:', err);
  }
  if (triggerCloudSync) {
    appHooks.scheduleDriveAutoSync();
  }
}
