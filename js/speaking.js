import { SPEAKING_PROMPTS, escapeHtml } from './constants.js';
import { speakSpanish } from './audio.js';
import { loadVerbsPack, loadVocabularyPack } from './packs.js';
import {
  buildGeminiExternalPrompt,
  detectMatchedChunks,
  gradeSpeakingChallenge,
  translateSpanishSpeech
} from './speakingAnalyzer.js';
import {
  getVoicePrefs,
  isSpeechRecognitionSupported,
  startContinuousSpeakingSession,
  stopSpeechSession
} from './speechInput.js';
import { appHooks, appState } from './storage.js';
import { showToast } from './ui.js';

const speakingSession = {
  ctrl: null,
  recordingActive: false,
  startedAtMs: 0,
  elapsedBeforePauseSec: 0,
  playbackUrl: null,
  lastTranslation: null,
  lastGrade: null
};

function getModeDurationSeconds(mode = appState.timerMode) {
  if (mode === 'SPEAK_4') return 240;
  if (mode === 'SPEAK_CUSTOM') {
    const mins = Math.min(15, Math.max(1, Math.round(Number(appState.customSpeakMinutes) || 3)));
    appState.customSpeakMinutes = mins;
    return mins * 60;
  }
  if (mode === 'PREP') return 240;
  return 120;
}

function revokePlaybackUrl() {
  if (speakingSession.playbackUrl) {
    try {
      URL.revokeObjectURL(speakingSession.playbackUrl);
    } catch {
      // Ignore
    }
    speakingSession.playbackUrl = null;
  }
  const audioEl = document.getElementById('speaking-playback-audio');
  if (audioEl) {
    audioEl.removeAttribute('src');
    audioEl.classList.add('hidden');
  }
}

function updateCheckedChunksCounter() {
  const checked = document.querySelectorAll('.speaking-chunk-cb:checked').length;
  const total = appState.currentRequiredChunks.length;
  const countEl = document.getElementById('chunks-checked-count');
  if (countEl) {
    countEl.textContent = `${checked} / ${total} Used`;
  }
}

function syncTranscriptMetaAndChunks(text) {
  const clean = String(text || '').trim();
  const words = clean ? clean.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/g) || [] : [];
  const metaEl = document.getElementById('speaking-live-meta');
  if (metaEl) {
    metaEl.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`;
  }

  if (appState.currentRequiredChunks.length > 0 && clean) {
    const matchedIndices = detectMatchedChunks(appState.currentRequiredChunks, clean);
    document.querySelectorAll('.speaking-chunk-cb').forEach((cb) => {
      const idx = Number(cb.dataset.idx);
      if (matchedIndices.includes(idx)) {
        cb.checked = true;
      }
    });
    updateCheckedChunksCounter();
  }
}

function setMicButtonsUI(isListening) {
  speakingSession.recordingActive = Boolean(isListening);
  const startBtn = document.getElementById('speaking-mic-start-btn');
  const stopBtn = document.getElementById('speaking-stop-grade-btn');
  const statusEl = document.getElementById('speaking-mic-status');

  if (startBtn) {
    startBtn.classList.toggle('hidden', isListening);
  }
  if (stopBtn) {
    stopBtn.classList.toggle('hidden', !isListening);
  }
  if (statusEl && isListening) {
    const vp = getVoicePrefs();
    statusEl.className = 'text-[11px] font-bold text-rose-700';
    statusEl.textContent = `🔴 Recording & transcribing live (${vp.lang})... Speak your AP Cultural Comparison now.`;
  }
}

function clearResultsPanel() {
  const panel = document.getElementById('speaking-results-panel');
  const transOut = document.getElementById('speaking-translation-output');
  const gradeOut = document.getElementById('speaking-grade-output');
  if (panel) panel.classList.add('hidden');
  if (transOut) transOut.innerHTML = '';
  if (gradeOut) gradeOut.innerHTML = '';
  speakingSession.lastTranslation = null;
  speakingSession.lastGrade = null;
}

export function generateSpeakingChallenge() {
  stopSpeechSession();
  stopTimer();
  setMicButtonsUI(false);
  revokePlaybackUrl();
  clearResultsPanel();

  const transcriptEl = document.getElementById('speaking-transcript-input');
  if (transcriptEl) transcriptEl.value = '';
  syncTranscriptMetaAndChunks('');
  speakingSession.elapsedBeforePauseSec = 0;
  speakingSession.startedAtMs = 0;
  appState.timeRemaining = getModeDurationSeconds(appState.timerMode);
  updateTimerDisplay();

  const statusEl = document.getElementById('speaking-mic-status');
  if (statusEl) {
    statusEl.className = 'text-[11px] font-medium text-slate-500';
    statusEl.innerHTML = 'Ready — click <strong>Start Speaking + Mic</strong> to transcribe your Spanish live.';
  }

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
    label.className =
      'flex items-start gap-3 p-3 rounded-xl bg-white border border-amber-200/80 shadow-2xs cursor-pointer hover:border-indigo-400 transition';
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
  const safe = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const display = document.getElementById('timer-display');
  if (!display) return;
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
  if (speakingSession.startedAtMs > 0) {
    speakingSession.elapsedBeforePauseSec += Math.max(
      0,
      Math.round((Date.now() - speakingSession.startedAtMs) / 1000)
    );
    speakingSession.startedAtMs = 0;
  }
}

function startCountdownTimer(onComplete) {
  if (appState.timerInterval) return;
  if (appState.timeRemaining <= 0) {
    appState.timeRemaining = getModeDurationSeconds(appState.timerMode);
    speakingSession.elapsedBeforePauseSec = 0;
  }
  speakingSession.startedAtMs = Date.now();
  appState.timerInterval = setInterval(() => {
    appState.timeRemaining -= 1;
    updateTimerDisplay();
    if (appState.timeRemaining <= 0) {
      stopTimer();
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  }, 1000);
}

function setTimerMode(mode) {
  stopTimer();
  appState.timerMode = mode;
  speakingSession.elapsedBeforePauseSec = 0;
  appState.timeRemaining = getModeDurationSeconds(mode);
  updateTimerDisplay();

  const btnMap = {
    SPEAK_2: document.getElementById('timer-mode-speak2'),
    SPEAK_4: document.getElementById('timer-mode-speak4'),
    SPEAK_CUSTOM: document.getElementById('timer-mode-custom'),
    PREP: document.getElementById('timer-mode-prep')
  };

  const activeCls =
    'px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-xs transition cursor-pointer';
  const inactiveCls =
    'px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer';

  for (const [key, btn] of Object.entries(btnMap)) {
    if (btn) btn.className = key === mode ? activeCls : inactiveCls;
  }

  const customRow = document.getElementById('speaking-custom-duration-row');
  if (customRow) {
    if (mode === 'SPEAK_CUSTOM') {
      customRow.classList.remove('hidden');
      customRow.classList.add('flex');
    } else {
      customRow.classList.add('hidden');
      customRow.classList.remove('flex');
    }
  }
}

function renderTranslationCard(translationResult) {
  const outEl = document.getElementById('speaking-translation-output');
  if (!outEl) return;

  const clausesHtml = (translationResult.clauses || [])
    .map(
      (c, i) => `
      <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
        <div class="font-bold text-slate-900">
          <span class="text-indigo-600 mr-1">#${i + 1} ES:</span> ${escapeHtml(c.es)}
        </div>
        <div class="text-slate-700">
          <span class="font-bold text-emerald-700 mr-1">EN:</span> ${escapeHtml(c.en)}
        </div>
      </div>`
    )
    .join('');

  outEl.innerHTML = `
    <div class="bg-white border border-indigo-200 rounded-2xl p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <span class="inline-block px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[11px] font-extrabold uppercase tracking-wider mb-1">
            Step 1: Spanish → English Translation
          </span>
          <h4 class="text-base font-extrabold text-slate-900">What Your Spanish Speech Communicated</h4>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">${escapeHtml(translationResult.engineUsed)}</span>
          <span class="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
            ${translationResult.coveragePct}% local dictionary coverage
          </span>
        </div>
      </div>

      <p class="text-sm sm:text-base text-slate-800 leading-relaxed bg-indigo-50/40 border border-indigo-100 rounded-xl p-4">
        ${escapeHtml(translationResult.naturalEnglish || '(No speech detected)')}
      </p>

      ${
        clausesHtml
          ? `<details class="text-xs text-slate-600">
              <summary class="cursor-pointer font-bold text-indigo-700 hover:underline">
                View Clause-by-Clause Spanish ↔ English Breakdown (${translationResult.clauses.length} segments)
              </summary>
              <div class="mt-3 space-y-2 max-h-64 overflow-y-auto">${clausesHtml}</div>
            </details>`
          : ''
      }
    </div>
  `;
}

function renderGradeCard(gradeResult, translationResult, transcriptEs, durationSeconds) {
  const outEl = document.getElementById('speaking-grade-output');
  if (!outEl) return;

  const bandColors = {
    5: 'bg-emerald-600 text-white',
    4: 'bg-sky-600 text-white',
    3: 'bg-amber-500 text-white',
    2: 'bg-orange-600 text-white',
    1: 'bg-rose-600 text-white'
  };
  const bandCls = bandColors[gradeResult.apBand] || bandColors[3];
  const { chunksScore, comparisonScore, grammarVocabScore, fluencyScore } = gradeResult.subscores;

  const renderBar = (label, val, max, colorCls) => {
    const pct = Math.min(100, Math.round((val / max) * 100));
    return `
      <div class="space-y-1">
        <div class="flex items-center justify-between text-xs font-bold">
          <span class="text-slate-700">${label}</span>
          <span class="text-slate-900">${val} / ${max}</span>
        </div>
        <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full ${colorCls} transition-all duration-300" style="width: ${pct}%"></div>
        </div>
      </div>`;
  };

  const durationMinsLabel = Math.round((durationSeconds / 60) * 10) / 10;

  outEl.innerHTML = `
    <div class="bg-white border border-emerald-200 rounded-2xl p-5 shadow-xs space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <span class="inline-block px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-extrabold uppercase tracking-wider mb-1">
            Step 2: AP Task 4 Grade (${durationMinsLabel}-min Challenge)
          </span>
          <h4 class="text-base font-extrabold text-slate-900">Automated Speech Evaluation</h4>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-2xl font-extrabold text-slate-900">${gradeResult.totalScore} / 100</div>
            <div class="text-[11px] text-slate-500">Composite Score</div>
          </div>
          <span class="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold shadow-xs ${bandCls}">
            AP Band ${escapeHtml(gradeResult.apBandLabel)}
          </span>
        </div>
      </div>

      <!-- 4 Rubric Bars -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${renderBar('Required Chunks Woven In', chunksScore, 30, 'bg-indigo-600')}
        ${renderBar('Cultural Comparison & Relevance', comparisonScore, 30, 'bg-purple-600')}
        ${renderBar('Grammar, Tenses & Vocabulary', grammarVocabScore, 25, 'bg-emerald-600')}
        ${renderBar('Fluency, Length & Pacing', fluencyScore, 15, 'bg-sky-600')}
      </div>

      <!-- Speech Telemetry -->
      <div class="flex flex-wrap gap-2 text-xs font-semibold">
        <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
          ${gradeResult.metrics.wordCount} words spoken (goal: ~${gradeResult.metrics.targetWordGoal}+)
        </span>
        <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
          Pace: ~${gradeResult.metrics.wpm} WPM
        </span>
        <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
          ${gradeResult.metrics.uniqueVerbsCount} distinct verbs
        </span>
        ${
          gradeResult.metrics.tensesDetected.length > 0
            ? `<span class="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-800">
                Tenses: ${escapeHtml(gradeResult.metrics.tensesDetected.join(', '))}
              </span>`
            : ''
        }
      </div>

      <!-- Strengths & Improvements -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 space-y-2">
          <h5 class="text-xs font-extrabold uppercase tracking-wider text-emerald-900">✓ Strengths</h5>
          <ul class="space-y-1.5 text-xs text-emerald-950 list-disc pl-4">
            ${
              gradeResult.strengths.length > 0
                ? gradeResult.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
                : '<li>Keep practicing full comparative sentences to build strengths.</li>'
            }
          </ul>
        </div>
        <div class="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-2">
          <h5 class="text-xs font-extrabold uppercase tracking-wider text-amber-900">→ Next Steps to Reach a 5</h5>
          <ul class="space-y-1.5 text-xs text-amber-950 list-disc pl-4">
            ${
              gradeResult.improvements.length > 0
                ? gradeResult.improvements.map((imp) => `<li>${escapeHtml(imp)}</li>`).join('')
                : '<li>Excellent AP Task 4 coverage! Try a new prompt or longer 4-minute challenge.</li>'
            }
          </ul>
        </div>
      </div>

      ${
        gradeResult.nanoFeedback
          ? `<div class="bg-sky-50 border border-sky-200 rounded-xl p-4 space-y-1.5">
              <div class="text-xs font-extrabold text-sky-900">✨ On-Device Gemini Nano Notes (Zero API Keys)</div>
              <div class="text-xs text-sky-950 whitespace-pre-line leading-relaxed">${escapeHtml(gradeResult.nanoFeedback)}</div>
            </div>`
          : ''
      }

      <!-- Optional 1-Click External Gemini Bridge -->
      <div class="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p class="text-[11px] text-slate-500">
          Want deeper AI feedback from your own logged-in Gemini web session? Copies your prompt + Spanish transcript + translation ready to paste:
        </p>
        <button id="speaking-open-gemini-btn" type="button" class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-2xs transition cursor-pointer">
          📋 Copy Prompt &amp; Open gemini.google.com ↗
        </button>
      </div>
    </div>
  `;

  const openGeminiBtn = document.getElementById('speaking-open-gemini-btn');
  if (openGeminiBtn) {
    openGeminiBtn.onclick = async () => {
      const promptText = buildGeminiExternalPrompt({
        prompt: appState.currentPrompt,
        requiredChunks: appState.currentRequiredChunks,
        transcriptEs,
        translationResult,
        gradeResult,
        durationSeconds
      });
      try {
        await navigator.clipboard.writeText(promptText);
        showToast('Prompt + transcript copied! Paste into gemini.google.com.', 'success');
      } catch {
        showToast('Opened gemini.google.com — copy your transcript if clipboard was blocked.', 'info');
      }
      window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer');
    };
  }
}

async function runTranslateAndGrade() {
  if (speakingSession.recordingActive) {
    stopSpeechSession();
    setMicButtonsUI(false);
  }
  stopTimer();

  const transcriptEl = document.getElementById('speaking-transcript-input');
  const transcriptEs = transcriptEl ? transcriptEl.value.trim() : '';
  if (!transcriptEs) {
    showToast('Speak into your microphone or paste Spanish text first.', 'error');
    return;
  }

  const analyzeBtn = document.getElementById('speaking-translate-grade-btn');
  const origBtnLabel = analyzeBtn ? analyzeBtn.textContent : 'Translate & Grade Speech';
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Translating → Grading...';
  }

  const statusEl = document.getElementById('speaking-mic-status');
  if (statusEl) {
    statusEl.className = 'text-[11px] font-semibold text-indigo-700';
    statusEl.textContent = 'Step 1: Translating your Spanish speech to English...';
  }

  try {
    // Step 1: Translate Spanish speech -> English BEFORE grading
    const translationResult = await translateSpanishSpeech(transcriptEs);
    speakingSession.lastTranslation = translationResult;

    const panel = document.getElementById('speaking-results-panel');
    if (panel) panel.classList.remove('hidden');
    renderTranslationCard(translationResult);

    if (statusEl) {
      statusEl.textContent = 'Step 2: Grading Cultural Comparison & AP Task 4 Rubric...';
    }

    const durationSeconds = getModeDurationSeconds(appState.timerMode);
    const elapsedSeconds =
      speakingSession.elapsedBeforePauseSec > 0
        ? speakingSession.elapsedBeforePauseSec
        : Math.max(10, durationSeconds - (appState.timeRemaining || 0));

    // Step 2: Grade after translation
    const gradeResult = await gradeSpeakingChallenge({
      transcriptEs,
      translationResult,
      prompt: appState.currentPrompt,
      requiredChunks: appState.currentRequiredChunks,
      durationSeconds,
      elapsedSeconds
    });
    speakingSession.lastGrade = gradeResult;

    // Sync matched chunks checkboxes
    document.querySelectorAll('.speaking-chunk-cb').forEach((cb) => {
      const idx = Number(cb.dataset.idx);
      if (gradeResult.matchedChunkIndices.includes(idx)) {
        cb.checked = true;
      }
    });
    updateCheckedChunksCounter();

    renderGradeCard(gradeResult, translationResult, transcriptEs, durationSeconds);
    if (statusEl) {
      statusEl.className = 'text-[11px] font-semibold text-emerald-700';
      statusEl.textContent = `✓ Translated (${translationResult.coveragePct}% coverage) & Graded: AP Band ${gradeResult.apBand} (${gradeResult.totalScore}/100).`;
    }
    panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    showToast(`Speech analysis error: ${err.message || err}`, 'error');
    if (statusEl) {
      statusEl.className = 'text-[11px] font-semibold text-rose-700';
      statusEl.textContent = 'Could not finish analyzing speech. Please try again.';
    }
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = origBtnLabel;
    }
  }
}

function startSpeakingMicSession() {
  if (!isSpeechRecognitionSupported()) {
    const msg = 'Live microphone transcription requires Chrome or Edge. You can still type or paste Spanish below and click "Translate & Grade Speech".';
    const statusEl = document.getElementById('speaking-mic-status');
    if (statusEl) {
      statusEl.className = 'text-[11px] font-semibold text-amber-800';
      statusEl.textContent = msg;
    }
    showToast(msg, 'error');
    return;
  }

  // Warm up local dictionaries immediately for instant accent restoration & post-speech translation
  loadVocabularyPack().catch(() => {});
  loadVerbsPack().catch(() => {});

  revokePlaybackUrl();
  clearResultsPanel();

  const transcriptEl = document.getElementById('speaking-transcript-input');
  const existingText = transcriptEl ? transcriptEl.value.trim() : '';
  const vp = getVoicePrefs();

  if (appState.timeRemaining <= 0) {
    appState.timeRemaining = getModeDurationSeconds(appState.timerMode);
    speakingSession.elapsedBeforePauseSec = 0;
    updateTimerDisplay();
  }

  setMicButtonsUI(true);
  startCountdownTimer(() => {
    showToast('¡Tiempo! Translating and grading your speech...', 'info');
    runTranslateAndGrade();
  });

  speakingSession.ctrl = startContinuousSpeakingSession({
    lang: vp.lang,
    initialTranscript: existingText,
    onStateChange: (state) => {
      if (state === 'idle') {
        setMicButtonsUI(false);
        stopTimer();
      }
    },
    onTranscriptUpdate: (fullText) => {
      if (transcriptEl) {
        transcriptEl.value = fullText;
      }
      syncTranscriptMetaAndChunks(fullText);
    },
    onAudioReady: (audioUrl) => {
      revokePlaybackUrl();
      speakingSession.playbackUrl = audioUrl;
      const audioEl = document.getElementById('speaking-playback-audio');
      if (audioEl) {
        audioEl.src = audioUrl;
        audioEl.classList.remove('hidden');
      }
    },
    onError: (msg) => {
      setMicButtonsUI(false);
      stopTimer();
      const statusEl = document.getElementById('speaking-mic-status');
      if (statusEl) {
        statusEl.className = 'text-[11px] font-semibold text-rose-700';
        statusEl.textContent = msg;
      }
      showToast(msg, 'error');
    }
  });
}

export function initSpeaking() {
  appHooks.generateSpeakingChallenge = generateSpeakingChallenge;

  document.getElementById('timer-mode-speak2').onclick = () => setTimerMode('SPEAK_2');
  document.getElementById('timer-mode-speak4').onclick = () => setTimerMode('SPEAK_4');
  document.getElementById('timer-mode-custom').onclick = () => setTimerMode('SPEAK_CUSTOM');
  document.getElementById('timer-mode-prep').onclick = () => setTimerMode('PREP');

  const customMinEl = document.getElementById('speaking-custom-minutes');
  if (customMinEl) {
    customMinEl.addEventListener('change', () => {
      const mins = Math.min(15, Math.max(1, Math.round(Number(customMinEl.value) || 3)));
      customMinEl.value = String(mins);
      appState.customSpeakMinutes = mins;
      if (appState.timerMode === 'SPEAK_CUSTOM') {
        stopTimer();
        speakingSession.elapsedBeforePauseSec = 0;
        appState.timeRemaining = mins * 60;
        updateTimerDisplay();
      }
    });
  }

  document.getElementById('new-speaking-challenge-btn').onclick = generateSpeakingChallenge;
  document.getElementById('speak-prompt-btn').onclick = () => {
    if (appState.currentPrompt) speakSpanish(appState.currentPrompt.es);
  };

  document.getElementById('speaking-mic-start-btn').onclick = startSpeakingMicSession;
  document.getElementById('speaking-stop-grade-btn').onclick = runTranslateAndGrade;
  document.getElementById('speaking-translate-grade-btn').onclick = runTranslateAndGrade;

  const transcriptEl = document.getElementById('speaking-transcript-input');
  if (transcriptEl) {
    transcriptEl.addEventListener('input', () => {
      syncTranscriptMetaAndChunks(transcriptEl.value);
      if (speakingSession.ctrl && typeof speakingSession.ctrl.setBaseTranscript === 'function') {
        speakingSession.ctrl.setBaseTranscript(transcriptEl.value);
      }
    });
  }

  document.getElementById('speaking-clear-transcript-btn').onclick = () => {
    stopSpeechSession();
    setMicButtonsUI(false);
    revokePlaybackUrl();
    clearResultsPanel();
    if (transcriptEl) transcriptEl.value = '';
    syncTranscriptMetaAndChunks('');
    const statusEl = document.getElementById('speaking-mic-status');
    if (statusEl) {
      statusEl.className = 'text-[11px] font-medium text-slate-500';
      statusEl.innerHTML = 'Transcript cleared — click <strong>Start Speaking + Mic</strong> to record again.';
    }
  };

  document.getElementById('timer-start-btn').onclick = () => {
    startCountdownTimer(() => {
      if (speakingSession.recordingActive) {
        showToast('¡Tiempo! Translating and grading your speech...', 'info');
        runTranslateAndGrade();
      } else {
        showToast(
          appState.timerMode === 'PREP'
            ? '4-Minute Prep complete! Switch to 2:00 or 4:00 Speaking timer.'
            : '¡Tiempo! AP Cultural Comparison time complete.',
          'info'
        );
      }
    });
  };

  document.getElementById('timer-pause-btn').onclick = () => {
    stopTimer();
    if (speakingSession.recordingActive) {
      stopSpeechSession();
      setMicButtonsUI(false);
      const statusEl = document.getElementById('speaking-mic-status');
      if (statusEl) {
        statusEl.className = 'text-[11px] font-semibold text-amber-700';
        statusEl.textContent = 'Paused — click "Start Speaking + Mic" to continue or "Translate & Grade Speech" now.';
      }
    }
  };

  document.getElementById('timer-reset-btn').onclick = () => {
    stopSpeechSession();
    setMicButtonsUI(false);
    stopTimer();
    speakingSession.elapsedBeforePauseSec = 0;
    appState.timeRemaining = getModeDurationSeconds(appState.timerMode);
    updateTimerDisplay();
  };

  setTimerMode(appState.timerMode || 'SPEAK_2');
}
