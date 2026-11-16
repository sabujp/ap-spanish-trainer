import { VALID_AP_THEMES } from './constants.js';
import { saveDeck } from './packs.js';
import { appState } from './storage.js';
import { formatClozeSentence } from './studyChunks.js';
import { showToast } from './ui.js';

export function initPreplyAdd() {
  const addSentenceInput = document.getElementById('add-sentence');
  const addTargetInput = document.getElementById('add-target');
  const addPreviewEl = document.getElementById('add-live-preview');

  function updateLiveClozePreview() {
    const sentence = addSentenceInput.value.trim();
    const target = addTargetInput.value.trim();
    if (!sentence) {
      addPreviewEl.innerHTML =
        '<span class="text-slate-400 italic">Type a sentence and target chunk above to preview...</span>';
      return;
    }
    if (!target) {
      addPreviewEl.textContent = sentence;
      return;
    }
    // Explicitly NEVER enable word lookup in Tab 2 preview
    addPreviewEl.innerHTML = formatClozeSentence(sentence, target, false, {
      enableWordLookup: false
    });
  }

  addSentenceInput.addEventListener('input', updateLiveClozePreview);
  addTargetInput.addEventListener('input', updateLiveClozePreview);

  document.getElementById('single-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const sentence = addSentenceInput.value.trim();
    const target = addTargetInput.value.trim();
    const hint = document.getElementById('add-hint').value.trim();
    const theme = document.getElementById('add-theme').value;
    const notes = document.getElementById('add-notes').value.trim();

    if (!sentence || !target || !hint) {
      showToast('Please fill in the sentence, target chunk, and English hint.', 'error');
      return;
    }

    const newCard = {
      id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      sentence,
      target,
      hint,
      theme,
      notes,
      interval: 0,
      ease: 2.5,
      reps: 0,
      dueDate: Date.now(),
      updatedAt: Date.now()
    };

    appState.deck.unshift(newCard);
    saveDeck();
    e.target.reset();
    updateLiveClozePreview();
    showToast('Chunk added to your study deck!', 'success');
  });

  document.getElementById('bulk-import-btn').addEventListener('click', () => {
    const raw = document.getElementById('bulk-textarea').value.trim();
    const feedbackEl = document.getElementById('bulk-feedback');
    if (!raw) {
      showToast('Paste at least one line to import.', 'error');
      return;
    }

    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    let skipped = 0;

    lines.forEach((line, idx) => {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
        skipped++;
        return;
      }
      const matchedTheme =
        VALID_AP_THEMES.find((t) => t.toLowerCase() === (parts[3] || '').toLowerCase()) ||
        'Argument & Connectors';

      appState.deck.unshift({
        id: `bulk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        sentence: parts[0],
        target: parts[1],
        hint: parts[2],
        theme: matchedTheme,
        notes: parts[4] || '',
        interval: 0,
        ease: 2.5,
        reps: 0,
        dueDate: Date.now(),
        updatedAt: Date.now()
      });
      added++;
    });

    saveDeck();
    if (added > 0) {
      document.getElementById('bulk-textarea').value = '';
      showToast(`Imported ${added} new chunk${added === 1 ? '' : 's'}!`, 'success');
    }
    feedbackEl.textContent = `Added ${added} card(s)${skipped > 0 ? ` • Skipped ${skipped} malformed line(s)` : ''}.`;
  });
}
