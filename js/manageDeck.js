import { BOOTSTRAP_SAMPLE_DECK, escapeHtml } from './constants.js';
import { speakSpanish } from './audio.js';
import { fetchAndMergeRemoteJsonPack, mergeImportedCardsArray, saveDeck } from './packs.js';
import { appHooks, appState } from './storage.js';
import { showConfirm, showToast } from './ui.js';

export function renderManageTable(resetLimit = false) {
  if (resetLimit) appState.managePageLimit = 100;
  const tbody = document.getElementById('manage-table-body');
  const countEl = document.getElementById('manage-table-count');
  const loadMoreBtn = document.getElementById('manage-load-more-btn');
  const query = document.getElementById('manage-search').value.trim().toLowerCase();
  const themeFilter = document.getElementById('manage-theme-filter').value;
  const now = Date.now();

  const filtered = appState.deck.filter((c) => {
    const matchesTheme = themeFilter === 'ALL' || c.theme === themeFilter;
    const matchesQuery =
      !query ||
      c.sentence.toLowerCase().includes(query) ||
      c.target.toLowerCase().includes(query) ||
      c.hint.toLowerCase().includes(query);
    return matchesTheme && matchesQuery;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-sm text-slate-400">
          No cards match your search filter.
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Showing 0 of 0 matching cards';
    if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
    return;
  }

  const visible = filtered.slice(0, appState.managePageLimit);
  if (countEl) {
    countEl.textContent = `Showing ${visible.length.toLocaleString()} of ${filtered.length.toLocaleString()} matching card${filtered.length === 1 ? '' : 's'}`;
  }
  if (loadMoreBtn) {
    if (filtered.length > visible.length) {
      const nextBatch = Math.min(100, filtered.length - visible.length);
      loadMoreBtn.textContent = `Show ${nextBatch} More (${(filtered.length - visible.length).toLocaleString()} remaining)`;
      loadMoreBtn.classList.remove('hidden');
    } else {
      loadMoreBtn.classList.add('hidden');
    }
  }

  tbody.innerHTML = visible
    .map((card) => {
      const isDue = (card.dueDate || 0) <= now;
      const statusBadge = isDue
        ? '<span class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-bold">Due Now</span>'
        : `<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[11px] font-bold">Next: ${card.interval}d</span>`;

      return `
        <tr class="hover:bg-slate-50/80 transition">
          <td class="py-3 px-4 align-top">
            <div class="font-bold text-indigo-700">${escapeHtml(card.target)}</div>
            <div class="text-xs text-slate-500">${escapeHtml(card.hint)}</div>
          </td>
          <td class="py-3 px-4 align-top text-xs sm:text-sm text-slate-700 max-w-md">
            ${escapeHtml(card.sentence)}
          </td>
          <td class="py-3 px-4 align-top whitespace-nowrap">
            <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">
              ${escapeHtml(card.theme)}
            </span>
          </td>
          <td class="py-3 px-4 align-top whitespace-nowrap">
            ${statusBadge}
          </td>
          <td class="py-3 px-4 align-top text-right whitespace-nowrap space-x-1.5">
            <button data-speak-id="${card.id}" class="tbl-speak-btn px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 text-xs font-semibold transition cursor-pointer" title="Listen">
              🔊
            </button>
            <button data-reset-id="${card.id}" class="tbl-reset-btn px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 text-xs font-semibold transition cursor-pointer" title="Reset SRS Progress">
              Reset
            </button>
            <button data-del-id="${card.id}" class="tbl-del-btn px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition cursor-pointer" title="Delete Card">
              Delete
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

export function initManageDeck() {
  appHooks.renderManageTable = renderManageTable;

  document.getElementById('manage-table-body').addEventListener('click', (e) => {
    const speakBtn = e.target.closest('.tbl-speak-btn');
    if (speakBtn) {
      const card = appState.deck.find((c) => c.id === speakBtn.dataset.speakId);
      if (card) speakSpanish(card.sentence);
      return;
    }
    const resetBtn = e.target.closest('.tbl-reset-btn');
    if (resetBtn) {
      const card = appState.deck.find((c) => c.id === resetBtn.dataset.resetId);
      if (!card) return;
      card.interval = 0;
      card.reps = 0;
      card.ease = 2.5;
      card.dueDate = Date.now();
      card.updatedAt = Date.now();
      saveDeck();
      renderManageTable();
      showToast('Card progress reset to Due Now.', 'info');
      return;
    }
    const delBtn = e.target.closest('.tbl-del-btn');
    if (delBtn) {
      const delId = delBtn.dataset.delId;
      appState.deletedCardIds.add(delId);
      appState.deck = appState.deck.filter((c) => c.id !== delId);
      saveDeck();
      renderManageTable();
      showToast('Card deleted from deck.', 'info');
    }
  });

  document.getElementById('manage-load-more-btn').addEventListener('click', () => {
    appState.managePageLimit += 100;
    renderManageTable(false);
  });
  document.getElementById('manage-search').addEventListener('input', () => renderManageTable(true));
  document.getElementById('manage-theme-filter').addEventListener('change', () => renderManageTable(true));

  document.getElementById('export-json-btn').addEventListener('click', () => {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(appState.deck, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ap-spanish-deck-${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported deck backup (.json)!', 'success');
  });

  document.querySelectorAll('.load-remote-pack-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      fetchAndMergeRemoteJsonPack(btn.dataset.packUrl, btn.dataset.packName);
    });
  });

  document.getElementById('fetch-remote-pack-btn').addEventListener('click', () => {
    const url = document.getElementById('remote-pack-url-input').value.trim();
    fetchAndMergeRemoteJsonPack(url, 'remote JSON pack');
  });

  document.getElementById('import-json-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        const cardsArray = Array.isArray(imported) ? imported : imported.cards || imported.deck;
        mergeImportedCardsArray(cardsArray, file.name, false, { defaultUpdatedAt: Date.now() });
      } catch (err) {
        showToast('Failed to import JSON: ' + err.message, 'error');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('reset-default-btn').addEventListener('click', () => {
    showConfirm(
      'Reset Local Deck?',
      'This clears your local deck back to the starter sample so you can re-import clean grade-level JSON packs. Export a .json backup first if you want to keep custom Preply cards.',
      () => {
        appState.deletedCardIds.clear();
        appState.loadedPackUrls.clear();
        appState.deck = JSON.parse(JSON.stringify(BOOTSTRAP_SAMPLE_DECK)).map((c) => ({
          ...c,
          dueDate: Date.now(),
          updatedAt: 0
        }));
        saveDeck();
        renderManageTable(true);
        appHooks.selectNextCard();
        showToast('Deck reset! Load any Grade JSON pack above to populate.', 'info');
      }
    );
  });
}
