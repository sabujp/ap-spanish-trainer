import { normalizeSpanishAnswer, stripSpanishDiacritics } from './constants.js';
import { appHooks, appState, normalizeVoiceInputPrefs, saveUserPrefs } from './storage.js';

const BASE_UNAMBIGUOUS_ACCENTS = {
  ademas: 'además',
  tambien: 'también',
  despues: 'después',
  asi: 'así',
  aqui: 'aquí',
  ahi: 'ahí',
  alla: 'allá',
  todavia: 'todavía',
  quizas: 'quizás',
  pais: 'país',
  paises: 'países',
  facil: 'fácil',
  dificil: 'difícil',
  rapido: 'rápido',
  rapida: 'rápida',
  rapidamente: 'rápidamente',
  tecnologia: 'tecnología',
  educacion: 'educación',
  informacion: 'información',
  comunicacion: 'comunicación',
  economia: 'economía',
  politica: 'política',
  musica: 'música',
  pelicula: 'película',
  periodico: 'periódico',
  telefono: 'teléfono',
  numero: 'número',
  proximo: 'próximo',
  proxima: 'próxima',
  ultimo: 'último',
  ultima: 'última',
  unico: 'único',
  unica: 'única',
  publico: 'público',
  publica: 'pública',
  estan: 'están',
  estas: 'estás',
  seria: 'sería',
  podria: 'podría',
  deberia: 'debería',
  habria: 'habría',
  tendria: 'tendría',
  espanol: 'español',
  espanola: 'española',
  espanoles: 'españoles',
  espanolas: 'españolas',
  espana: 'España',
  mexico: 'México',
  peru: 'Perú',
  nino: 'niño',
  nina: 'niña',
  ninos: 'niños',
  ninas: 'niñas',
  ano: 'año',
  anos: 'años',
  manana: 'mañana',
  dia: 'día',
  dias: 'días',
  hablais: 'habláis',
  comiais: 'comíais',
  viviais: 'vivíais',
  teneis: 'tenéis',
  podeis: 'podéis',
  quereis: 'queréis',
  sois: 'sois',
  estais: 'estáis',
  habeis: 'habéis'
};

const SUBJECT_PRONOUN_PREFIX_RE =
  /^(?:yo|t[uú]|el|[eé]l|ella|usted|ud\.?|nosotros|nosotras|vosotros|vosotras|ellos|ellas|ustedes|uds\.?)\s+/i;

const NUMBER_WORDS_ES = {
  '0': 'cero',
  '1': 'uno',
  '2': 'dos',
  '3': 'tres',
  '4': 'cuatro',
  '5': 'cinco',
  '6': 'seis',
  '7': 'siete',
  '8': 'ocho',
  '9': 'nueve',
  '10': 'diez',
  '11': 'once',
  '12': 'doce',
  '13': 'trece',
  '14': 'catorce',
  '15': 'quince',
  '16': 'dieciséis',
  '17': 'diecisiete',
  '18': 'dieciocho',
  '19': 'diecinueve',
  '20': 'veinte',
  '30': 'treinta',
  '40': 'cuarenta',
  '50': 'cincuenta',
  '60': 'sesenta',
  '70': 'setenta',
  '80': 'ochenta',
  '90': 'noventa',
  '100': 'cien'
};

const NUMBER_WORDS_EN = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '11': 'eleven',
  '12': 'twelve',
  '13': 'thirteen',
  '14': 'fourteen',
  '15': 'fifteen',
  '16': 'sixteen',
  '17': 'seventeen',
  '18': 'eighteen',
  '19': 'nineteen',
  '20': 'twenty'
};

let cachedAccentMap = null;
let cachedAccentPackRefs = { vocab: null, verbs: null };

let activeSpeechController = null;
let autoSubmitTimer = null;
let autoSubmitTickInterval = null;

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognitionCtor());
}

export function getVoicePrefs() {
  appState.userPrefs.voiceInput = normalizeVoiceInputPrefs(appState.userPrefs.voiceInput);
  return appState.userPrefs.voiceInput;
}

export function setVoiceModeEnabled(enabled, triggerSync = true) {
  const vi = getVoicePrefs();
  vi.enabled = Boolean(enabled);
  for (const id of [
    'chunks-voice-mode-checkbox',
    'vocab-voice-mode-checkbox',
    'conj-voice-mode-checkbox',
    'settings-voice-mode-checkbox'
  ]) {
    const el = document.getElementById(id);
    if (el) el.checked = vi.enabled;
  }
  saveUserPrefs(triggerSync, true);
  appHooks.onVoicePrefsChanged();
}

export function cancelAutoSubmitCountdown(onCancelled = null) {
  if (autoSubmitTimer) {
    clearTimeout(autoSubmitTimer);
    autoSubmitTimer = null;
  }
  if (autoSubmitTickInterval) {
    clearInterval(autoSubmitTickInterval);
    autoSubmitTickInterval = null;
  }
  if (typeof onCancelled === 'function') {
    onCancelled();
  }
}

export function scheduleAutoSubmitCountdown(delaySec, onTick, onFire) {
  cancelAutoSubmitCountdown();
  const safeSec = Math.min(10, Math.max(1, Math.round(Number(delaySec) || 3)));
  let remaining = safeSec;
  if (typeof onTick === 'function') onTick(remaining);

  autoSubmitTickInterval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0 && typeof onTick === 'function') {
      onTick(remaining);
    }
  }, 1000);

  autoSubmitTimer = setTimeout(() => {
    cancelAutoSubmitCountdown();
    if (typeof onTick === 'function') onTick(0);
    if (typeof onFire === 'function') onFire();
  }, safeSec * 1000);
}

export function stopSpeechSession() {
  cancelAutoSubmitCountdown();
  if (activeSpeechController && typeof activeSpeechController.stop === 'function') {
    const ctrl = activeSpeechController;
    activeSpeechController = null;
    ctrl.stop(true);
  }
}

function getUnambiguousSpanishAccentMap() {
  const vocabPack = appState.vocabPack || null;
  const verbsPack = appState.verbsPack || null;
  if (
    cachedAccentMap &&
    cachedAccentPackRefs.vocab === vocabPack &&
    cachedAccentPackRefs.verbs === verbsPack
  ) {
    return cachedAccentMap;
  }

  const variantsByBare = new Map();
  const recordWord = (rawWord) => {
    const w = String(rawWord || '').trim().toLowerCase();
    if (!w || w.includes(' ') || !/[a-záéíóúüñ]/.test(w)) return;
    const bare = stripSpanishDiacritics(w);
    if (!bare) return;
    let set = variantsByBare.get(bare);
    if (!set) {
      set = new Set();
      variantsByBare.set(bare, set);
    }
    set.add(w);
  };

  if (vocabPack && vocabPack.wordMap) {
    for (const entry of vocabPack.wordMap.values()) {
      recordWord(entry.es);
    }
  }
  if (verbsPack && Array.isArray(verbsPack.verbs)) {
    for (const v of verbsPack.verbs) {
      recordWord(v.infinitive);
      recordWord(v.gerund);
      recordWord(v.participle);
      for (const forms of Object.values(v.tenses || {})) {
        if (!Array.isArray(forms)) continue;
        for (const f of forms) {
          for (const part of String(f).split(/\s+/)) {
            recordWord(part);
          }
        }
      }
    }
  }

  const finalMap = new Map(Object.entries(BASE_UNAMBIGUOUS_ACCENTS));
  for (const [bare, variants] of variantsByBare.entries()) {
    if (variants.size === 1) {
      const [onlyForm] = variants;
      if (onlyForm !== bare) {
        finalMap.set(bare, onlyForm);
      }
    }
  }

  cachedAccentMap = finalMap;
  cachedAccentPackRefs = { vocab: vocabPack, verbs: verbsPack };
  return finalMap;
}

function matchCasing(sourceToken, targetLower) {
  if (!sourceToken || !targetLower) return targetLower;
  if (sourceToken === sourceToken.toUpperCase() && sourceToken.length > 1) {
    return targetLower.toUpperCase();
  }
  if (sourceToken[0] === sourceToken[0].toUpperCase()) {
    return targetLower[0].toUpperCase() + targetLower.slice(1);
  }
  return targetLower;
}

export function restoreUnambiguousSpanishAccents(text) {
  const accentMap = getUnambiguousSpanishAccentMap();
  return String(text || '').replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (tok) => {
    const lower = tok.toLowerCase();
    const bare = stripSpanishDiacritics(lower);
    const mapped = accentMap.get(bare);
    if (!mapped) return tok;
    // Preserve explicit accents if token already contains one and matches bare
    if (/[áéíóúüñ]/i.test(tok) && bare === stripSpanishDiacritics(mapped)) {
      return tok;
    }
    return matchCasing(tok, mapped);
  });
}

function stripOuterPunctuation(str) {
  return String(str || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[¿¡.,;:!?"'()]+|[¿¡.,;:!?"'()]+$/g, '')
    .trim();
}

export function stripLeadingSubjectPronoun(text, expectedCandidates = []) {
  const clean = stripOuterPunctuation(text);
  if (!clean) return '';
  const hasPronounExpected = expectedCandidates.some((c) =>
    SUBJECT_PRONOUN_PREFIX_RE.test(stripOuterPunctuation(c))
  );
  if (hasPronounExpected) return clean;
  return clean.replace(SUBJECT_PRONOUN_PREFIX_RE, '').trim();
}

function replaceDigitsWithSpokenWords(text, lang = 'es-US') {
  const map = String(lang).startsWith('en') ? NUMBER_WORDS_EN : NUMBER_WORDS_ES;
  return String(text || '').replace(/\b\d+\b/g, (num) => map[num] || num);
}

export function applyVoiceTranscriptTransform(rawText, options = {}) {
  const {
    lang = 'es-US',
    expectedCandidates = [],
    stripPronounForVerb = false,
    preservePunctuation = false
  } = options;

  const voicePrefs = getVoicePrefs();
  let text = String(rawText || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';

  if (!preservePunctuation) {
    text = stripOuterPunctuation(text);
  }

  if (stripPronounForVerb) {
    text = stripLeadingSubjectPronoun(text, expectedCandidates);
  }

  const isSpanish = String(lang).toLowerCase().startsWith('es');
  const normList = expectedCandidates
    .map((c) => ({
      raw: String(c || '').trim(),
      bare: stripSpanishDiacritics(stripOuterPunctuation(c).toLowerCase())
    }))
    .filter((c) => c.bare);

  // Check direct or digit-expanded match against expected answers (restores exact Spanish accents!)
  if (normList.length > 0) {
    const candidatesToTry = [
      stripOuterPunctuation(text),
      stripOuterPunctuation(replaceDigitsWithSpokenWords(text, lang))
    ];
    for (const candText of candidatesToTry) {
      const bareInput = stripSpanishDiacritics(candText.toLowerCase());
      const exactCand = normList.find((c) => c.bare === bareInput);
      if (exactCand) {
        return isSpanish && !voicePrefs.autoAccents ? candText : exactCand.raw;
      }
    }
  }

  if (isSpanish && voicePrefs.autoAccents) {
    text = restoreUnambiguousSpanishAccents(text);
  }

  return text;
}

function pickBestSpeechAlternative(alternatives, options) {
  const { lang = 'es-US', expectedCandidates = [], stripPronounForVerb = false } = options;
  if (!alternatives || alternatives.length === 0) return '';

  const expectedBare = expectedCandidates
    .map((c) => stripSpanishDiacritics(stripOuterPunctuation(c).toLowerCase()))
    .filter(Boolean);

  if (expectedBare.length > 0) {
    for (const alt of alternatives) {
      let cleaned = stripOuterPunctuation(alt);
      if (stripPronounForVerb) {
        cleaned = stripLeadingSubjectPronoun(cleaned, expectedCandidates);
      }
      const variants = [
        stripSpanishDiacritics(cleaned.toLowerCase()),
        stripSpanishDiacritics(replaceDigitsWithSpokenWords(cleaned, lang).toLowerCase())
      ];
      if (variants.some((v) => expectedBare.includes(v))) {
        return applyVoiceTranscriptTransform(alt, options);
      }
    }
  }

  return applyVoiceTranscriptTransform(alternatives[0], options);
}

export function startSingleShotVoiceInput({
  lang,
  expectedCandidates = [],
  stripPronounForVerb = false,
  onInterim,
  onResult,
  onAutoSubmitCountdown,
  onStateChange,
  onError
} = {}) {
  const RecCtor = getSpeechRecognitionCtor();
  if (!RecCtor) {
    if (typeof onError === 'function') {
      onError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
    }
    return null;
  }

  // Toggle off if already recording single-shot
  if (activeSpeechController && activeSpeechController.mode === 'single') {
    stopSpeechSession();
    return null;
  }
  stopSpeechSession();

  const voicePrefs = getVoicePrefs();
  const targetLang = lang || voicePrefs.lang || 'es-US';
  const recognition = new RecCtor();
  recognition.lang = targetLang;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;

  let stoppedManually = false;
  let receivedFinal = false;

  const ctrl = {
    mode: 'single',
    stop: (abort = false) => {
      stoppedManually = true;
      if (activeSpeechController === ctrl) {
        activeSpeechController = null;
      }
      try {
        if (abort) recognition.abort();
        else recognition.stop();
      } catch {
        // Ignore stop errors
      }
      if (typeof onStateChange === 'function') onStateChange('idle');
    }
  };
  activeSpeechController = ctrl;

  recognition.onstart = () => {
    if (typeof onStateChange === 'function') onStateChange('listening');
  };

  recognition.onresult = (event) => {
    let interimText = '';
    let finalAlts = [];

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        receivedFinal = true;
        finalAlts = [];
        for (let k = 0; k < res.length; k++) {
          if (res[k]?.transcript) finalAlts.push(res[k].transcript);
        }
      } else {
        interimText += res[0]?.transcript || '';
      }
    }

    if (interimText && typeof onInterim === 'function') {
      const transformedInterim = applyVoiceTranscriptTransform(interimText, {
        lang: targetLang,
        expectedCandidates,
        stripPronounForVerb
      });
      onInterim(transformedInterim);
    }

    if (finalAlts.length > 0 && typeof onResult === 'function') {
      const best = pickBestSpeechAlternative(finalAlts, {
        lang: targetLang,
        expectedCandidates,
        stripPronounForVerb
      });
      onResult(best, finalAlts);
    }
  };

  recognition.onerror = (event) => {
    const code = event?.error || 'unknown';
    if (code === 'aborted' && stoppedManually) return;
    const msg =
      code === 'not-allowed' || code === 'service-not-allowed'
        ? 'Microphone permission denied. Allow mic access in your browser.'
        : code === 'no-speech'
          ? 'No speech detected — try speaking closer to the mic.'
          : `Voice detection error: ${code}`;
    if (typeof onError === 'function') onError(msg, code);
  };

  recognition.onend = () => {
    if (activeSpeechController === ctrl) {
      activeSpeechController = null;
    }
    if (typeof onStateChange === 'function') onStateChange('idle');
    if (!stoppedManually && receivedFinal && voicePrefs.autoSubmit && typeof onAutoSubmitCountdown === 'function') {
      onAutoSubmitCountdown(voicePrefs.autoSubmitDelaySec);
    }
  };

  try {
    recognition.start();
  } catch (err) {
    activeSpeechController = null;
    if (typeof onError === 'function') onError(err.message || 'Could not start microphone.');
    return null;
  }

  return ctrl;
}

export function startContinuousSpeakingSession({
  lang,
  initialTranscript = '',
  onTranscriptUpdate,
  onStateChange,
  onAudioReady,
  onError
} = {}) {
  const RecCtor = getSpeechRecognitionCtor();
  if (!RecCtor) {
    if (typeof onError === 'function') {
      onError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
    }
    return null;
  }

  stopSpeechSession();

  const voicePrefs = getVoicePrefs();
  const targetLang = lang || voicePrefs.lang || 'es-US';
  let active = true;
  let committedParts = initialTranscript && initialTranscript.trim() ? [initialTranscript.trim()] : [];
  let currentInterim = '';
  let recognition = null;
  let restartTimer = null;

  // Optional parallel audio recording for student playback
  let mediaRecorder = null;
  let mediaStream = null;
  const audioChunks = [];

  const emitTranscript = () => {
    const full = [...committedParts, currentInterim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (typeof onTranscriptUpdate === 'function') {
      onTranscriptUpdate(full, committedParts.join(' '), currentInterim);
    }
  };

  const stopMediaRecorder = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {
        // Ignore
      }
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  };

  const launchRecognition = () => {
    if (!active) return;
    recognition = new RecCtor();
    recognition.lang = targetLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      if (typeof onStateChange === 'function') onStateChange('listening');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = String(res[0]?.transcript || '').trim();
        if (!txt) continue;
        if (res.isFinal) {
          const transformed = applyVoiceTranscriptTransform(txt, {
            lang: targetLang,
            preservePunctuation: true
          });
          if (transformed) committedParts.push(transformed);
        } else {
          interim = interim ? `${interim} ${txt}` : txt;
        }
      }
      currentInterim = interim
        ? applyVoiceTranscriptTransform(interim, {
            lang: targetLang,
            preservePunctuation: true
          })
        : '';
      emitTranscript();
    };

    recognition.onerror = (event) => {
      const code = event?.error || 'unknown';
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        active = false;
        stopMediaRecorder();
        if (typeof onError === 'function') {
          onError('Microphone permission denied. Allow mic access in your browser.');
        }
        if (typeof onStateChange === 'function') onStateChange('idle');
      }
    };

    recognition.onend = () => {
      if (currentInterim) {
        committedParts.push(currentInterim);
        currentInterim = '';
        emitTranscript();
      }
      if (active) {
        // Chrome ends continuous speech after ~60s or silence; seamlessly restart
        restartTimer = setTimeout(() => {
          if (active) launchRecognition();
        }, 180);
      } else if (typeof onStateChange === 'function') {
        onStateChange('idle');
      }
    };

    try {
      recognition.start();
    } catch {
      if (active) {
        restartTimer = setTimeout(launchRecognition, 350);
      }
    }
  };

  // Request audio stream for optional playback (non-fatal if MediaRecorder unsupported)
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStream = stream;
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) audioChunks.push(ev.data);
        };
        mediaRecorder.onstop = () => {
          if (audioChunks.length > 0 && typeof onAudioReady === 'function') {
            const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const url = URL.createObjectURL(blob);
            onAudioReady(url, blob);
          }
        };
        mediaRecorder.start();
      })
      .catch(() => {
        // SpeechRecognition can still operate independently if audio recording fails
      });
  }

  launchRecognition();

  const ctrl = {
    mode: 'continuous',
    getTranscript: () =>
      [...committedParts, currentInterim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    setBaseTranscript: (txt) => {
      committedParts = txt && txt.trim() ? [txt.trim()] : [];
      currentInterim = '';
    },
    stop: (abort = false) => {
      active = false;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (activeSpeechController === ctrl) {
        activeSpeechController = null;
      }
      if (recognition) {
        try {
          if (abort) recognition.abort();
          else recognition.stop();
        } catch {
          // Ignore
        }
      }
      stopMediaRecorder();
      if (typeof onStateChange === 'function') onStateChange('idle');
    }
  };

  activeSpeechController = ctrl;
  return ctrl;
}

if (typeof appHooks !== 'undefined') {
  appHooks.stopActiveVoiceSession = stopSpeechSession;
}
