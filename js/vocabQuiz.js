import {
  LEVEL_BADGES,
  SPANISH_ACCENT_CHARS,
  escapeHtml,
  normalizeSpanishAnswer,
  stripSpanishDiacritics
} from './constants.js';
import { speakSpanish } from './audio.js';
import { getActivePhrasePriority, loadVerbsPack, loadVocabularyPack } from './packs.js';
import {
  cancelAutoSubmitCountdown,
  getVoicePrefs,
  isSpeechRecognitionSupported,
  scheduleAutoSubmitCountdown,
  setVoiceModeEnabled,
  startSingleShotVoiceInput,
  stopSpeechSession
} from './speechInput.js';
import { appHooks, appState, saveUserPrefs, saveVocabStats, setSharedStudyLevel } from './storage.js';
import { showToast } from './ui.js';

const quizState = {
  items: [],
  index: 0,
  targetLength: 20, // 0 = endless
  results: [], // { item, direction, typed, status, expected }
  currentDirection: 'es_en',
  answered: false,
  lastGrade: null, // { status, typed, expected }
  draftInput: '',
  streak: 0,
  correctCount: 0,
  answeredCount: 0,
  loading: false,
  error: '',
  isSummary: false,
  builtForLevel: null
};

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getPrefs() {
  if (!appState.userPrefs.vocabPrefs) {
    appState.userPrefs.vocabPrefs = {
      level: 'ALL',
      theme: 'ALL',
      direction: 'mixed',
      pool: 'both',
      length: 20,
      weakOnly: false
    };
  }
  return appState.userPrefs.vocabPrefs;
}

function stripEnglishNoise(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,;:!?"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildEnglishAcceptedVariants(rawEn) {
  const variants = new Set();
  const addVariant = (txt) => {
    const clean = stripEnglishNoise(txt);
    if (!clean) return;
    variants.add(clean);
    const noTo = clean.replace(/^to\s+/, '').trim();
    if (noTo) variants.add(noTo);
    const noArticle = clean.replace(/^(?:a|an|the)\s+/, '').trim();
    if (noArticle) variants.add(noArticle);
    const noPrep = clean.replace(/\s+(?:of|for|to|at|on|in|with)$/g, '').trim();
    if (noPrep && noPrep.length >= 2) variants.add(noPrep);
  };

  addVariant(rawEn);
  // Split slash / semicolon / comma gloss alternatives
  const noParens = String(rawEn || '').replace(/\([^)]*\)/g, '');
  for (const part of noParens.split(/[\/;|,]+/)) {
    addVariant(part);
    for (const orPart of part.split(/\bor\b/i)) {
      addVariant(orPart);
    }
  }
  return variants;
}

function gradeEnglishResponse(typedRaw, expectedEn) {
  const cleanTyped = stripEnglishNoise(typedRaw);
  if (!cleanTyped) return 'wrong';
  const accepted = buildEnglishAcceptedVariants(expectedEn);
  if (accepted.has(cleanTyped)) return 'exact';

  const typedNoTo = cleanTyped.replace(/^to\s+/, '').trim();
  const typedNoArt = cleanTyped.replace(/^(?:a|an|the)\s+/, '').trim();
  if (accepted.has(typedNoTo) || accepted.has(typedNoArt)) {
    return 'exact';
  }
  return 'wrong';
}

function gradeSpanishResponse(typedRaw, expectedEs) {
  const clean = (s) =>
    normalizeSpanishAnswer(s).replace(/^[¿¡.,;:!?"'()]+|[¿¡.,;:!?"'()]+$/g, '').trim();
  const normTyped = clean(typedRaw);
  const normExp = clean(expectedEs);
  if (!normTyped) return 'wrong';
  if (normTyped === normExp) return 'exact';
  if (stripSpanishDiacritics(normTyped) === stripSpanishDiacritics(normExp)) {
    return 'accent';
  }
  return 'wrong';
}

function pickDirectionForItem(dirSetting, idx) {
  if (dirSetting === 'es_en') return 'es_en';
  if (dirSetting === 'en_es') return 'en_es';
  return idx % 2 === 0 ? 'es_en' : 'en_es';
}

function buildFilteredVocabPool() {
  const pack = appState.vocabPack;
  if (!pack) return [];
  const prefs = getPrefs();
  const activeLevel = String(prefs.level || appState.studyLevel || 'ALL');
  const lvlNum = activeLevel === 'ALL' ? null : Number(activeLevel);
  const priority = getActivePhrasePriority(activeLevel, prefs.theme);

  let rawPool = [];
  if (prefs.pool === 'words') {
    rawPool = pack.quizWords;
  } else if (prefs.pool === 'phrases') {
    rawPool = pack.quizPhrases;
  } else {
    rawPool = [...pack.quizWords, ...pack.quizPhrases];
  }

  let filtered = rawPool.filter((item) => {
    const inLivePhrase =
      priority.targetVocabKeys.has(item.key) || priority.sentenceVocabKeys.has(item.key);
    const matchLevel =
      activeLevel === 'ALL' ||
      (Array.isArray(item.levels) ? item.levels.includes(lvlNum) : String(item.level) === activeLevel) ||
      inLivePhrase;
    const matchTheme =
      prefs.theme === 'ALL' ||
      (Array.isArray(item.themes) && item.themes.includes(prefs.theme)) ||
      inLivePhrase;
    return matchLevel && matchTheme;
  });

  if (prefs.weakOnly) {
    filtered = filtered.filter((item) => {
      const st = appState.vocabStats[item.key];
      return st && (st.wrong || 0) > 0 && (st.streak || 0) < 2;
    });
  }

  return filtered.map((item) => {
    const isStudiedPhrase = priority.studiedVocabKeys.has(item.key);
    const isTargetPhrase =
      priority.targetVocabKeys.has(item.key) ||
      (lvlNum === null ? (item.targetLevels || []).length > 0 : (item.targetLevels || []).includes(lvlNum));
    const isSentencePhrase = priority.sentenceVocabKeys.has(item.key) || (item.phraseFreq || 0) > 0;
    return {
      ...item,
      _isStudiedPhrase: isStudiedPhrase,
      _isTargetPhrase: isTargetPhrase,
      _inPhraseTests: isStudiedPhrase || isTargetPhrase || isSentencePhrase
    };
  });
}

function selectWeightedVocabItems(pool, targetLen) {
  if (pool.length === 0) return [];
  const studiedOrTarget = shuffleArray(pool.filter((i) => i._isStudiedPhrase || i._isTargetPhrase));
  const sentenceMatch = shuffleArray(
    pool.filter((i) => !i._isStudiedPhrase && !i._isTargetPhrase && i._inPhraseTests)
  );
  const otherItems = shuffleArray(pool.filter((i) => !i._inPhraseTests));
  const phraseBacked = [...studiedOrTarget, ...sentenceMatch];

  if (targetLen <= 0 || pool.length <= targetLen) {
    // Keep phrase-backed items heavily weighted toward the front in endless/small pools
    return shuffleArray([...phraseBacked.slice(0, Math.ceil(phraseBacked.length * 0.75)), ...otherItems]).concat(
      phraseBacked.slice(Math.ceil(phraseBacked.length * 0.75))
    );
  }

  // Mix ~70% from Phrase Tests (studied & target phrases first) + ~30% from other matching vocab
  const wantOther = Math.min(otherItems.length, Math.floor(targetLen * 0.3));
  const wantPhrase = Math.min(phraseBacked.length, targetLen - wantOther);
  const chosenPhrase = phraseBacked.slice(0, wantPhrase);
  const chosenOther = otherItems.slice(0, targetLen - chosenPhrase.length);
  const shortfall = targetLen - (chosenPhrase.length + chosenOther.length);
  const extraPhrase = shortfall > 0 ? phraseBacked.slice(chosenPhrase.length, chosenPhrase.length + shortfall) : [];
  return shuffleArray([...chosenPhrase, ...chosenOther, ...extraPhrase]);
}

export async function startVocabRound(customItems = null) {
  stopSpeechSession();
  const area = document.getElementById('vocab-quiz-area');
  if (!appState.vocabPack) {
    quizState.loading = true;
    quizState.error = '';
    renderVocabQuiz();
    try {
      await loadVocabularyPack();
    } catch (err) {
      quizState.loading = false;
      quizState.error = err.message || 'Failed to load vocabulary dictionary.';
      renderVocabQuiz();
      return;
    }
    quizState.loading = false;
  }

  const prefs = getPrefs();
  const activeLevel = String(prefs.level || appState.studyLevel || 'ALL');
  const pool = Array.isArray(customItems) ? customItems : buildFilteredVocabPool();
  const targetLen = Number(prefs.length) || 0;
  const chosen = Array.isArray(customItems) ? shuffleArray(pool) : selectWeightedVocabItems(pool, targetLen);

  quizState.builtForLevel = activeLevel;
  quizState.targetLength = customItems ? chosen.length : targetLen;
  quizState.items = chosen;
  quizState.index = 0;
  quizState.results = [];
  quizState.answered = false;
  quizState.lastGrade = null;
  quizState.draftInput = '';
  quizState.streak = 0;
  quizState.correctCount = 0;
  quizState.answeredCount = 0;
  quizState.isSummary = false;
  quizState.currentDirection = pickDirectionForItem(prefs.direction, 0);

  if (area) renderVocabQuiz();
}

function submitVocabAnswer(skipAsReveal = false) {
  if (quizState.answered || quizState.isSummary) return;
  stopSpeechSession();
  const item = quizState.items[quizState.index];
  if (!item) return;

  const input = document.getElementById('vocab-answer-input');
  const typed = skipAsReveal ? '' : (input ? input.value.trim() : '');
  quizState.draftInput = '';
  const dir = quizState.currentDirection;
  const expected = dir === 'es_en' ? item.en : item.es;
  const status = skipAsReveal
    ? 'wrong'
    : dir === 'es_en'
      ? gradeEnglishResponse(typed, item.en)
      : gradeSpanishResponse(typed, item.es);

  const isPass = status === 'exact' || status === 'accent';
  const prevStat = appState.vocabStats[item.key] || {
    right: 0,
    wrong: 0,
    streak: 0,
    lastSeen: 0,
    updatedAt: 0
  };
  const now = Date.now();
  appState.vocabStats[item.key] = {
    right: (prevStat.right || 0) + (isPass ? 1 : 0),
    wrong: (prevStat.wrong || 0) + (isPass ? 0 : 1),
    streak: isPass ? (prevStat.streak || 0) + 1 : 0,
    lastSeen: now,
    updatedAt: now
  };
  saveVocabStats(true);

  quizState.answered = true;
  quizState.lastGrade = { status, typed, expected };
  quizState.answeredCount += 1;
  if (isPass) {
    quizState.correctCount += 1;
    quizState.streak += 1;
  } else {
    quizState.streak = 0;
  }
  quizState.results.push({ item, direction: dir, typed, status, expected });

  renderVocabQuiz();
  if (dir === 'en_es') {
    speakSpanish(item.es, 1.0);
  }
}

function advanceVocabQuestion() {
  if (!quizState.answered) return;
  stopSpeechSession();
  const prefs = getPrefs();
  quizState.index += 1;

  if (quizState.index >= quizState.items.length) {
    if (quizState.targetLength === 0) {
      // Endless mode: reshuffle a fresh batch seamlessly
      const fresh = selectWeightedVocabItems(buildFilteredVocabPool(), 0);
      if (fresh.length === 0) {
        quizState.isSummary = true;
      } else {
        quizState.items = fresh;
        quizState.index = 0;
      }
    } else {
      quizState.isSummary = true;
    }
  }

  quizState.answered = false;
  quizState.lastGrade = null;
  quizState.draftInput = '';
  quizState.currentDirection = pickDirectionForItem(prefs.direction, quizState.index);
  renderVocabQuiz();
}

export function renderVocabQuiz() {
  const container = document.getElementById('vocab-quiz-area');
  if (!container) return;

  if (quizState.loading) {
    container.innerHTML = `<div class="my-auto text-center py-10 text-sm text-slate-500">Loading local vocabulary bank (2,492 words &amp; 536 phrases)...</div>`;
    return;
  }

  if (quizState.error) {
    container.innerHTML = `
      <div class="my-auto text-center py-8 space-y-3">
        <div class="text-sm font-bold text-rose-700">${escapeHtml(quizState.error)}</div>
        <button id="vocab-retry-load-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer">Retry Load</button>
      </div>`;
    document.getElementById('vocab-retry-load-btn').onclick = () => startVocabRound();
    return;
  }

  if (!appState.vocabPack) {
    container.innerHTML = `<div class="my-auto text-center py-10 text-sm text-slate-500">Preparing Vocab Test...</div>`;
    return;
  }

  const prefs = getPrefs();

  if (quizState.items.length === 0) {
    container.innerHTML = `
      <div class="my-auto text-center py-8 space-y-4 max-w-md mx-auto">
        <div class="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center mx-auto text-2xl font-bold">Aa</div>
        <h3 class="text-lg font-extrabold text-slate-900">No Matching Vocabulary Items</h3>
        <p class="text-xs sm:text-sm text-slate-500 leading-relaxed">
          ${prefs.weakOnly
            ? 'Great news — you currently have no weak or missed vocabulary items in this filter! Uncheck "Weak Only" or pick another filter.'
            : 'No vocabulary items match your selected Level, Theme, and Pool filters.'}
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          ${prefs.weakOnly
            ? `<button id="vocab-clear-weak-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">Show All Matching Items</button>`
            : `<button id="vocab-reset-filters-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">Reset Filters</button>`}
        </div>
      </div>`;
    const clearWeak = document.getElementById('vocab-clear-weak-btn');
    if (clearWeak) {
      clearWeak.onclick = () => {
        prefs.weakOnly = false;
        const cb = document.getElementById('vocab-weak-only-checkbox');
        if (cb) cb.checked = false;
        saveUserPrefs(true, true);
        startVocabRound();
      };
    }
    const resetBtn = document.getElementById('vocab-reset-filters-btn');
    if (resetBtn) {
      resetBtn.onclick = () => {
        prefs.theme = 'ALL';
        prefs.pool = 'both';
        document.getElementById('vocab-theme-filter').value = 'ALL';
        document.getElementById('vocab-pool-select').value = 'both';
        setSharedStudyLevel('ALL', { source: 'vocab', notify: false });
        startVocabRound();
      };
    }
    return;
  }

  if (quizState.isSummary) {
    const total = quizState.answeredCount;
    const pct = total > 0 ? Math.round((quizState.correctCount / total) * 100) : 0;
    const missed = quizState.results.filter((r) => r.status === 'wrong');

    container.innerHTML = `
      <div class="space-y-6">
        <div class="text-center space-y-2 border-b border-slate-100 pb-5">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold">
            Vocab Test Complete
          </div>
          <div class="text-4xl font-extrabold text-slate-900">${quizState.correctCount} / ${total} <span class="text-indigo-600">(${pct}%)</span></div>
          <p class="text-xs text-slate-500">All answers typed from recall — progress saved &amp; synced.</p>
        </div>

        ${
          missed.length > 0
            ? `<div class="space-y-2">
                <h4 class="text-xs font-bold uppercase tracking-wider text-rose-700">Missed Items (${missed.length})</h4>
                <div class="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl">
                  ${missed
                    .map(
                      (m) => `
                    <div class="p-3 flex items-center justify-between gap-3 text-xs">
                      <div class="min-w-0">
                        <span class="font-bold text-slate-900">${escapeHtml(m.item.es)}</span>
                        <span class="text-slate-400 mx-1.5">↔</span>
                        <span class="font-semibold text-emerald-700">${escapeHtml(m.item.en)}</span>
                        ${m.typed ? `<div class="text-[11px] text-rose-600 mt-0.5">You typed: "${escapeHtml(m.typed)}"</div>` : ''}
                      </div>
                      <button type="button" class="vocab-summary-speak px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-700 text-xs shrink-0 cursor-pointer" data-es="${escapeHtml(m.item.es)}">🔊</button>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>`
            : `<div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center text-sm font-bold text-emerald-900">
                ¡Perfecto! Zero missed items in this round.
              </div>`
        }

        <div class="flex flex-wrap justify-center gap-3 pt-2">
          ${
            missed.length > 0
              ? `<button id="vocab-practice-missed-btn" type="button" class="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs sm:text-sm font-bold shadow-xs transition cursor-pointer">
                  Practice ${missed.length} Missed Word${missed.length === 1 ? '' : 's'}
                </button>`
              : ''
          }
          <button id="vocab-new-round-btn" type="button" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold shadow-xs transition cursor-pointer">
            ↻ Start New Test
          </button>
        </div>
      </div>`;

    container.querySelectorAll('.vocab-summary-speak').forEach((btn) => {
      btn.onclick = () => speakSpanish(btn.dataset.es || '', 1.0);
    });
    const missedBtn = document.getElementById('vocab-practice-missed-btn');
    if (missedBtn) {
      missedBtn.onclick = () => startVocabRound(missed.map((m) => m.item));
    }
    document.getElementById('vocab-new-round-btn').onclick = () => startVocabRound();
    return;
  }

  const item = quizState.items[quizState.index];
  const dir = quizState.currentDirection;
  const activeLvlNum = Number(prefs.level || appState.studyLevel);
  const badgeLvl = activeLvlNum >= 1 && activeLvlNum <= 4 ? activeLvlNum : item.level || 1;
  const lvlBadge = LEVEL_BADGES[badgeLvl] || LEVEL_BADGES[1];
  const phraseOriginBadge = item._isStudiedPhrase
    ? `<span class="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold" title="Taken directly from cards you studied or added">★ In Your Phrases</span>`
    : item._inPhraseTests
      ? `<span class="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold" title="Appears in the Phrase Tests at this level">✓ In Phrase Tests</span>`
      : '';
  const progressLabel =
    quizState.targetLength > 0
      ? `Question ${quizState.index + 1} / ${quizState.items.length}`
      : `Question ${quizState.answeredCount + (quizState.answered ? 0 : 1)} (Endless)`;
  const pctDone =
    quizState.targetLength > 0
      ? Math.round(((quizState.index + (quizState.answered ? 1 : 0)) / quizState.items.length) * 100)
      : 0;
  const dirLabel = dir === 'es_en' ? 'Spanish → English' : 'English → Spanish';
  const promptMain = dir === 'es_en' ? item.es : item.en;
  const themeDisplay = item.themes && item.themes.length > 0 ? item.themes[0] : 'General AP';

  const inputClass = !quizState.answered
    ? 'vocab-input w-full max-w-lg mx-auto block rounded-2xl border-2 border-indigo-200 bg-slate-50 px-4 py-3 text-center text-base sm:text-lg font-bold text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 focus:outline-none transition'
    : quizState.lastGrade.status === 'exact'
      ? 'vocab-input is-correct w-full max-w-lg mx-auto block rounded-2xl border-2 px-4 py-3 text-center text-base sm:text-lg font-bold focus:outline-none'
      : quizState.lastGrade.status === 'accent'
        ? 'vocab-input is-accent w-full max-w-lg mx-auto block rounded-2xl border-2 px-4 py-3 text-center text-base sm:text-lg font-bold focus:outline-none'
        : 'vocab-input is-wrong w-full max-w-lg mx-auto block rounded-2xl border-2 px-4 py-3 text-center text-base sm:text-lg font-bold focus:outline-none';

  let feedbackHtml = '';
  if (quizState.answered && quizState.lastGrade) {
    const { status, expected, typed } = quizState.lastGrade;
    if (status === 'exact') {
      feedbackHtml = `
        <div class="max-w-lg mx-auto bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-emerald-900 font-semibold">
          ✓ ¡Correcto! Accepted: <strong>${escapeHtml(expected)}</strong>
        </div>`;
    } else if (status === 'accent') {
      feedbackHtml = `
        <div class="max-w-lg mx-auto bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-amber-950 space-y-1">
          <div class="font-bold">~ Almost! Watch the Spanish accents / ñ:</div>
          <div>Expected: <strong class="text-emerald-800">${escapeHtml(expected)}</strong></div>
        </div>`;
    } else {
      feedbackHtml = `
        <div class="max-w-lg mx-auto bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-rose-950 space-y-1">
          <div class="font-bold">✗ Answer: <span class="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">${escapeHtml(expected)}</span></div>
          ${typed ? `<div class="text-xs text-rose-700">You typed: "${escapeHtml(typed)}"</div>` : ''}
        </div>`;
    }
  }

  const voicePrefs = getVoicePrefs();
  const voiceOn = Boolean(voicePrefs.enabled);
  if (voiceOn && !appState.verbsPack) {
    loadVerbsPack().catch(() => {});
  }
  const sttLang = dir === 'es_en' ? 'en-US' : voicePrefs.lang;
  const sttLangLabel = dir === 'es_en' ? 'English' : `Spanish (${voicePrefs.lang})`;

  const voiceBarHtml =
    !quizState.answered && voiceOn
      ? `<div class="flex flex-col items-center gap-2 pt-1">
          <div class="flex flex-wrap items-center justify-center gap-2">
            <button id="vocab-mic-btn" type="button" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-xs font-bold shadow-2xs transition cursor-pointer">
              🎙️ Speak ${sttLangLabel} Answer
            </button>
            <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">
              ${
                voicePrefs.autoSubmit
                  ? `Auto-submit: ${voicePrefs.autoSubmitDelaySec}s delay`
                  : 'Fill box & press Enter'
              }${dir === 'en_es' && voicePrefs.autoAccents ? ' • Auto-Accents' : ''}
            </span>
          </div>
          <div id="vocab-voice-status" class="text-[11px] font-medium text-slate-500 min-h-[16px]">
            ${
              isSpeechRecognitionSupported()
                ? `Click mic and speak your ${dir === 'es_en' ? 'English' : 'Spanish'} translation.`
                : 'Speech recognition requires Chrome or Edge desktop/Android.'
            }
          </div>
        </div>`
      : '';

  const accentBarHtml =
    !quizState.answered && dir === 'en_es'
      ? `<div class="flex flex-wrap items-center justify-center gap-1.5">
          <span class="text-[11px] font-medium text-slate-400 mr-1">Accents:</span>
          ${SPANISH_ACCENT_CHARS.map(
            (ch) =>
              `<button type="button" class="vocab-accent-btn px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-indigo-100 border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer" data-char="${ch}">${ch}</button>`
          ).join('')}
        </div>`
      : '';

  container.innerHTML = `
    <!-- Top Progress & Score -->
    <div class="space-y-3 border-b border-slate-100 pb-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold">${dirLabel}</span>
          <span class="px-2.5 py-1 rounded-full border text-xs font-bold ${lvlBadge.cls}">${lvlBadge.text}</span>
          ${phraseOriginBadge}
          <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">${escapeHtml(item.pos || item.type)}</span>
          <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">${escapeHtml(themeDisplay)}</span>
        </div>
        <div class="flex items-center gap-3 text-xs font-semibold text-slate-600">
          <span>${progressLabel}</span>
          <span class="text-emerald-700">✓ ${quizState.correctCount}/${quizState.answeredCount}</span>
          <span class="text-amber-700">🔥 ${quizState.streak}</span>
        </div>
      </div>
      ${
        quizState.targetLength > 0
          ? `<div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-indigo-600 transition-all duration-300" style="width: ${pctDone}%"></div>
            </div>`
          : ''
      }
    </div>

    <!-- Center Prompt & Typed / Spoken Answer -->
    <div class="my-auto py-7 text-center space-y-5">
      <div class="space-y-2">
        <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          ${dir === 'es_en' ? (voiceOn ? 'Translate to English (Type or Speak)' : 'Translate to English (Typed Only)') : voiceOn ? 'Type or Speak the Spanish Word / Phrase' : 'Type the Spanish Word / Phrase'}
        </div>
        <div class="flex items-center justify-center gap-2.5 flex-wrap">
          <h3 class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">${escapeHtml(promptMain)}</h3>
          ${
            dir === 'es_en' || quizState.answered
              ? `<button id="vocab-speak-btn" type="button" class="px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer" title="Listen in Spanish">🔊</button>`
              : ''
          }
        </div>
      </div>

      <div class="space-y-3">
        <input
          type="text"
          id="vocab-answer-input"
          class="${inputClass}"
          value="${quizState.answered ? escapeHtml(quizState.lastGrade.typed) : escapeHtml(quizState.draftInput || '')}"
          ${quizState.answered ? 'readonly' : ''}
          placeholder="${dir === 'es_en' ? 'Type English meaning...' : 'Type Spanish translation...'}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        ${voiceBarHtml}
        ${accentBarHtml}
      </div>

      ${feedbackHtml}
    </div>

    <!-- Bottom Action Bar -->
    <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5">
      ${
        !quizState.answered
          ? `<button id="vocab-submit-btn" type="button" class="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-xs transition cursor-pointer">
              Check Answer (Enter)
            </button>
            <button id="vocab-reveal-btn" type="button" class="px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition cursor-pointer">
              Show Answer
            </button>`
          : `<button id="vocab-next-btn" type="button" class="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-xs transition cursor-pointer">
              ${quizState.targetLength > 0 && quizState.index + 1 >= quizState.items.length ? 'View Results Summary (Enter) →' : 'Next Question (Enter) →'}
            </button>`
      }
    </div>
  `;

  const speakBtn = document.getElementById('vocab-speak-btn');
  if (speakBtn) {
    speakBtn.onclick = () => speakSpanish(item.es, 1.0);
  }

  const input = document.getElementById('vocab-answer-input');
  const voiceStatusEl = document.getElementById('vocab-voice-status');
  const vocabMicBtn = document.getElementById('vocab-mic-btn');
  const setVoiceStatus = (msg, cls = 'text-slate-500') => {
    if (!voiceStatusEl) return;
    voiceStatusEl.className = `text-[11px] font-medium min-h-[16px] ${cls}`;
    voiceStatusEl.textContent = msg;
  };

  if (!quizState.answered) {
    if (input) {
      input.focus();
      input.addEventListener('input', () => {
        quizState.draftInput = input.value;
        cancelAutoSubmitCountdown(() => {
          if (voiceOn) setVoiceStatus('Auto-submit cancelled — press Enter when ready.');
        });
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          cancelAutoSubmitCountdown();
          submitVocabAnswer(false);
        } else if (e.key === 'Escape') {
          cancelAutoSubmitCountdown(() => {
            if (voiceOn) setVoiceStatus('Auto-submit cancelled — press Enter when ready.');
          });
          input.blur();
        }
      });
    }

    if (vocabMicBtn) {
      vocabMicBtn.onclick = () => {
        cancelAutoSubmitCountdown();
        const vp = getVoicePrefs();
        const englishCandidates =
          dir === 'es_en'
            ? String(item.en || '')
                .replace(/\([^)]*\)/g, '')
                .split(/[\/;|,]+/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [item.es];

        startSingleShotVoiceInput({
          lang: sttLang,
          expectedCandidates: englishCandidates,
          onStateChange: (state) => {
            if (!document.body.contains(vocabMicBtn)) return;
            if (state === 'listening') {
              vocabMicBtn.classList.add('ring-2', 'ring-rose-400', 'bg-rose-600', 'text-white');
              vocabMicBtn.classList.remove('bg-rose-50', 'text-rose-800');
              vocabMicBtn.textContent = '🛑 Listening... (click to stop)';
              setVoiceStatus(`Listening in ${sttLangLabel}...`, 'text-rose-700 font-semibold');
            } else {
              vocabMicBtn.classList.remove('ring-2', 'ring-rose-400', 'bg-rose-600', 'text-white');
              vocabMicBtn.classList.add('bg-rose-50', 'text-rose-800');
              vocabMicBtn.textContent = `🎙️ Speak ${sttLangLabel} Answer`;
            }
          },
          onInterim: (interim) => {
            if (input && document.body.contains(input)) {
              input.value = interim;
              quizState.draftInput = interim;
            }
          },
          onResult: (finalText) => {
            if (input && document.body.contains(input)) {
              input.value = finalText;
              quizState.draftInput = finalText;
              input.focus();
              if (!vp.autoSubmit) {
                setVoiceStatus('Filled box — review or press Enter to check.', 'text-emerald-700');
              }
            }
          },
          onAutoSubmitCountdown: (delaySec) => {
            scheduleAutoSubmitCountdown(
              delaySec,
              (secLeft) => {
                if (secLeft > 0) {
                  setVoiceStatus(
                    `Auto-submitting in ${secLeft}s... (type or press Esc to cancel)`,
                    'text-amber-700 font-semibold'
                  );
                }
              },
              () => {
                submitVocabAnswer(false);
              }
            );
          },
          onError: (msg) => {
            setVoiceStatus(msg, 'text-rose-700');
            if (!isSpeechRecognitionSupported()) showToast(msg, 'error');
          }
        });
      };
    }

    container.querySelectorAll('.vocab-accent-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cancelAutoSubmitCountdown();
        if (!input) return;
        const ch = btn.dataset.char || '';
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + ch + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + ch.length;
        quizState.draftInput = input.value;
        input.focus();
      });
    });
    document.getElementById('vocab-submit-btn').onclick = () => submitVocabAnswer(false);
    document.getElementById('vocab-reveal-btn').onclick = () => submitVocabAnswer(true);
  } else {
    const nextBtn = document.getElementById('vocab-next-btn');
    if (nextBtn) {
      nextBtn.onclick = advanceVocabQuestion;
      nextBtn.focus();
    }
  }
}

export function initVocabQuiz() {
  appHooks.refreshStudySubTabOnSync = ((prevHook) => (subTab) => {
    if (typeof prevHook === 'function') prevHook(subTab);
    if (subTab === 'vocab') {
      const currentLvl = String(getPrefs().level || appState.studyLevel || 'ALL');
      if ((quizState.items.length === 0 || quizState.builtForLevel !== currentLvl) && !quizState.loading) {
        startVocabRound();
      } else {
        renderVocabQuiz();
      }
    }
  })(appHooks.refreshStudySubTabOnSync);

  appHooks.onSharedLevelChanged = ((prevHook) => (lvl, source) => {
    if (typeof prevHook === 'function') prevHook(lvl, source);
    if (appState.userPrefs.activeTab === 'study' && appState.userPrefs.studySubTab === 'vocab') {
      startVocabRound();
    } else {
      quizState.builtForLevel = null;
    }
  })(appHooks.onSharedLevelChanged);

  appHooks.onVocabStatsUpdated = () => {
    if (appState.userPrefs.studySubTab === 'vocab') {
      renderVocabQuiz();
    }
  };

  appHooks.onVoicePrefsChanged = ((prevHook) => () => {
    if (typeof prevHook === 'function') prevHook();
    cancelAutoSubmitCountdown();
    const inp = document.getElementById('vocab-answer-input');
    if (inp && !quizState.answered) {
      quizState.draftInput = inp.value;
    }
    if (appState.vocabPack && quizState.items.length > 0 && !quizState.isSummary) {
      renderVocabQuiz();
    }
  })(appHooks.onVoicePrefsChanged);

  const prefs = getPrefs();
  const bindFilter = (id, key, isBool = false, isNum = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      prefs[key] = isBool ? e.target.checked : isNum ? Number(e.target.value) : e.target.value;
      saveUserPrefs(true, true);
      startVocabRound();
    });
  };

  const levelEl = document.getElementById('vocab-level-filter');
  if (levelEl) {
    levelEl.addEventListener('change', (e) => {
      setSharedStudyLevel(e.target.value, { source: 'vocab' });
    });
  }
  bindFilter('vocab-theme-filter', 'theme');
  bindFilter('vocab-direction-select', 'direction');
  bindFilter('vocab-pool-select', 'pool');
  bindFilter('vocab-length-select', 'length', false, true);
  bindFilter('vocab-weak-only-checkbox', 'weakOnly', true);

  const vocabVoiceCb = document.getElementById('vocab-voice-mode-checkbox');
  if (vocabVoiceCb) {
    vocabVoiceCb.checked = Boolean(getVoicePrefs().enabled);
    vocabVoiceCb.addEventListener('change', (e) => {
      const inp = document.getElementById('vocab-answer-input');
      if (inp && !quizState.answered) {
        quizState.draftInput = inp.value;
      }
      setVoiceModeEnabled(e.target.checked, true);
    });
  }

  const restartBtn = document.getElementById('vocab-restart-btn');
  if (restartBtn) {
    restartBtn.onclick = () => startVocabRound();
  }
}
