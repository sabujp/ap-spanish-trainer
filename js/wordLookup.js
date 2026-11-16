import {
  escapeHtml,
  normalizeSpanishAnswer,
  stripSpanishDiacritics
} from './constants.js';
import { speakSpanish } from './audio.js';
import { loadVocabularyPack } from './packs.js';
import { appHooks, appState } from './storage.js';

const SPANISH_WORD_TOKEN_RE =
  /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:-[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*/g;

let hoverTimer = null;
let currentAnchorEl = null;
let currentSpeakText = '';

export function isWordLookupActive() {
  if (!appState.userPrefs.wordLookupEnabled) return false;
  if (appState.userPrefs.activeTab !== 'study') return false;
  if ((appState.userPrefs.studySubTab || 'chunks') !== 'chunks') return false;
  const subPanel = document.getElementById('study-subpanel-chunks');
  const studyPanel = document.getElementById('tab-study');
  return Boolean(
    subPanel &&
      !subPanel.classList.contains('hidden') &&
      studyPanel &&
      !studyPanel.classList.contains('hidden')
  );
}

export function tokenizeSpanishHtmlWithLookup(rawText) {
  const str = String(rawText ?? '');
  let out = '';
  let lastIdx = 0;
  SPANISH_WORD_TOKEN_RE.lastIndex = 0;

  let match;
  while ((match = SPANISH_WORD_TOKEN_RE.exec(str)) !== null) {
    if (match.index > lastIdx) {
      out += escapeHtml(str.slice(lastIdx, match.index));
    }
    const word = match[0];
    const safeWord = escapeHtml(word);
    out += `<span class="lookup-word" data-lookup-word="${safeWord}">${safeWord}</span>`;
    lastIdx = match.index + word.length;
  }
  if (lastIdx < str.length) {
    out += escapeHtml(str.slice(lastIdx));
  }
  return out;
}

export function hideWordLookupPopover() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (currentAnchorEl) {
    currentAnchorEl.classList.remove('active-lookup');
    currentAnchorEl = null;
  }
  const pop = document.getElementById('word-lookup-popover');
  if (pop) {
    pop.classList.add('hidden');
  }
}

function cleanLookupSurface(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[\s¿¡.,;:!?()"'«»—–-]+|[\s¿¡.,;:!?()"'«»—–-]+$/g, '');
}

function resolveWordEntry(token, pack) {
  if (!pack || !token) return null;
  const norm = normalizeSpanishAnswer(token);
  if (!norm) return null;
  if (pack.wordMap.has(norm)) return pack.wordMap.get(norm);
  const bare = stripSpanishDiacritics(norm);
  if (pack.wordNormMap.has(bare)) return pack.wordNormMap.get(bare);
  return null;
}

function resolveSelectionLookup(rawText, pack) {
  const cleaned = cleanLookupSurface(rawText);
  if (!cleaned) return null;
  const norm = normalizeSpanishAnswer(cleaned);
  const bare = stripSpanishDiacritics(norm);

  // 1. Exact phrase match in card targets/phrases
  if (pack.phraseMap.has(norm)) {
    const p = pack.phraseMap.get(norm);
    return {
      es: p.es || cleaned,
      pos: 'phrase',
      en: p.en,
      meta: ''
    };
  }
  if (pack.phraseNormMap.has(bare)) {
    const p = pack.phraseNormMap.get(bare);
    return {
      es: p.es || cleaned,
      pos: 'phrase',
      en: p.en,
      meta: ''
    };
  }

  // 2. Single word lookup
  const words = cleaned.match(SPANISH_WORD_TOKEN_RE) || [];
  if (words.length <= 1) {
    const wEntry = resolveWordEntry(words[0] || cleaned, pack);
    if (!wEntry) return null;
    const baseNote =
      wEntry.lemma && wEntry.lemma.toLowerCase() !== norm
        ? `Base form: ${wEntry.lemma}`
        : '';
    return {
      es: words[0] || cleaned,
      pos: wEntry.pos || 'word',
      en: wEntry.en,
      meta: baseNote
    };
  }

  // 3. Multi-word highlight not in phraseMap -> look up key words inline (up to 5 words)
  const limited = words.slice(0, 5);
  const parts = [];
  for (const w of limited) {
    const entry = resolveWordEntry(w, pack);
    if (entry) {
      parts.push(`${w}: ${entry.en}`);
    }
  }
  if (parts.length === 0) return null;
  return {
    es: cleaned,
    pos: 'selection',
    en: parts.join(' • '),
    meta: words.length > 5 ? `Showing first 5 of ${words.length} highlighted words` : ''
  };
}

function positionPopoverAtRect(pop, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 10;

  // Reveal invisibly first to measure true dimensions
  pop.style.visibility = 'hidden';
  pop.classList.remove('hidden');

  const popRect = pop.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(margin, Math.min(left, vw - popRect.width - margin));

  let top = rect.bottom + 8;
  if (top + popRect.height > vh - margin) {
    const aboveTop = rect.top - popRect.height - 8;
    if (aboveTop >= margin) {
      top = aboveTop;
    } else {
      top = Math.max(margin, vh - popRect.height - margin);
    }
  }

  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.visibility = 'visible';
}

async function showLookupForText(text, anchorRect, anchorEl = null) {
  if (!isWordLookupActive()) return;

  let pack = appState.vocabPack;
  if (!pack) {
    try {
      pack = await loadVocabularyPack();
    } catch {
      return;
    }
  }
  if (!isWordLookupActive()) return;

  const result = resolveSelectionLookup(text, pack);
  if (!result) return;

  const pop = document.getElementById('word-lookup-popover');
  const esEl = document.getElementById('lookup-pop-es');
  const posEl = document.getElementById('lookup-pop-pos');
  const enEl = document.getElementById('lookup-pop-en');
  const metaEl = document.getElementById('lookup-pop-meta');
  if (!pop || !esEl || !posEl || !enEl || !metaEl) return;

  if (currentAnchorEl && currentAnchorEl !== anchorEl) {
    currentAnchorEl.classList.remove('active-lookup');
  }
  currentAnchorEl = anchorEl;
  if (currentAnchorEl) {
    currentAnchorEl.classList.add('active-lookup');
  }

  currentSpeakText = result.es;
  esEl.textContent = result.es;
  posEl.textContent = result.pos || '';
  posEl.classList.toggle('hidden', !result.pos);
  enEl.textContent = result.en;

  if (result.meta) {
    metaEl.textContent = result.meta;
    metaEl.classList.remove('hidden');
  } else {
    metaEl.textContent = '';
    metaEl.classList.add('hidden');
  }

  positionPopoverAtRect(pop, anchorRect);
}

export function initWordLookup() {
  appHooks.hideWordLookupPopover = hideWordLookupPopover;

  const flashcardArea = document.getElementById('flashcard-area');
  const pop = document.getElementById('word-lookup-popover');
  const speakBtn = document.getElementById('lookup-pop-speak-btn');
  const closeBtn = document.getElementById('lookup-pop-close-btn');

  if (speakBtn) {
    speakBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentSpeakText) speakSpanish(currentSpeakText, 0.95);
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideWordLookupPopover();
    });
  }

  if (!flashcardArea) return;

  // Hover intent on tokenized Spanish words inside Chunk Study cards
  flashcardArea.addEventListener('mouseover', (e) => {
    if (!isWordLookupActive()) return;
    const wordEl = e.target.closest('.lookup-word');
    if (!wordEl || !flashcardArea.contains(wordEl)) return;
    // Do not hijack when user is actively drag-selecting text
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const rect = wordEl.getBoundingClientRect();
      showLookupForText(wordEl.dataset.lookupWord || wordEl.textContent, rect, wordEl);
    }, 160);
  });

  flashcardArea.addEventListener('mouseout', (e) => {
    const wordEl = e.target.closest('.lookup-word');
    if (!wordEl) return;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  });

  // Tap/click lookup + drag-selection phrase highlight lookup
  flashcardArea.addEventListener('mouseup', (e) => {
    if (!isWordLookupActive()) return;
    if (e.target.closest('input, textarea, select, button')) return;

    const sel = window.getSelection ? window.getSelection() : null;
    const selectedText = sel ? sel.toString().trim() : '';

    if (selectedText.length > 0 && sel.rangeCount > 0) {
      // Ensure selection is inside the Spanish sentence container (not Cue/Tips)
      const sentenceEl = flashcardArea.querySelector('.study-sentence-text');
      const range = sel.getRangeAt(0);
      if (!sentenceEl || !sentenceEl.contains(range.commonAncestorContainer)) return;
      const rect = range.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        showLookupForText(selectedText, rect, null);
      }
      return;
    }

    const wordEl = e.target.closest('.lookup-word');
    if (wordEl && flashcardArea.contains(wordEl)) {
      const rect = wordEl.getBoundingClientRect();
      showLookupForText(wordEl.dataset.lookupWord || wordEl.textContent, rect, wordEl);
    }
  });

  // Outside click & Escape hide popover
  document.addEventListener('mousedown', (e) => {
    if (!pop || pop.classList.contains('hidden')) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.lookup-word')) return;
    hideWordLookupPopover();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideWordLookupPopover();
    }
  });

  window.addEventListener('scroll', () => {
    if (pop && !pop.classList.contains('hidden')) {
      hideWordLookupPopover();
    }
  }, { passive: true });
}
