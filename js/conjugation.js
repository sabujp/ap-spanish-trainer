import {
  CONJUGATION_PRONOUNS,
  CONJUGATION_TENSE_LABELS,
  LEVEL_BADGES,
  SPANISH_ACCENT_CHARS,
  escapeHtml,
  normalizeSpanishAnswer,
  stripSpanishDiacritics
} from './constants.js';
import { speakSpanish } from './audio.js';
import { getActivePhrasePriority, loadVerbsPack } from './packs.js';
import { appHooks, appState, saveUserPrefs, saveVerbStats, setSharedStudyLevel } from './storage.js';

const ALL_TENSE_KEYS = Object.keys(CONJUGATION_TENSE_LABELS);

const conjState = {
  queue: [],
  queueIndex: 0,
  currentVerb: null,
  activeTense: 'present',
  stage: 'infinitive', // 'infinitive' | 'matrix'
  infinitiveInput: '',
  infinitiveGrade: null, // null | 'exact' | 'accent' | 'wrong' | 'revealed'
  matrixInputs: ['', '', '', '', '', ''],
  matrixGraded: false,
  matrixResults: [], // array of { status, typed, expected }
  lastFocusedIdx: 0,
  sessionRightForms: 0,
  sessionTotalForms: 0,
  sessionVerbsDone: 0,
  loading: false,
  error: '',
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
  if (!appState.userPrefs.conjPrefs) {
    appState.userPrefs.conjPrefs = {
      level: 'ALL',
      tense: 'present',
      category: 'ALL',
      weakOnly: false
    };
  }
  return appState.userPrefs.conjPrefs;
}

function getFilteredVerbs() {
  const pack = appState.verbsPack;
  if (!pack || !Array.isArray(pack.verbs)) return [];
  const prefs = getPrefs();
  const activeLevel = String(prefs.level || appState.studyLevel || 'ALL');
  const lvlNum = activeLevel === 'ALL' ? null : Number(activeLevel);
  const priority = getActivePhrasePriority(activeLevel, 'ALL');

  const filtered = pack.verbs.filter((v) => {
    const inLivePhrase = priority.targetVerbs.has(v.infinitive) || priority.sentenceVerbs.has(v.infinitive);
    const matchLevel =
      activeLevel === 'ALL' ||
      (Array.isArray(v.levels) ? v.levels.includes(lvlNum) : String(v.level) === activeLevel) ||
      inLivePhrase;
    const matchCat = prefs.category === 'ALL' || v.category === prefs.category;
    if (!matchLevel || !matchCat) return false;
    if (prefs.weakOnly) {
      const st = appState.verbStats[v.id];
      return st && ((st.wrong || 0) > 0 || (st.infWrong || 0) > 0) && (st.streak || 0) < 2;
    }
    return true;
  });

  return filtered.map((v) => {
    const isStudiedVerb = priority.studiedVerbs.has(v.infinitive);
    const isTargetVerb =
      priority.targetVerbs.has(v.infinitive) ||
      (lvlNum === null ? (v.targetLevels || []).length > 0 : (v.targetLevels || []).includes(lvlNum));
    const isSentenceVerb = priority.sentenceVerbs.has(v.infinitive) || (v.phraseFreq || 0) > 0;
    return {
      ...v,
      _isStudiedVerb: isStudiedVerb,
      _isTargetVerb: isTargetVerb,
      _inPhraseTests: isStudiedVerb || isTargetVerb || isSentenceVerb
    };
  });
}

function buildWeightedVerbQueue(verbs) {
  if (!verbs.length) return [];
  const studiedOrTarget = shuffleArray(verbs.filter((v) => v._isStudiedVerb || v._isTargetVerb));
  const sentenceMatched = shuffleArray(
    verbs.filter((v) => !v._isStudiedVerb && !v._isTargetVerb && v._inPhraseTests)
  );
  const others = shuffleArray(verbs.filter((v) => !v._inPhraseTests));
  const prioritized = [...studiedOrTarget, ...sentenceMatched];
  // Interleave ~4 phrase-test verbs per 1 general verb so phrase verbs anchor practice while keeping all verbs reachable
  const out = [];
  let pi = 0;
  let oi = 0;
  while (pi < prioritized.length || oi < others.length) {
    for (let k = 0; k < 4 && pi < prioritized.length; k++) {
      out.push(prioritized[pi++]);
    }
    if (oi < others.length) {
      out.push(others[oi++]);
    }
  }
  return out;
}

function pickTenseForVerb() {
  const prefs = getPrefs();
  if (prefs.tense === 'mixed' || !CONJUGATION_TENSE_LABELS[prefs.tense]) {
    return ALL_TENSE_KEYS[Math.floor(Math.random() * ALL_TENSE_KEYS.length)];
  }
  return prefs.tense;
}

function setupVerbTurn(verb) {
  conjState.currentVerb = verb || null;
  conjState.activeTense = pickTenseForVerb();
  conjState.stage = 'infinitive';
  conjState.infinitiveInput = '';
  conjState.infinitiveGrade = null;
  conjState.matrixInputs = ['', '', '', '', '', ''];
  conjState.matrixGraded = false;
  conjState.matrixResults = [];
  conjState.lastFocusedIdx = 0;
}

export async function startConjugationDeck(advanceToNext = false) {
  if (!appState.verbsPack) {
    conjState.loading = true;
    conjState.error = '';
    renderConjugation();
    try {
      await loadVerbsPack();
    } catch (err) {
      conjState.loading = false;
      conjState.error = err.message || 'Failed to load AP verbs pack.';
      renderConjugation();
      return;
    }
    conjState.loading = false;
  }

  const activeLevel = String(getPrefs().level || appState.studyLevel || 'ALL');
  conjState.builtForLevel = activeLevel;

  if (advanceToNext && conjState.queue.length > 0) {
    conjState.queueIndex += 1;
    if (conjState.queueIndex >= conjState.queue.length) {
      conjState.queue = buildWeightedVerbQueue(getFilteredVerbs());
      conjState.queueIndex = 0;
    }
    setupVerbTurn(conjState.queue[conjState.queueIndex] || null);
    renderConjugation();
    return;
  }

  conjState.queue = buildWeightedVerbQueue(getFilteredVerbs());
  conjState.queueIndex = 0;
  setupVerbTurn(conjState.queue[0] || null);
  renderConjugation();
}

function checkInfinitiveStage(revealOnly = false) {
  const verb = conjState.currentVerb;
  if (!verb) return;
  const input = document.getElementById('conj-infinitive-input');
  const rawTyped = revealOnly ? '' : (input ? input.value.trim() : conjState.infinitiveInput);
  conjState.infinitiveInput = rawTyped;

  const normTyped = normalizeSpanishAnswer(rawTyped);
  const normExp = normalizeSpanishAnswer(verb.infinitive);

  let status = 'wrong';
  if (revealOnly) {
    status = 'revealed';
  } else if (normTyped === normExp) {
    status = 'exact';
  } else if (normTyped && stripSpanishDiacritics(normTyped) === stripSpanishDiacritics(normExp)) {
    status = 'accent';
  }

  conjState.infinitiveGrade = status;

  const prev = appState.verbStats[verb.id] || {
    right: 0,
    wrong: 0,
    infRight: 0,
    infWrong: 0,
    streak: 0,
    lastSeen: 0,
    updatedAt: 0
  };
  const now = Date.now();
  const isPass = status === 'exact' || status === 'accent';
  appState.verbStats[verb.id] = {
    ...prev,
    infRight: (prev.infRight || 0) + (isPass ? 1 : 0),
    infWrong: (prev.infWrong || 0) + (isPass ? 0 : 1),
    lastSeen: now,
    updatedAt: now
  };
  saveVerbStats(true);

  if (isPass) {
    // Move directly into Stage 2 with confirmation banner
    conjState.stage = 'matrix';
  }
  renderConjugation();
}

function enterMatrixStage() {
  conjState.stage = 'matrix';
  renderConjugation();
}

function gradeMatrixStage(revealAll = false) {
  const verb = conjState.currentVerb;
  if (!verb || conjState.matrixGraded) return;
  const expectedForms = (verb.tenses && verb.tenses[conjState.activeTense]) || [];
  if (expectedForms.length !== 6) return;

  const results = CONJUGATION_PRONOUNS.map((p, idx) => {
    const inputEl = document.getElementById(`conj-matrix-input-${idx}`);
    const typed = revealAll ? '' : (inputEl ? inputEl.value.trim() : conjState.matrixInputs[idx] || '');
    conjState.matrixInputs[idx] = typed;
    const expected = expectedForms[idx] || '';

    const normTyped = normalizeSpanishAnswer(typed);
    const normExp = normalizeSpanishAnswer(expected);

    let status = 'wrong';
    if (!revealAll && normTyped) {
      if (normTyped === normExp) status = 'exact';
      else if (stripSpanishDiacritics(normTyped) === stripSpanishDiacritics(normExp)) status = 'accent';
    }
    return { status, typed, expected };
  });

  const rightInMatrix = results.filter((r) => r.status === 'exact' || r.status === 'accent').length;
  const wrongInMatrix = 6 - rightInMatrix;

  conjState.matrixGraded = true;
  conjState.matrixResults = results;
  conjState.sessionRightForms += rightInMatrix;
  conjState.sessionTotalForms += 6;
  conjState.sessionVerbsDone += 1;

  const prev = appState.verbStats[verb.id] || {
    right: 0,
    wrong: 0,
    infRight: 0,
    infWrong: 0,
    streak: 0,
    lastSeen: 0,
    updatedAt: 0
  };
  const now = Date.now();
  const matrixPerfect = rightInMatrix === 6;
  appState.verbStats[verb.id] = {
    ...prev,
    right: (prev.right || 0) + rightInMatrix,
    wrong: (prev.wrong || 0) + wrongInMatrix,
    streak: matrixPerfect ? (prev.streak || 0) + 1 : 0,
    lastSeen: now,
    updatedAt: now
  };
  saveVerbStats(true);
  renderConjugation();
}

export function renderConjugation() {
  const container = document.getElementById('conjugation-area');
  if (!container) return;

  if (conjState.loading) {
    container.innerHTML = `<div class="my-auto text-center py-10 text-sm text-slate-500">Loading all 397 AP verbs from phrase packs...</div>`;
    return;
  }

  if (conjState.error) {
    container.innerHTML = `
      <div class="my-auto text-center py-8 space-y-3">
        <div class="text-sm font-bold text-rose-700">${escapeHtml(conjState.error)}</div>
        <button id="conj-retry-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer">Retry Load</button>
      </div>`;
    document.getElementById('conj-retry-btn').onclick = () => startConjugationDeck(false);
    return;
  }

  if (!appState.verbsPack) {
    container.innerHTML = `<div class="my-auto text-center py-10 text-sm text-slate-500">Preparing Verb Conjugation Trainer...</div>`;
    return;
  }

  const prefs = getPrefs();
  const verb = conjState.currentVerb;

  if (!verb) {
    container.innerHTML = `
      <div class="my-auto text-center py-8 space-y-4 max-w-md mx-auto">
        <div class="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center mx-auto text-2xl font-bold">V</div>
        <h3 class="text-lg font-extrabold text-slate-900">No Matching Verbs</h3>
        <p class="text-xs sm:text-sm text-slate-500 leading-relaxed">
          ${prefs.weakOnly
            ? 'You have no weak verbs in this filter yet! Uncheck "Weak Verbs Only" to practice all 397 verbs.'
            : 'No verbs match the selected Level and Verb Type filters.'}
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          ${prefs.weakOnly
            ? `<button id="conj-clear-weak-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">Practice All Matching Verbs</button>`
            : `<button id="conj-reset-filters-btn" type="button" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">Reset Verb Filters</button>`}
        </div>
      </div>`;
    const cw = document.getElementById('conj-clear-weak-btn');
    if (cw) {
      cw.onclick = () => {
        prefs.weakOnly = false;
        const cb = document.getElementById('conj-weak-only-checkbox');
        if (cb) cb.checked = false;
        saveUserPrefs(true, true);
        startConjugationDeck(false);
      };
    }
    const rf = document.getElementById('conj-reset-filters-btn');
    if (rf) {
      rf.onclick = () => {
        setSharedStudyLevel('ALL', { source: 'conjugation', notify: false });
        prefs.category = 'ALL';
        const catSel = document.getElementById('conj-category-select');
        if (catSel) catSel.value = 'ALL';
        saveUserPrefs(true, true);
        startConjugationDeck(false);
      };
    }
    return;
  }

  const activeLevel = String(prefs.level || appState.studyLevel || 'ALL');
  const activeLvlNum = activeLevel === 'ALL' ? null : Number(activeLevel);
  const badgeLvl =
    activeLvlNum && Array.isArray(verb.levels) && verb.levels.includes(activeLvlNum)
      ? activeLvlNum
      : verb.level || 1;
  const lvlBadge = LEVEL_BADGES[badgeLvl] || LEVEL_BADGES[1];
  const phraseOriginBadge =
    verb._isStudiedVerb || verb._isTargetVerb
      ? `<span class="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold" title="Appears directly in Phrase Tests / your studied phrases">★ In Your Phrases</span>`
      : verb._inPhraseTests
        ? `<span class="px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold" title="Appears in Phrase Test sentences">✓ In Phrase Tests</span>`
        : '';
  const tenseLabel = CONJUGATION_TENSE_LABELS[conjState.activeTense] || conjState.activeTense;
  const catLabel = verb.category ? verb.category.replace('-', ' ') : 'verb';
  const sessionStatsHtml = `
    <div class="flex items-center gap-3 text-xs font-semibold text-slate-600">
      <span>Pool: <strong>${conjState.queue.length}</strong> verbs</span>
      <span>Session: <strong class="text-emerald-700">${conjState.sessionRightForms}/${conjState.sessionTotalForms}</strong> forms</span>
    </div>`;

  // ===== STAGE 1: ENGLISH INFINITIVE -> TYPE SPANISH INFINITIVE =====
  if (conjState.stage === 'infinitive') {
    const isWrong = conjState.infinitiveGrade === 'wrong';
    const isRevealed = conjState.infinitiveGrade === 'revealed';
    const doneCheck = isWrong || isRevealed;

    const inputCls = doneCheck
      ? 'conj-input is-wrong w-full max-w-md mx-auto block rounded-2xl border-2 px-4 py-3 text-center text-lg font-extrabold focus:outline-none'
      : 'conj-input w-full max-w-md mx-auto block rounded-2xl border-2 border-indigo-200 bg-slate-50 px-4 py-3 text-center text-lg font-extrabold text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 focus:outline-none transition';

    container.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-xs font-bold">Step 1 of 2: Spanish Infinitive</span>
          <span class="px-2.5 py-1 rounded-full border text-xs font-bold ${lvlBadge.cls}">${lvlBadge.text}</span>
          ${phraseOriginBadge}
          <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold capitalize">${escapeHtml(catLabel)}</span>
          <span class="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">Next Tense: ${escapeHtml(tenseLabel)}</span>
        </div>
        ${sessionStatsHtml}
      </div>

      <div class="my-auto py-8 text-center space-y-5">
        <div class="space-y-1.5">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Type the Spanish Infinitive For:
          </div>
          <h3 class="text-2xl sm:text-3xl font-extrabold text-slate-900">${escapeHtml(verb.english)}</h3>
          ${verb.reflexive ? `<div class="text-xs font-semibold text-indigo-600">(Reflexive verb — remember the <code>-se</code> ending)</div>` : ''}
        </div>

        <div class="space-y-3">
          <input
            type="text"
            id="conj-infinitive-input"
            class="${inputCls}"
            value="${escapeHtml(conjState.infinitiveInput)}"
            ${doneCheck ? 'readonly' : ''}
            placeholder="Type Spanish infinitive (e.g., hablar)..."
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
          ${
            !doneCheck
              ? `<div class="flex flex-wrap items-center justify-center gap-1.5">
                  <span class="text-[11px] font-medium text-slate-400 mr-1">Accents:</span>
                  ${SPANISH_ACCENT_CHARS.slice(0, 7)
                    .map(
                      (ch) =>
                        `<button type="button" class="conj-accent-btn px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-indigo-100 border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer" data-char="${ch}">${ch}</button>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>

        ${
          doneCheck
            ? `<div class="max-w-md mx-auto bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs sm:text-sm text-rose-950 space-y-1.5">
                <div class="flex items-center justify-center gap-2">
                  <span class="font-bold">${isRevealed ? 'Spanish Infinitive:' : 'Not quite — expected:'}</span>
                  <strong class="text-base text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">${escapeHtml(verb.infinitive)}</strong>
                  <button id="conj-inf-speak-btn" type="button" class="px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer">🔊</button>
                </div>
              </div>`
            : ''
        }
      </div>

      <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5">
        ${
          !doneCheck
            ? `<button id="conj-check-inf-btn" type="button" class="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-xs transition cursor-pointer">
                Check Infinitive &amp; Continue (Enter)
              </button>
              <button id="conj-reveal-inf-btn" type="button" class="px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition cursor-pointer">
                Reveal Infinitive
              </button>`
            : `<button id="conj-continue-matrix-btn" type="button" class="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-xs transition cursor-pointer">
                Continue to Full 6-Person Matrix (Enter) →
              </button>`
        }
      </div>
    `;

    const infInput = document.getElementById('conj-infinitive-input');
    if (!doneCheck) {
      if (infInput) {
        infInput.focus();
        infInput.addEventListener('input', () => {
          conjState.infinitiveInput = infInput.value;
        });
        infInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            checkInfinitiveStage(false);
          }
        });
      }
      container.querySelectorAll('.conj-accent-btn').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (!infInput) return;
          const ch = btn.dataset.char || '';
          const start = infInput.selectionStart ?? infInput.value.length;
          const end = infInput.selectionEnd ?? infInput.value.length;
          infInput.value = infInput.value.slice(0, start) + ch + infInput.value.slice(end);
          infInput.selectionStart = infInput.selectionEnd = start + ch.length;
          conjState.infinitiveInput = infInput.value;
          infInput.focus();
        });
      });
      document.getElementById('conj-check-inf-btn').onclick = () => checkInfinitiveStage(false);
      document.getElementById('conj-reveal-inf-btn').onclick = () => checkInfinitiveStage(true);
    } else {
      const spk = document.getElementById('conj-inf-speak-btn');
      if (spk) spk.onclick = () => speakSpanish(verb.infinitive, 1.0);
      const contBtn = document.getElementById('conj-continue-matrix-btn');
      if (contBtn) {
        contBtn.onclick = enterMatrixStage;
        contBtn.focus();
      }
    }
    return;
  }

  // ===== STAGE 2: FULL 6-PERSON CONJUGATION MATRIX (WITH VOSOTROS) =====
  const infPassBanner =
    conjState.infinitiveGrade === 'exact'
      ? `<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">✓ Infinitive Correct</span>`
      : conjState.infinitiveGrade === 'accent'
        ? `<span class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-bold">~ Infinitive Accent Tip: ${escapeHtml(verb.infinitive)}</span>`
        : '';

  const matrixScore = conjState.matrixGraded
    ? conjState.matrixResults.filter((r) => r.status === 'exact' || r.status === 'accent').length
    : 0;

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="px-2.5 py-1 rounded-full bg-indigo-600 text-white text-xs font-bold">Step 2 of 2: Full 6-Person Matrix</span>
        <span class="px-2.5 py-1 rounded-full border text-xs font-bold ${lvlBadge.cls}">${lvlBadge.text}</span>
        ${phraseOriginBadge}
        <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold capitalize">${escapeHtml(catLabel)}</span>
        ${infPassBanner}
      </div>
      ${sessionStatsHtml}
    </div>

    <!-- Verb & Tense Banner -->
    <div class="pt-4 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="space-y-0.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-2xl font-extrabold text-slate-900">${escapeHtml(verb.infinitive)}</span>
          <button id="conj-speak-verb-btn" type="button" class="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer" title="Pronounce infinitive">🔊</button>
          <span class="text-sm font-medium text-slate-500">— ${escapeHtml(verb.english)}</span>
        </div>
      </div>
      <div class="px-3.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs sm:text-sm font-extrabold shrink-0">
        Tense: ${escapeHtml(tenseLabel)}
      </div>
    </div>

    <!-- Accent Helper Bar -->
    ${
      !conjState.matrixGraded
        ? `<div class="flex flex-wrap items-center gap-1.5 py-2">
            <span class="text-[11px] font-medium text-slate-400 mr-1">Accents (inserts into active box):</span>
            ${SPANISH_ACCENT_CHARS.slice(0, 7)
              .map(
                (ch) =>
                  `<button type="button" class="conj-matrix-accent-btn px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-indigo-100 border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer" data-char="${ch}">${ch}</button>`
              )
              .join('')}
          </div>`
        : ''
    }

    <!-- 6-Person Grid WITH vosotros -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 py-3">
      ${CONJUGATION_PRONOUNS.map((p, idx) => {
        const res = conjState.matrixGraded ? conjState.matrixResults[idx] : null;
        const val = conjState.matrixInputs[idx] || '';
        const inputStateClass = !res
          ? 'conj-input w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none'
          : res.status === 'exact'
            ? 'conj-input is-correct w-full rounded-xl border-2 px-3 py-2 text-sm font-bold focus:outline-none'
            : res.status === 'accent'
              ? 'conj-input is-accent w-full rounded-xl border-2 px-3 py-2 text-sm font-bold focus:outline-none'
              : 'conj-input is-wrong w-full rounded-xl border-2 px-3 py-2 text-sm font-bold focus:outline-none';

        let rowNoteHtml = '';
        if (res) {
          if (res.status === 'exact') {
            rowNoteHtml = `<div class="flex items-center justify-between text-[11px] font-bold text-emerald-700 pt-1"><span>✓ Exact</span><button type="button" class="conj-row-speak cursor-pointer hover:underline" data-speak="${escapeHtml(res.expected)}">🔊</button></div>`;
          } else if (res.status === 'accent') {
            rowNoteHtml = `<div class="flex items-center justify-between text-[11px] font-bold text-amber-800 pt-1"><span>~ Accent: <strong class="underline">${escapeHtml(res.expected)}</strong></span><button type="button" class="conj-row-speak cursor-pointer hover:underline" data-speak="${escapeHtml(res.expected)}">🔊</button></div>`;
          } else {
            rowNoteHtml = `<div class="flex items-center justify-between text-[11px] font-bold text-rose-700 pt-1"><span>Expected: <strong class="text-emerald-800">${escapeHtml(res.expected)}</strong></span><button type="button" class="conj-row-speak cursor-pointer hover:underline" data-speak="${escapeHtml(res.expected)}">🔊</button></div>`;
          }
        }

        return `
          <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1.5">
            <div class="flex items-center justify-between">
              <label for="conj-matrix-input-${idx}" class="text-xs font-extrabold text-indigo-800">${escapeHtml(p.label)}</label>
              <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">${escapeHtml(p.note)}</span>
            </div>
            <input
              type="text"
              id="conj-matrix-input-${idx}"
              data-idx="${idx}"
              class="${inputStateClass}"
              value="${escapeHtml(val)}"
              ${conjState.matrixGraded ? 'readonly' : ''}
              placeholder="${escapeHtml(p.label.split('/')[0].trim())}..."
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
            ${rowNoteHtml}
          </div>`;
      }).join('')}
    </div>

    ${
      conjState.matrixGraded
        ? `<div class="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-3.5 text-xs text-indigo-950 flex flex-wrap items-center justify-between gap-2">
            <div class="space-y-0.5">
              <div class="font-bold">Matrix Score: ${matrixScore} / 6 ${matrixScore === 6 ? '— ¡Perfecto!' : ''}</div>
              <div class="text-[11px] text-indigo-900">
                Gerund: <strong>${escapeHtml(verb.gerund || '')}</strong> • Participle: <strong>${escapeHtml(verb.participle || '')}</strong>
                ${verb.disambiguation ? ` • Tip: <strong>${escapeHtml(verb.disambiguation)}</strong>` : ''}
              </div>
            </div>
            <button id="conj-listen-all-btn" type="button" class="px-3 py-1.5 rounded-xl bg-white hover:bg-indigo-100 border border-indigo-200 text-indigo-800 text-xs font-bold cursor-pointer">
              🔊 Listen All 6 Forms
            </button>
          </div>`
        : ''
    }

    <!-- Bottom Action Bar -->
    <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5">
      ${
        !conjState.matrixGraded
          ? `<button id="conj-grade-matrix-btn" type="button" class="flex-1 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-xs transition cursor-pointer">
              Check All 6 Conjugations (Enter)
            </button>
            <button id="conj-reveal-matrix-btn" type="button" class="px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition cursor-pointer">
              Reveal All 6
            </button>`
          : `<button id="conj-next-verb-btn" type="button" class="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-xs transition cursor-pointer">
              Next Verb (Enter) →
            </button>`
      }
    </div>
  `;

  document.getElementById('conj-speak-verb-btn').onclick = () => speakSpanish(verb.infinitive, 1.0);

  if (!conjState.matrixGraded) {
    const inputs = CONJUGATION_PRONOUNS.map((_, idx) => document.getElementById(`conj-matrix-input-${idx}`));
    inputs.forEach((inp, idx) => {
      if (!inp) return;
      inp.addEventListener('focus', () => {
        conjState.lastFocusedIdx = idx;
      });
      inp.addEventListener('input', () => {
        conjState.matrixInputs[idx] = inp.value;
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (idx < inputs.length - 1) {
            inputs[idx + 1]?.focus();
          } else {
            gradeMatrixStage(false);
          }
        }
      });
    });

    if (inputs[conjState.lastFocusedIdx]) {
      inputs[conjState.lastFocusedIdx].focus();
    } else if (inputs[0]) {
      inputs[0].focus();
    }

    container.querySelectorAll('.conj-matrix-accent-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const targetInput = inputs[conjState.lastFocusedIdx] || inputs[0];
        if (!targetInput) return;
        const ch = btn.dataset.char || '';
        const start = targetInput.selectionStart ?? targetInput.value.length;
        const end = targetInput.selectionEnd ?? targetInput.value.length;
        targetInput.value = targetInput.value.slice(0, start) + ch + targetInput.value.slice(end);
        targetInput.selectionStart = targetInput.selectionEnd = start + ch.length;
        conjState.matrixInputs[Number(targetInput.dataset.idx) || 0] = targetInput.value;
        targetInput.focus();
      });
    });

    document.getElementById('conj-grade-matrix-btn').onclick = () => gradeMatrixStage(false);
    document.getElementById('conj-reveal-matrix-btn').onclick = () => gradeMatrixStage(true);
  } else {
    container.querySelectorAll('.conj-row-speak').forEach((btn) => {
      btn.onclick = () => speakSpanish(btn.dataset.speak || '', 0.95);
    });
    const listenAllBtn = document.getElementById('conj-listen-all-btn');
    if (listenAllBtn) {
      listenAllBtn.onclick = () => {
        const expected = (verb.tenses && verb.tenses[conjState.activeTense]) || [];
        speakSpanish(expected.join(', '), 0.92);
      };
    }
    const nextBtn = document.getElementById('conj-next-verb-btn');
    if (nextBtn) {
      nextBtn.onclick = () => startConjugationDeck(true);
      nextBtn.focus();
    }
  }
}

export function initConjugation() {
  appHooks.refreshStudySubTabOnSync = ((prevHook) => (subTab) => {
    if (typeof prevHook === 'function') prevHook(subTab);
    if (subTab === 'conjugation') {
      const currentLvl = String(getPrefs().level || appState.studyLevel || 'ALL');
      if ((!conjState.currentVerb || conjState.builtForLevel !== currentLvl) && !conjState.loading) {
        startConjugationDeck(false);
      } else {
        renderConjugation();
      }
    }
  })(appHooks.refreshStudySubTabOnSync);

  appHooks.onSharedLevelChanged = ((prevHook) => (lvl, source) => {
    if (typeof prevHook === 'function') prevHook(lvl, source);
    if (appState.userPrefs.activeTab === 'study' && appState.userPrefs.studySubTab === 'conjugation') {
      startConjugationDeck(false);
    } else {
      conjState.builtForLevel = null;
    }
  })(appHooks.onSharedLevelChanged);

  appHooks.onVerbStatsUpdated = () => {
    if (appState.userPrefs.studySubTab === 'conjugation') {
      renderConjugation();
    }
  };

  const prefs = getPrefs();
  const bindFilter = (id, key, isBool = false, rebuildQueue = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      prefs[key] = isBool ? e.target.checked : e.target.value;
      saveUserPrefs(true, true);
      if (rebuildQueue) {
        startConjugationDeck(false);
      } else {
        conjState.activeTense = pickTenseForVerb();
        conjState.matrixInputs = ['', '', '', '', '', ''];
        conjState.matrixGraded = false;
        conjState.matrixResults = [];
        renderConjugation();
      }
    });
  };

  const levelEl = document.getElementById('conj-level-filter');
  if (levelEl) {
    levelEl.addEventListener('change', (e) => {
      setSharedStudyLevel(e.target.value, { source: 'conjugation' });
    });
  }
  bindFilter('conj-tense-select', 'tense', false, false);
  bindFilter('conj-category-select', 'category', false, true);
  bindFilter('conj-weak-only-checkbox', 'weakOnly', true, true);

  const nextVerbToolbarBtn = document.getElementById('conj-next-btn');
  if (nextVerbToolbarBtn) {
    nextVerbToolbarBtn.onclick = () => startConjugationDeck(true);
  }
}
