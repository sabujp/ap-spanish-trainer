import { THEME_MODE_LABELS } from './constants.js';
import { appHooks, appState, saveAudioPrefs } from './storage.js';
import { showToast } from './ui.js';

export function isRoboticLocalVoice(voice) {
  const name = (voice.name || '').toLowerCase();
  return (
    name.includes('espeak') ||
    name.includes('chrome os') ||
    name.includes('chromeos') ||
    (voice.localService && !name.includes('google') && !name.includes('paulina') && !name.includes('monica') && !name.includes('jorge'))
  );
}

export function getBestGoogleBrowserVoice() {
  const voices = appState.spanishVoices;
  if (!voices.length) return null;
  if (appState.audioPrefs.selectedVoiceName) {
    const exact = voices.find((v) => v.name === appState.audioPrefs.selectedVoiceName);
    if (exact) return exact;
  }
  const googleUs = voices.find(
    (v) => v.name.toLowerCase().includes('google') && v.lang.toLowerCase() === 'es-us'
  );
  if (googleUs) return googleUs;

  const anyGoogle = voices.find((v) => v.name.toLowerCase().includes('google'));
  if (anyGoogle) return anyGoogle;

  const nonRobotic = voices.find((v) => !isRoboticLocalVoice(v));
  if (nonRobotic) return nonRobotic;

  return voices[0];
}

export function updateAudioBadgeUI() {
  const btnEl = document.getElementById('open-settings-btn');
  const badgeEl = document.getElementById('active-voice-badge');
  const dotEl = document.getElementById('audio-engine-dot');
  const tier1Tag = document.getElementById('tier1-status-tag');
  const tier2Tag = document.getElementById('tier2-status-tag');
  const warningBox = document.getElementById('chromeos-sandbox-warning');

  const bestBrowserVoice = getBestGoogleBrowserVoice();
  const isGoogleCloudVoice = Boolean(bestBrowserVoice && bestBrowserVoice.name.toLowerCase().includes('google'));
  const isRobotic = Boolean(bestBrowserVoice && isRoboticLocalVoice(bestBrowserVoice));
  const hasGcpKey = Boolean(appState.audioPrefs.gcpApiKey && appState.audioPrefs.gcpApiKey.trim().length > 10);

  if (warningBox) {
    if (!isGoogleCloudVoice && !hasGcpKey) {
      warningBox.classList.remove('hidden');
    } else {
      warningBox.classList.add('hidden');
    }
  }

  if (tier2Tag) {
    if (hasGcpKey) {
      tier2Tag.textContent = 'Ready (Key Saved)';
      tier2Tag.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    } else {
      tier2Tag.textContent = 'Not Configured';
      tier2Tag.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700';
    }
  }

  let voiceSummary = 'Detecting Voice...';
  if ((appState.audioPrefs.forceGcp || !isGoogleCloudVoice) && hasGcpKey) {
    voiceSummary = `Cloud Neural: ${appState.audioPrefs.gcpVoiceName}`;
    if (badgeEl) badgeEl.textContent = voiceSummary;
    if (dotEl) dotEl.className = 'w-2 h-2 rounded-full bg-sky-500';
    if (tier1Tag) {
      tier1Tag.textContent = isGoogleCloudVoice ? 'Standby' : 'Hidden in Local/Sandbox';
      tier1Tag.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700';
    }
  } else if (bestBrowserVoice && !isRobotic) {
    voiceSummary = bestBrowserVoice.name;
    if (badgeEl) badgeEl.textContent = voiceSummary;
    if (dotEl) dotEl.className = 'w-2 h-2 rounded-full bg-emerald-500';
    if (tier1Tag) {
      tier1Tag.textContent = isGoogleCloudVoice ? 'Google Neural Active' : 'System Voice Active';
      tier1Tag.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    }
  } else {
    voiceSummary = 'Robotic Local Voice (Fix Audio)';
    if (badgeEl) badgeEl.textContent = voiceSummary;
    if (dotEl) dotEl.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
    if (tier1Tag) {
      tier1Tag.textContent = 'Offline eSpeak Only';
      tier1Tag.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800';
    }
  }

  if (btnEl) {
    btnEl.title = `Settings • Theme: ${THEME_MODE_LABELS[appState.userPrefs.themeMode] || 'Light'} • Voice: ${voiceSummary}`;
  }
}

export function populateVoices() {
  if (!('speechSynthesis' in window)) {
    updateAudioBadgeUI();
    return;
  }
  const allVoices = window.speechSynthesis.getVoices();
  const rawSpanish = allVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('es'));

  const cleanVoices = rawSpanish.filter((v) => !isRoboticLocalVoice(v));
  const sorted = (cleanVoices.length > 0 ? cleanVoices : rawSpanish).slice();

  sorted.sort((a, b) => {
    const score = (v) => {
      const n = v.name.toLowerCase();
      const l = v.lang.toLowerCase();
      if (n.includes('google') && l === 'es-us') return 0;
      if (n.includes('google')) return 1;
      if (l === 'es-ar' || l === 'es-419') return 2;
      return 3;
    };
    return score(a) - score(b);
  });

  appState.spanishVoices = sorted;

  const select = document.getElementById('voice-select');
  if (select) {
    select.innerHTML = '<option value="">Auto-Detect Google Spanish Neural Voice</option>';
    sorted.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    });

    if (appState.audioPrefs.selectedVoiceName && sorted.some((v) => v.name === appState.audioPrefs.selectedVoiceName)) {
      select.value = appState.audioPrefs.selectedVoiceName;
    }
  }
  updateAudioBadgeUI();
}

async function speakViaGoogleCloudTTS(text, rate = 1.0) {
  const apiKey = (appState.audioPrefs.gcpApiKey || '').trim();
  if (!apiKey) return false;

  const voiceName = appState.audioPrefs.gcpVoiceName || 'es-US-Neural2-B';
  const languageCode = voiceName.slice(0, 5);
  const cacheKey = `${voiceName}|${rate}|${text}`;

  try {
    if (appState.activeAudioElement) {
      appState.activeAudioElement.pause();
      appState.activeAudioElement = null;
    }

    let base64Audio = appState.cloudAudioCache.get(cacheKey);
    if (!base64Audio) {
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode, name: voiceName },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: rate
            }
          })
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.audioContent) throw new Error('No audio returned from Google Cloud TTS.');
      base64Audio = data.audioContent;
      appState.cloudAudioCache.set(cacheKey, base64Audio);
    }

    const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
    appState.activeAudioElement = audio;
    await audio.play();
    return true;
  } catch (err) {
    showToast(`Google Cloud TTS error: ${err.message}. Falling back to browser voice.`, 'error');
    return false;
  }
}

export async function speakSpanish(text, rate = 1.0) {
  if (!text) return;
  const bestVoice = getBestGoogleBrowserVoice();
  const hasGoogleBrowserVoice = bestVoice && bestVoice.name.toLowerCase().includes('google');
  const hasGcpKey = Boolean(appState.audioPrefs.gcpApiKey && appState.audioPrefs.gcpApiKey.trim().length > 10);

  if (hasGcpKey && (appState.audioPrefs.forceGcp || !hasGoogleBrowserVoice)) {
    const ok = await speakViaGoogleCloudTTS(text, rate);
    if (ok) return;
  }

  if (!('speechSynthesis' in window)) {
    showToast('Text-to-speech is not supported in this browser.', 'error');
    return;
  }
  window.speechSynthesis.cancel();
  if (appState.activeAudioElement) {
    appState.activeAudioElement.pause();
    appState.activeAudioElement = null;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  if (bestVoice) {
    utterance.voice = bestVoice;
    utterance.lang = bestVoice.lang;
  } else {
    utterance.lang = 'es-US';
  }
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

export function initAudioControls() {
  appHooks.populateVoices = populateVoices;
  appHooks.updateAudioBadgeUI = updateAudioBadgeUI;

  if ('speechSynthesis' in window) {
    populateVoices();
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  document.getElementById('voice-select').onchange = (e) => {
    appState.audioPrefs.selectedVoiceName = e.target.value;
    saveAudioPrefs(true, true);
  };

  document.getElementById('gcp-voice-select').onchange = (e) => {
    appState.audioPrefs.gcpVoiceName = e.target.value;
    saveAudioPrefs(true, true);
  };

  document.getElementById('force-gcp-checkbox').onchange = (e) => {
    appState.audioPrefs.forceGcp = e.target.checked;
    saveAudioPrefs(true, true);
  };

  document.getElementById('save-gcp-key-btn').onclick = () => {
    const val = document.getElementById('gcp-api-key-input').value.trim();
    appState.audioPrefs.gcpApiKey = val;
    saveAudioPrefs(false, false);
    showToast(val ? 'Google Cloud TTS API key saved locally!' : 'Cleared API key.', 'success');
  };

  document.getElementById('clear-gcp-key-btn').onclick = () => {
    document.getElementById('gcp-api-key-input').value = '';
    appState.audioPrefs.gcpApiKey = '';
    appState.audioPrefs.forceGcp = false;
    document.getElementById('force-gcp-checkbox').checked = false;
    saveAudioPrefs(true, true);
    showToast('Google Cloud TTS API key removed.', 'info');
  };

  document.getElementById('test-voice-btn').onclick = () => {
    speakSpanish(
      'Hola, así suena la voz neuronal en español para practicar el examen de AP.',
      1.0
    );
  };
}
