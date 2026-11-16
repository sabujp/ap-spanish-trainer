import {
  AUTO_FOCUS_TYPE_KEY,
  DAY_MS,
  LEVEL_BADGES,
  SPANISH_ACCENT_CHARS,
  escapeHtml,
  escapeRegExp,
  getTodayDateStr,
  normalizeSpanishAnswer,
  stripSpanishDiacritics
} from './constants.js';
import { speakSpanish } from './audio.js';
import { loadVocabularyPack, saveDeck } from './packs.js';
import {
  appHooks,
  appState,
  getEffectiveDueCards,
  saveDailyPace,
  saveUserPrefs,
  syncStudyModeButtonsUI
} from './storage.js';
import { hasValidGoogleToken } from './sync.js';
import { showToast } from './ui.js';
import {
  hideWordLookupPopover,
  isWordLookupActive,
  tokenizeSpanishHtmlWithLookup
} from './wordLookup.js';

export function parseClozeSegments(sentence, target) {
  const rawSentence = String(sentence || '');
  const rawTarget = String(target || '');

  if (rawTarget.includes('...')) {
    const parts = rawTarget.split('...').map((p) => p.trim()).filter(Boolean);
    let cursor = 0;
    let matchedAll = parts.length > 0;
    const tempSegments = [];
    const tempExpected = [];

    for (const part of parts) {
      const rest = rawSentence.slice(cursor);
      const regex = new RegExp(escapeRegExp(part), 'i');
      const m = rest.match(regex);
      if (!m) {
        matchedAll = false;
        break;
      }
      if (m.index > 0) {
        tempSegments.push({ type: 'text', text: rest.slice(0, m.index) });
      }
      tempSegments.push({
        type: 'blank',
        expected: m[0],
        blankIndex: tempExpected.length
      });
      tempExpected.push(m[0]);
      cursor += m.index + m[0].length;
    }

    if (matchedAll) {
      if (cursor < rawSentence.length) {
        tempSegments.push({ type: 'text', text: rawSentence.slice(cursor) });
      }
      return { segments: tempSegments, expected: tempExpected, isFallback: false };
    }
  }

  const regex = new RegExp(escapeRegExp(rawTarget), 'i');
  const match = rawSentence.match(regex);
  if (match) {
    const segments = [];
    if (match.index > 0) {
      segments.push({ type: 'text', text: rawSentence.slice(0, match.index) });
    }
    segments.push({
      type: 'blank',
      expected: match[0],
      blankIndex: 0
    });
    const endIdx = match.index + match[0].length;
    if (endIdx < rawSentence.length) {
      segments.push({ type: 'text', text: rawSentence.slice(endIdx) });
    }
    return { segments, expected: [match[0]], isFallback: false };
  }

  return {
    segments: [
      { type: 'text', text: rawSentence },
      { type: 'fallback-blank', expected: rawTarget, blankIndex: 0 }
    ],
    expected: [rawTarget],
    isFallback: true
  };
}

export function evaluateTypedAnswers(typedList, expectedList) {
  const hasTypedAny = typedList.some((v) => String(v || '').trim().length > 0);
  if (!hasTypedAny) {
    return { hasTypedAny: false, status: 'none', perBlank: [] };
  }

  const perBlank = expectedList.map((exp, idx) => {
    const typed = String(typedList[idx] || '');
    const normTyped = normalizeSpanishAnswer(typed);
    const normExp = normalizeSpanishAnswer(exp);
    if (!normTyped) {
      return { status: 'wrong', typed, expected: exp };
    }
    if (normTyped === normExp) {
      return { status: 'exact', typed, expected: exp };
    }
    if (stripSpanishDiacritics(normTyped) === stripSpanishDiacritics(normExp)) {
      return { status: 'accent', typed, expected: exp };
    }
    return { status: 'wrong', typed, expected: exp };
  });

  let overall = 'exact';
  if (perBlank.some((b) => b.status === 'wrong')) {
    overall = 'wrong';
  } else if (perBlank.some((b) => b.status === 'accent')) {
    overall = 'accent';
  }

  return { hasTypedAny: true, status: overall, perBlank };
}

export function formatClozeSentence(sentence, target, revealed, options = {}) {
  const interactive = Boolean(options.interactive);
  const enableLookup = Boolean(options.enableWordLookup);
  const userAnswers = Array.isArray(options.typedAnswers) ? options.typedAnswers : [];
  const parsed = parseClozeSegments(sentence, target);

  if (interactive) {
    appState.expectedAnswers = parsed.expected;
  }

  const renderText = (txt) => (enableLookup ? tokenizeSpanishHtmlWithLookup(txt) : escapeHtml(txt));

  return parsed.segments
    .map((seg) => {
      if (seg.type === 'text') {
        return renderText(seg.text);
      }
      const safeExpected = escapeHtml(seg.expected);
      let innerHtml;
      if (revealed) {
        innerHtml = `<span class="cloze-revealed">${renderText(seg.expected)}</span>`;
      } else if (interactive) {
        const currentVal = String(userAnswers[seg.blankIndex] || '');
        const widthCh = Math.max(16, currentVal.length + 3);
        innerHtml = `<input type="text" class="cloze-input" data-blank-idx="${seg.blankIndex}" value="${escapeHtml(currentVal)}" style="width: ${widthCh}ch" placeholder="type chunk..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Type missing Spanish phrase" />`;
      } else {
        innerHtml = `<span class="cloze-blank">[ _______ ]</span>`;
      }
      return seg.type === 'fallback-blank' ? `<div class="mt-3">${innerHtml}</div>` : innerHtml;
    })
    .join('');
}

export function getFilteredStudyQueue() {
  if (appState.studyMode === 'ALL') {
    return appState.deck
      .filter(
        (card) =>
          (appState.studyTheme === 'ALL' || card.theme === appState.studyTheme) &&
          (appState.studyLevel === 'ALL' || String(card.level || 2) === String(appState.studyLevel))
      )
      .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
  }
  return getEffectiveDueCards(appState.studyTheme, appState.studyLevel);
}

export function selectNextCard(options = {}) {
  hideWordLookupPopover();
  const queue = getFilteredStudyQueue();
  appState.typedAnswers = [];
  appState.expectedAnswers = [];
  appState.activeBlankInputIndex = 0;

  if (queue.length === 0) {
    appState.currentCardId = null;
    appState.isRevealed = false;
    renderFlashcard();
    return;
  }

  if (
    options.restoreLastCard &&
    appState.userPrefs.lastCardId &&
    queue.some((c) => c.id === appState.userPrefs.lastCardId)
  ) {
    appState.currentCardId = appState.userPrefs.lastCardId;
  } else if (
    appState.studyMode === 'ALL' &&
    queue.length > 1 &&
    queue[0].id === appState.currentCardId &&
    !options.keepCurrent
  ) {
    const idx = queue.findIndex((c) => c.id === appState.currentCardId);
    const nextCard = queue[(idx + 1) % queue.length];
    appState.currentCardId = nextCard.id;
  } else {
    appState.currentCardId = queue[0].id;
  }

  if (appState.currentCardId !== appState.userPrefs.lastCardId) {
    appState.userPrefs.lastCardId = appState.currentCardId;
    saveUserPrefs(false, !options.skipTimestamp);
  }

  appState.isRevealed = false;
  renderFlashcard();

  const tabStudy = document.getElementById('tab-study');
  const chunksSub = document.getElementById('study-subpanel-chunks');
  if (
    appState.autoFocusType &&
    tabStudy &&
    !tabStudy.classList.contains('hidden') &&
    chunksSub &&
    !chunksSub.classList.contains('hidden')
  ) {
    const firstInput = document.querySelector('#flashcard-area .cloze-input');
    if (firstInput) firstInput.focus();
  }
}

export function renderFlashcard() {
  const container = document.getElementById('flashcard-area');
  if (!container) return;
  hideWordLookupPopover();

  const queue = getFilteredStudyQueue();
  const card = appState.deck.find((c) => c.id === appState.currentCardId);

  if (!card || queue.length === 0) {
    container.innerHTML = `
      <div class="my-auto text-center py-8 space-y-4 max-w-md mx-auto">
        <div class="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto text-2xl font-bold">
          ✓
        </div>
        <h3 class="text-xl font-extrabold text-slate-900">All Caught Up for Now!</h3>
        <p class="text-sm text-slate-500 leading-relaxed">
          You have reviewed all due chunks in this filter. Load a <strong>Grade-Level JSON Pack</strong> in Tab 4, switch to <strong>Practice All</strong>, or add phrases from your Preply session.
        </p>
        <div class="pt-2 flex flex-wrap justify-center gap-3">
          <button id="empty-goto-manage-btn" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-xs transition cursor-pointer">
            + Load Grade JSON Pack
          </button>
          <button id="empty-practice-all-btn" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-xs transition cursor-pointer">
            Switch to Practice All
          </button>
          <button id="empty-goto-add-btn" class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold transition cursor-pointer">
            + Add Preply Phrases
          </button>
        </div>
      </div>
    `;
    document.getElementById('empty-goto-manage-btn').onclick = () => appHooks.switchTab('manage');
    document.getElementById('empty-practice-all-btn').onclick = () => setStudyMode('ALL');
    document.getElementById('empty-goto-add-btn').onclick = () => appHooks.switchTab('add');
    return;
  }

  const lookupOn = isWordLookupActive();
  if (lookupOn && !appState.vocabPack) {
    loadVocabularyPack().catch(() => {});
  }
  const formattedSentence = formatClozeSentence(card.sentence, card.target, appState.isRevealed, {
    interactive: true,
    typedAnswers: appState.typedAnswers,
    enableWordLookup: lookupOn
  });

  const evaluation = appState.isRevealed
    ? evaluateTypedAnswers(appState.typedAnswers, appState.expectedAnswers)
    : null;
  let typedFeedbackHtml = '';
  if (evaluation && evaluation.hasTypedAny) {
    const typedSummary = evaluation.perBlank
      .map((b) => (b.typed.trim() ? b.typed.trim() : '(blank)'))
      .join(' ... ');
    const expectedSummary = evaluation.perBlank.map((b) => b.expected).join(' ... ');

    if (evaluation.status === 'exact') {
      typedFeedbackHtml = `
        <div class="max-w-xl mx-auto bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-emerald-900 font-semibold inline-flex items-center gap-2">
          <span>✓</span>
          <span>¡Exacto! You typed the exact phrase.</span>
        </div>
      `;
    } else if (evaluation.status === 'accent') {
      typedFeedbackHtml = `
        <div class="max-w-xl mx-auto bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-amber-950 space-y-1">
          <div class="font-bold">~ Almost! Watch the accents / ñ:</div>
          <div>
            You typed: <span class="font-mono bg-white/80 px-1.5 py-0.5 rounded border border-amber-200">${escapeHtml(typedSummary)}</span>
            <span class="mx-1 text-amber-600">→</span>
            Expected: <strong class="text-emerald-800">${escapeHtml(expectedSummary)}</strong>
          </div>
        </div>
      `;
    } else {
      typedFeedbackHtml = `
        <div class="max-w-xl mx-auto bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-rose-950 space-y-1">
          <div class="font-bold">✗ Not quite — compare your answer:</div>
          <div>
            You typed: <span class="line-through text-rose-700 font-medium">${escapeHtml(typedSummary)}</span>
            <span class="mx-1 text-rose-500">→</span>
            Expected: <strong class="text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">${escapeHtml(expectedSummary)}</strong>
          </div>
        </div>
      `;
    }
  }

  const hasTypedTextNow = appState.typedAnswers.some((v) => String(v || '').trim().length > 0);
  const accentHelperHtml = !appState.isRevealed
    ? `<div class="flex flex-wrap items-center justify-center gap-1.5 pt-1" aria-label="Spanish accent helper">
        <span class="text-[11px] font-medium text-slate-400 mr-1">Accents:</span>
        ${SPANISH_ACCENT_CHARS.map(
          (ch) =>
            `<button type="button" class="accent-char-btn px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-indigo-100 border border-slate-200 hover:border-indigo-300 text-xs font-bold text-slate-700 hover:text-indigo-800 transition cursor-pointer" data-char="${ch}">${ch}</button>`
        ).join('')}
      </div>`
    : '';

  const previewIntervals = {
    again: 'In 1 min',
    hard: card.reps === 0 ? 'In 12 hrs' : `In ${Math.max(1, Math.round(card.interval * 1.2))}d`,
    good:
      card.reps === 0
        ? 'In 1 day'
        : card.reps === 1
          ? 'In 3 days'
          : `In ${Math.round(card.interval * card.ease)}d`,
    easy: card.reps === 0 ? 'In 4 days' : `In ${Math.round(card.interval * card.ease * 1.3)}d`
  };

  const syncStatusBadge = hasValidGoogleToken()
    ? '<span class="text-sky-700 font-semibold">☁️ Auto-saving to Google Drive</span>'
    : '<span class="text-slate-400">Saved locally (Sign in with Google to sync)</span>';

  const lvlBadge = LEVEL_BADGES[card.level || 2] || LEVEL_BADGES[2];
  const lookupTipHtml = lookupOn
    ? `<div class="text-[11px] text-indigo-600 font-medium">💡 Word Lookup ON — hover or highlight any Spanish word above for English meaning</div>`
    : '';

  container.innerHTML = `
    <!-- Top Meta Row -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="px-2.5 py-1 rounded-full border text-xs font-bold ${lvlBadge.cls}">
          ${lvlBadge.text}
        </span>
        <span class="px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold">
          ${escapeHtml(card.theme)}
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-slate-400 mr-1">
          Queue: <strong class="text-slate-700">${queue.length}</strong> remaining
        </span>
        <button id="card-tts-normal-btn" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition cursor-pointer" title="Listen at Normal Speed (Shortcut: R)">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          Listen (1.0x)
        </button>
        <button id="card-tts-slow-btn" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer" title="Listen Slowly (0.8x)">
          🐢 0.8x
        </button>
      </div>
    </div>

    <!-- Center Sentence & Cue -->
    <div class="my-auto py-8 text-center space-y-5">
      <p class="study-sentence-text text-xl sm:text-2xl md:text-[26px] font-medium text-slate-900 leading-relaxed max-w-3xl mx-auto">
        ${formattedSentence}
      </p>

      ${lookupTipHtml}
      ${accentHelperHtml}
      ${typedFeedbackHtml}

      <div class="inline-block bg-amber-50 border border-amber-200/80 px-4 py-2 rounded-xl">
        <span class="text-xs font-bold uppercase tracking-wider text-amber-700 mr-1.5">Cue:</span>
        <span class="text-sm font-semibold text-amber-950">${escapeHtml(card.hint)}</span>
      </div>

      ${
        appState.isRevealed && card.notes
          ? `<div class="max-w-xl mx-auto bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
              <strong class="text-slate-800">AP / Usage Tip:</strong> ${escapeHtml(card.notes)}
            </div>`
          : ''
      }
    </div>

    <!-- Bottom Action Bar -->
    <div class="pt-4 border-t border-slate-100 space-y-2.5">
      ${
        !appState.isRevealed
          ? `<button id="reveal-card-btn" class="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm sm:text-base shadow-sm transition cursor-pointer">
              ${hasTypedTextNow ? 'Check &amp; Reveal Answer (Enter)' : 'Reveal Answer (Space)'}
            </button>`
          : `<div class="flex items-center justify-between text-[11px] px-1">
              <span class="font-semibold text-slate-600">How well did you recall the missing phrase?</span>
              ${syncStatusBadge}
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <button data-rate="1" class="rate-btn flex flex-col items-center py-2.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-900 transition cursor-pointer" title="Missed it — reset card and review again in 1 minute">
                <span class="text-xs font-extrabold">1. Again</span>
                <span class="text-[11px] font-medium text-rose-700">Forgot / Missed</span>
                <span class="mt-0.5 px-2 py-0.5 rounded-full bg-rose-200/70 text-[10px] font-bold">${previewIntervals.again}</span>
              </button>
              <button data-rate="2" class="rate-btn flex flex-col items-center py-2.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 transition cursor-pointer" title="Got it with difficulty — shorten future spacing">
                <span class="text-xs font-extrabold">2. Hard</span>
                <span class="text-[11px] font-medium text-amber-700">Struggled</span>
                <span class="mt-0.5 px-2 py-0.5 rounded-full bg-amber-200/70 text-[10px] font-bold">${previewIntervals.hard}</span>
              </button>
              <button data-rate="3" class="rate-btn flex flex-col items-center py-2.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 transition cursor-pointer" title="Recalled correctly — standard spaced repetition interval">
                <span class="text-xs font-extrabold">3. Good</span>
                <span class="text-[11px] font-medium text-emerald-700">Recalled</span>
                <span class="mt-0.5 px-2 py-0.5 rounded-full bg-emerald-200/70 text-[10px] font-bold">${previewIntervals.good}</span>
              </button>
              <button data-rate="4" class="rate-btn flex flex-col items-center py-2.5 px-3 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-900 transition cursor-pointer" title="Knew it instantly — push next review further out">
                <span class="text-xs font-extrabold">4. Easy</span>
                <span class="text-[11px] font-medium text-sky-700">Effortless</span>
                <span class="mt-0.5 px-2 py-0.5 rounded-full bg-sky-200/70 text-[10px] font-bold">${previewIntervals.easy}</span>
              </button>
            </div>`
      }
    </div>
  `;

  document.getElementById('card-tts-normal-btn').onclick = () => speakSpanish(card.sentence, 1.0);
  document.getElementById('card-tts-slow-btn').onclick = () => speakSpanish(card.sentence, 0.8);

  if (!appState.isRevealed) {
    const revealBtn = document.getElementById('reveal-card-btn');
    revealBtn.onclick = revealCurrentCard;

    const inputs = [...container.querySelectorAll('.cloze-input')];
    const syncRevealBtnLabel = () => {
      const anyFilled = appState.typedAnswers.some((v) => String(v || '').trim().length > 0);
      revealBtn.textContent = anyFilled ? 'Check & Reveal Answer (Enter)' : 'Reveal Answer (Space)';
    };

    inputs.forEach((input) => {
      const idx = Number(input.dataset.blankIdx) || 0;
      input.addEventListener('focus', () => {
        appState.activeBlankInputIndex = idx;
      });
      input.addEventListener('input', () => {
        appState.typedAnswers[idx] = input.value;
        input.style.width = `${Math.max(16, input.value.length + 3)}ch`;
        syncRevealBtnLabel();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (idx < inputs.length - 1 && !inputs[idx + 1].value.trim()) {
            inputs[idx + 1].focus();
          } else {
            revealCurrentCard();
          }
        } else if (e.key === 'Escape') {
          input.blur();
        }
      });
    });

    container.querySelectorAll('.accent-char-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const ch = btn.dataset.char || '';
        const targetInput = inputs[appState.activeBlankInputIndex] || inputs[0];
        if (!targetInput) return;
        if (document.activeElement !== targetInput) {
          targetInput.focus();
        }
        const start = targetInput.selectionStart ?? targetInput.value.length;
        const end = targetInput.selectionEnd ?? targetInput.value.length;
        targetInput.value = targetInput.value.slice(0, start) + ch + targetInput.value.slice(end);
        targetInput.selectionStart = targetInput.selectionEnd = start + ch.length;
        const idx = Number(targetInput.dataset.blankIdx) || 0;
        appState.typedAnswers[idx] = targetInput.value;
        targetInput.style.width = `${Math.max(16, targetInput.value.length + 3)}ch`;
        syncRevealBtnLabel();
      });
    });
  } else {
    container.querySelectorAll('.rate-btn').forEach((btn) => {
      btn.onclick = () => rateCurrentCard(Number(btn.dataset.rate));
    });
  }
}

export function revealCurrentCard() {
  const card = appState.deck.find((c) => c.id === appState.currentCardId);
  if (!card || appState.isRevealed) return;
  document.querySelectorAll('#flashcard-area .cloze-input').forEach((input) => {
    const idx = Number(input.dataset.blankIdx) || 0;
    appState.typedAnswers[idx] = input.value;
  });
  appState.isRevealed = true;
  renderFlashcard();
  if (document.getElementById('auto-tts-checkbox').checked) {
    speakSpanish(card.sentence, 1.0);
  }
}

export function rateCurrentCard(quality) {
  const card = appState.deck.find((c) => c.id === appState.currentCardId);
  if (!card) return;

  const now = Date.now();
  let ease = card.ease || 2.5;
  let reps = card.reps || 0;
  let interval = card.interval || 0;
  const wasUnstudiedNewCard = reps === 0;

  if (quality === 1) {
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    card.dueDate = now + 60 * 1000;
  } else if (quality === 2) {
    interval = reps === 0 ? 0.5 : Math.max(1, Math.round(interval * 1.2));
    reps += 1;
    ease = Math.max(1.3, ease - 0.15);
    card.dueDate = now + interval * DAY_MS;
  } else if (quality === 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 3;
    else interval = Math.round(interval * ease);
    reps += 1;
    card.dueDate = now + interval * DAY_MS;
  } else if (quality === 4) {
    if (reps === 0) interval = 4;
    else interval = Math.round(interval * ease * 1.3);
    reps += 1;
    ease += 0.15;
    card.dueDate = now + interval * DAY_MS;
  }

  if (wasUnstudiedNewCard && reps > 0) {
    const today = getTodayDateStr();
    if (appState.dailyPace.date !== today) {
      appState.dailyPace.date = today;
      appState.dailyPace.introducedCount = 0;
    }
    appState.dailyPace.introducedCount = (appState.dailyPace.introducedCount || 0) + 1;
    saveDailyPace(false);
  }

  card.ease = Number(ease.toFixed(2));
  card.reps = reps;
  card.interval = interval;
  card.updatedAt = now;

  saveDeck();
  selectNextCard();
}

export function setStudyMode(mode) {
  appState.studyMode = mode;
  appState.userPrefs.studyMode = mode;
  syncStudyModeButtonsUI(mode);
  saveUserPrefs(true, true);
  selectNextCard();
}

export function initStudyChunks() {
  appHooks.selectNextCard = selectNextCard;
  appHooks.renderFlashcard = renderFlashcard;

  document.getElementById('mode-due-btn').onclick = () => setStudyMode('DUE');
  document.getElementById('mode-all-btn').onclick = () => setStudyMode('ALL');

  document.getElementById('study-level-filter').onchange = (e) => {
    appState.studyLevel = e.target.value;
    appState.userPrefs.studyLevel = appState.studyLevel;
    saveUserPrefs(true, true);
    selectNextCard();
  };

  document.getElementById('study-theme-filter').onchange = (e) => {
    appState.studyTheme = e.target.value;
    appState.userPrefs.studyTheme = appState.studyTheme;
    saveUserPrefs(true, true);
    selectNextCard();
  };

  const handleAutoSpeakChange = (checked) => {
    appState.userPrefs.autoSpeak = Boolean(checked);
    const cb1 = document.getElementById('auto-tts-checkbox');
    const cb2 = document.getElementById('settings-auto-tts-checkbox');
    if (cb1) cb1.checked = appState.userPrefs.autoSpeak;
    if (cb2) cb2.checked = appState.userPrefs.autoSpeak;
    saveUserPrefs(true, true);
  };
  document.getElementById('auto-tts-checkbox').addEventListener('change', (e) =>
    handleAutoSpeakChange(e.target.checked)
  );
  const settingsAutoTtsEl = document.getElementById('settings-auto-tts-checkbox');
  if (settingsAutoTtsEl) {
    settingsAutoTtsEl.addEventListener('change', (e) => handleAutoSpeakChange(e.target.checked));
  }

  const handleFocusChange = (checked) => {
    appState.autoFocusType = Boolean(checked);
    appState.userPrefs.autoFocusType = appState.autoFocusType;
    const cb1 = document.getElementById('auto-focus-type-checkbox');
    const cb2 = document.getElementById('settings-auto-focus-checkbox');
    if (cb1) cb1.checked = appState.autoFocusType;
    if (cb2) cb2.checked = appState.autoFocusType;
    saveUserPrefs(true, true);
    try {
      localStorage.setItem(AUTO_FOCUS_TYPE_KEY, String(appState.autoFocusType));
    } catch (err) {
      console.error('Failed to save auto-focus preference:', err);
    }
    if (appState.autoFocusType && !appState.isRevealed) {
      const firstInput = document.querySelector('#flashcard-area .cloze-input');
      if (firstInput) firstInput.focus();
    }
  };
  document.getElementById('auto-focus-type-checkbox').addEventListener('change', (e) =>
    handleFocusChange(e.target.checked)
  );
  document.getElementById('settings-auto-focus-checkbox').addEventListener('change', (e) =>
    handleFocusChange(e.target.checked)
  );

  // Word Lookup toggle (default OFF, synced between Chunk Study bar & Settings, persisted in Drive)
  const handleWordLookupToggle = async (checked) => {
    appState.userPrefs.wordLookupEnabled = Boolean(checked);
    const cb1 = document.getElementById('word-lookup-checkbox');
    const cb2 = document.getElementById('settings-word-lookup-checkbox');
    if (cb1) cb1.checked = appState.userPrefs.wordLookupEnabled;
    if (cb2) cb2.checked = appState.userPrefs.wordLookupEnabled;

    if (!appState.userPrefs.wordLookupEnabled) {
      hideWordLookupPopover();
    } else if (!appState.vocabPack) {
      try {
        await loadVocabularyPack();
      } catch {
        showToast('Could not load local vocabulary dictionary.', 'error');
      }
    }

    // Preserve current typed answers in inputs before re-rendering flashcard
    document.querySelectorAll('#flashcard-area .cloze-input').forEach((input) => {
      const idx = Number(input.dataset.blankIdx) || 0;
      appState.typedAnswers[idx] = input.value;
    });

    saveUserPrefs(true, true);
    renderFlashcard();
  };

  const lookupCb1 = document.getElementById('word-lookup-checkbox');
  const lookupCb2 = document.getElementById('settings-word-lookup-checkbox');
  if (lookupCb1) {
    lookupCb1.addEventListener('change', (e) => handleWordLookupToggle(e.target.checked));
  }
  if (lookupCb2) {
    lookupCb2.addEventListener('change', (e) => handleWordLookupToggle(e.target.checked));
  }

  // Chunk Study Global Shortcuts (ONLY when Tab 1 -> Subtab 1 Chunks is active)
  document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;

    const studyPanel = document.getElementById('tab-study');
    const chunksSub = document.getElementById('study-subpanel-chunks');
    const studyPanelVisible = studyPanel && !studyPanel.classList.contains('hidden');
    const chunksVisible = chunksSub && !chunksSub.classList.contains('hidden');
    if (!studyPanelVisible || !chunksVisible || !appState.currentCardId) return;

    // Skip if a modal is open
    const anyModalOpen = ['confirm-modal', 'help-modal', 'drive-sync-modal', 'settings-modal'].some(
      (id) => !document.getElementById(id)?.classList.contains('hidden')
    );
    if (anyModalOpen) return;

    if (e.key === 'Enter' && !appState.isRevealed && !['BUTTON', 'A'].includes(activeTag)) {
      const firstInput = document.querySelector('#flashcard-area .cloze-input');
      if (firstInput) {
        e.preventDefault();
        firstInput.focus();
      }
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (!appState.isRevealed) revealCurrentCard();
    } else if (e.key.toLowerCase() === 'r') {
      const card = appState.deck.find((c) => c.id === appState.currentCardId);
      if (card) speakSpanish(card.sentence);
    } else if (appState.isRevealed && ['1', '2', '3', '4'].includes(e.key)) {
      rateCurrentCard(Number(e.key));
    }
  });
}
