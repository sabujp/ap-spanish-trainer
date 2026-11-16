import {
  DEFAULT_GOOGLE_CLIENT_ID,
  DRIVE_BACKUP_FILE_NAME,
  DRIVE_FILE_NAME,
  GOOGLE_AUTH_PREFS_KEY,
  OFFICIAL_PACK_URLS,
  getTodayDateStr
} from './constants.js';
import {
  appHooks,
  appState,
  applySharedLevelToPrefsAndUI,
  normalizeVoiceInputPrefs,
  resolveUnifiedStudyLevel,
  saveAudioPrefs,
  saveDailyPace,
  saveUserPrefs,
  saveVerbStats,
  saveVocabStats,
  syncUserPrefsToUI
} from './storage.js';
import {
  fetchAndMergeRemoteJsonPack,
  isOfficialPackCard,
  normalizeOfficialCardLevels,
  saveDeck
} from './packs.js';
import { showToast } from './ui.js';

export function hasValidGoogleToken() {
  return Boolean(
    appState.googleAuthState.accessToken &&
      Date.now() < appState.googleAuthState.tokenExpiresAt - 30000
  );
}

export function updateGoogleDriveUI(syncStatusText = '') {
  const badge = document.getElementById('drive-sync-badge');
  const btn = document.getElementById('header-google-signin-btn');
  const userNameEl = document.getElementById('google-user-name');
  const detailEl = document.getElementById('google-sync-status-detail');
  if (!badge || !btn) return;

  if (hasValidGoogleToken()) {
    const displayLabel =
      appState.googleAuthState.userName || appState.googleAuthState.userEmail || 'Drive Connected';
    const sizeLabel = appState.googleAuthState.lastPayloadBytes
      ? ` (${(appState.googleAuthState.lastPayloadBytes / 1024).toFixed(1)} KB)`
      : '';
    badge.textContent = syncStatusText || displayLabel;
    btn.className = 'flex items-center gap-2 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-900 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-2xs transition cursor-pointer';
    if (userNameEl) {
      userNameEl.textContent = appState.googleAuthState.userEmail
        ? `${appState.googleAuthState.userName || 'Signed In'} (${appState.googleAuthState.userEmail})`
        : 'Connected to Google Drive';
    }
    if (detailEl) {
      detailEl.textContent = appState.googleAuthState.lastSyncedAt
        ? `Last synced at ${appState.googleAuthState.lastSyncedAt}${sizeLabel}`
        : 'Connected — automatic Google Drive backup active.';
    }
  } else if (appState.googleAuthState.userEmail) {
    const rememberedLabel = appState.googleAuthState.userName || appState.googleAuthState.userEmail;
    badge.textContent = `Reconnect (${rememberedLabel})`;
    btn.className = 'flex items-center gap-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-2xs transition cursor-pointer';
  } else {
    badge.textContent = 'Sign in with Google';
    btn.className = 'flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-2xs transition cursor-pointer';
  }
}

export function loadGoogleAuthPrefs() {
  try {
    const raw = localStorage.getItem(GOOGLE_AUTH_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appState.googleAuthState.userEmail = parsed.userEmail || '';
      appState.googleAuthState.userName = parsed.userName || '';
      appState.googleAuthState.driveFileId = parsed.driveFileId || '';
      appState.googleAuthState.driveBackupFileId = parsed.driveBackupFileId || '';
      appState.googleAuthState.lastSyncedAt = parsed.lastSyncedAt || '';
      appState.googleAuthState.lastPayloadBytes = parsed.lastPayloadBytes || 0;
      if (parsed.accessToken && Number(parsed.tokenExpiresAt) > Date.now() + 30000) {
        appState.googleAuthState.accessToken = parsed.accessToken;
        appState.googleAuthState.tokenExpiresAt = Number(parsed.tokenExpiresAt);
      } else {
        appState.googleAuthState.accessToken = '';
        appState.googleAuthState.tokenExpiresAt = 0;
      }
    }
  } catch (err) {
    console.error('Failed to load Google auth prefs:', err);
  }
  appState.googleAuthState.clientId = DEFAULT_GOOGLE_CLIENT_ID;
  updateGoogleDriveUI();
}

export function saveGoogleAuthPrefs() {
  try {
    localStorage.setItem(
      GOOGLE_AUTH_PREFS_KEY,
      JSON.stringify({
        accessToken: appState.googleAuthState.accessToken,
        tokenExpiresAt: appState.googleAuthState.tokenExpiresAt,
        userEmail: appState.googleAuthState.userEmail,
        userName: appState.googleAuthState.userName,
        driveFileId: appState.googleAuthState.driveFileId,
        driveBackupFileId: appState.googleAuthState.driveBackupFileId,
        lastSyncedAt: appState.googleAuthState.lastSyncedAt,
        lastPayloadBytes: appState.googleAuthState.lastPayloadBytes
      })
    );
  } catch (err) {
    console.error('Failed to save Google auth prefs:', err);
  }
  updateGoogleDriveUI();
}

function clearExpiredGoogleToken() {
  appState.googleAuthState.accessToken = '';
  appState.googleAuthState.tokenExpiresAt = 0;
  saveGoogleAuthPrefs();
}

export function buildCompactProgressDelta() {
  const progress = {};
  const customCards = [];

  appState.deck.forEach((card) => {
    const isOfficial = isOfficialPackCard(card);
    const hasProgress =
      (card.reps || 0) > 0 || (card.interval || 0) > 0 || (card.updatedAt || 0) > 0;

    if (hasProgress) {
      progress[card.id] = {
        reps: card.reps || 0,
        interval: card.interval || 0,
        ease: card.ease || 2.5,
        dueDate: card.dueDate || Date.now(),
        updatedAt: card.updatedAt || Date.now()
      };
    }

    if (!isOfficial) {
      customCards.push({
        id: card.id,
        level: card.level || 1,
        sentence: card.sentence,
        target: card.target,
        hint: card.hint,
        theme: card.theme,
        notes: card.notes || '',
        reps: card.reps || 0,
        interval: card.interval || 0,
        ease: card.ease || 2.5,
        dueDate: card.dueDate || Date.now(),
        updatedAt: card.updatedAt || Date.now()
      });
    }
  });

  const packPrefixes = [
    ['g9-', './packs/grade9-foundations.json'],
    ['g10-', './packs/grade10-foundations.json'],
    ['g11-', './packs/grade11-foundations.json'],
    ['g12-', './packs/grade12-foundations.json']
  ];
  for (const [prefix, url] of packPrefixes) {
    if (
      !appState.loadedPackUrls.has(url) &&
      appState.deck.some((c) => c.id && c.id.startsWith(prefix) && !c.id.includes('boot'))
    ) {
      appState.loadedPackUrls.add(url);
    }
  }

  return {
    schemaVersion: 2,
    updatedAt: Date.now(),
    dailyPace: appState.dailyPace,
    userPrefs: appState.userPrefs,
    audioPrefsSync: {
      selectedVoiceName: appState.audioPrefs.selectedVoiceName || '',
      gcpVoiceName: appState.audioPrefs.gcpVoiceName || 'es-US-Neural2-B',
      forceGcp: Boolean(appState.audioPrefs.forceGcp),
      updatedAt: appState.audioPrefs.updatedAt || 0
    },
    vocabStats: appState.vocabStats,
    verbStats: appState.verbStats,
    loadedPackUrls: [...appState.loadedPackUrls],
    deletedIds: [...appState.deletedCardIds],
    progress,
    customCards
  };
}

function mergeTelemetryStatsMap(localMap, remoteMap) {
  if (!remoteMap || typeof remoteMap !== 'object') return 0;
  let changes = 0;
  for (const [key, rStat] of Object.entries(remoteMap)) {
    if (!rStat || typeof rStat !== 'object') continue;
    const lStat = localMap[key];
    if (!lStat) {
      localMap[key] = { ...rStat };
      changes++;
      continue;
    }
    const rTs = Number(rStat.updatedAt) || 0;
    const lTs = Number(lStat.updatedAt) || 0;
    const rTotal = (Number(rStat.right) || 0) + (Number(rStat.wrong) || 0);
    const lTotal = (Number(lStat.right) || 0) + (Number(lStat.wrong) || 0);
    if (rTs > lTs || (rTs === lTs && rTotal > lTotal)) {
      localMap[key] = { ...rStat };
      changes++;
    }
  }
  return changes;
}

export async function applyRemoteDeltaPayload(remotePayload) {
  if (!remotePayload || typeof remotePayload !== 'object') return 0;
  let mergedChanges = 0;

  if (Array.isArray(remotePayload)) {
    const localById = new Map(appState.deck.map((c) => [c.id, c]));
    remotePayload.forEach((rCard) => {
      if (!rCard || !rCard.id) return;
      const local = localById.get(rCard.id);
      if (local) {
        if ((rCard.reps || 0) > (local.reps || 0) || (rCard.dueDate || 0) > (local.dueDate || 0)) {
          Object.assign(local, rCard);
          mergedChanges++;
        }
      } else if (rCard.sentence && rCard.target && rCard.hint && !appState.deletedCardIds.has(rCard.id)) {
        appState.deck.push(rCard);
        mergedChanges++;
      }
    });
    normalizeOfficialCardLevels(appState.deck);
    return mergedChanges;
  }

  if (remotePayload.schemaVersion !== 2) return 0;

  if (Array.isArray(remotePayload.loadedPackUrls)) {
    for (const packUrl of remotePayload.loadedPackUrls) {
      if (OFFICIAL_PACK_URLS.includes(packUrl) && !appState.loadedPackUrls.has(packUrl)) {
        try {
          await fetchAndMergeRemoteJsonPack(packUrl, packUrl, true);
        } catch (err) {
          console.warn('Could not auto-fetch remote pack:', packUrl, err);
        }
      }
    }
  }

  if (Array.isArray(remotePayload.deletedIds)) {
    remotePayload.deletedIds.forEach((id) => {
      if (!appState.deletedCardIds.has(id)) {
        appState.deletedCardIds.add(id);
        mergedChanges++;
      }
    });
    appState.deck = appState.deck.filter((c) => !appState.deletedCardIds.has(c.id));
  }

  const localById = new Map(appState.deck.map((c) => [c.id, c]));
  const localSentences = new Set(appState.deck.map((c) => c.sentence.toLowerCase().trim()));
  if (Array.isArray(remotePayload.customCards)) {
    remotePayload.customCards.forEach((rCard) => {
      if (!rCard || !rCard.id || appState.deletedCardIds.has(rCard.id)) return;
      const existing = localById.get(rCard.id);
      if (existing) {
        if ((rCard.updatedAt || 0) > (existing.updatedAt || 0)) {
          Object.assign(existing, rCard);
          mergedChanges++;
        }
      } else if (
        rCard.sentence &&
        rCard.target &&
        rCard.hint &&
        !localSentences.has(rCard.sentence.toLowerCase().trim())
      ) {
        appState.deck.push(rCard);
        localById.set(rCard.id, rCard);
        localSentences.add(rCard.sentence.toLowerCase().trim());
        mergedChanges++;
      }
    });
  }
  normalizeOfficialCardLevels(appState.deck);

  if (remotePayload.progress && typeof remotePayload.progress === 'object') {
    Object.entries(remotePayload.progress).forEach(([cardId, rStats]) => {
      const localCard = localById.get(cardId);
      if (!localCard || !rStats) return;
      const remoteTs = rStats.updatedAt || 0;
      const localTs = localCard.updatedAt || 0;
      if (remoteTs > localTs || (remoteTs === localTs && (rStats.reps || 0) > (localCard.reps || 0))) {
        localCard.reps = Number(rStats.reps) || 0;
        localCard.interval = Number(rStats.interval) || 0;
        localCard.ease = Number(rStats.ease) || 2.5;
        localCard.dueDate = Number(rStats.dueDate) || Date.now();
        localCard.updatedAt = remoteTs;
        mergedChanges++;
      }
    });
  }

  if (remotePayload.dailyPace && typeof remotePayload.dailyPace === 'object') {
    const rPace = remotePayload.dailyPace;
    let paceChanged = false;
    const rLimit = Number(rPace.dailyLimit);
    const rLimitTs = Number(rPace.limitUpdatedAt) || 0;
    const lLimitTs = Number(appState.dailyPace.limitUpdatedAt) || 0;
    if (rLimit > 0 && (rLimitTs > lLimitTs || (lLimitTs === 0 && rLimit !== appState.dailyPace.dailyLimit && rLimitTs > 0))) {
      appState.dailyPace.dailyLimit = rLimit;
      appState.dailyPace.limitUpdatedAt = rLimitTs;
      appState.dailyPace.upgradedTo20 = true;
      paceChanged = true;
      mergedChanges++;
    }
    if (rPace.date === getTodayDateStr()) {
      const mergedIntroduced = Math.max(
        appState.dailyPace.introducedCount || 0,
        rPace.introducedCount || 0
      );
      if (mergedIntroduced !== appState.dailyPace.introducedCount) {
        appState.dailyPace.introducedCount = mergedIntroduced;
        paceChanged = true;
        mergedChanges++;
      }
    }
    if (paceChanged) {
      saveDailyPace(false);
    }
  }

  if (remotePayload.userPrefs && typeof remotePayload.userPrefs === 'object') {
    const rPrefs = remotePayload.userPrefs;
    if ((Number(rPrefs.updatedAt) || 0) > (Number(appState.userPrefs.updatedAt) || 0)) {
      const prevLevel = appState.studyLevel;
      appState.userPrefs = {
        ...appState.userPrefs,
        ...rPrefs,
        voiceInput: normalizeVoiceInputPrefs({ ...appState.userPrefs.voiceInput, ...(rPrefs.voiceInput || {}) }),
        vocabPrefs: { ...appState.userPrefs.vocabPrefs, ...(rPrefs.vocabPrefs || {}) },
        conjPrefs: { ...appState.userPrefs.conjPrefs, ...(rPrefs.conjPrefs || {}) }
      };
      appState.userPrefs.wordLookupEnabled = Boolean(appState.userPrefs.wordLookupEnabled);
      const unifiedLevel = resolveUnifiedStudyLevel(appState.userPrefs);
      applySharedLevelToPrefsAndUI(unifiedLevel);
      saveUserPrefs(false, false);
      syncUserPrefsToUI();
      appHooks.onVoicePrefsChanged();
      if (unifiedLevel !== prevLevel) {
        appHooks.onSharedLevelChanged(unifiedLevel, 'sync');
      }
      if (appState.userPrefs.activeTab && ['study', 'add', 'speaking', 'manage'].includes(appState.userPrefs.activeTab)) {
        appHooks.switchTab(appState.userPrefs.activeTab, {
          sync: false,
          skipTimestamp: true,
          restoreLastCard: true
        });
      }
      mergedChanges++;
    }
  }

  if (remotePayload.audioPrefsSync && typeof remotePayload.audioPrefsSync === 'object') {
    const rAudio = remotePayload.audioPrefsSync;
    if ((Number(rAudio.updatedAt) || 0) > (Number(appState.audioPrefs.updatedAt) || 0)) {
      appState.audioPrefs.selectedVoiceName = rAudio.selectedVoiceName || '';
      appState.audioPrefs.gcpVoiceName = rAudio.gcpVoiceName || 'es-US-Neural2-B';
      appState.audioPrefs.forceGcp = Boolean(rAudio.forceGcp);
      appState.audioPrefs.updatedAt = Number(rAudio.updatedAt) || 0;
      saveAudioPrefs(false, false);
      appHooks.populateVoices();
      mergedChanges++;
    }
  }

  const vocabChanges = mergeTelemetryStatsMap(appState.vocabStats, remotePayload.vocabStats);
  if (vocabChanges > 0) {
    saveVocabStats(false);
    appHooks.onVocabStatsUpdated();
    mergedChanges += vocabChanges;
  }

  const verbChanges = mergeTelemetryStatsMap(appState.verbStats, remotePayload.verbStats);
  if (verbChanges > 0) {
    saveVerbStats(false);
    appHooks.onVerbStatsUpdated();
    mergedChanges += verbChanges;
  }

  return mergedChanges;
}

async function fetchGoogleUserProfile(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const profile = await res.json();
    appState.googleAuthState.userEmail = profile.email || '';
    appState.googleAuthState.userName = profile.name || profile.given_name || '';
    saveGoogleAuthPrefs();
  } catch (err) {
    console.warn('Could not fetch Google profile:', err);
  }
}

async function findDriveFileByName(token, fileName) {
  const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchRes.ok) {
    if (searchRes.status === 401) clearExpiredGoogleToken();
    throw new Error(`Drive search failed (${searchRes.status})`);
  }
  const searchData = await searchRes.json();
  return searchData.files && searchData.files.length > 0 ? searchData.files[0].id : null;
}

async function findOrCreateDriveDeckFile(token) {
  if (appState.googleAuthState.driveFileId) return appState.googleAuthState.driveFileId;
  const foundId = await findDriveFileByName(token, DRIVE_FILE_NAME);
  if (foundId) {
    appState.googleAuthState.driveFileId = foundId;
    saveGoogleAuthPrefs();
    return foundId;
  }
  return null;
}

async function downloadAndValidateDriveJson(token, fileId) {
  const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!dlRes.ok) {
    if (dlRes.status === 401) clearExpiredGoogleToken();
    const err = new Error(`Drive download failed (${dlRes.status})`);
    err.status = dlRes.status;
    throw err;
  }
  const rawText = await dlRes.text();
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Corrupted JSON payload in Drive.');
  }
  return { parsed, rawText };
}

async function uploadJsonToDriveFile(token, existingFileId, fileName, jsonString) {
  if (existingFileId) {
    const patchRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: jsonString
      }
    );
    if (!patchRes.ok) {
      if (patchRes.status === 401) clearExpiredGoogleToken();
      throw new Error(`Drive update failed (${patchRes.status})`);
    }
    return existingFileId;
  }

  const boundary = 'ap_spanish_drive_boundary_' + Date.now();
  const metadata = JSON.stringify({
    name: fileName,
    parents: ['appDataFolder']
  });
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonString}\r\n` +
    `--${boundary}--`;

  const createRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    }
  );
  if (!createRes.ok) {
    if (createRes.status === 401) clearExpiredGoogleToken();
    throw new Error(`Drive create failed (${createRes.status})`);
  }
  const created = await createRes.json();
  return created.id;
}

export async function pullAndMergeFromGoogleDrive(silent = false) {
  if (!hasValidGoogleToken() || appState.isDriveSyncing) return;
  appState.isDriveSyncing = true;
  const token = appState.googleAuthState.accessToken;
  updateGoogleDriveUI('Syncing Delta...');

  try {
    const fileId = await findOrCreateDriveDeckFile(token);
    if (!fileId) {
      const legacyId = await findDriveFileByName(token, 'ap-spanish-srs-deck.json');
      if (legacyId) {
        const { parsed: legacyData } = await downloadAndValidateDriveJson(token, legacyId);
        await applyRemoteDeltaPayload(legacyData);
        saveDeck(false);
      }
      appState.isDriveSyncing = false;
      await pushDeckToGoogleDrive(silent);
      return;
    }

    let remotePayload;
    try {
      const result = await downloadAndValidateDriveJson(token, fileId);
      remotePayload = result.parsed;
    } catch (primaryErr) {
      if (primaryErr.status === 404) {
        appState.googleAuthState.driveFileId = '';
        appState.isDriveSyncing = false;
        await pushDeckToGoogleDrive(silent);
        return;
      }
      const backupId =
        appState.googleAuthState.driveBackupFileId ||
        (await findDriveFileByName(token, DRIVE_BACKUP_FILE_NAME));
      if (backupId) {
        const backupRes = await downloadAndValidateDriveJson(token, backupId);
        remotePayload = backupRes.parsed;
        showToast('Recovered progress from automatic Drive backup!', 'info');
      } else {
        throw primaryErr;
      }
    }

    const mergedChanges = await applyRemoteDeltaPayload(remotePayload);
    saveDeck(false);
    appHooks.selectNextCard({ restoreLastCard: true, skipTimestamp: true });
    const tabManage = document.getElementById('tab-manage');
    if (tabManage && !tabManage.classList.contains('hidden')) {
      appHooks.renderManageTable();
    }
    if (!silent) {
      showToast(`Synced delta with Google Drive (${mergedChanges} update${mergedChanges === 1 ? '' : 's'} merged).`, 'success');
    }

    appState.googleAuthState.lastSyncedAt = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    saveGoogleAuthPrefs();
  } catch (err) {
    console.error('Drive pull error:', err);
    updateGoogleDriveUI();
    if (!silent) showToast(`Google Drive sync error: ${err.message}`, 'error');
  } finally {
    appState.isDriveSyncing = false;
  }
}

export async function pushDeckToGoogleDrive(silent = false) {
  if (!hasValidGoogleToken() || appState.isDriveSyncing) return;
  appState.isDriveSyncing = true;
  const token = appState.googleAuthState.accessToken;
  updateGoogleDriveUI('Saving Delta...');

  try {
    const existingId = await findOrCreateDriveDeckFile(token);

    if (existingId) {
      try {
        const { parsed: remoteLatest, rawText: previousValidJson } = await downloadAndValidateDriveJson(
          token,
          existingId
        );
        await applyRemoteDeltaPayload(remoteLatest);
        saveDeck(false);

        const backupId =
          appState.googleAuthState.driveBackupFileId ||
          (await findDriveFileByName(token, DRIVE_BACKUP_FILE_NAME));
        const savedBackupId = await uploadJsonToDriveFile(
          token,
          backupId,
          DRIVE_BACKUP_FILE_NAME,
          previousValidJson
        );
        appState.googleAuthState.driveBackupFileId = savedBackupId;
      } catch (mergeErr) {
        console.warn('Pre-write merge/backup skipped:', mergeErr);
      }
    }

    const deltaObj = buildCompactProgressDelta();
    const payload = JSON.stringify(deltaObj);
    JSON.parse(payload);

    const savedId = await uploadJsonToDriveFile(token, existingId, DRIVE_FILE_NAME, payload);
    appState.googleAuthState.driveFileId = savedId;
    appState.googleAuthState.lastPayloadBytes = new Blob([payload]).size;
    appState.googleAuthState.lastSyncedAt = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    saveGoogleAuthPrefs();

    if (!silent) {
      showToast(`Saved ${(appState.googleAuthState.lastPayloadBytes / 1024).toFixed(1)} KB progress delta to Drive!`, 'success');
    }
  } catch (err) {
    console.error('Drive push error:', err);
    updateGoogleDriveUI();
    if (!silent) showToast(`Google Drive save error: ${err.message}`, 'error');
  } finally {
    appState.isDriveSyncing = false;
  }
}

export function scheduleDriveAutoSync() {
  if (!hasValidGoogleToken()) return;
  if (appState.driveSyncTimeout) clearTimeout(appState.driveSyncTimeout);
  appState.driveSyncTimeout = setTimeout(() => {
    pushDeckToGoogleDrive(true);
  }, 2500);
}

function startGoogleSignInFlow() {
  const clientId = (DEFAULT_GOOGLE_CLIENT_ID || '').trim();
  if (!clientId || clientId.startsWith('YOUR_GOOGLE_OAUTH_CLIENT_ID')) {
    showToast('Google Sign-In is not configured yet—set googleClientId in config.js.', 'info');
    return;
  }
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    showToast('Google Sign-In is still loading—try again in 1 second.', 'info');
    return;
  }

  appState.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    callback: async (tokenResponse) => {
      if (tokenResponse.error) {
        showToast(`Google Sign-In failed: ${tokenResponse.error}`, 'error');
        return;
      }
      appState.googleAuthState.accessToken = tokenResponse.access_token;
      appState.googleAuthState.tokenExpiresAt =
        Date.now() + (Number(tokenResponse.expires_in) || 3600) * 1000;
      saveGoogleAuthPrefs();
      updateGoogleDriveUI('Connected');
      await fetchGoogleUserProfile(tokenResponse.access_token);
      await pullAndMergeFromGoogleDrive(false);
    }
  });

  const tokenRequestOptions = { prompt: '' };
  if (appState.googleAuthState.userEmail) {
    tokenRequestOptions.hint = appState.googleAuthState.userEmail;
  }
  appState.tokenClient.requestAccessToken(tokenRequestOptions);
}

function openDriveModal() {
  updateGoogleDriveUI();
  const driveModal = document.getElementById('drive-sync-modal');
  driveModal.classList.remove('hidden');
  driveModal.classList.add('flex');
}

function closeDriveModal() {
  const driveModal = document.getElementById('drive-sync-modal');
  driveModal.classList.add('hidden');
  driveModal.classList.remove('flex');
}

function signOutGoogle() {
  if (appState.googleAuthState.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(appState.googleAuthState.accessToken, () => {});
  }
  appState.googleAuthState.accessToken = '';
  appState.googleAuthState.tokenExpiresAt = 0;
  appState.googleAuthState.userEmail = '';
  appState.googleAuthState.userName = '';
  appState.googleAuthState.driveFileId = '';
  appState.googleAuthState.driveBackupFileId = '';
  appState.googleAuthState.lastSyncedAt = '';
  appState.googleAuthState.lastPayloadBytes = 0;
  saveGoogleAuthPrefs();
  closeDriveModal();
  showToast('Signed out of Google.', 'info');
}

export function initGoogleSync() {
  appHooks.scheduleDriveAutoSync = scheduleDriveAutoSync;

  const driveModal = document.getElementById('drive-sync-modal');
  document.getElementById('header-google-signin-btn').onclick = () => {
    if (hasValidGoogleToken()) {
      openDriveModal();
    } else {
      startGoogleSignInFlow();
    }
  };
  document.getElementById('close-drive-sync-btn').onclick = closeDriveModal;
  document.getElementById('done-drive-sync-btn').onclick = closeDriveModal;
  driveModal.addEventListener('click', (e) => {
    if (e.target === driveModal) closeDriveModal();
  });

  document.getElementById('google-signout-action-btn').onclick = signOutGoogle;
  document.getElementById('drive-push-now-btn').onclick = () => pushDeckToGoogleDrive(false);
  document.getElementById('drive-pull-now-btn').onclick = () => pullAndMergeFromGoogleDrive(false);

  const flushPendingDriveSync = () => {
    if (appState.driveSyncTimeout && hasValidGoogleToken() && !appState.isDriveSyncing) {
      clearTimeout(appState.driveSyncTimeout);
      appState.driveSyncTimeout = null;
      pushDeckToGoogleDrive(true);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingDriveSync();
    }
  });
  window.addEventListener('pagehide', flushPendingDriveSync);
}
