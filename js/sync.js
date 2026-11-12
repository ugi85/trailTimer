/**
 * TrailTimer - Offline-First Auto-Sync & Backup Engine
 * Handles network monitoring, background sync queue to Google Apps Script / REST API,
 * and physical emergency CSV/JSON backup.
 */

class TrailSync {
  constructor(options = {}) {
    this.backendUrl = options.backendUrl || '';
    this.stationName = options.stationName || 'Pos Utama';
    this.deviceId = options.deviceId || this.getOrCreateDeviceId();
    this.isSyncing = false;
    this.syncIntervalId = null;
    this.onStatusChange = options.onStatusChange || null;
    this.onSyncComplete = options.onSyncComplete || null;

    this.initNetworkListeners();
    this.startPeriodicSync();
  }

  getOrCreateDeviceId() {
    let id = localStorage.getItem('trailtimer_device_id');
    if (!id) {
      id = 'device_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem('trailtimer_device_id', id);
    }
    return id;
  }

  isOnline() {
    return navigator.onLine;
  }

  initNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('[TrailSync] Koneksi terdeteksi (Online)');
      this.notifyStatus(true);
      // Auto-trigger sync when back online
      setTimeout(() => this.syncNow(false), 1500);
    });

    window.addEventListener('offline', () => {
      console.log('[TrailSync] Terputus dari internet (Offline)');
      this.notifyStatus(false);
    });
  }

  notifyStatus(isOnline) {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange(isOnline);
    }
  }

  startPeriodicSync(intervalSeconds = 20) {
    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
    this.syncIntervalId = setInterval(() => {
      if (this.isOnline() && !this.isSyncing) {
        this.syncNow(false);
      }
    }, intervalSeconds * 1000);
  }

  stopPeriodicSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  /**
   * Main Sync Trigger
   * @param {boolean} isManual - Was this triggered by clicking the Sync button?
   */
  async syncNow(isManual = false) {
    if (this.isSyncing) {
      return { success: false, message: 'Sinkronisasi sedang berjalan...' };
    }

    if (!this.isOnline()) {
      return {
        success: false,
        message: 'Perangkat sedang Offline. Data tetap aman di penyimpanan HP.'
      };
    }

    const backendUrl = await TrailDB.getSetting('backend_url', '');
    if (!backendUrl || !backendUrl.trim().startsWith('http')) {
      return {
        success: false,
        message: 'URL Google Apps Script belum dikonfigurasi di menu Pengaturan.'
      };
    }

    const pendingLogs = await TrailDB.getPendingLogs();
    if (!pendingLogs || pendingLogs.length === 0) {
      return {
        success: true,
        count: 0,
        message: 'Semua data sudah tersinkronisasi.'
      };
    }

    this.isSyncing = true;
    try {
      const stationName = await TrailDB.getSetting('station_name', this.stationName);
      const payload = {
        action: 'batch_timing_sync',
        device_id: this.deviceId,
        station_name: stationName,
        client_timestamp: new Date().toISOString(),
        logs: pendingLogs
      };

      console.log(`[TrailSync] Mengirim ${pendingLogs.length} data ke server...`);

      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8' // Preferred for Google Apps Script CORS
        },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`Server merespon dengan status ${response.status}`);
      }

      const result = await response.json().catch(() => ({ status: 'success' }));
      
      // If server confirmed success, mark as synced in local DB
      const syncedIds = pendingLogs.map(l => l.id);
      await TrailDB.markLogsAsSynced(syncedIds);

      console.log(`[TrailSync] Berhasil mensinkronkan ${syncedIds.length} data.`);

      if (typeof this.onSyncComplete === 'function') {
        this.onSyncComplete({ success: true, count: syncedIds.length, isManual });
      }

      return {
        success: true,
        count: syncedIds.length,
        message: `Berhasil mensinkronkan ${syncedIds.length} catatan waktu!`
      };

    } catch (err) {
      console.warn('[TrailSync] Gagal sinkronisasi:', err);
      return {
        success: false,
        error: err,
        message: `Gagal mengirim data: ${err.message || 'Koneksi tidak stabil'}. Data tetap tersimpan aman di HP.`
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Tarik Data Peserta Master dari Google Sheets (Cloud Pull)
   * Berguna bagi seluruh panitia di Basecamp sebelum naik ke pos gunung masing-masing
   */
  async pullParticipantsFromCloud() {
    if (!this.isOnline()) {
      return {
        success: false,
        message: 'Gagal menarik data: Perangkat sedang Offline. Pastikan ada internet saat di Basecamp.'
      };
    }

    const backendUrl = await TrailDB.getSetting('backend_url', '');
    if (!backendUrl || !backendUrl.trim().startsWith('http')) {
      return {
        success: false,
        message: 'URL Google Apps Script belum diisi di Pengaturan.'
      };
    }

    try {
      const url = backendUrl + (backendUrl.includes('?') ? '&' : '?') + 'action=get_participants';
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      if (data && Array.isArray(data.participants) && data.participants.length > 0) {
        await TrailDB.saveParticipantsBatch(data.participants);
        return {
          success: true,
          count: data.participants.length,
          message: `Berhasil menarik ${data.participants.length} peserta dari server Google Sheets!`
        };
      } else {
        return {
          success: true,
          count: 0,
          message: 'Belum ada data peserta di lembar Google Sheets.'
        };
      }
    } catch (err) {
      console.error('[TrailSync] Gagal menarik data peserta:', err);
      return {
        success: false,
        message: `Gagal menarik data dari server: ${err.message}`
      };
    }
  }

  // --- CSV / JSON EXPORT FOR PHYSICAL BACKUP ---
  static async exportLogsCSV() {
    const logs = await TrailDB.getAllTimingLogs();
    if (!logs || logs.length === 0) {
      alert('Belum ada log waktu untuk diexport.');
      return;
    }

    const headers = [
      'Log_ID',
      'BIB',
      'Nama_Peserta',
      'Kategori',
      'Aksi',
      'Checkpoint_Index',
      'Nama_Checkpoint',
      'Device_Timestamp',
      'Split_Waktu',
      'Elapsed_Waktu',
      'Pace',
      'Kecepatan_KMH',
      'Status_Sync',
      'Waktu_Sync'
    ];

    const rows = logs.map(l => [
      l.id,
      `"${l.bib || ''}"`,
      `"${(l.participant_name || '').replace(/"/g, '""')}"`,
      `"${(l.category || '').replace(/"/g, '""')}"`,
      l.action || '',
      l.checkpoint_index !== undefined ? l.checkpoint_index : '',
      `"${(l.checkpoint_name || '').replace(/"/g, '""')}"`,
      l.device_timestamp || '',
      TrailTimer.formatElapsed(l.split_ms),
      TrailTimer.formatElapsed(l.elapsed_ms),
      `"${l.pace || ''}"`,
      `"${l.speed || ''}"`,
      l.sync_status || 'pending',
      l.synced_at || '-'
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    this.downloadFile(csvContent, `TrailTimer_Logs_${this.getDateStamp()}.csv`, 'text/csv;charset=utf-8;');
  }

  static async exportParticipantsCSV() {
    const participants = await TrailDB.getAllParticipants();
    if (!participants || participants.length === 0) {
      alert('Belum ada data peserta untuk diexport.');
      return;
    }

    // Sort by BIB numeric if possible
    participants.sort((a, b) => (parseInt(a.bib) || 0) - (parseInt(b.bib) || 0));

    const headers = [
      'BIB',
      'Nama',
      'Kategori',
      'Tim',
      'Status',
      'Waktu_Start',
      'Waktu_Finish',
      'Total_Waktu',
      'Rata_Rata_Pace',
      'Rata_Rata_Speed',
      'Jumlah_CP_Tuntas'
    ];

    const rows = participants.map(p => [
      `"${p.bib}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${(p.category || '').replace(/"/g, '""')}"`,
      `"${(p.team || '').replace(/"/g, '""')}"`,
      p.status || 'dns',
      p.startTime ? TrailTimer.formatTimeOfDay(p.startTime) : '-',
      p.finishTime ? TrailTimer.formatTimeOfDay(p.finishTime) : '-',
      p.totalMs ? TrailTimer.formatElapsed(p.totalMs) : '-',
      p.avgPace || '-',
      p.avgSpeed || '-',
      (p.splits || []).length
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    this.downloadFile(csvContent, `TrailTimer_Peserta_${this.getDateStamp()}.csv`, 'text/csv;charset=utf-8;');
  }

  static async exportLeaderboardCSV(category = 'Semua') {
    const participants = await TrailDB.getAllParticipants();
    const finished = participants.filter(p => p.status === 'finished');

    // Filter category if specified
    const filtered = (category === 'Semua') ? finished : finished.filter(p => p.category === category);
    filtered.sort((a, b) => (a.totalMs || Infinity) - (b.totalMs || Infinity));

    const headers = ['Peringkat', 'BIB', 'Nama', 'Kategori', 'Total_Waktu', 'Avg_Pace', 'Avg_Speed'];
    const rows = filtered.map((p, idx) => [
      idx + 1,
      `"${p.bib}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${(p.category || '').replace(/"/g, '""')}"`,
      TrailTimer.formatElapsed(p.totalMs),
      p.avgPace || '-',
      p.avgSpeed || '-'
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const catClean = category.replace(/[^a-zA-Z0-9]/g, '_');
    this.downloadFile(csvContent, `TrailTimer_Klasemen_${catClean}_${this.getDateStamp()}.csv`, 'text/csv;charset=utf-8;');
  }

  static async exportJSONBackup() {
    const backup = await TrailDB.exportFullBackup();
    const jsonString = JSON.stringify(backup, null, 2);
    this.downloadFile(jsonString, `TrailTimer_Backup_Full_${this.getDateStamp()}.json`, 'application/json');
  }

  static downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }

  static getDateStamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
}

// Export to window
window.TrailSync = TrailSync;

