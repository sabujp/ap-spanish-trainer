import { SPEAKING_PROMPTS, escapeHtml } from './constants.js';
import { speakSpanish } from './audio.js';
import { appHooks, appState } from './storage.js';
import { showToast } from './ui.js';

function updateCheckedChunksCounter() {
  const checked = document.querySelectorAll('.speaking-chunk-cb:checked').length;
  const total = appState.currentRequiredChunks.length;
  document.getElementById('chunks-checked-count').textContent = `${checked} / ${total} Used`;
}

export function generateSpeakingChallenge() {
  appState.currentPrompt = SPEAKING_PROMPTS[Math.floor(Math.random() * SPEAKING_PROMPTS.length)];
  document.getElementById('speaking-prompt-theme').textContent = `AP Theme: ${appState.currentPrompt.theme}`;
  document.getElementById('speaking-prompt-es').textContent = appState.currentPrompt.es;
  document.getElementById('speaking-prompt-en').textContent = appState.currentPrompt.en;

  const pickedIndices = new Set();
  const maxDraws = Math.min(3, appState.deck.length);
  while (pickedIndices.size < maxDraws) {
    pickedIndices.add(Math.floor(Math.random() * appState.deck.length));
  }
  appState.currentRequiredChunks = [...pickedIndices].map((i) => appState.deck[i]);

  const listEl = document.getElementById('speaking-chunks-list');
  listEl.innerHTML = '';

  appState.currentRequiredChunks.forEach((chunk, index) => {
    const label = document.createElement('label');
    label.className = 'flex items-start gap-3 p-3 rounded-xl bg-white border border-amber-200/80 shadow-2xs cursor-pointer hover:border-indigo-400 transition';
    label.innerHTML = `
      <input type="checkbox" class="speaking-chunk-cb mt-1 rounded text-indigo-600 focus:ring-indigo-500" data-idx="${index}" />
      <div class="flex-1">
        <div class="text-sm font-bold text-slate-900">${escapeHtml(chunk.target)}</div>
        <div class="text-xs text-slate-500">${escapeHtml(chunk.hint)}</div>
      </div>
    `;
    listEl.appendChild(label);
  });

  document.querySelectorAll('.speaking-chunk-cb').forEach((cb) => {
    cb.addEventListener('change', updateCheckedChunksCounter);
  });
  updateCheckedChunksCounter();
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const display = document.getElementById('timer-display');
  display.textContent = formatSeconds(appState.timeRemaining);
  if (appState.timeRemaining <= 15 && appState.timeRemaining > 0) {
    display.classList.add('text-rose-600');
    display.classList.remove('text-slate-900');
  } else {
    display.classList.remove('text-rose-600');
    display.classList.add('text-slate-900');
  }
}

function stopTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
}

function setTimerMode(mode) {
  stopTimer();
  appState.timerMode = mode;
  appState.timeRemaining = mode === 'SPEAK' ? 120 : 240;
  updateTimerDisplay();

  const speakBtn = document.getElementById('timer-mode-speak');
  const prepBtn = document.getElementById('timer-mode-prep');
  if (mode === 'SPEAK') {
    speakBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-xs transition';
    prepBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition';
  } else {
    prepBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-xs transition';
    speakBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition';
  }
}

export function initSpeaking() {
  appHooks.generateSpeakingChallenge = generateSpeakingChallenge;

  document.getElementById('timer-mode-speak').onclick = () => setTimerMode('SPEAK');
  document.getElementById('timer-mode-prep').onclick = () => setTimerMode('PREP');
  document.getElementById('new-speaking-challenge-btn').onclick = generateSpeakingChallenge;
  document.getElementById('speak-prompt-btn').onclick = () => {
    if (appState.currentPrompt) speakSpanish(appState.currentPrompt.es);
  };

  document.getElementById('timer-start-btn').onclick = () => {
    if (appState.timerInterval) return;
    if (appState.timeRemaining <= 0) {
      appState.timeRemaining = appState.timerMode === 'SPEAK' ? 120 : 240;
    }
    appState.timerInterval = setInterval(() => {
      appState.timeRemaining--;
      updateTimerDisplay();
      if (appState.timeRemaining <= 0) {
        stopTimer();
        showToast(
          appState.timerMode === 'PREP'
            ? '4-Minute Prep complete! Switch to 2:00 Speaking timer.'
            : '¡Tiempo! 2-Minute AP Cultural Comparison complete.',
          'info'
        );
      }
    }, 1000);
  };

  document.getElementById('timer-pause-btn').onclick = stopTimer;
  document.getElementById('timer-reset-btn').onclick = () => {
    stopTimer();
    appState.timeRemaining = appState.timerMode === 'SPEAK' ? 120 : 240;
    updateTimerDisplay();
  };
}
