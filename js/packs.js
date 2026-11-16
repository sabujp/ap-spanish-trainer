import {
  BOOTSTRAP_SAMPLE_DECK,
  IDB_DECK_KEY,
  IDB_VERBS_KEY,
  IDB_VOCAB_KEY,
  LOADED_PACKS_KEY,
  DELETED_IDS_KEY,
  OFFICIAL_PACK_CATALOG,
  OFFICIAL_PACK_URLS,
  STORAGE_KEY,
  VERBS_PACK_URL,
  VOCAB_PACK_URL,
  normalizeSpanishAnswer,
  stripSpanishDiacritics
} from './constants.js';
import { appHooks, appState, enqueueIdbWrite, idbGet, idbSet } from './storage.js';
import { showToast, updateStats } from './ui.js';

let vocabLoadPromise = null;
let verbsLoadPromise = null;

export function isOfficialPackCard(card) {
  if (!card || !card.id) return false;
  return /^g(?:9|10|11|12)-(?:boot-)?\d+$/.test(card.id) || Boolean(card.fromOfficialPack);
}

export function normalizeOfficialCardLevels(cards) {
  if (!Array.isArray(cards)) return;
  cards.forEach((c) => {
    if (!c || !c.id) return;
    if (/^g9-/.test(c.id)) c.level = 1;
    else if (/^g10-/.test(c.id)) c.level = 2;
    else if (/^g11-/.test(c.id)) c.level = 3;
    else if (/^g12-/.test(c.id)) c.level = 4;
  });
}

export function saveLoadedPackUrls() {
  try {
    localStorage.setItem(LOADED_PACKS_KEY, JSON.stringify([...appState.loadedPackUrls]));
  } catch (err) {
    console.error('Failed to save loaded pack URLs:', err);
  }
}

export function pruneUnstudiedBootstrapCards() {
  const hasFullG9 = appState.deck.some((c) => /^g9-\d+$/.test(c.id));
  if (!hasFullG9) return false;
  const beforeLen = appState.deck.length;
  appState.deck = appState.deck.filter((c) => {
    if (!/^g9-boot-\d+$/.test(c.id)) return true;
    return (c.reps || 0) > 0 || (c.interval || 0) > 0 || (c.updatedAt || 0) > 0;
  });
  return appState.deck.length !== beforeLen;
}

export function getMissingOrOutdatedOfficialPacks() {
  return OFFICIAL_PACK_CATALOG.filter((pack) => {
    let presentCount = 0;
    for (const c of appState.deck) {
      if (c && c.id && pack.regex.test(c.id)) presentCount++;
    }
    let deletedCount = 0;
    for (const id of appState.deletedCardIds) {
      if (pack.regex.test(id)) deletedCount++;
    }
    return presentCount + deletedCount < 7000;
  });
}

export function saveDeck(triggerCloudSync = true) {
  try {
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...appState.deletedCardIds]));
    saveLoadedPackUrls();
  } catch (err) {
    console.error('Failed to save metadata to localStorage:', err);
  }

  const snapshot = appState.deck;
  enqueueIdbWrite(async () => {
    const ok = await idbSet(IDB_DECK_KEY, snapshot);
    if (!ok) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (lsErr) {
        console.error('Fallback localStorage save failed (likely quota exceeded):', lsErr);
      }
    }
  });

  updateStats();
  if (triggerCloudSync) {
    appHooks.scheduleDriveAutoSync();
  }
}

export function mergeImportedCardsArray(imported, sourceLabel = 'deck', silent = false, options = {}) {
  if (!Array.isArray(imported)) {
    throw new Error('Invalid JSON structure: expected an array of cards.');
  }
  const isOfficialPack = Boolean(options.isOfficialPack);
  const respectDeleted = Boolean(options.respectDeleted);
  const skipSave = Boolean(options.skipSave);
  const defaultCreatedAt = Number(options.defaultUpdatedAt) || 0;
  const now = Date.now();
  const existingById = new Map(appState.deck.map((c) => [c.id, c]));
  const existingSentences = new Set(appState.deck.map((c) => c.sentence.toLowerCase().trim()));
  let mergedCount = 0;

  imported.forEach((item) => {
    if (!item || !item.sentence || !item.target || !item.hint) return;
    if (respectDeleted && item.id && appState.deletedCardIds.has(item.id)) return;
    const existing = item.id ? existingById.get(item.id) : null;
    if (existing) {
      if (isOfficialPack && item.level && Number(existing.level) !== Number(item.level)) {
        existing.level = Number(item.level);
      }
      return;
    }

    const sentenceKey = item.sentence.toLowerCase().trim();
    if (existingSentences.has(sentenceKey)) return;

    const newId = item.id || `imp-${now}-${Math.random().toString(36).slice(2, 6)}`;
    appState.deletedCardIds.delete(newId);
    const cardObj = {
      id: newId,
      level: Number(item.level) || 1,
      sentence: item.sentence,
      target: item.target,
      hint: item.hint,
      theme: item.theme || 'Argument & Connectors',
      notes: item.notes || '',
      interval: Number(item.interval) || 0,
      ease: Number(item.ease) || 2.5,
      reps: Number(item.reps) || 0,
      dueDate: Number(item.dueDate) || now,
      updatedAt: Number(item.updatedAt) || defaultCreatedAt
    };
    if (isOfficialPack) {
      cardObj.fromOfficialPack = true;
    }
    appState.deck.push(cardObj);
    existingById.set(newId, cardObj);
    existingSentences.add(sentenceKey);
    mergedCount++;
  });

  if (!skipSave) {
    saveDeck(!silent);
    const tabManage = document.getElementById('tab-manage');
    if (tabManage && !tabManage.classList.contains('hidden')) {
      appHooks.renderManageTable();
    }
    appHooks.selectNextCard();
  }
  if (!silent) {
    const hasToken = Boolean(
      appState.googleAuthState.accessToken && Date.now() < appState.googleAuthState.tokenExpiresAt - 30000
    );
    const driveNote = hasToken ? ' & synced to Google Drive' : '';
    showToast(`Merged ${mergedCount.toLocaleString()} new card(s) from ${sourceLabel}${driveNote}!`, 'success');
  }
  return mergedCount;
}

export async function fetchAndMergeRemoteJsonPack(url, label, silent = false) {
  if (!url) {
    if (!silent) showToast('Enter a valid .json URL first.', 'error');
    return;
  }
  try {
    if (!silent) showToast(`Fetching ${label || url}...`, 'info');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`File not found (HTTP ${res.status}). Upload ${url} to your GitHub/Netlify /packs/ folder or use Import (.json).`);
    }
    const data = await res.json();
    const cardsArray = Array.isArray(data) ? data : data.cards || data.deck;
    const isOfficial = OFFICIAL_PACK_URLS.includes(url);
    if (isOfficial) {
      appState.loadedPackUrls.add(url);
    }
    mergeImportedCardsArray(cardsArray, label || url, silent, {
      isOfficialPack: isOfficial,
      defaultUpdatedAt: isOfficial ? 0 : Date.now()
    });
  } catch (err) {
    if (!silent) showToast(err.message, 'error');
  }
}

export async function ensureAllOfficialPacksLoaded(triggerCloudSync = false) {
  const missingPacks = getMissingOrOutdatedOfficialPacks();
  if (missingPacks.length === 0) {
    if (pruneUnstudiedBootstrapCards()) {
      saveDeck(false);
    }
    return;
  }

  const fetched = await Promise.all(
    missingPacks.map(async (pack) => {
      try {
        const res = await fetch(pack.url);
        if (!res.ok) return null;
        const data = await res.json();
        const cardsArray = Array.isArray(data) ? data : data.cards || data.deck;
        return Array.isArray(cardsArray) ? { pack, cardsArray } : null;
      } catch {
        return null;
      }
    })
  );

  let anyUpdated = false;
  for (const item of fetched) {
    if (!item) continue;
    appState.loadedPackUrls.add(item.pack.url);
    const mergedCount = mergeImportedCardsArray(item.cardsArray, item.pack.label, true, {
      isOfficialPack: true,
      defaultUpdatedAt: 0,
      respectDeleted: true,
      skipSave: true
    });
    if (mergedCount > 0) anyUpdated = true;
  }

  if (pruneUnstudiedBootstrapCards()) {
    anyUpdated = true;
  }
  normalizeOfficialCardLevels(appState.deck);

  if (anyUpdated) {
    saveDeck(triggerCloudSync);
    const tabManage = document.getElementById('tab-manage');
    if (tabManage && !tabManage.classList.contains('hidden')) {
      appHooks.renderManageTable();
    }
    appHooks.selectNextCard();
  }
}

export async function loadDeck() {
  try {
    const rawDeleted = localStorage.getItem(DELETED_IDS_KEY);
    if (rawDeleted) {
      appState.deletedCardIds = new Set(JSON.parse(rawDeleted));
    }
  } catch (err) {
    console.error('Failed to load deleted IDs:', err);
  }

  try {
    const rawLoadedPacks = localStorage.getItem(LOADED_PACKS_KEY);
    if (rawLoadedPacks) {
      appState.loadedPackUrls = new Set(JSON.parse(rawLoadedPacks));
    }
  } catch (err) {
    console.error('Failed to load loadedPackUrls:', err);
  }

  try {
    const idbDeck = await idbGet(IDB_DECK_KEY);
    if (Array.isArray(idbDeck) && idbDeck.length > 0) {
      appState.deck = idbDeck.filter((c) => !appState.deletedCardIds.has(c.id));
      normalizeOfficialCardLevels(appState.deck);
      const pruned = pruneUnstudiedBootstrapCards();
      if (getMissingOrOutdatedOfficialPacks().length > 0) {
        await ensureAllOfficialPacksLoaded(false);
      } else if (pruned) {
        saveDeck(false);
      }
      return;
    }
  } catch (err) {
    console.error('Failed to load deck from IndexedDB:', err);
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        appState.deck = parsed.filter((c) => !appState.deletedCardIds.has(c.id));
        normalizeOfficialCardLevels(appState.deck);
        const savedToIdb = await idbSet(IDB_DECK_KEY, appState.deck);
        if (savedToIdb) {
          localStorage.removeItem(STORAGE_KEY);
        }
        await ensureAllOfficialPacksLoaded(false);
        return;
      }
    }
  } catch (err) {
    console.error('Failed to migrate deck from localStorage:', err);
  }

  appState.deck = JSON.parse(JSON.stringify(BOOTSTRAP_SAMPLE_DECK))
    .filter((c) => !appState.deletedCardIds.has(c.id))
    .map((c) => ({
      ...c,
      dueDate: Date.now(),
      updatedAt: 0
    }));
  saveDeck(false);

  try {
    await ensureAllOfficialPacksLoaded(false);
  } catch {
    // Ignore when opened over file://
  }
}

// ==================== VOCABULARY & VERBS PACK LOADERS ====================
const META_GRAMMAR_PHRASE_RE =
  /^(conditional|hypothetical|imperfect|preterite|present|subjunctive|gerund|passive|participle|indicative)\b.*(clause|tense|phrase|form)$/i;

function indexVocabularyData(raw) {
  const words = raw.words || {};
  const phrases = raw.phrases || {};
  const wordMap = new Map();
  const wordNormMap = new Map();
  const phraseMap = new Map();
  const phraseNormMap = new Map();
  const quizWords = [];
  const quizPhrases = [];

  for (const [token, info] of Object.entries(words)) {
    if (!info || !info.en) continue;
    const norm = normalizeSpanishAnswer(token);
    const bare = stripSpanishDiacritics(norm);
    const entry = { key: `w:${norm}`, es: token, ...info };
    wordMap.set(norm, entry);
    if (!wordNormMap.has(bare)) {
      wordNormMap.set(bare, entry);
    }
    if (info.quiz) {
      quizWords.push({
        key: `w:${norm}`,
        type: 'word',
        es: token,
        en: info.en,
        pos: info.pos || 'word',
        lemma: info.lemma || token,
        level: Number(info.level) || 1,
        themes: Array.isArray(info.themes) ? info.themes : []
      });
    }
  }

  for (const [key, info] of Object.entries(phrases)) {
    if (!info || !info.en) continue;
    const norm = normalizeSpanishAnswer(key);
    const bare = stripSpanishDiacritics(norm);
    const entry = { key: `p:${norm}`, es: info.es || key, ...info };
    phraseMap.set(norm, entry);
    if (!phraseNormMap.has(bare)) {
      phraseNormMap.set(bare, entry);
    }
    if (info.quiz && !META_GRAMMAR_PHRASE_RE.test(info.en.trim())) {
      quizPhrases.push({
        key: `p:${norm}`,
        type: 'phrase',
        es: info.es || key,
        en: info.en,
        pos: 'phrase',
        lemma: '',
        level: Number(info.level) || 1,
        themes: Array.isArray(info.themes) ? info.themes : []
      });
    }
  }

  return {
    meta: raw.meta || {},
    words,
    phrases,
    wordMap,
    wordNormMap,
    phraseMap,
    phraseNormMap,
    quizWords,
    quizPhrases
  };
}

export async function loadVocabularyPack(forceReload = false) {
  if (!forceReload && appState.vocabPack) {
    return appState.vocabPack;
  }
  if (!forceReload && vocabLoadPromise) {
    return vocabLoadPromise;
  }

  vocabLoadPromise = (async () => {
    try {
      if (!forceReload) {
        const cached = await idbGet(IDB_VOCAB_KEY);
        if (cached && cached.words && cached.phrases && cached.meta?.version === 1) {
          appState.vocabPack = indexVocabularyData(cached);
          return appState.vocabPack;
        }
      }

      const res = await fetch(VOCAB_PACK_URL);
      if (!res.ok) throw new Error(`Failed to fetch ${VOCAB_PACK_URL} (HTTP ${res.status})`);
      const raw = await res.json();
      await idbSet(IDB_VOCAB_KEY, raw);
      appState.vocabPack = indexVocabularyData(raw);
      return appState.vocabPack;
    } catch (err) {
      console.error('Error loading vocabulary pack:', err);
      throw err;
    } finally {
      vocabLoadPromise = null;
    }
  })();

  return vocabLoadPromise;
}

export async function loadVerbsPack(forceReload = false) {
  if (!forceReload && appState.verbsPack) {
    return appState.verbsPack;
  }
  if (!forceReload && verbsLoadPromise) {
    return verbsLoadPromise;
  }

  verbsLoadPromise = (async () => {
    try {
      if (!forceReload) {
        const cached = await idbGet(IDB_VERBS_KEY);
        if (cached && Array.isArray(cached.verbs) && cached.meta?.version === 1) {
          appState.verbsPack = cached;
          return appState.verbsPack;
        }
      }

      const res = await fetch(VERBS_PACK_URL);
      if (!res.ok) throw new Error(`Failed to fetch ${VERBS_PACK_URL} (HTTP ${res.status})`);
      const raw = await res.json();
      await idbSet(IDB_VERBS_KEY, raw);
      appState.verbsPack = raw;
      return appState.verbsPack;
    } catch (err) {
      console.error('Error loading verbs pack:', err);
      throw err;
    } finally {
      verbsLoadPromise = null;
    }
  })();

  return verbsLoadPromise;
}
