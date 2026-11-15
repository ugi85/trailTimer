/**
 * TrailTimer - Main Application Controller
 * Handles UI state, event listeners, timer ticks, offline data flow, and PWA registration.
 */

// Global State
const state = {
  currentTab: 'viewDashboard',
  userRole: 'admin', // 'admin' or 'marshal'
  adminPin: '1234',
  marshalName: '',
  participants: [],
  filteredParticipants: [],
  activeFilterStatus: 'all',
  searchQuery: '',
  selectedCategory: 'Semua',
  selectedTeam: 'Semua',
  teams: [],
  routeConfig: {
    checkpoints: [
      { id: 'start', name: 'Start Gate', distFromPrevKm: 0, cumulativeKm: 0 },
      { id: 'cp1', name: 'CP 1 Pos Bayangan', distFromPrevKm: 4.5, cumulativeKm: 4.5 },
      { id: 'cp2', name: 'CP 2 Puncak', distFromPrevKm: 3.5, cumulativeKm: 8.0 },
      { id: 'finish', name: 'Finish Gate', distFromPrevKm: 4.0, cumulativeKm: 12.0 }
    ],
    totalDistanceKm: 12.0
  },
  categories: [],
  backendUrl: '',
  stationName: 'Pos Utama',
  deviceId: '',
  pendingSyncCount: 0,
  syncEngine: null,
  undoTargetBib: null
};

// Sanitizer Kategori agar terbebas dari karakter biner rusak dari Excel
function isValidCategoryName(cat) {
  if (!cat || typeof cat !== 'string') return false;
  const s = cat.trim();
  if (s.length === 0 || s.length > 35) return false;
  // Buang karakter biner / non-printable / control codes / Excel font metadata
  if (/[\uFFFD\u0000-\u001F\u007F-\u009F♦%\\{}]/.test(s)) return false;
  if (/Calibri|Output|Arial|Table|##0|Sheet|Print/i.test(s)) return false;
  return /^[a-zA-Z0-9\s\-\.\/\+()]{1,35}$/.test(s);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initServiceWorker();
  await loadInitialSettings();
  initSyncEngine();
  initNavigation();
  initEventListeners();
  await refreshParticipants();
  startLiveTicker();
  updateSyncBadge();
});

// 1. PWA Service Worker Registration
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('[PWA] Service Worker terdaftar dengan scope:', reg.scope))
        .catch((err) => console.warn('[PWA] Gagal mendaftarkan Service Worker:', err));
    });
  }
}

// 2. Load Settings from IndexedDB
async function loadInitialSettings() {
  // Load Route Config
  const savedRoute = await TrailDB.getSetting('route_config');
  if (savedRoute && Array.isArray(savedRoute.checkpoints)) {
    state.routeConfig = savedRoute;
  } else {
    await TrailDB.setSetting('route_config', state.routeConfig);
  }

  // Categories are dynamically extracted from participants in database
  state.categories = [];

  // Load Backend URL & Station
  state.backendUrl = await TrailDB.getSetting('backend_url', '');
  state.stationName = await TrailDB.getSetting('station_name', 'Pos Utama');

  // Load Device ID
  let devId = localStorage.getItem('trailtimer_device_id');
  if (!devId) {
    devId = 'device_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('trailtimer_device_id', devId);
  }
  state.deviceId = devId;

  // Load Admin PIN
  state.adminPin = await TrailDB.getSetting('admin_pin', '1234');
  const pinInput = document.getElementById('inputAdminPin');
  if (pinInput) pinInput.value = state.adminPin;

  // Handle URL Parameters (Magic Links for Marshals)
  const urlParams = new URLSearchParams(window.location.search);
  const stationParam = urlParams.get('station') || urlParams.get('pos');
  const roleParam = urlParams.get('role');
  const nameParam = urlParams.get('name') || urlParams.get('marshal');
  const backendParam = urlParams.get('backend') || urlParams.get('api');

  if (backendParam) {
    try {
      const decodedBackend = decodeURIComponent(backendParam);
      if (decodedBackend.startsWith('http')) {
        state.backendUrl = decodedBackend;
        await TrailDB.setSetting('backend_url', decodedBackend);
      }
    } catch(e) {}
  }

  if (nameParam) {
    state.marshalName = nameParam;
    localStorage.setItem('trailtimer_marshal_name', nameParam);
  } else {
    state.marshalName = localStorage.getItem('trailtimer_marshal_name') || '';
  }

  if (stationParam) {
    // Match with checkpoints
    const matched = state.routeConfig.checkpoints.find(c => 
      c.name.toLowerCase().includes(stationParam.toLowerCase()) ||
      c.id.toLowerCase() === stationParam.toLowerCase()
    );
    if (matched) {
      state.stationName = matched.name;
    } else {
      state.stationName = decodeURIComponent(stationParam);
    }
    await TrailDB.setSetting('station_name', state.stationName);
  }

  // Determine initial role
  let initialRole = localStorage.getItem('trailtimer_role') || 'admin';
  if (roleParam === 'marshal' || stationParam) {
    initialRole = 'marshal';
  } else if (roleParam === 'admin') {
    initialRole = 'admin';
  }

  // Set form inputs
  const backendInput = document.getElementById('settingBackendUrl');
  const stationInput = document.getElementById('settingStationName');
  const devIdInput = document.getElementById('settingDeviceId');
  if (backendInput) backendInput.value = state.backendUrl;
  if (stationInput) stationInput.value = state.stationName;
  if (devIdInput) devIdInput.value = state.deviceId;

  renderRouteSetup();
  populateCategoryDropdowns();
  populateStationDropdowns();
  setRole(initialRole);
}

// 3. Initialize Sync Engine
function initSyncEngine() {
  state.syncEngine = new TrailSync({
    backendUrl: state.backendUrl,
    stationName: state.stationName,
    deviceId: state.deviceId,
    onStatusChange: (isOnline) => {
      updateNetworkBadge(isOnline);
    },
    onSyncComplete: async ({ success, count, pullCount, isManual }) => {
      updateSyncBadge();
      renderSyncQueue();
      if (pullCount > 0) {
        await refreshParticipants();
      }
      if (success && (count > 0 || pullCount > 0)) {
        if (count > 0 && pullCount > 0) {
          showToast(`Berhasil kirim ${count} log & tarik ${pullCount} peserta!`, 'success');
        } else if (count > 0) {
          showToast(`Berhasil mensinkronkan ${count} catatan waktu!`, 'success');
        } else if (pullCount > 0) {
          showToast(`Berhasil menarik ${pullCount} peserta dari Google Sheets!`, 'success');
        }
      } else if (isManual && count === 0 && (!pullCount || pullCount === 0)) {
        showToast('Semua data sudah tersinkronisasi.', 'info');
      }
    }
  });

  updateNetworkBadge(navigator.onLine);
}

function updateNetworkBadge(isOnline) {
  const badge = document.getElementById('networkBadge');
  const text = document.getElementById('networkText');
  if (!badge || !text) return;

  if (isOnline) {
    badge.className = 'network-badge online';
    text.textContent = 'Online';
    badge.title = 'Terhubung ke internet. Auto-sync aktif.';
  } else {
    badge.className = 'network-badge offline';
    text.textContent = 'Offline';
    badge.title = 'Tanpa sinyal internet. Data tersimpan aman di database HP.';
  }
}

async function updateSyncBadge() {
  const count = await TrailDB.getPendingCount();
  state.pendingSyncCount = count;

  const btn = document.getElementById('quickSyncBtn');
  const badgeText = document.getElementById('pendingBadgeText');
  const settingsBadge = document.getElementById('syncQueueStatusBadge');

  if (badgeText) {
    badgeText.textContent = count > 0 ? `${count} Antrean` : 'Tersinkron';
  }

  if (settingsBadge) {
    settingsBadge.textContent = `${count} Menunggu`;
  }

  if (btn) {
    if (count > 0) {
      btn.className = 'sync-btn';
    } else {
      btn.className = 'sync-btn synced';
    }
  }
}

// --- NAVIGATION & TABS ---
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.dataset.tab;
      switchTab(targetTab);
    });
  });

  const btnGoSetup = document.getElementById('btnGoToSetup');
  if (btnGoSetup) {
    btnGoSetup.addEventListener('click', () => switchTab('viewSetup'));
  }
}

function switchTab(tabId) {
  state.currentTab = tabId;

  // Toggle Tab Views
  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === tabId);
  });

  // Toggle Nav Item Active State
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  // Actions on Tab Switch
  if (tabId === 'viewDashboard') {
    renderParticipantCards();
  } else if (tabId === 'viewSetup') {
    renderRegisteredTable();
    renderRouteSetup();
  } else if (tabId === 'viewLeaderboard') {
    renderLeaderboard();
  } else if (tabId === 'viewSettings') {
    renderSyncQueue();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- LIVE RUNNING TIMER TICKER ---
function startLiveTicker() {
  TrailTimer.startTicker(() => {
    if (state.currentTab !== 'viewDashboard') return;

    // Update only active running cards to maintain smooth performance
    const activeTimers = document.querySelectorAll('.live-timer[data-status="running"]');
    const now = Date.now();

    activeTimers.forEach(el => {
      const startMs = parseInt(el.dataset.start, 10);
      if (startMs && !isNaN(startMs)) {
        const elapsed = Math.max(0, now - startMs);
        el.textContent = TrailTimer.formatElapsed(elapsed);
      }
    });
  });
}

// --- DATA REFRESH & STATE ---
async function refreshParticipants() {
  const list = await TrailDB.getAllParticipants();
  state.participants = list;

  // Sort participants by BIB
  state.participants.sort((a, b) => {
    const numA = parseInt(a.bib, 10);
    const numB = parseInt(b.bib, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.bib).localeCompare(String(b.bib));
  });

  updateCategoriesList();
  updateTeamsList();
  filterParticipants();
  updateSummaryStats();
  renderParticipantCards();
  renderRegisteredTable();
  if (state.currentTab === 'viewLeaderboard') {
    renderLeaderboard();
  }
}

function filterParticipants() {
  let filtered = [...state.participants];

  // 1. Status Filter
  if (state.activeFilterStatus !== 'all') {
    filtered = filtered.filter(p => p.status === state.activeFilterStatus);
  }

  // 2. Category Filter
  if (state.selectedCategory !== 'Semua') {
    filtered = filtered.filter(p => p.category === state.selectedCategory);
  }

  // 3. Team / Group Filter
  if (state.selectedTeam && state.selectedTeam !== 'Semua') {
    filtered = filtered.filter(p => p.team === state.selectedTeam);
  }

  // 4. Search Query (BIB, Name, Group / Team, or Category)
  if (state.searchQuery.trim() !== '') {
    const q = state.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(p => 
      String(p.bib).toLowerCase().includes(q) || 
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.team && p.team.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  state.filteredParticipants = filtered;

  // Update Group Action Bar visibility
  updateGroupActionBar(filtered);
}

function updateGroupActionBar(filtered) {
  const bar = document.getElementById('groupActionBar');
  const titleEl = document.getElementById('groupActionTitle');
  if (!bar || !titleEl) return;

  const hasTeamFilter = (state.selectedTeam && state.selectedTeam !== 'Semua');
  const hasSearch = (state.searchQuery && state.searchQuery.trim().length > 0);

  if ((hasTeamFilter || hasSearch) && filtered.length > 0) {
    let groupTitle = '';
    if (hasTeamFilter) {
      groupTitle = `👥 Grup: ${state.selectedTeam} (${filtered.length} Pelari)`;
    } else {
      groupTitle = `👥 Hasil Pencarian "${state.searchQuery}" (${filtered.length} Pelari)`;
    }
    titleEl.textContent = groupTitle;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function updateSummaryStats() {
  const total = state.participants.length;
  const running = state.participants.filter(p => p.status === 'running').length;
  const finished = state.participants.filter(p => p.status === 'finished').length;
  const dns = state.participants.filter(p => p.status === 'dns').length;
  const dnf = state.participants.filter(p => p.status === 'dnf').length;

  const elTotal = document.getElementById('statTotalParticipants');
  const elRunning = document.getElementById('statRunning');
  const elFinished = document.getElementById('statFinished');
  const elDnsDnf = document.getElementById('statDnsDnf');

  if (elTotal) elTotal.textContent = total;
  if (elRunning) elRunning.textContent = running;
  if (elFinished) elFinished.textContent = finished;
  if (elDnsDnf) elDnsDnf.textContent = `${dns + dnf}`;

  // Update filter pills count
  const countAll = document.getElementById('countAll');
  const countRunning = document.getElementById('countRunning');
  const countDns = document.getElementById('countDns');
  const countFinished = document.getElementById('countFinished');
  const countDnf = document.getElementById('countDnf');

  if (countAll) countAll.textContent = total;
  if (countRunning) countRunning.textContent = running;
  if (countDns) countDns.textContent = dns;
  if (countFinished) countFinished.textContent = finished;
  if (countDnf) countDnf.textContent = dnf;
}

// --- RENDER PARTICIPANT CARDS ---
function renderParticipantCards() {
  const container = document.getElementById('participantGrid');
  const emptyNotice = document.getElementById('emptyParticipantsNotice');
  if (!container) return;

  if (state.participants.length === 0) {
    container.innerHTML = '';
    if (emptyNotice) emptyNotice.style.display = 'block';
    return;
  }

  if (emptyNotice) emptyNotice.style.display = 'none';

  if (state.filteredParticipants.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-muted);">
        Tidak ada peserta yang cocok dengan filter atau kata kunci pencarian.
      </div>
    `;
    return;
  }

  const checkpoints = state.routeConfig.checkpoints || [];

  container.innerHTML = state.filteredParticipants.map(p => {
    const splits = p.splits || [];
    const nextCpIndex = splits.length + 1;
    const nextCp = checkpoints[nextCpIndex] || null;
    const isLastSegmentBeforeFinish = nextCpIndex === (checkpoints.length - 1);

    // Status Label & Tag
    let statusLabel = 'Belum Start';
    let statusClass = 'ready';
    if (p.status === 'running') {
      statusLabel = 'Berlari';
      statusClass = 'running';
    } else if (p.status === 'finished') {
      statusLabel = 'Finish';
      statusClass = 'finished';
    } else if (p.status === 'dnf') {
      statusLabel = 'DNF';
      statusClass = 'dnf';
    }

    // Timer display text
    let timerDisplay = '--:--:--';
    if (p.status === 'running' && p.startTime) {
      timerDisplay = TrailTimer.formatElapsed(Date.now() - p.startTime);
    } else if (p.status === 'finished' && p.totalMs) {
      timerDisplay = TrailTimer.formatElapsed(p.totalMs);
    }

    // Last CP info
    let lastCpName = 'Start';
    let lastSplitTime = '-';
    let lastPace = '-';
    if (splits.length > 0) {
      const lastSplit = splits[splits.length - 1];
      lastCpName = lastSplit.cpName || `CP ${lastSplit.cpIndex}`;
      lastSplitTime = lastSplit.splitFormatted || TrailTimer.formatElapsed(lastSplit.splitMs);
      lastPace = lastSplit.paceFormatted || '-';
    } else if (p.status === 'running') {
      lastCpName = 'Menuju CP 1';
    }

    // Action buttons based on status
    let actionButtonsHtml = '';
    if (p.status === 'dns') {
      actionButtonsHtml = `
        <button class="btn btn-start btn-sm" onclick="handleStartRunner('${p.bib}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          MULAI / START
        </button>
      `;
    } else if (p.status === 'running') {
      if (nextCp && !isLastSegmentBeforeFinish) {
        actionButtonsHtml = `
          <button class="btn btn-cp btn-sm" onclick="handlePunchCheckpoint('${p.bib}')" title="Catat tiba di ${nextCp.name}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            PUNCH ${nextCp.name}
          </button>
          <button class="btn btn-finish btn-sm" onclick="handleFinishRunner('${p.bib}')">
            FINISH
          </button>
        `;
      } else {
        // Direct Finish button
        actionButtonsHtml = `
          <button class="btn btn-finish btn-sm" onclick="handleFinishRunner('${p.bib}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
            FINISH / STOP
          </button>
        `;
      }

      actionButtonsHtml += `
        <button class="btn btn-danger btn-sm" onclick="handleDnfRunner('${p.bib}')" title="Tandai DNF (Did Not Finish)">
          DNF
        </button>
      `;
    }

    // Undo button (if history available)
    const canUndo = (p.history && p.history.length > 0);
    const undoButtonHtml = canUndo ? `
      <button class="btn btn-undo btn-sm" onclick="openUndoModal('${p.bib}')" title="Koreksi / Batalkan aksi terakhir">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
        Undo
      </button>
    ` : '';

    return `
      <div class="participant-card ${p.status}">
        <div class="card-header">
          <span class="bib-badge">#${p.bib}</span>
          <div class="participant-meta">
            <h4 class="runner-name" title="${p.name}">${p.name}</h4>
            <span class="runner-category">${p.category || 'Trail'} ${p.team ? '• ' + p.team : ''}</span>
          </div>
          <span class="status-tag ${statusClass}">${statusLabel}</span>
        </div>

        <div class="timer-container">
          <span class="timer-label">${p.status === 'finished' ? 'Total Waktu' : 'Waktu Berjalan'}</span>
          <span class="timer-digits live-timer" data-start="${p.startTime || 0}" data-status="${p.status}" data-total="${p.totalMs || 0}">
            ${timerDisplay}
          </span>
        </div>

        <div class="split-stats">
          <div class="stat-item">
            <span class="stat-title">Pos Terakhir</span>
            <span class="stat-val" style="font-size: 0.72rem;">${lastCpName}</span>
          </div>
          <div class="stat-item">
            <span class="stat-title">Split Terakhir</span>
            <span class="stat-val">${lastSplitTime}</span>
          </div>
          <div class="stat-item">
            <span class="stat-title">${p.status === 'finished' ? 'Avg Pace' : 'Split Pace'}</span>
            <span class="stat-val">${p.status === 'finished' ? (p.avgPace || '-') : lastPace}</span>
          </div>
        </div>

        <div class="card-actions">
          ${actionButtonsHtml}
          ${undoButtonHtml}
        </div>
      </div>
    `;
  }).join('');
}

// --- TIMING ACTION HANDLERS ---

// Helper: Push snapshot to history stack for Undo
function recordStateSnapshot(participant) {
  if (!participant.history) participant.history = [];
  const snapshot = {
    status: participant.status,
    startTime: participant.startTime,
    finishTime: participant.finishTime,
    totalMs: participant.totalMs,
    avgPace: participant.avgPace,
    avgSpeed: participant.avgSpeed,
    splits: JSON.parse(JSON.stringify(participant.splits || [])),
    updatedAt: participant.updatedAt
  };
  participant.history.push(snapshot);
  if (participant.history.length > 5) {
    participant.history.shift(); // keep last 5
  }
}

// 1. Start Runner
async function handleStartRunner(bib, customTimestamp = null) {
  const p = await TrailDB.getParticipant(bib);
  if (!p) {
    showToast(`Peserta BIB #${bib} tidak ditemukan.`, 'error');
    return;
  }

  if (p.status !== 'dns') {
    showToast(`Peserta BIB #${bib} sudah dalam status ${p.status}.`, 'info');
    return;
  }

  recordStateSnapshot(p);

  const startTimestamp = customTimestamp || Date.now();
  p.status = 'running';
  p.startTime = startTimestamp;
  p.splits = [];
  p.finishTime = null;
  p.totalMs = null;

  await TrailDB.saveParticipant(p);

  // Add timing log to sync queue
  await TrailDB.addTimingLog({
    bib: p.bib,
    participant_name: p.name,
    category: p.category,
    team: p.team || '',
    action: 'START',
    checkpoint_index: 0,
    checkpoint_name: 'Start Gate',
    timestamp: startTimestamp,
    device_timestamp: new Date(startTimestamp).toISOString(),
    elapsed_ms: 0,
    split_ms: 0,
    pace: '--:-- /km',
    speed: '-- km/h'
  });

  updateSyncBadge();
  await refreshParticipants();
  showToast(`BIB #${p.bib} ${p.name} berhasil di-start!`, 'success');

  // Trigger sync if online
  if (navigator.onLine && state.syncEngine) {
    state.syncEngine.syncNow();
  }
}

// 2. Punch Checkpoint
async function handlePunchCheckpoint(bib, customTimestamp = null) {
  const p = await TrailDB.getParticipant(bib);
  if (!p) {
    showToast(`Peserta BIB #${bib} tidak ditemukan.`, 'error');
    return;
  }

  if (p.status !== 'running') {
    showToast(`Peserta BIB #${bib} tidak sedang berlari (Status: ${p.status}).`, 'info');
    return;
  }

  const checkpoints = state.routeConfig.checkpoints || [];
  const splits = p.splits || [];
  const nextCpIndex = splits.length + 1;

  if (nextCpIndex >= checkpoints.length) {
    showToast(`Seluruh checkpoint sudah tuntas. Silakan tekan tombol FINISH.`, 'info');
    return;
  }

  const currentCp = checkpoints[nextCpIndex];
  const now = customTimestamp || Date.now();

  recordStateSnapshot(p);

  // Previous point timestamp
  const prevTimestamp = (splits.length > 0) ? splits[splits.length - 1].timestamp : p.startTime;
  const segmentDistKm = currentCp.distFromPrevKm || 0;

  // Calculate split metrics
  const splitData = TrailTimer.calculateSplit(prevTimestamp, now, segmentDistKm);
  const elapsedTotalMs = now - p.startTime;

  const splitRecord = {
    cpIndex: nextCpIndex,
    cpName: currentCp.name,
    timestamp: now,
    splitMs: splitData.splitMs,
    splitFormatted: splitData.splitFormatted,
    cumulativeMs: elapsedTotalMs,
    paceFormatted: splitData.paceFormatted,
    speedFormatted: splitData.speedFormatted,
    distKm: segmentDistKm
  };

  p.splits.push(splitRecord);
  await TrailDB.saveParticipant(p);

  // Add timing log to sync queue
  await TrailDB.addTimingLog({
    bib: p.bib,
    participant_name: p.name,
    category: p.category,
    team: p.team || '',
    action: 'CP',
    checkpoint_index: nextCpIndex,
    checkpoint_name: currentCp.name,
    timestamp: now,
    device_timestamp: new Date(now).toISOString(),
    elapsed_ms: elapsedTotalMs,
    split_ms: splitData.splitMs,
    pace: splitData.paceFormatted,
    speed: splitData.speedFormatted
  });

  updateSyncBadge();
  await refreshParticipants();
  showToast(`PUNCH: BIB #${p.bib} tiba di ${currentCp.name} (${splitData.splitFormatted})`, 'success');

  if (navigator.onLine && state.syncEngine) {
    state.syncEngine.syncNow();
  }
}

// 2b. Punch Specific Checkpoint (digunakan di Mode Petugas Pos Lapangan)
async function handlePunchSpecificCheckpoint(bib, stationName, customTimestamp = null) {
  const p = await TrailDB.getParticipant(bib);
  if (!p) {
    showToast(`Peserta BIB #${bib} tidak ditemukan.`, 'error');
    return;
  }

  const now = customTimestamp || Date.now();
  recordStateSnapshot(p);

  const checkpoints = state.routeConfig.checkpoints || [];
  const cpIndex = checkpoints.findIndex(c => c.name.toLowerCase() === (stationName || '').toLowerCase());
  const cpObj = (cpIndex >= 0) ? checkpoints[cpIndex] : { name: stationName, distFromPrevKm: 0 };
  const targetIndex = (cpIndex >= 0) ? cpIndex : ((p.splits || []).length + 1);

  // Jika pelari belum start di sistem tapi sudah sampai di CP (misal gun time offline), auto-start
  if (p.status === 'dns') {
    p.status = 'running';
    p.startTime = now;
  }

  const splits = p.splits || [];
  const prevTimestamp = (splits.length > 0) ? splits[splits.length - 1].timestamp : p.startTime;
  const segmentDistKm = cpObj.distFromPrevKm || 0;
  const splitData = TrailTimer.calculateSplit(prevTimestamp, now, segmentDistKm);
  const elapsedTotalMs = now - p.startTime;

  const splitRecord = {
    cpIndex: targetIndex,
    cpName: cpObj.name,
    timestamp: now,
    splitMs: splitData.splitMs,
    splitFormatted: splitData.splitFormatted,
    cumulativeMs: elapsedTotalMs,
    paceFormatted: splitData.paceFormatted,
    speedFormatted: splitData.speedFormatted,
    distKm: segmentDistKm
  };

  if (!p.splits) p.splits = [];
  p.splits.push(splitRecord);
  await TrailDB.saveParticipant(p);

  await TrailDB.addTimingLog({
    bib: p.bib,
    participant_name: p.name,
    category: p.category,
    team: p.team || '',
    action: 'CP',
    checkpoint_index: targetIndex,
    checkpoint_name: cpObj.name,
    timestamp: now,
    device_timestamp: new Date(now).toISOString(),
    elapsed_ms: elapsedTotalMs,
    split_ms: splitData.splitMs,
    pace: splitData.paceFormatted,
    speed: splitData.speedFormatted
  });

  updateSyncBadge();
  await refreshParticipants();
  showToast(`PUNCH: BIB #${p.bib} tiba di ${cpObj.name}! (${splitData.splitFormatted})`, 'success');

  if (navigator.onLine && state.syncEngine) {
    state.syncEngine.syncNow();
  }
}

// 3. Finish Runner
async function handleFinishRunner(bib, customTimestamp = null) {
  const p = await TrailDB.getParticipant(bib);
  if (!p) {
    showToast(`Peserta BIB #${bib} tidak ditemukan.`, 'error');
    return;
  }

  if (p.status !== 'running') {
    showToast(`Peserta BIB #${bib} tidak sedang berlari.`, 'info');
    return;
  }

  const now = customTimestamp || Date.now();
  recordStateSnapshot(p);

  const totalMs = Math.max(0, now - p.startTime);
  const totalDist = state.routeConfig.totalDistanceKm || 0;
  const overall = TrailTimer.calculateOverall(totalMs, totalDist);

  // Check last segment split if applicable
  const checkpoints = state.routeConfig.checkpoints || [];
  const finishCp = checkpoints[checkpoints.length - 1] || { name: 'Finish Gate', distFromPrevKm: 0 };
  const prevTimestamp = (p.splits && p.splits.length > 0) ? p.splits[p.splits.length - 1].timestamp : p.startTime;
  const lastSplitData = TrailTimer.calculateSplit(prevTimestamp, now, finishCp.distFromPrevKm || 0);

  const finishSplitRecord = {
    cpIndex: checkpoints.length - 1,
    cpName: finishCp.name,
    timestamp: now,
    splitMs: lastSplitData.splitMs,
    splitFormatted: lastSplitData.splitFormatted,
    cumulativeMs: totalMs,
    paceFormatted: lastSplitData.paceFormatted,
    speedFormatted: lastSplitData.speedFormatted
  };

  if (!p.splits) p.splits = [];
  p.splits.push(finishSplitRecord);

  p.status = 'finished';
  p.finishTime = now;
  p.totalMs = totalMs;
  p.avgPace = overall.paceFormatted;
  p.avgSpeed = overall.speedFormatted;

  await TrailDB.saveParticipant(p);

  // Add timing log
  await TrailDB.addTimingLog({
    bib: p.bib,
    participant_name: p.name,
    category: p.category,
    team: p.team || '',
    action: 'FINISH',
    checkpoint_index: checkpoints.length - 1,
    checkpoint_name: finishCp.name,
    timestamp: now,
    device_timestamp: new Date(now).toISOString(),
    elapsed_ms: totalMs,
    split_ms: lastSplitData.splitMs,
    pace: overall.paceFormatted,
    speed: overall.speedFormatted
  });

  updateSyncBadge();
  await refreshParticipants();
  showToast(`FINISH! BIB #${p.bib} ${p.name} - Total: ${overall.totalFormatted}`, 'success');

  if (navigator.onLine && state.syncEngine) {
    state.syncEngine.syncNow();
  }
}

// 4. DNF (Did Not Finish)
async function handleDnfRunner(bib) {
  const p = await TrailDB.getParticipant(bib);
  if (!p) return;

  if (!confirm(`Konfirmasi: Tandai BIB #${p.bib} (${p.name}) sebagai DNF (Did Not Finish)?`)) {
    return;
  }

  recordStateSnapshot(p);
  const now = Date.now();
  p.status = 'dnf';

  await TrailDB.saveParticipant(p);

  await TrailDB.addTimingLog({
    bib: p.bib,
    participant_name: p.name,
    category: p.category,
    team: p.team || '',
    action: 'DNF',
    checkpoint_index: -1,
    checkpoint_name: 'Drop Out',
    timestamp: now,
    device_timestamp: new Date(now).toISOString(),
    elapsed_ms: p.startTime ? (now - p.startTime) : 0,
    split_ms: 0,
    pace: '-',
    speed: '-'
  });

  updateSyncBadge();
  await refreshParticipants();
  showToast(`BIB #${p.bib} ditandai sebagai DNF.`, 'info');
}

// 5. Undo Modal & Execution
async function openUndoModal(bib) {
  const p = await TrailDB.getParticipant(bib);
  if (!p || !p.history || p.history.length === 0) {
    showToast('Tidak ada riwayat untuk di-undo.', 'info');
    return;
  }

  state.undoTargetBib = bib;
  const runnerInfo = document.getElementById('undoRunnerInfo');
  const details = document.getElementById('undoLastActionDetails');

  if (runnerInfo) runnerInfo.textContent = `BIB #${p.bib} - ${p.name} (${p.category})`;

  const lastSnapshot = p.history[p.history.length - 1];
  if (details) {
    details.innerHTML = `
      Status Saat Ini: <strong>${p.status.toUpperCase()}</strong><br>
      Akan Kembali Ke: <strong>${lastSnapshot.status.toUpperCase()}</strong><br>
      Jumlah CP Tercatat: ${p.splits ? p.splits.length : 0} &rarr; ${lastSnapshot.splits ? lastSnapshot.splits.length : 0}
    `;
  }

  openModal('modalUndo');
}

async function executeUndo() {
  if (!state.undoTargetBib) return;
  const bib = state.undoTargetBib;
  const p = await TrailDB.getParticipant(bib);

  if (!p || !p.history || p.history.length === 0) {
    closeModal('modalUndo');
    return;
  }

  const previous = p.history.pop();
  p.status = previous.status;
  p.startTime = previous.startTime;
  p.finishTime = previous.finishTime;
  p.totalMs = previous.totalMs;
  p.avgPace = previous.avgPace;
  p.avgSpeed = previous.avgSpeed;
  p.splits = previous.splits;
  p.updatedAt = new Date().toISOString();

  await TrailDB.saveParticipant(p);

  // Add undo log
  await TrailDB.addTimingLog({
    bib: p.bib,
    participant_name: p.name,
    category: p.category,
    team: p.team || '',
    action: 'UNDO',
    checkpoint_index: 0,
    checkpoint_name: 'Undo Correction',
    timestamp: Date.now(),
    device_timestamp: new Date().toISOString(),
    elapsed_ms: 0,
    split_ms: 0,
    pace: '-',
    speed: '-'
  });

  closeModal('modalUndo');
  updateSyncBadge();
  await refreshParticipants();
  showToast(`Aksi terakhir untuk BIB #${bib} berhasil dibatalkan.`, 'info');
}

// --- AKSI MASSAL & PUNCHING GRUP / KATEGORI ---
function resolvePunchTargets(inputVal) {
  if (!inputVal || !inputVal.trim()) return [];
  const val = inputVal.trim();

  // 1. Multiple comma-separated BIBs: "101, 102, 103"
  if (val.includes(',')) {
    const bibList = val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return state.participants.filter(p => bibList.includes(String(p.bib).toLowerCase()));
  }

  // 2. Exact match with BIB
  const exactBib = state.participants.find(p => String(p.bib).toLowerCase() === val.toLowerCase());
  if (exactBib) {
    return [exactBib];
  }

  // 3. Match with Group / Team (case-insensitive substring)
  const groupMatches = state.participants.filter(p => 
    p.team && p.team.toLowerCase().includes(val.toLowerCase())
  );
  if (groupMatches.length > 0) {
    return groupMatches;
  }

  // 4. Match with Name
  const nameMatches = state.participants.filter(p => 
    p.name && p.name.toLowerCase().includes(val.toLowerCase())
  );
  if (nameMatches.length > 0) {
    return nameMatches;
  }

  // 5. Partial match with BIB
  const partialBib = state.participants.filter(p => String(p.bib).toLowerCase().includes(val.toLowerCase()));
  return partialBib;
}

// Eksekusi Aksi Serentak untuk Satu Rombongan / Grup Pelari
async function handleMassActionOnTargets(targets, actionType, options = {}) {
  if (!targets || targets.length === 0) return;
  const now = Date.now();
  const label = options.label || (options.groupLabel ? options.groupLabel : `${targets.length} pelari`);

  if (actionType === 'START') {
    const eligible = targets.filter(p => p.status === 'dns');
    if (eligible.length === 0) {
      showToast(`Semua pelari di ${label} sudah dalam status Berlari/Finish.`, 'info');
      return;
    }
    for (const p of eligible) {
      recordStateSnapshot(p);
      p.status = 'running';
      p.startTime = now;
      p.splits = [];
      p.finishTime = null;
      p.totalMs = null;
      await TrailDB.saveParticipant(p);

      await TrailDB.addTimingLog({
        bib: p.bib,
        participant_name: p.name,
        category: p.category,
        team: p.team || '',
        action: 'START',
        checkpoint_index: 0,
        checkpoint_name: 'Start Gate',
        timestamp: now,
        device_timestamp: new Date(now).toISOString(),
        elapsed_ms: 0,
        split_ms: 0,
        pace: '--:-- /km',
        speed: '-- km/h'
      });
    }
    updateSyncBadge();
    await refreshParticipants();
    showToast(`▶️ START: Berhasil memulai timer untuk ${eligible.length} pelari (${label})!`, 'success');

  } else if (actionType === 'CP') {
    const eligible = targets.filter(p => p.status === 'running' || p.status === 'dns');
    if (eligible.length === 0) {
      showToast(`Tidak ada pelari aktif di ${label} untuk di-punch Checkpoint.`, 'info');
      return;
    }

    const checkpoints = state.routeConfig.checkpoints || [];
    let stationName = state.stationName;
    const isMarshal = (state.userRole === 'marshal' && stationName && !stationName.includes('Master'));

    for (const p of eligible) {
      if (p.status === 'dns') {
        p.status = 'running';
        p.startTime = now;
      }
      recordStateSnapshot(p);

      let cpIndex, cpName, segmentDistKm;
      if (isMarshal) {
        const foundIdx = checkpoints.findIndex(c => c.name.toLowerCase() === stationName.toLowerCase());
        cpIndex = (foundIdx >= 0) ? foundIdx : ((p.splits || []).length + 1);
        cpName = stationName;
        segmentDistKm = (foundIdx >= 0 && checkpoints[foundIdx].distFromPrevKm) ? checkpoints[foundIdx].distFromPrevKm : 0;
      } else {
        const splits = p.splits || [];
        cpIndex = splits.length + 1;
        if (cpIndex >= checkpoints.length) cpIndex = checkpoints.length - 1;
        const currentCp = checkpoints[cpIndex] || { name: 'CP ' + cpIndex, distFromPrevKm: 0 };
        cpName = currentCp.name;
        segmentDistKm = currentCp.distFromPrevKm || 0;
      }

      const splits = p.splits || [];
      const prevTimestamp = (splits.length > 0) ? splits[splits.length - 1].timestamp : p.startTime;
      const splitData = TrailTimer.calculateSplit(prevTimestamp, now, segmentDistKm);
      const elapsedTotalMs = now - p.startTime;

      const splitRecord = {
        cpIndex: cpIndex,
        cpName: cpName,
        timestamp: now,
        splitMs: splitData.splitMs,
        splitFormatted: splitData.splitFormatted,
        cumulativeMs: elapsedTotalMs,
        paceFormatted: splitData.paceFormatted,
        speedFormatted: splitData.speedFormatted,
        distKm: segmentDistKm
      };

      if (!p.splits) p.splits = [];
      p.splits.push(splitRecord);
      await TrailDB.saveParticipant(p);

      await TrailDB.addTimingLog({
        bib: p.bib,
        participant_name: p.name,
        category: p.category,
        team: p.team || '',
        action: 'CP',
        checkpoint_index: cpIndex,
        checkpoint_name: cpName,
        timestamp: now,
        device_timestamp: new Date(now).toISOString(),
        elapsed_ms: elapsedTotalMs,
        split_ms: splitData.splitMs,
        pace: splitData.paceFormatted,
        speed: splitData.speedFormatted
      });
    }

    updateSyncBadge();
    await refreshParticipants();
    showToast(`📍 PUNCH CP: Berhasil mencatat ${eligible.length} pelari (${label}) tiba di Checkpoint!`, 'success');

  } else if (actionType === 'FINISH') {
    const eligible = targets.filter(p => p.status === 'running');
    if (eligible.length === 0) {
      showToast(`Tidak ada pelari berstatus 'Berlari' di ${label} untuk di-Finish.`, 'info');
      return;
    }

    const checkpoints = state.routeConfig.checkpoints || [];
    const finishCp = checkpoints[checkpoints.length - 1] || { name: 'Finish Gate', distFromPrevKm: 0 };
    const totalDist = state.routeConfig.totalDistanceKm || 0;

    for (const p of eligible) {
      recordStateSnapshot(p);
      const totalMs = Math.max(0, now - p.startTime);
      const overall = TrailTimer.calculateOverall(totalMs, totalDist);
      const prevTimestamp = (p.splits && p.splits.length > 0) ? p.splits[p.splits.length - 1].timestamp : p.startTime;
      const lastSplitData = TrailTimer.calculateSplit(prevTimestamp, now, finishCp.distFromPrevKm || 0);

      const finishSplitRecord = {
        cpIndex: checkpoints.length - 1,
        cpName: finishCp.name,
        timestamp: now,
        splitMs: lastSplitData.splitMs,
        splitFormatted: lastSplitData.splitFormatted,
        cumulativeMs: totalMs,
        paceFormatted: lastSplitData.paceFormatted,
        speedFormatted: lastSplitData.speedFormatted
      };

      if (!p.splits) p.splits = [];
      p.splits.push(finishSplitRecord);

      p.status = 'finished';
      p.finishTime = now;
      p.totalMs = totalMs;
      p.avgPace = overall.paceFormatted;
      p.avgSpeed = overall.speedFormatted;
      await TrailDB.saveParticipant(p);

      await TrailDB.addTimingLog({
        bib: p.bib,
        participant_name: p.name,
        category: p.category,
        team: p.team || '',
        action: 'FINISH',
        checkpoint_index: checkpoints.length - 1,
        checkpoint_name: finishCp.name,
        timestamp: now,
        device_timestamp: new Date(now).toISOString(),
        elapsed_ms: totalMs,
        split_ms: lastSplitData.splitMs,
        pace: overall.paceFormatted,
        speed: overall.speedFormatted
      });
    }

    updateSyncBadge();
    await refreshParticipants();
    showToast(`🏁 FINISH: Seluruh ${eligible.length} pelari (${label}) berhasil Finish bersamaan!`, 'success');
  }

  // Trigger auto sync jika online
  if (navigator.onLine && state.syncEngine) {
    state.syncEngine.syncNow();
  }
}

// 6. Mass Start
async function executeMassStart() {
  const selectCat = document.getElementById('massStartCategory');
  const selectedCat = selectCat ? selectCat.value : 'ALL';
  const selectTeam = document.getElementById('massStartTeam');
  const selectedTeam = selectTeam ? selectTeam.value : 'ALL';

  let targets = state.participants.filter(p => p.status === 'dns');
  if (selectedCat !== 'ALL') {
    targets = targets.filter(p => p.category === selectedCat);
  }
  if (selectedTeam !== 'ALL') {
    targets = targets.filter(p => p.team === selectedTeam);
  }

  if (targets.length === 0) {
    showToast('Tidak ada pelari dengan status "Belum Start" di filter ini.', 'info');
    closeModal('modalMassStart');
    return;
  }

  closeModal('modalMassStart');
  const label = selectedTeam !== 'ALL' ? `Grup ${selectedTeam}` : (selectedCat !== 'ALL' ? selectedCat : 'Semua Pelari');
  await handleMassActionOnTargets(targets, 'START', { label });
}

// 7. Mass CP from Modal
async function executeMassCpFromModal() {
  const teamVal = document.getElementById('massCpTeam')?.value || 'ALL';
  const catVal = document.getElementById('massCpCategory')?.value || 'ALL';

  let targets = state.participants.filter(p => p.status === 'running' || p.status === 'dns');
  if (teamVal !== 'ALL') {
    targets = targets.filter(p => p.team === teamVal);
  }
  if (catVal !== 'ALL') {
    targets = targets.filter(p => p.category === catVal);
  }

  if (targets.length === 0) {
    showToast('Tidak ada pelari aktif yang cocok dengan pilihan tersebut.', 'info');
    return;
  }

  closeModal('modalMassCp');
  const label = teamVal !== 'ALL' ? `Grup ${teamVal}` : (catVal !== 'ALL' ? catVal : 'Semua Pelari');
  await handleMassActionOnTargets(targets, 'CP', { label });
}

// 8. Mass Finish from Modal
async function executeMassFinishFromModal() {
  const teamVal = document.getElementById('massFinishTeam')?.value || 'ALL';
  const catVal = document.getElementById('massFinishCategory')?.value || 'ALL';

  let targets = state.participants.filter(p => p.status === 'running');
  if (teamVal !== 'ALL') {
    targets = targets.filter(p => p.team === teamVal);
  }
  if (catVal !== 'ALL') {
    targets = targets.filter(p => p.category === catVal);
  }

  if (targets.length === 0) {
    showToast('Tidak ada pelari berstatus Berlari yang cocok dengan pilihan tersebut.', 'info');
    return;
  }

  closeModal('modalMassFinish');
  const label = teamVal !== 'ALL' ? `Grup ${teamVal}` : (catVal !== 'ALL' ? catVal : 'Semua Pelari');
  await handleMassActionOnTargets(targets, 'FINISH', { label });
}

// --- QUICK BIB & GROUP NUMPAD / FAST ENTRY ---
function initQuickPuncher() {
  const bibInput = document.getElementById('quickBibInput');
  const btnCp = document.getElementById('btnQuickCp');
  const btnFinish = document.getElementById('btnQuickFinish');
  const btnStart = document.getElementById('btnQuickStart');

  const getResolved = () => {
    const val = bibInput.value.trim();
    if (!val) {
      showToast('Masukkan nomor BIB atau Nama Grup terlebih dahulu!', 'info');
      bibInput.focus();
      return null;
    }
    const targets = resolvePunchTargets(val);
    if (!targets || targets.length === 0) {
      showToast(`Tidak ditemukan pelari/grup dengan kata kunci: "${val}"`, 'error');
      bibInput.focus();
      return null;
    }
    return { val, targets };
  };

  btnCp.addEventListener('click', async () => {
    const res = getResolved();
    if (!res) return;
    if (res.targets.length === 1) {
      const bib = res.targets[0].bib;
      if (state.userRole === 'marshal' && state.stationName && !state.stationName.includes('Master')) {
        await handlePunchSpecificCheckpoint(bib, state.stationName);
      } else {
        await handlePunchCheckpoint(bib);
      }
    } else {
      await handleMassActionOnTargets(res.targets, 'CP', { label: res.val });
    }
    bibInput.value = '';
    bibInput.focus();
  });

  btnFinish.addEventListener('click', async () => {
    const res = getResolved();
    if (!res) return;
    if (res.targets.length === 1) {
      await handleFinishRunner(res.targets[0].bib);
    } else {
      await handleMassActionOnTargets(res.targets, 'FINISH', { label: res.val });
    }
    bibInput.value = '';
    bibInput.focus();
  });

  btnStart.addEventListener('click', async () => {
    const res = getResolved();
    if (!res) return;
    if (res.targets.length === 1) {
      await handleStartRunner(res.targets[0].bib);
    } else {
      await handleMassActionOnTargets(res.targets, 'START', { label: res.val });
    }
    bibInput.value = '';
    bibInput.focus();
  });

  bibInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const res = getResolved();
      if (!res) return;

      if (res.targets.length === 1) {
        const runner = res.targets[0];
        const bib = runner.bib;
        if (state.userRole === 'marshal') {
          const cur = (state.stationName || '').toLowerCase();
          if (cur.includes('start')) {
            await handleStartRunner(bib);
          } else if (cur.includes('finish')) {
            await handleFinishRunner(bib);
          } else {
            await handlePunchSpecificCheckpoint(bib, state.stationName);
          }
        } else {
          // Admin behavior
          if (runner.status === 'dns') {
            await handleStartRunner(bib);
          } else if (runner.status === 'running') {
            const nextCpIndex = (runner.splits || []).length + 1;
            const totalCps = (state.routeConfig.checkpoints || []).length;
            if (nextCpIndex >= totalCps - 1) {
              await handleFinishRunner(bib);
            } else {
              await handlePunchCheckpoint(bib);
            }
          } else {
            showToast(`BIB #${bib} sudah selesai/berstatus ${runner.status}.`, 'info');
          }
        }
      } else {
        // Multiple runners in group: Auto-detect action
        const anyRunning = res.targets.some(p => p.status === 'running');
        if (anyRunning) {
          const cur = (state.stationName || '').toLowerCase();
          if (cur.includes('finish')) {
            await handleMassActionOnTargets(res.targets, 'FINISH', { label: res.val });
          } else {
            await handleMassActionOnTargets(res.targets, 'CP', { label: res.val });
          }
        } else {
          await handleMassActionOnTargets(res.targets, 'START', { label: res.val });
        }
      }
      bibInput.value = '';
    }
  });
}

// --- SETUP & ROUTE MANAGEMENT ---
function renderRouteSetup() {
  const listEl = document.getElementById('checkpointsList');
  const totalBadge = document.getElementById('totalRouteDistanceBadge');
  if (!listEl) return;

  const cps = state.routeConfig.checkpoints || [];
  let cum = 0;

  listEl.innerHTML = cps.map((cp, idx) => {
    cum += (parseFloat(cp.distFromPrevKm) || 0);
    cp.cumulativeKm = parseFloat(cum.toFixed(2));

    const isStart = idx === 0;
    const isFinish = idx === (cps.length - 1);
    const badgeText = isStart ? 'S' : (isFinish ? 'F' : `${idx}`);

    return `
      <div class="cp-item" data-index="${idx}">
        <div class="cp-info">
          <span class="cp-order">${badgeText}</span>
          <input type="text" class="form-input cp-name-input" value="${cp.name}" style="padding: 6px 10px; font-size: 0.85rem;" placeholder="Nama Pos">
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input type="number" step="0.1" min="0" class="form-input cp-dist-input" value="${cp.distFromPrevKm || 0}" style="width: 80px; padding: 6px 8px; font-size: 0.85rem; text-align: right;" ${isStart ? 'disabled' : ''}>
          <span style="font-size: 0.75rem; color: var(--text-dim);">KM (segmen)</span>
          ${(!isStart && !isFinish) ? `
            <button type="button" class="btn btn-danger btn-sm" onclick="removeCheckpointRow(${idx})" style="padding: 4px 8px;">&times;</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  state.routeConfig.totalDistanceKm = parseFloat(cum.toFixed(2));
  if (totalBadge) totalBadge.textContent = `Total: ${state.routeConfig.totalDistanceKm} KM`;
}

function addCheckpointRow() {
  const cps = state.routeConfig.checkpoints || [];
  const finish = cps.pop(); // temporary pop finish

  const newIdx = cps.length;
  cps.push({
    id: `cp_${Date.now()}`,
    name: `CP ${newIdx} Pos Baru`,
    distFromPrevKm: 3.0,
    cumulativeKm: 0
  });

  cps.push(finish);
  state.routeConfig.checkpoints = cps;
  renderRouteSetup();
}

function removeCheckpointRow(index) {
  const cps = state.routeConfig.checkpoints || [];
  if (index <= 0 || index >= cps.length - 1) return;
  cps.splice(index, 1);
  renderRouteSetup();
}

async function saveRouteConfigFromUI() {
  const rows = document.querySelectorAll('.cp-item');
  const updated = [];
  let cum = 0;

  rows.forEach((row, idx) => {
    const nameInput = row.querySelector('.cp-name-input');
    const distInput = row.querySelector('.cp-dist-input');

    const name = nameInput ? nameInput.value.trim() : `Pos ${idx}`;
    const dist = (idx === 0) ? 0 : (parseFloat(distInput.value) || 0);
    cum += dist;

    updated.push({
      id: (idx === 0) ? 'start' : ((idx === rows.length - 1) ? 'finish' : `cp_${idx}`),
      name,
      distFromPrevKm: dist,
      cumulativeKm: parseFloat(cum.toFixed(2))
    });
  });

  state.routeConfig = {
    checkpoints: updated,
    totalDistanceKm: parseFloat(cum.toFixed(2))
  };

  await TrailDB.setSetting('route_config', state.routeConfig);
  renderRouteSetup();
  showToast('Konfigurasi rute dan checkpoint berhasil disimpan!', 'success');
}

// --- SETUP: PARTICIPANTS FORM & CSV IMPORT ---
async function handleAddParticipantManual(e) {
  e.preventDefault();
  const bibInput = document.getElementById('inputBib');
  const nameInput = document.getElementById('inputName');
  const catInput = document.getElementById('inputCategory');
  const teamInput = document.getElementById('inputTeam');

  const bib = bibInput.value.trim();
  const name = nameInput.value.trim();
  const category = catInput.value.trim() || 'Trail';
  const team = teamInput.value.trim();

  if (!bib || !name) {
    showToast('BIB dan Nama wajib diisi.', 'info');
    return;
  }

  const existing = await TrailDB.getParticipant(bib);
  if (existing) {
    showToast(`Peserta dengan BIB #${bib} sudah ada!`, 'error');
    return;
  }

  const participant = {
    bib,
    name,
    category,
    team,
    status: 'dns',
    startTime: null,
    splits: [],
    finishTime: null,
    totalMs: null,
    avgPace: null,
    avgSpeed: null,
    history: []
  };

  await TrailDB.saveParticipant(participant);

  // Update categories set
  if (category && isValidCategoryName(category) && !state.categories.includes(category)) {
    state.categories.push(category);
    await TrailDB.setSetting('categories', state.categories);
    populateCategoryDropdowns();
  }

  bibInput.value = '';
  nameInput.value = '';
  teamInput.value = '';
  bibInput.focus();

  await refreshParticipants();
  showToast(`Peserta BIB #${bib} (${name}) berhasil ditambahkan.`, 'success');
}

// Process Bulk Text / CSV Import
async function processBulkImport() {
  const textarea = document.getElementById('importTextArea');
  const text = textarea ? textarea.value.trim() : '';

  if (!text) {
    showToast('Silakan tempel teks CSV peserta terlebih dahulu.', 'info');
    return;
  }

  const lines = text.split(/\r?\n/);
  const newParticipants = [];
  const existingBibs = new Set(state.participants.map(p => String(p.bib)));

  let skippedCount = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    // Support comma or semicolon or tab
    let cols = line.split(/[,\t;]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 2) continue;

    let bib = cols[0];
    let name = cols[1];
    let category = cols[2] || 'Trail';
    let team = cols[3] || '';

    // Deteksi cerdas: Jika user meng-copy 3 kolom dari Excel [Nama, Kategori, Tim] tanpa kolom BIB:
    // Contoh: cols[0] = "Andi Wijaya" (nama orang), cols[1] = "AAG Run", cols[2] = "Grup 1"
    if (cols.length === 3 && isNaN(parseInt(bib, 10))) {
      team = cols[2];
      category = cols[1];
      name = cols[0];
      bib = String(100 + existingBibs.size + 1);
    }

    // Check if header line
    if (bib.toLowerCase() === 'bib' || bib.toLowerCase() === 'nomor' || (name && name.toLowerCase().includes('nama'))) {
      continue;
    }

    if (existingBibs.has(bib)) {
      skippedCount++;
      continue;
    }

    newParticipants.push({
      bib,
      name,
      category,
      team,
      status: 'dns',
      startTime: null,
      splits: [],
      finishTime: null,
      totalMs: null,
      avgPace: null,
      avgSpeed: null,
      history: []
    });

    existingBibs.add(bib);

    if (category && isValidCategoryName(category) && !state.categories.includes(category)) {
      state.categories.push(category);
    }
  }

  if (newParticipants.length === 0) {
    showToast(`Tidak ada data baru yang valid untuk diimpor. (${skippedCount} BIB terlewati karena duplikat)`, 'info');
    return;
  }

  await TrailDB.saveParticipantsBatch(newParticipants);
  await TrailDB.setSetting('categories', state.categories);

  populateCategoryDropdowns();
  closeModal('modalImport');
  if (textarea) textarea.value = '';

  await refreshParticipants();
  showToast(`Berhasil mengimpor ${newParticipants.length} peserta baru! (${skippedCount} duplikat diabaikan)`, 'success');
}

function handleCsvFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const raw = event.target.result;
    const textarea = document.getElementById('importTextArea');
    if (!textarea) return;

    // Jika file berformat Excel HTML-table (.xls)
    if (raw.includes('<table') || raw.includes('<tr')) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      const rows = doc.querySelectorAll('tr');
      const parsedLines = [];

      rows.forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        const rowVals = [];
        cells.forEach(c => rowVals.push(c.textContent.trim().replace(/,/g, ' ')));
        if (rowVals.length >= 2) {
          parsedLines.push(rowVals.join(', '));
        }
      });

      textarea.value = parsedLines.join('\n');
    } else {
      // Plain CSV / TXT / TSV
      textarea.value = raw;
    }
  };
  reader.readAsText(file);
}

// Render Registered Participants mini table in Setup View
function renderRegisteredTable() {
  const tbody = document.getElementById('registeredParticipantsTbody');
  const countEl = document.getElementById('registeredCount');
  if (!tbody) return;

  if (countEl) countEl.textContent = state.participants.length;

  if (state.participants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 20px;">Belum ada peserta terdaftar.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.participants.map(p => `
    <tr>
      <td style="font-family: var(--font-mono); font-weight: 800;">#${p.bib}</td>
      <td><strong>${p.name}</strong></td>
      <td><span class="runner-category">${p.category}</span></td>
      <td>${p.team || '-'}</td>
      <td><span class="status-tag ${p.status === 'running' ? 'running' : (p.status === 'finished' ? 'finished' : 'ready')}">${p.status.toUpperCase()}</span></td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteSingleParticipant('${p.bib}')" style="padding: 3px 8px; font-size: 0.72rem;">Hapus</button>
      </td>
    </tr>
  `).join('');
}

async function deleteSingleParticipant(bib) {
  if (!confirm(`Hapus peserta BIB #${bib}?`)) return;
  await TrailDB.deleteParticipant(bib);
  await refreshParticipants();
  showToast(`Peserta BIB #${bib} dihapus.`, 'info');
}

async function clearAllParticipantsConfirm() {
  if (!confirm('PERINGATAN: Apakah Anda yakin ingin menghapus SEMUA peserta? Data waktu yang ada juga akan hilang!')) {
    return;
  }
  await TrailDB.clearAllParticipants();
  await refreshParticipants();
  showToast('Seluruh data peserta telah dibersihkan.', 'info');
}

// --- LEADERBOARD & REKAP ---
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardTbody');
  const emptyNotice = document.getElementById('emptyLeaderboardNotice');
  const headerRow = document.getElementById('leaderboardHeaderRow');
  const filterCat = document.getElementById('leaderboardCategoryFilter');
  if (!tbody) return;

  const selectedCat = filterCat ? filterCat.value : 'Semua';

  // Get finished runners
  let finishers = state.participants.filter(p => p.status === 'finished');
  if (selectedCat !== 'Semua') {
    finishers = finishers.filter(p => p.category === selectedCat);
  }

  // Sort by totalMs ascending
  finishers.sort((a, b) => (a.totalMs || Infinity) - (b.totalMs || Infinity));

  if (finishers.length === 0) {
    tbody.innerHTML = '';
    if (emptyNotice) emptyNotice.style.display = 'block';
    return;
  }

  if (emptyNotice) emptyNotice.style.display = 'none';

  // Dynamic header with Checkpoints columns
  const checkpoints = state.routeConfig.checkpoints || [];
  const cpColsHtml = checkpoints.slice(1, -1).map(cp => `<th>${cp.name}</th>`).join('');

  if (headerRow) {
    headerRow.innerHTML = `
      <th style="width: 50px;">Pos</th>
      <th>BIB</th>
      <th>Nama Peserta</th>
      <th>Kategori</th>
      <th>Total Waktu</th>
      ${cpColsHtml}
      <th>Avg Pace</th>
      <th>Avg Speed</th>
      <th>Start Time</th>
      <th>Finish Time</th>
    `;
  }

  tbody.innerHTML = finishers.map((p, idx) => {
    const rank = idx + 1;
    let rankBadge = `<span class="rank-badge">${rank}</span>`;
    if (rank === 1) rankBadge = `<span class="rank-badge rank-1" title="Juara 1">1</span>`;
    else if (rank === 2) rankBadge = `<span class="rank-badge rank-2" title="Juara 2">2</span>`;
    else if (rank === 3) rankBadge = `<span class="rank-badge rank-3" title="Juara 3">3</span>`;

    // Checkpoint split times
    const cpSplitsHtml = checkpoints.slice(1, -1).map((cp, cpIdx) => {
      const sp = (p.splits || []).find(s => s.cpIndex === (cpIdx + 1));
      return `<td>${sp ? sp.splitFormatted : '-'}</td>`;
    }).join('');

    return `
      <tr>
        <td>${rankBadge}</td>
        <td style="font-family: var(--font-mono); font-weight: 800;">#${p.bib}</td>
        <td><strong>${p.name}</strong></td>
        <td><span class="runner-category">${p.category}</span></td>
        <td style="font-family: var(--font-mono); font-weight: 800; color: var(--primary-light); font-size: 1.05rem;">
          ${TrailTimer.formatElapsed(p.totalMs)}
        </td>
        ${cpSplitsHtml}
        <td style="font-family: var(--font-mono);">${p.avgPace || '-'}</td>
        <td style="font-family: var(--font-mono);">${p.avgSpeed || '-'}</td>
        <td>${TrailTimer.formatTimeOfDay(p.startTime)}</td>
        <td>${TrailTimer.formatTimeOfDay(p.finishTime)}</td>
      </tr>
    `;
  }).join('');
}

// --- SYNC QUEUE VIEW & SETTINGS ---
async function renderSyncQueue() {
  const tbody = document.getElementById('syncQueueTbody');
  if (!tbody) return;

  const logs = await TrailDB.getAllTimingLogs();
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 20px;">Belum ada log catatan waktu di memori perangkat.</td></tr>`;
    return;
  }

  // Reverse sort (newest first)
  const sorted = [...logs].reverse().slice(0, 50);

  tbody.innerHTML = sorted.map(l => {
    const isPending = l.sync_status === 'pending';
    const statusBadge = isPending
      ? `<span class="status-tag running">PENDING</span>`
      : `<span class="status-tag finished">SYNCED</span>`;

    return `
      <tr>
        <td style="font-family: var(--font-mono);">${l.id}</td>
        <td style="font-family: var(--font-mono); font-weight: 700;">#${l.bib}</td>
        <td><strong>${l.action}</strong></td>
        <td>${l.checkpoint_name || '-'}</td>
        <td>${TrailTimer.formatTimeOfDay(l.timestamp)}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

async function saveSyncSettings() {
  const backendInput = document.getElementById('settingBackendUrl');
  const stationInput = document.getElementById('settingStationName');

  const url = backendInput ? backendInput.value.trim() : '';
  const station = stationInput ? stationInput.value.trim() : 'Pos Utama';

  state.backendUrl = url;
  state.stationName = station;

  await TrailDB.setSetting('backend_url', url);
  await TrailDB.setSetting('station_name', station);

  if (state.syncEngine) {
    state.syncEngine.backendUrl = url;
    state.syncEngine.stationName = station;
  }

  showToast('Pengaturan backend & pos berhasil disimpan!', 'success');
}

async function handleManualSync() {
  if (!state.syncEngine) return;
  const btn = document.getElementById('quickSyncBtn');
  const manualBtn = document.getElementById('btnManualSyncNow');

  if (btn) btn.classList.add('loading');
  if (manualBtn) manualBtn.classList.add('loading');

  const result = await state.syncEngine.syncNow(true);

  if (btn) btn.classList.remove('loading');
  if (manualBtn) manualBtn.classList.remove('loading');

  if (result.success) {
    if (result.pullCount > 0) {
      await refreshParticipants();
    }
    showToast(result.message, (result.count > 0 || result.pullCount > 0) ? 'success' : 'info');
  } else {
    showToast(result.message, 'error');
  }
}

// Clear synced logs to save space
async function handleClearSyncedLogs() {
  const logs = await TrailDB.getAllTimingLogs();
  const pending = logs.filter(l => l.sync_status === 'pending');
  if (!confirm(`Hapus log yang sudah berstatus 'synced'? (${pending.length} log pending akan tetap disimpan).`)) {
    return;
  }

  await TrailDB.clearAllTimingLogs();
  // Restore pending
  for (const p of pending) {
    await TrailDB.addTimingLog(p);
  }

  renderSyncQueue();
  updateSyncBadge();
  showToast('Log yang telah tersinkronisasi berhasil dibersihkan.', 'info');
}

// Reset Entire Database
async function handleResetEntireDb() {
  const code = prompt('PERINGATAN TINGKAT TINGGI!\nIni akan menghapus SEMUA data peserta, catatan waktu, dan antrean sync di HP ini.\nKetik "RESET" untuk mengonfirmasi:');
  if (code === 'RESET') {
    await TrailDB.resetDatabase();
    state.categories = [];
    populateCategoryDropdowns();
    await refreshParticipants();
    renderSyncQueue();
    updateSyncBadge();
    showToast('Database lomba berhasil direset sepenuhnya.', 'info');
  }
}

// Bersihkan Cache Service Worker, Storage & Reset Total (Factory Reset)
async function handleClearAppCache() {
  if (!confirm('PERINGATAN BERSIHKAN CACHE & RESET TOTAL:\n\nIni akan membersihkan:\n1. Cache offline Service Worker (PWA)\n2. Seluruh data peserta & log lokal di HP ini\n3. Kategori yang kotor/rusak dan dikembalikan ke default\n\nLanjutkan Factory Reset?')) {
    return;
  }

  try {
    // 1. Reset Database & Categories
    await TrailDB.resetDatabase();

    // 2. Clear Service Worker Caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }

    // 3. Clear LocalStorage except device_id
    const devId = localStorage.getItem('trailtimer_device_id');
    localStorage.clear();
    if (devId) localStorage.setItem('trailtimer_device_id', devId);

    // 4. Unregister Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    alert('Cache dan seluruh database lokal berhasil dibersihkan! Aplikasi akan dimuat ulang.');
    window.location.reload(true);
  } catch (err) {
    console.error('Gagal membersihkan cache:', err);
    alert('Terjadi kesalahan saat membersihkan cache: ' + err.message);
  }
}

// Reset / Segarkan Kategori dari Database
async function handleResetCategories() {
  updateCategoriesList();
  if (state.categories.length > 0) {
    showToast(`Daftar kategori disesuaikan dengan database: ${state.categories.join(', ')}`, 'success');
  } else {
    showToast('Database belum memiliki kategori peserta. Dropdown dinonaktifkan.', 'info');
  }
}

// Restore Database from JSON
async function handleRestoreJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = JSON.parse(event.target.result);
      await TrailDB.importFullBackup(data);
      await loadInitialSettings();
      await refreshParticipants();
      renderSyncQueue();
      updateSyncBadge();
      showToast('Database berhasil dipulihkan dari file cadangan!', 'success');
    };
    reader.readAsText(file);
  } catch (err) {
    showToast('Gagal memulihkan database: format file salah.', 'error');
  }
}

// --- UTILITIES: CATEGORIES DROPDOWNS & MODALS ---
function updateCategoriesList() {
  const catsSet = new Set();
  for (const p of state.participants) {
    if (p.category && p.category.trim() && isValidCategoryName(p.category.trim())) {
      catsSet.add(p.category.trim());
    }
  }
  state.categories = Array.from(catsSet).sort((a, b) => a.localeCompare(b));
  TrailDB.setSetting('categories', state.categories);
  populateCategoryDropdowns();
}

function populateCategoryDropdowns() {
  const filterSelect = document.getElementById('filterCategory');
  const lbSelect = document.getElementById('leaderboardCategoryFilter');
  const massSelect = document.getElementById('massStartCategory');
  const massCpCat = document.getElementById('massCpCategory');
  const massFinishCat = document.getElementById('massFinishCategory');
  const datalist = document.getElementById('categoriesDatalist');
  const inputCategory = document.getElementById('inputCategory');

  // 1. Datalist untuk Tambah Peserta Manual
  // Jika database masih kosong / belum ada nama kategori, hilangkan dropdown dan biarkan sebagai kolom input biasa
  if (datalist) {
    if (state.categories.length > 0) {
      datalist.innerHTML = state.categories.map(c => `<option value="${c}"></option>`).join('');
      if (inputCategory) inputCategory.setAttribute('list', 'categoriesDatalist');
    } else {
      datalist.innerHTML = '';
      if (inputCategory) inputCategory.removeAttribute('list');
    }
  }

  // 2. Filter Kategori di Tab Timer & Klasemen
  const currentFilter = state.selectedCategory || 'Semua';
  const optionsHtml = ['<option value="Semua">Semua Kategori</option>', ...state.categories.map(c => `<option value="${c}">${c}</option>`)].join('');

  if (filterSelect) {
    filterSelect.innerHTML = optionsHtml;
    filterSelect.value = state.categories.includes(currentFilter) ? currentFilter : 'Semua';
    state.selectedCategory = filterSelect.value;
  }
  if (lbSelect) {
    const currentLb = lbSelect.value || 'Semua';
    lbSelect.innerHTML = optionsHtml;
    lbSelect.value = state.categories.includes(currentLb) ? currentLb : 'Semua';
  }

  // 3. Dropdown di Modal Mass Actions
  const massOpts = ['<option value="ALL">Semua Kategori</option>', ...state.categories.map(c => `<option value="${c}">${c}</option>`)].join('');
  if (massSelect) massSelect.innerHTML = massOpts;
  if (massCpCat) massCpCat.innerHTML = massOpts;
  if (massFinishCat) massFinishCat.innerHTML = massOpts;
}

// --- UTILITIES: TEAMS / GROUPS DROPDOWNS ---
function updateTeamsList() {
  const teamsSet = new Set();
  for (const p of state.participants) {
    if (p.team && p.team.trim()) {
      teamsSet.add(p.team.trim());
    }
  }
  state.teams = Array.from(teamsSet).sort((a, b) => a.localeCompare(b));
  populateTeamDropdowns();
}

function populateTeamDropdowns() {
  const filterTeam = document.getElementById('filterTeam');
  if (filterTeam) {
    const currentVal = state.selectedTeam || 'Semua';
    const opts = ['<option value="Semua">Semua Grup/Tim</option>', ...state.teams.map(t => `<option value="${t}">${t}</option>`)];
    filterTeam.innerHTML = opts.join('');
    filterTeam.value = state.teams.includes(currentVal) ? currentVal : 'Semua';
  }

  const massStartTeam = document.getElementById('massStartTeam');
  if (massStartTeam) {
    massStartTeam.innerHTML = ['<option value="ALL">Semua Grup/Tim</option>', ...state.teams.map(t => `<option value="${t}">${t}</option>`)].join('');
  }

  const massCpTeam = document.getElementById('massCpTeam');
  if (massCpTeam) {
    massCpTeam.innerHTML = ['<option value="ALL">Semua Grup/Tim</option>', ...state.teams.map(t => `<option value="${t}">${t}</option>`)].join('');
  }

  const massFinishTeam = document.getElementById('massFinishTeam');
  if (massFinishTeam) {
    massFinishTeam.innerHTML = ['<option value="ALL">Semua Grup/Tim</option>', ...state.teams.map(t => `<option value="${t}">${t}</option>`)].join('');
  }
}

function populateStationDropdowns() {
  const stationSelect = document.getElementById('quickStationSelect');
  if (!stationSelect) return;

  const cps = state.routeConfig.checkpoints || [];
  let html = `<option value="Pos Utama / Master">🌐 Pos Utama (Master)</option>`;

  cps.forEach((cp, idx) => {
    let icon = '⛰️';
    if (idx === 0) icon = '🚩';
    else if (idx === cps.length - 1) icon = '🏁';
    html += `<option value="${cp.name}">${icon} ${cp.name}</option>`;
  });

  stationSelect.innerHTML = html;

  // Set current selected
  if (state.stationName) {
    stationSelect.value = state.stationName;
  }

  stationSelect.onchange = async (e) => {
    const val = e.target.value;
    state.stationName = val;
    await TrailDB.setSetting('station_name', val);
    if (state.syncEngine) state.syncEngine.stationName = val;
    const settingInput = document.getElementById('settingStationName');
    if (settingInput) settingInput.value = val;
    updateQuickPuncherForStation();
    showToast(`Pos aktif diubah ke: ${val}`, 'info');
  };
}

function setRole(role) {
  state.userRole = role;
  localStorage.setItem('trailtimer_role', role);

  const roleBadge = document.getElementById('btnRoleBadge');
  const navSetup = document.getElementById('navItemSetup');
  const navSettings = document.getElementById('navItemSettings');
  const stationSelect = document.getElementById('quickStationSelect');
  const massStartBtn = document.getElementById('btnOpenMassStart');

  if (role === 'marshal') {
    if (roleBadge) {
      roleBadge.textContent = `📍 ${state.stationName}`;
      roleBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      roleBadge.style.color = '#34d399';
      roleBadge.title = 'Mode Petugas Pos (Terkunci). Klik untuk membuka PIN Admin.';
    }
    // Hide administrative tabs for field marshals
    if (navSetup) navSetup.style.display = 'none';
    if (navSettings) navSettings.style.display = 'none';
    if (massStartBtn) massStartBtn.style.display = 'none';

    // Lock station selector
    if (stationSelect) {
      stationSelect.disabled = true;
      stationSelect.value = state.stationName;
    }

    updateQuickPuncherForStation();

    // If currently on hidden tab, switch to dashboard
    if (state.currentTab === 'viewSetup' || state.currentTab === 'viewSettings') {
      switchTab('viewDashboard');
    }
  } else {
    // Admin Mode
    if (roleBadge) {
      roleBadge.textContent = '👑 Mode Admin';
      roleBadge.style.background = 'rgba(245, 158, 11, 0.15)';
      roleBadge.style.color = 'var(--accent-amber-light)';
      roleBadge.title = 'Mode Admin Penuh. Klik untuk beralih mode.';
    }
    if (navSetup) navSetup.style.display = 'flex';
    if (navSettings) navSettings.style.display = 'flex';
    if (massStartBtn) massStartBtn.style.display = 'inline-flex';
    if (stationSelect) stationSelect.disabled = false;

    updateQuickPuncherForStation();
    renderMarshalLinkGenerator();
  }
}

function updateQuickPuncherForStation() {
  const btnCp = document.getElementById('btnQuickCp');
  const btnFinish = document.getElementById('btnQuickFinish');
  const btnStart = document.getElementById('btnQuickStart');
  if (!btnCp || !btnFinish || !btnStart) return;

  const currentStation = (state.stationName || '').toLowerCase();

  if (state.userRole === 'marshal') {
    if (currentStation.includes('start')) {
      btnStart.style.display = 'inline-flex';
      btnCp.style.display = 'none';
      btnFinish.style.display = 'none';
    } else if (currentStation.includes('finish')) {
      btnStart.style.display = 'none';
      btnCp.style.display = 'none';
      btnFinish.style.display = 'inline-flex';
      btnFinish.textContent = 'FINISH';
    } else {
      // Regular Checkpoint
      btnStart.style.display = 'none';
      btnFinish.style.display = 'none';
      btnCp.style.display = 'inline-flex';
      btnCp.textContent = `PUNCH ${state.stationName.toUpperCase()}`;
    }
  } else {
    // Admin sees all actions
    btnStart.style.display = 'inline-flex';
    btnCp.style.display = 'inline-flex';
    btnFinish.style.display = 'inline-flex';
    btnCp.textContent = 'PUNCH CP';
    btnFinish.textContent = 'FINISH';
    btnStart.textContent = 'START';
  }
}

function renderMarshalLinkGenerator() {
  const container = document.getElementById('marshalLinksContainer');
  if (!container) return;

  const cps = state.routeConfig.checkpoints || [];
  const origin = window.location.origin + window.location.pathname.replace(/\/+$/, '');
  const backendParam = state.backendUrl ? `&backend=${encodeURIComponent(state.backendUrl)}` : '';

  container.innerHTML = cps.map((cp, idx) => {
    let icon = '⛰️';
    if (idx === 0) icon = '🚩';
    else if (idx === cps.length - 1) icon = '🏁';

    const link = `${origin}?station=${encodeURIComponent(cp.name)}&role=marshal${backendParam}`;

    const waMsg = encodeURIComponent(
      `Halo Petugas Pos,\nBerikut link akses aplikasi TrailTimer untuk pos tugas Anda:\n\n` +
      `📍 *${cp.name}* (Jarak: ${cp.distFromPrevKm || 0} KM)\n` +
      `🔗 ${link}\n\n` +
      `*Petunjuk:* Buka link di browser HP Anda dan klik "Tambahkan ke Layar Utama" (Install PWA) saat di Basecamp. Sistem sudah otomatis terkunci untuk pos Anda!`
    );

    return `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
          <strong style="color: #fff; font-size: 0.95rem;">${icon} ${cp.name}</strong>
          <span class="brand-tag">${cp.distFromPrevKm || 0} KM</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <input type="text" class="form-input" value="${link}" readonly style="font-size: 0.75rem; font-family: var(--font-mono); opacity: 0.8; padding: 6px 10px;">
          <button type="button" class="btn btn-outline btn-sm" onclick="copyToClipboard('${link}')" title="Salin Link Pos">
            Salin Link
          </button>
          <a href="https://api.whatsapp.com/send?text=${waMsg}" target="_blank" class="btn btn-accent btn-sm" style="text-decoration: none;" title="Bagikan ke WhatsApp">
            Kirim WhatsApp
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Link pos berhasil disalin ke clipboard!', 'success');
  }).catch(() => {
    prompt('Salin link berikut:', text);
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="flex: 1;">${message}</span>
    <button style="background: none; border: none; color: inherit; font-size: 1.1rem; cursor: pointer;">&times;</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);
}

// --- GLOBAL EVENT LISTENERS BINDING ---
function initEventListeners() {
  // Quick Puncher
  initQuickPuncher();

  // Search Input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      filterParticipants();
      renderParticipantCards();
    });
  }

  // Filter Category Dropdown
  const filterCat = document.getElementById('filterCategory');
  if (filterCat) {
    filterCat.addEventListener('change', (e) => {
      state.selectedCategory = e.target.value;
      filterParticipants();
      renderParticipantCards();
    });
  }

  // Filter Team / Group Dropdown
  const filterTeam = document.getElementById('filterTeam');
  if (filterTeam) {
    filterTeam.addEventListener('change', (e) => {
      state.selectedTeam = e.target.value;
      filterParticipants();
      renderParticipantCards();
    });
  }

  // Group Action Bar Buttons
  const btnGroupCp = document.getElementById('btnGroupMassCp');
  if (btnGroupCp) {
    btnGroupCp.addEventListener('click', async () => {
      const title = document.getElementById('groupActionTitle')?.textContent || 'Grup Terpilih';
      await handleMassActionOnTargets(state.filteredParticipants, 'CP', { label: title });
    });
  }

  const btnGroupFinish = document.getElementById('btnGroupMassFinish');
  if (btnGroupFinish) {
    btnGroupFinish.addEventListener('click', async () => {
      const title = document.getElementById('groupActionTitle')?.textContent || 'Grup Terpilih';
      await handleMassActionOnTargets(state.filteredParticipants, 'FINISH', { label: title });
    });
  }

  const btnGroupStart = document.getElementById('btnGroupMassStart');
  if (btnGroupStart) {
    btnGroupStart.addEventListener('click', async () => {
      const title = document.getElementById('groupActionTitle')?.textContent || 'Grup Terpilih';
      await handleMassActionOnTargets(state.filteredParticipants, 'START', { label: title });
    });
  }

  // Leaderboard Category Filter
  const lbCat = document.getElementById('leaderboardCategoryFilter');
  if (lbCat) {
    lbCat.addEventListener('change', () => renderLeaderboard());
  }

  // Status Filter Pills
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilterStatus = btn.dataset.status;
      filterParticipants();
      renderParticipantCards();
    });
  });

  // Modal Closers
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.dataset.close);
    });
  });

  // Modal Triggers
  const btnOpenMass = document.getElementById('btnOpenMassStart');
  if (btnOpenMass) {
    btnOpenMass.addEventListener('click', () => openModal('modalMassStart'));
  }

  const btnConfirmMass = document.getElementById('btnConfirmMassStart');
  if (btnConfirmMass) {
    btnConfirmMass.addEventListener('click', executeMassStart);
  }

  const btnOpenCpModal = document.getElementById('btnOpenMassCp');
  if (btnOpenCpModal) {
    btnOpenCpModal.addEventListener('click', () => openModal('modalMassCp'));
  }

  const btnConfirmCpModal = document.getElementById('btnConfirmMassCp');
  if (btnConfirmCpModal) {
    btnConfirmCpModal.addEventListener('click', executeMassCpFromModal);
  }

  const btnOpenFinishModal = document.getElementById('btnOpenMassFinish');
  if (btnOpenFinishModal) {
    btnOpenFinishModal.addEventListener('click', () => openModal('modalMassFinish'));
  }

  const btnConfirmFinishModal = document.getElementById('btnConfirmMassFinish');
  if (btnConfirmFinishModal) {
    btnConfirmFinishModal.addEventListener('click', executeMassFinishFromModal);
  }

  const btnOpenImport = document.getElementById('btnOpenImportModal');
  if (btnOpenImport) {
    btnOpenImport.addEventListener('click', () => openModal('modalImport'));
  }

  const btnProcessImp = document.getElementById('btnProcessImport');
  if (btnProcessImp) {
    btnProcessImp.addEventListener('click', processBulkImport);
  }

  const importCsvFile = document.getElementById('importCsvFileInput');
  if (importCsvFile) {
    importCsvFile.addEventListener('change', handleCsvFileUpload);
  }

  const btnConfirmUndo = document.getElementById('btnConfirmUndo');
  if (btnConfirmUndo) {
    btnConfirmUndo.addEventListener('click', executeUndo);
  }

  // Add Participant Form
  const addForm = document.getElementById('addParticipantForm');
  if (addForm) {
    addForm.addEventListener('submit', handleAddParticipantManual);
  }

  // Route Setup Buttons
  const btnAddCp = document.getElementById('btnAddCpRow');
  if (btnAddCp) btnAddCp.addEventListener('click', addCheckpointRow);

  const btnLoadDemo = document.getElementById('btnLoadDemoData');
  if (btnLoadDemo) btnLoadDemo.addEventListener('click', loadDemoParticipants);

  const btnLoadDemoSetup = document.getElementById('btnLoadDemoSetup');
  if (btnLoadDemoSetup) btnLoadDemoSetup.addEventListener('click', loadDemoParticipants);

  const btnPullCloud = document.getElementById('btnPullFromCloud');
  if (btnPullCloud) {
    btnPullCloud.addEventListener('click', async () => {
      if (!state.syncEngine) return;
      btnPullCloud.disabled = true;
      btnPullCloud.textContent = 'Menarik Data...';
      const res = await state.syncEngine.pullParticipantsFromCloud();
      btnPullCloud.disabled = false;
      btnPullCloud.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        Tarik dari Google Sheets
      `;
      if (res.success) {
        if (res.isEmptySheet && state.participants.length > 0) {
          if (confirm('Daftar peserta di Google Sheets kosong (0 peserta).\n\nApakah Anda ingin mengosongkan juga daftar peserta di HP ini agar sama persis dengan Google Sheets?')) {
            await TrailDB.clearAllParticipants();
            await refreshParticipants();
            showToast('Daftar peserta di HP telah dikosongkan (sinkron dengan Google Sheets).', 'info');
            return;
          }
        }
        showToast(res.message, 'success');
        await refreshParticipants();
      } else {
        showToast(res.message, 'error');
      }
    });
  }

  const btnSaveRoute = document.getElementById('btnSaveRouteConfig');
  if (btnSaveRoute) btnSaveRoute.addEventListener('click', saveRouteConfigFromUI);

  // Setup: Clear all participants
  const btnClearParts = document.getElementById('btnClearAllParticipants');
  if (btnClearParts) btnClearParts.addEventListener('click', clearAllParticipantsConfirm);

  // Export Buttons
  const btnExportParts = document.getElementById('btnExportParticipants');
  if (btnExportParts) btnExportParts.addEventListener('click', () => TrailSync.exportParticipantsCSV());

  const btnDownloadTpl = document.getElementById('btnDownloadTemplate');
  if (btnDownloadTpl) btnDownloadTpl.addEventListener('click', () => TrailSync.downloadParticipantTemplate());

  const btnModalDownloadTpl = document.getElementById('btnModalDownloadTemplate');
  if (btnModalDownloadTpl) btnModalDownloadTpl.addEventListener('click', () => TrailSync.downloadParticipantTemplate());

  const btnExportLb = document.getElementById('btnExportLeaderboard');
  if (btnExportLb) {
    btnExportLb.addEventListener('click', () => {
      const cat = document.getElementById('leaderboardCategoryFilter')?.value || 'Semua';
      TrailSync.exportLeaderboardCSV(cat);
    });
  }

  const btnExportLogs = document.getElementById('btnExportTimingLogsCsv');
  if (btnExportLogs) btnExportLogs.addEventListener('click', () => TrailSync.exportLogsCSV());

  const btnExportFullJson = document.getElementById('btnExportFullJson');
  if (btnExportFullJson) btnExportFullJson.addEventListener('click', () => TrailSync.exportJSONBackup());

  const inputRestoreJson = document.getElementById('inputRestoreJson');
  if (inputRestoreJson) inputRestoreJson.addEventListener('change', handleRestoreJson);

  // Settings & Sync Buttons
  const btnSaveSync = document.getElementById('btnSaveSyncSettings');
  if (btnSaveSync) btnSaveSync.addEventListener('click', saveSyncSettings);

  const btnQuickSync = document.getElementById('quickSyncBtn');
  if (btnQuickSync) btnQuickSync.addEventListener('click', handleManualSync);

  const btnManualSync = document.getElementById('btnManualSyncNow');
  if (btnManualSync) btnManualSync.addEventListener('click', handleManualSync);

  const btnClearSync = document.getElementById('btnClearSyncedLogs');
  if (btnClearSync) btnClearSync.addEventListener('click', handleClearSyncedLogs);

  const btnResetDb = document.getElementById('btnResetEntireDb');
  if (btnResetDb) btnResetDb.addEventListener('click', handleResetEntireDb);

  const btnClearAppCache = document.getElementById('btnClearAppCache');
  if (btnClearAppCache) btnClearAppCache.addEventListener('click', handleClearAppCache);

  const btnResetCats = document.getElementById('btnResetCategories');
  if (btnResetCats) btnResetCats.addEventListener('click', handleResetCategories);

  const btnQuickResetCat = document.getElementById('btnQuickResetCat');
  if (btnQuickResetCat) btnQuickResetCat.addEventListener('click', handleResetCategories);

  // Role Badge Click (Toggle / Unlock Admin)
  const btnRole = document.getElementById('btnRoleBadge');
  if (btnRole) {
    btnRole.addEventListener('click', () => {
      if (state.userRole === 'marshal') {
        openModal('modalAdminPin');
      } else {
        if (confirm('Beralih ke Pratinjau Mode Petugas Pos (Terkunci)?\n(Anda dapat kembali ke Mode Admin kapan saja dengan memasukkan PIN)')) {
          setRole('marshal');
        }
      }
    });
  }

  // Admin PIN Submit in Modal
  const btnSubmitPin = document.getElementById('btnSubmitAdminPin');
  if (btnSubmitPin) {
    btnSubmitPin.addEventListener('click', () => {
      const input = document.getElementById('dialogPinInput');
      const val = input ? input.value.trim() : '';
      if (val === state.adminPin) {
        setRole('admin');
        closeModal('modalAdminPin');
        showToast('Akses Admin berhasil dibuka!', 'success');
      } else {
        showToast('PIN Admin salah!', 'error');
      }
      if (input) input.value = '';
    });
  }

  // Save New Admin PIN in Settings
  const btnSavePin = document.getElementById('btnSaveAdminPin');
  if (btnSavePin) {
    btnSavePin.addEventListener('click', async () => {
      const pinInput = document.getElementById('inputAdminPin');
      const val = pinInput ? pinInput.value.trim() : '';
      if (!val) {
        showToast('PIN tidak boleh kosong!', 'info');
        return;
      }
      state.adminPin = val;
      await TrailDB.setSetting('admin_pin', val);
      showToast('PIN Admin berhasil diperbarui!', 'success');
    });
  }
}

async function loadDemoParticipants() {
  const existing = await TrailDB.getAllParticipants();
  if (existing.length > 0) {
    if (!confirm('Sudah ada data peserta. Apakah Anda ingin menimpa dengan data contoh (demo)?')) {
      return;
    }
    await TrailDB.clearAllParticipants();
  }

  const now = Date.now();
  const cps = state.routeConfig.checkpoints || [];

  const demoList = [
    {
      bib: '101',
      name: 'Rian Pratama',
      category: '21K Trail',
      team: 'Rinjani Trail Club',
      status: 'finished',
      startTime: now - 5400000, // 1h 30m ago
      splits: [
        { cpIndex: 1, cpName: cps[1]?.name || 'CP 1', timestamp: now - 3600000, splitMs: 1800000, splitFormatted: '00:30:00', cumulativeMs: 1800000, paceFormatted: '06:40 /km', speedFormatted: '9.0 km/h' },
        { cpIndex: 2, cpName: cps[2]?.name || 'CP 2', timestamp: now - 1800000, splitMs: 1800000, splitFormatted: '00:30:00', cumulativeMs: 3600000, paceFormatted: '08:34 /km', speedFormatted: '7.0 km/h' },
        { cpIndex: 3, cpName: cps[3]?.name || 'Finish', timestamp: now - 200000, splitMs: 1600000, splitFormatted: '00:26:40', cumulativeMs: 5200000, paceFormatted: '06:40 /km', speedFormatted: '9.0 km/h' }
      ],
      finishTime: now - 200000,
      totalMs: 5200000,
      avgPace: '07:13 /km',
      avgSpeed: '8.3 km/h',
      history: []
    },
    {
      bib: '102',
      name: 'Agus Setiawan',
      category: '21K Trail',
      team: 'Merbabu Ultra',
      status: 'finished',
      startTime: now - 5400000,
      splits: [
        { cpIndex: 1, cpName: cps[1]?.name || 'CP 1', timestamp: now - 3400000, splitMs: 2000000, splitFormatted: '00:33:20', cumulativeMs: 2000000, paceFormatted: '07:24 /km', speedFormatted: '8.1 km/h' },
        { cpIndex: 2, cpName: cps[2]?.name || 'CP 2', timestamp: now - 1500000, splitMs: 1900000, splitFormatted: '00:31:40', cumulativeMs: 3900000, paceFormatted: '09:02 /km', speedFormatted: '6.6 km/h' },
        { cpIndex: 3, cpName: cps[3]?.name || 'Finish', timestamp: now - 50000, splitMs: 1450000, splitFormatted: '00:24:10', cumulativeMs: 5350000, paceFormatted: '06:02 /km', speedFormatted: '9.9 km/h' }
      ],
      finishTime: now - 50000,
      totalMs: 5350000,
      avgPace: '07:25 /km',
      avgSpeed: '8.1 km/h',
      history: []
    },
    {
      bib: '103',
      name: 'Dewi Lestari',
      category: '21K Trail',
      team: 'Sumbing Runners',
      status: 'running',
      startTime: now - 2400000, // 40m ago
      splits: [
        { cpIndex: 1, cpName: cps[1]?.name || 'CP 1', timestamp: now - 900000, splitMs: 1500000, splitFormatted: '00:25:00', cumulativeMs: 1500000, paceFormatted: '05:33 /km', speedFormatted: '10.8 km/h' }
      ],
      finishTime: null,
      totalMs: null,
      avgPace: null,
      avgSpeed: null,
      history: []
    },
    {
      bib: '104',
      name: 'Fajar Nugraha',
      category: '10K Fun Trail',
      team: 'Solo Trail Enthusiast',
      status: 'running',
      startTime: now - 1200000, // 20m ago
      splits: [],
      finishTime: null,
      totalMs: null,
      avgPace: null,
      avgSpeed: null,
      history: []
    },
    {
      bib: '105',
      name: 'Bambang Pamungkas',
      category: '10K Fun Trail',
      team: 'Jakarta Hash',
      status: 'dns',
      startTime: null,
      splits: [],
      finishTime: null,
      totalMs: null,
      avgPace: null,
      avgSpeed: null,
      history: []
    },
    {
      bib: '106',
      name: 'Siti Aminah',
      category: '21K Trail',
      team: 'Bandung Trail Running',
      status: 'dns',
      startTime: null,
      splits: [],
      finishTime: null,
      totalMs: null,
      avgPace: null,
      avgSpeed: null,
      history: []
    },
    {
      bib: '107',
      name: 'Hendra Gunawan',
      category: '50K Ultra',
      team: 'Salomon Squad',
      status: 'dnf',
      startTime: now - 7200000,
      splits: [
        { cpIndex: 1, cpName: cps[1]?.name || 'CP 1', timestamp: now - 5200000, splitMs: 2000000, splitFormatted: '00:33:20', cumulativeMs: 2000000, paceFormatted: '07:24 /km', speedFormatted: '8.1 km/h' }
      ],
      finishTime: null,
      totalMs: null,
      avgPace: null,
      avgSpeed: null,
      history: []
    }
  ];

  await TrailDB.saveParticipantsBatch(demoList);
  await refreshParticipants();
  showToast('7 peserta demo berhasil dimuat!', 'success');
}

// Window exports for inline onclick handlers
window.handleStartRunner = handleStartRunner;
window.handlePunchCheckpoint = handlePunchCheckpoint;
window.handleFinishRunner = handleFinishRunner;
window.handleDnfRunner = handleDnfRunner;
window.openUndoModal = openUndoModal;
window.deleteSingleParticipant = deleteSingleParticipant;
window.removeCheckpointRow = removeCheckpointRow;
window.copyToClipboard = copyToClipboard;
