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

const SPANISH_TOKEN_EXTRACT_RE = /[a-záéíóúüñ]+/gi;
const VERB_REFL_PRONS = new Set(['me', 'te', 'se', 'nos', 'os']);
let cachedVerbFormIndex = null;
let cachedVerbPackRef = null;

function cleanPhrasePunctuation(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[¿¡.,;:!?"'()]+|[¿¡.,;:!?"'()]+$/g, '');
}

export function getVerbFormLookup(verbsPack) {
  if (!verbsPack || !Array.isArray(verbsPack.verbs)) {
    return { single: new Map(), multi: new Map() };
  }
  if (cachedVerbPackRef === verbsPack && cachedVerbFormIndex) {
    return cachedVerbFormIndex;
  }

  const single = new Map();
  const multi = new Map();
  const addForm = (map, form, infinitive) => {
    if (!form) return;
    let set = map.get(form);
    if (!set) {
      set = new Set();
      map.set(form, set);
    }
    set.add(infinitive);
  };

  for (const v of verbsPack.verbs) {
    const inf = normalizeSpanishAnswer(v.infinitive);
    addForm(single, inf, v.infinitive);
    if (inf.endsWith('se') && inf.length > 3) {
      addForm(single, inf.slice(0, -2), v.infinitive);
    }
    if (v.gerund) addForm(single, normalizeSpanishAnswer(v.gerund), v.infinitive);
    if (v.participle) addForm(single, normalizeSpanishAnswer(v.participle), v.infinitive);
    const tenses = v.tenses || {};
    for (const forms of Object.values(tenses)) {
      if (!Array.isArray(forms)) continue;
      for (const f of forms) {
        const fn = normalizeSpanishAnswer(f);
        const parts = fn.split(' ');
        if (parts.length === 1) {
          addForm(single, fn, v.infinitive);
        } else {
          addForm(multi, fn, v.infinitive);
          if (parts.length === 2 && VERB_REFL_PRONS.has(parts[0])) {
            addForm(single, parts[1], v.infinitive);
          }
        }
      }
    }
  }

  cachedVerbPackRef = verbsPack;
  cachedVerbFormIndex = { single, multi };
  return cachedVerbFormIndex;
}

// Fast runtime extraction of words, phrases & verbs from user's studied/custom/due Phrase Test cards
export function getActivePhrasePriority(levelFilter = 'ALL', themeFilter = 'ALL') {
  const targetVocabKeys = new Set();
  const studiedVocabKeys = new Set();
  const sentenceVocabKeys = new Set();
  const targetVerbs = new Set();
  const studiedVerbs = new Set();
  const sentenceVerbs = new Set();

  const vocabPack = appState.vocabPack;
  const verbsPack = appState.verbsPack;
  const verbLookup = verbsPack ? getVerbFormLookup(verbsPack) : null;

  const matchingCards = appState.deck.filter((c) => {
    if (!c) return false;
    const lvlMatch = levelFilter === 'ALL' || String(c.level || 2) === String(levelFilter);
    const themeMatch = themeFilter === 'ALL' || c.theme === themeFilter;
    return lvlMatch && themeMatch;
  });

  // Always inspect all custom Preply cards & studied cards, plus first 200 upcoming cards for live responsiveness
  const seenCardIds = new Set();
  const inspectCards = [];
  for (const c of matchingCards) {
    const isCustomOrStudied = !isOfficialPackCard(c) || (c.reps || 0) > 0 || (c.updatedAt || 0) > 0;
    if (isCustomOrStudied) {
      seenCardIds.add(c.id);
      inspectCards.push(c);
    }
  }
  let extraCount = 0;
  for (const c of matchingCards) {
    if (extraCount >= 200) break;
    if (!seenCardIds.has(c.id)) {
      inspectCards.push(c);
      extraCount++;
    }
  }

  const resolveVocabWordKey = (tok) => {
    if (!vocabPack) return null;
    const entry = vocabPack.wordMap.get(tok);
    if (!entry) return null;
    const lemNorm = entry.lemma ? normalizeSpanishAnswer(entry.lemma) : tok;
    const lemEntry = vocabPack.wordMap.get(lemNorm);
    if (lemEntry && lemEntry.quiz) return lemEntry.key;
    if (entry.quiz) return entry.key;
    return null;
  };

  for (const c of inspectCards) {
    const isStudiedOrCustom = !isOfficialPackCard(c) || (c.reps || 0) > 0 || (c.updatedAt || 0) > 0;
    const tgtClean = cleanPhrasePunctuation(c.target);
    const sentClean = normalizeSpanishAnswer(c.sentence);

    if (vocabPack) {
      const phraseEntry = vocabPack.phraseMap.get(tgtClean);
      if (phraseEntry) {
        targetVocabKeys.add(phraseEntry.key);
        if (isStudiedOrCustom) studiedVocabKeys.add(phraseEntry.key);
      }

      const tgtTokens = tgtClean.match(SPANISH_TOKEN_EXTRACT_RE) || [];
      for (const t of tgtTokens) {
        const k = resolveVocabWordKey(t);
        if (k) {
          targetVocabKeys.add(k);
          if (isStudiedOrCustom) studiedVocabKeys.add(k);
        }
      }

      const sentTokens = sentClean.match(SPANISH_TOKEN_EXTRACT_RE) || [];
      for (const t of sentTokens) {
        const k = resolveVocabWordKey(t);
        if (k) {
          sentenceVocabKeys.add(k);
          if (isStudiedOrCustom) studiedVocabKeys.add(k);
        }
      }
    }

    if (verbLookup) {
      const tgtTokens = tgtClean.match(SPANISH_TOKEN_EXTRACT_RE) || [];
      for (const t of tgtTokens) {
        const matched = verbLookup.single.get(t);
        if (matched) {
          for (const inf of matched) {
            targetVerbs.add(inf);
            if (isStudiedOrCustom) studiedVerbs.add(inf);
          }
        }
      }

      const sentTokens = sentClean.match(SPANISH_TOKEN_EXTRACT_RE) || [];
      for (const t of sentTokens) {
        const matched = verbLookup.single.get(t);
        if (matched) {
          for (const inf of matched) {
            sentenceVerbs.add(inf);
            if (isStudiedOrCustom) studiedVerbs.add(inf);
          }
        }
      }
    }
  }

  return {
    targetVocabKeys,
    studiedVocabKeys,
    sentenceVocabKeys,
    targetVerbs,
    studiedVerbs,
    sentenceVerbs
  };
}

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
    const baseLvl = Number(info.level) || 1;
    const levels = Array.isArray(info.levels) && info.levels.length > 0 ? info.levels.map(Number) : [baseLvl];
    const targetLevels = Array.isArray(info.targetLevels) ? info.targetLevels.map(Number) : [];
    const phraseFreq = Number(info.phraseFreq) || 0;
    const entry = { key: `w:${norm}`, es: token, ...info, levels, targetLevels, phraseFreq };
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
        level: baseLvl,
        levels,
        targetLevels,
        phraseFreq,
        themes: Array.isArray(info.themes) ? info.themes : []
      });
    }
  }

  for (const [key, info] of Object.entries(phrases)) {
    if (!info || !info.en) continue;
    const norm = normalizeSpanishAnswer(key);
    const bare = stripSpanishDiacritics(norm);
    const baseLvl = Number(info.level) || 1;
    const levels = Array.isArray(info.levels) && info.levels.length > 0 ? info.levels.map(Number) : [baseLvl];
    const targetLevels = Array.isArray(info.targetLevels) ? info.targetLevels.map(Number) : [];
    const phraseFreq = Number(info.phraseFreq) || 0;
    const entry = { key: `p:${norm}`, es: info.es || key, ...info, levels, targetLevels, phraseFreq };
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
        level: baseLvl,
        levels,
        targetLevels,
        phraseFreq,
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
        if (cached && cached.words && cached.phrases && cached.meta?.version === 2) {
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
        if (cached && Array.isArray(cached.verbs) && cached.meta?.version === 2) {
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
