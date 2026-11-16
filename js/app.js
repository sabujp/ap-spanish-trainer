import { initAudioControls, populateVoices } from './audio.js';
import { initConjugation } from './conjugation.js';
import { initManageDeck } from './manageDeck.js';
import { loadDeck, loadVerbsPack, loadVocabularyPack } from './packs.js';
import { loadHtmlPartials } from './partials.js';
import { initPreplyAdd } from './preplyAdd.js';
import { generateSpeakingChallenge, initSpeaking } from './speaking.js';
import {
  appState,
  loadAudioPrefs,
  loadDailyPace,
  loadUserPrefs,
  loadVerbStats,
  loadVocabStats
} from './storage.js';
import { initStudyChunks, selectNextCard } from './studyChunks.js';
import {
  hasValidGoogleToken,
  initGoogleSync,
  loadGoogleAuthPrefs,
  pullAndMergeFromGoogleDrive
} from './sync.js';
import { initModalsAndNav, switchTab, updateStats } from './ui.js';
import { initVocabQuiz } from './vocabQuiz.js';
import { initWordLookup } from './wordLookup.js';

async function bootstrapApp() {
  try {
    await loadHtmlPartials();
  } catch (err) {
    console.error('Failed to load page sections:', err);
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.innerHTML = `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-sm text-rose-900 font-semibold">Failed to load application sections (${err.message}). If opening locally, please serve over HTTP rather than <code>file://</code>.</div>`;
    }
    return;
  }

  loadAudioPrefs();
  loadUserPrefs();
  loadVocabStats();
  loadVerbStats();

  initModalsAndNav();
  initAudioControls();
  initGoogleSync();
  initWordLookup();
  initStudyChunks();
  initVocabQuiz();
  initConjugation();
  initPreplyAdd();
  initSpeaking();
  initManageDeck();

  populateVoices();
  loadGoogleAuthPrefs();
  loadDailyPace();

  await loadDeck();
  updateStats();

  const initialTab = ['study', 'add', 'speaking', 'manage'].includes(appState.userPrefs.activeTab)
    ? appState.userPrefs.activeTab
    : 'study';

  switchTab(initialTab, { sync: false, skipTimestamp: true, restoreLastCard: true });
  if (initialTab !== 'study') {
    selectNextCard({ restoreLastCard: true, skipTimestamp: true });
  }
  generateSpeakingChallenge();

  // Warm up local vocabulary & verbs dictionaries cleanly in the background (or immediately if needed)
  if (appState.userPrefs.wordLookupEnabled || (initialTab === 'study' && appState.userPrefs.studySubTab === 'vocab')) {
    loadVocabularyPack().catch(() => {});
  }
  if (initialTab === 'study' && appState.userPrefs.studySubTab === 'conjugation') {
    loadVerbsPack().catch(() => {});
  }

  if (hasValidGoogleToken()) {
    await pullAndMergeFromGoogleDrive(true);
  }
}

bootstrapApp();
