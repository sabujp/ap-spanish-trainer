import { THEME_MODE_LABELS } from './constants.js';
import { isSpeechRecognitionSupported, setVoiceModeEnabled } from './speechInput.js';
import {
  appHooks,
  appState,
  applyAppearancePrefs,
  getEffectiveDueCards,
  normalizeVoiceInputPrefs,
  saveDailyPace,
  saveUserPrefs,
  syncDailyLimitSelectsUI,
  syncUserPrefsToUI
} from './storage.js';

const STUDY_SUBTAB_SUMMARIES = {
  chunks: 'Contextual SRS sentences with SM-2 spacing, Voice Mode & Word Lookup',
  vocab: 'Typed or Voice Spanish ↔ English vocabulary & AP phrase drill',
  conjugation: 'English infinitive → Spanish infinitive → full 6-person matrix (with vosotros)'
};

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colors = {
    success: 'bg-emerald-900 text-white border-emerald-700',
    error: 'bg-rose-900 text-white border-rose-700',
    info: 'bg-slate-900 text-white border-slate-700'
  };
  const toast = document.createElement('div');
  toast.className = `pointer-events-auto px-4 py-3 rounded-xl shadow-lg border text-xs sm:text-sm font-medium transition-all transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

export function showConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');

  const cleanup = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
  };

  cancelBtn.onclick = cleanup;
  okBtn.onclick = () => {
    cleanup();
    onConfirm();
  };
}

export function updateStats() {
  const dueCount = getEffectiveDueCards('ALL').length;
  const masteredCount = appState.deck.filter((c) => (c.interval || 0) >= 7).length;
  const dueEl = document.getElementById('stat-due');
  const masteredEl = document.getElementById('stat-mastered');
  const totalEl = document.getElementById('stat-total');
  if (dueEl) dueEl.textContent = dueCount.toLocaleString();
  if (masteredEl) masteredEl.textContent = masteredCount.toLocaleString();
  if (totalEl) totalEl.textContent = appState.deck.length.toLocaleString();

  const paceEl = document.getElementById('daily-new-progress');
  if (paceEl) {
    const limitLabel = appState.dailyPace.dailyLimit >= 9999 ? '∞' : appState.dailyPace.dailyLimit;
    paceEl.textContent = `${appState.dailyPace.introducedCount || 0} / ${limitLabel}`;
  }
}

export function switchSettingsTab(section = 'appearance') {
  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    if (btn.dataset.settingsTab === section) {
      btn.className = 'settings-tab-btn flex-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-indigo-700 shadow-xs transition whitespace-nowrap cursor-pointer';
    } else {
      btn.className = 'settings-tab-btn flex-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition whitespace-nowrap cursor-pointer';
    }
  });
  document.querySelectorAll('.settings-panel').forEach((panel) => {
    panel.classList.add('hidden');
  });
  const targetPanel = document.getElementById(`settings-panel-${section}`);
  if (targetPanel) targetPanel.classList.remove('hidden');
}

export function openSettingsModal(initialTab = 'appearance') {
  appHooks.populateVoices();
  applyAppearancePrefs();
  syncDailyLimitSelectsUI();
  syncUserPrefsToUI();
  const sttBadge = document.getElementById('stt-support-badge');
  if (sttBadge) {
    if (isSpeechRecognitionSupported()) {
      sttBadge.textContent = 'Mic Speech Ready';
      sttBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    } else {
      sttBadge.textContent = 'Use Chrome / Edge for Mic';
      sttBadge.className = 'text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800';
    }
  }
  document.getElementById('gcp-api-key-input').value = appState.audioPrefs.gcpApiKey || '';
  document.getElementById('gcp-voice-select').value = appState.audioPrefs.gcpVoiceName || 'es-US-Neural2-B';
  document.getElementById('force-gcp-checkbox').checked = Boolean(appState.audioPrefs.forceGcp);
  switchSettingsTab(initialTab);
  const settingsModal = document.getElementById('settings-modal');
  settingsModal.classList.remove('hidden');
  settingsModal.classList.add('flex');
}

export function closeSettingsModal() {
  const settingsModal = document.getElementById('settings-modal');
  settingsModal.classList.add('hidden');
  settingsModal.classList.remove('flex');
}

export function openHelpModal() {
  const helpModal = document.getElementById('help-modal');
  helpModal.classList.remove('hidden');
  helpModal.classList.add('flex');
}

export function closeHelpModal() {
  const helpModal = document.getElementById('help-modal');
  helpModal.classList.add('hidden');
  helpModal.classList.remove('flex');
}

export function switchStudySubTab(subTabName = 'chunks', options = {}) {
  const validSubTabs = ['chunks', 'vocab', 'conjugation'];
  const nextSub = validSubTabs.includes(subTabName) ? subTabName : 'chunks';

  appHooks.stopActiveVoiceSession();

  if (nextSub !== 'chunks') {
    appHooks.hideWordLookupPopover();
  }

  document.querySelectorAll('.study-subtab-btn').forEach((btn) => {
    if (btn.dataset.studySubtab === nextSub) {
      btn.className = 'study-subtab-btn px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition whitespace-nowrap bg-indigo-600 text-white shadow-xs cursor-pointer';
    } else {
      btn.className = 'study-subtab-btn px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition whitespace-nowrap text-slate-600 hover:bg-slate-100 cursor-pointer';
    }
  });

  document.querySelectorAll('.study-subpanel').forEach((panel) => {
    panel.classList.add('hidden');
  });
  const targetSubPanel = document.getElementById(`study-subpanel-${nextSub}`);
  if (targetSubPanel) targetSubPanel.classList.remove('hidden');

  const summaryEl = document.getElementById('study-subtab-summary');
  if (summaryEl) {
    summaryEl.textContent = STUDY_SUBTAB_SUMMARIES[nextSub] || '';
  }

  if (appState.userPrefs.studySubTab !== nextSub) {
    appState.userPrefs.studySubTab = nextSub;
    saveUserPrefs(options.sync !== false, !options.skipTimestamp);
  }

  if (nextSub === 'chunks') {
    appHooks.selectNextCard({
      restoreLastCard: options.restoreLastCard !== false,
      keepCurrent: true,
      skipTimestamp: options.skipTimestamp
    });
  } else {
    appHooks.refreshStudySubTabOnSync(nextSub);
  }
}

export function switchTab(tabName, options = {}) {
  const validTabs = ['study', 'add', 'speaking', 'manage'];
  const nextTab = validTabs.includes(tabName) ? tabName : 'study';

  appHooks.stopActiveVoiceSession();

  if (nextTab !== 'study') {
    appHooks.hideWordLookupPopover();
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    if (btn.dataset.tab === nextTab) {
      btn.className = 'tab-btn active px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition whitespace-nowrap bg-indigo-600 text-white shadow-xs';
    } else {
      btn.className = 'tab-btn px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition whitespace-nowrap text-slate-600 hover:bg-slate-100';
    }
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.add('hidden');
  });
  const activePanel = document.getElementById(`tab-${nextTab}`);
  if (activePanel) activePanel.classList.remove('hidden');

  if (appState.userPrefs.activeTab !== nextTab) {
    appState.userPrefs.activeTab = nextTab;
    saveUserPrefs(options.sync !== false, !options.skipTimestamp);
  }

  if (nextTab === 'study') {
    switchStudySubTab(appState.userPrefs.studySubTab || 'chunks', {
      sync: false,
      skipTimestamp: true,
      restoreLastCard: options.restoreLastCard !== false
    });
  }
  if (nextTab === 'manage') appHooks.renderManageTable();
  if (nextTab === 'speaking' && !appState.currentPrompt && typeof appHooks.generateSpeakingChallenge === 'function') {
    appHooks.generateSpeakingChallenge();
  }
}

export function initModalsAndNav() {
  appHooks.updateStats = updateStats;
  appHooks.switchTab = switchTab;
  appHooks.switchStudySubTab = switchStudySubTab;

  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('open-settings-btn').onclick = () => openSettingsModal('appearance');
  document.getElementById('close-settings-btn').onclick = closeSettingsModal;
  document.getElementById('done-settings-btn').onclick = closeSettingsModal;
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.settingsTab));
  });

  document.querySelectorAll('.theme-option-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.userPrefs.themeMode = btn.dataset.themeOption || 'light';
      applyAppearancePrefs();
      appHooks.updateAudioBadgeUI();
      saveUserPrefs(true, true);
    });
  });

  document.querySelectorAll('.font-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.userPrefs.fontSize = btn.dataset.fontSize || 'normal';
      applyAppearancePrefs();
      saveUserPrefs(true, true);
    });
  });

  // Voice Input Settings controls
  const settingsVoiceCb = document.getElementById('settings-voice-mode-checkbox');
  if (settingsVoiceCb) {
    settingsVoiceCb.addEventListener('change', (e) => setVoiceModeEnabled(e.target.checked, true));
  }
  const sttLangSel = document.getElementById('settings-stt-lang-select');
  if (sttLangSel) {
    sttLangSel.addEventListener('change', (e) => {
      appState.userPrefs.voiceInput = normalizeVoiceInputPrefs({
        ...appState.userPrefs.voiceInput,
        lang: e.target.value
      });
      saveUserPrefs(true, true);
      appHooks.onVoicePrefsChanged();
    });
  }
  const voiceAccentsCb = document.getElementById('settings-voice-accents-checkbox');
  if (voiceAccentsCb) {
    voiceAccentsCb.addEventListener('change', (e) => {
      appState.userPrefs.voiceInput = normalizeVoiceInputPrefs({
        ...appState.userPrefs.voiceInput,
        autoAccents: e.target.checked
      });
      saveUserPrefs(true, true);
      appHooks.onVoicePrefsChanged();
    });
  }
  const voiceAutoSubCb = document.getElementById('settings-voice-autosubmit-checkbox');
  if (voiceAutoSubCb) {
    voiceAutoSubCb.addEventListener('change', (e) => {
      appState.userPrefs.voiceInput = normalizeVoiceInputPrefs({
        ...appState.userPrefs.voiceInput,
        autoSubmit: e.target.checked
      });
      saveUserPrefs(true, true);
      appHooks.onVoicePrefsChanged();
    });
  }
  const voiceDelayEl = document.getElementById('settings-voice-delay-input');
  if (voiceDelayEl) {
    voiceDelayEl.addEventListener('change', (e) => {
      appState.userPrefs.voiceInput = normalizeVoiceInputPrefs({
        ...appState.userPrefs.voiceInput,
        autoSubmitDelaySec: e.target.value
      });
      e.target.value = String(appState.userPrefs.voiceInput.autoSubmitDelaySec);
      saveUserPrefs(true, true);
      appHooks.onVoicePrefsChanged();
    });
  }

  const helpModal = document.getElementById('help-modal');
  document.getElementById('open-help-btn').onclick = openHelpModal;
  document.getElementById('close-help-btn').onclick = closeHelpModal;
  document.getElementById('done-help-btn').onclick = closeHelpModal;
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) closeHelpModal();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('.study-subtab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchStudySubTab(btn.dataset.studySubtab));
  });

  // Ensure daily limit select works cleanly from both Chunk filter bar & Settings
  const handleDailyLimitChange = (newVal) => {
    appState.dailyPace.dailyLimit = Number(newVal) || 20;
    appState.dailyPace.upgradedTo20 = true;
    appState.dailyPace.limitUpdatedAt = Date.now();
    saveDailyPace(true);
    appHooks.selectNextCard();
    showToast(
      appState.dailyPace.dailyLimit >= 9999
        ? 'Daily new-phrase goal set to Unlimited.'
        : `Daily new-phrase goal set to ${appState.dailyPace.dailyLimit} phrases/day.`,
      'info'
    );
  };

  document.getElementById('daily-new-limit-select').onchange = (e) => handleDailyLimitChange(e.target.value);
  const settingsDailyLimitEl = document.getElementById('settings-daily-limit-select');
  if (settingsDailyLimitEl) {
    settingsDailyLimitEl.onchange = (e) => handleDailyLimitChange(e.target.value);
  }
}
