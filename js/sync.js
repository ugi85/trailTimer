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
    this.isSyncing = true;
    let pushCount = 0;
    let pullCount = 0;

    try {
      // 1. PUSH: Kirim pending logs jika ada
      if (pendingLogs && pendingLogs.length > 0) {
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
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });

        if (response.ok) {
          const syncedIds = pendingLogs.map(l => l.id);
          await TrailDB.markLogsAsSynced(syncedIds);
          pushCount = syncedIds.length;
          console.log(`[TrailSync] Berhasil mensinkronkan ${pushCount} data.`);
        }
      }

      // 2. PULL: Tarik data master peserta dari Google Sheets (Sinkronisasi 2 Arah Penuh)
      const pullRes = await this.pullParticipantsFromCloud();
      if (pullRes && pullRes.success) {
        pullCount = pullRes.count || 0;
      }

      if (typeof this.onSyncComplete === 'function') {
        this.onSyncComplete({ success: true, count: pushCount, pullCount: pullCount, isManual });
      }

      let msg = '';
      if (pushCount > 0 && pullCount > 0) {
        msg = `Sync Berhasil: Mengirim ${pushCount} log & menarik ${pullCount} peserta dari Google Sheets!`;
      } else if (pushCount > 0) {
        msg = `Berhasil mengirim ${pushCount} catatan waktu ke server!`;
      } else if (pullCount > 0) {
        msg = `Berhasil menarik ${pullCount} peserta dari Google Sheets!`;
      } else {
        msg = `Semua data sudah tersinkronisasi dengan Google Sheets.`;
      }

      return {
        success: true,
        count: pushCount,
        pullCount: pullCount,
        message: msg
      };

    } catch (err) {
      console.warn('[TrailSync] Gagal sinkronisasi:', err);
      return {
        success: false,
        error: err,
        message: `Gagal sinkronisasi: ${err.message || 'Koneksi tidak stabil'}. Data tetap tersimpan aman di HP.`
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
      const url = backendUrl + (backendUrl.includes('?') ? '&' : '?') + 'action=get_participants&t=' + Date.now();
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      // Sinkronkan konfigurasi rute dari Google Sheets jika tersedia
      if (data && data.route_config && Array.isArray(data.route_config.checkpoints) && data.route_config.checkpoints.length > 0) {
        if (typeof state !== 'undefined' && state) {
          state.routeConfig = data.route_config;
        }
        await TrailDB.setSetting('route_config', data.route_config);
        if (typeof populateStationDropdowns === 'function') populateStationDropdowns();
        if (typeof renderRouteSetup === 'function') renderRouteSetup();
        if (typeof renderMarshalLinkGenerator === 'function') renderMarshalLinkGenerator();
        if (typeof renderParticipantCards === 'function') renderParticipantCards();
        if (typeof updateQuickPuncherForStation === 'function') updateQuickPuncherForStation();
        console.log('[TrailSync] Konfigurasi rute berhasil disinkronkan dari Google Sheets:', data.route_config);
      }
      if (data && Array.isArray(data.participants) && data.participants.length > 0) {
        // Smart Merge: Sinkronkan startTime dan status resmi dari server ke seluruh device
        const localList = await TrailDB.getAllParticipants();
        const localMap = {};
        for (const lp of localList) localMap[String(lp.bib)] = lp;

        for (const sp of data.participants) {
          const bib = String(sp.bib);
          if (localMap[bib]) {
            const lp = localMap[bib];
            // Jika di Google Sheets statusnya 'dns' (belum start / lomba di-reset oleh admin):
            if (sp.status === 'dns' || (!sp.startTime && !sp.status)) {
              lp.status = 'dns';
              lp.startTime = null;
              lp.finishTime = null;
              lp.totalMs = null;
              lp.splits = [];
              lp.avgPace = null;
              lp.avgSpeed = null;
              lp.lastCp = null;
              lp.history = [];
            } else {
              // Status resmi server (running atau finished)
              if (sp.startTime) lp.startTime = sp.startTime;
              if (sp.status) lp.status = sp.status;
              if (sp.finishTime) lp.finishTime = sp.finishTime;
              if (sp.totalMs !== undefined && sp.totalMs !== null) lp.totalMs = sp.totalMs;
              if (sp.avgPace) lp.avgPace = sp.avgPace;
              if (sp.avgSpeed) lp.avgSpeed = sp.avgSpeed;
              if (sp.lastCp) lp.lastCp = sp.lastCp;
              if (Array.isArray(sp.splits) && sp.splits.length > 0) {
                if (!lp.splits || lp.splits.length === 0 || sp.splits.length >= lp.splits.length) {
                  lp.splits = sp.splits;
                }
              }
            }
            lp.name = sp.name || lp.name;
            lp.category = sp.category || lp.category;
            lp.team = sp.team || lp.team || '';
          } else {
            localMap[bib] = {
              ...sp,
              team: sp.team || ''
            };
          }
        }

        // Hapus peserta lokal jika sudah dihapus dari Google Sheets
        const serverBibs = new Set(data.participants.map(sp => String(sp.bib)));
        for (const lp of localList) {
          const bibStr = String(lp.bib);
          if (!serverBibs.has(bibStr)) {
            delete localMap[bibStr];
            await TrailDB.deleteParticipant(lp.bib);
          }
        }

        await TrailDB.saveParticipantsBatch(Object.values(localMap));
        return {
          success: true,
          count: data.participants.length,
          message: `Berhasil sinkronkan ${data.participants.length} peserta dari server Google Sheets!`
        };
      } else {
        // Database Google Sheets KOSONG (0 peserta)
        const localList = await TrailDB.getAllParticipants();
        if (localList.length > 0) {
          console.log('[TrailSync] Google Sheets kosong, membersihkan ' + localList.length + ' peserta lokal...');
          await TrailDB.clearAllParticipants();
          await TrailDB.clearAllTimingLogs();
          if (typeof refreshParticipants === 'function') await refreshParticipants();
        }
        return {
          success: true,
          count: 0,
          isEmptySheet: true,
          message: 'Database Google Sheets kosong. Data di HP telah dikosongkan mengikuti server.'
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
  /**
   * Unduh Berkas Template Excel (.xls) Asli dengan Kolom & Baris Rapi
   * Langsung terbuka dalam kolom A, B, C, D di Microsoft Excel tanpa masalah separator CSV
   */
  static downloadParticipantTemplate() {
    const headers = ['BIB', 'Nama Peserta', 'Kategori', 'Tim atau Komunitas'];
    const sampleRows = [
      ['101', 'Budi Santoso', '21K Trail', 'Merbabu Runners'],
      ['102', 'Siti Rahma', '21K Trail', 'Rinjani Trail Club'],
      ['103', 'Andi Wijaya', '10K Fun Trail', 'Solo Trail Squad'],
      ['104', 'Dewi Lestari', '10K Fun Trail', 'Bandung Trail Running'],
      ['105', 'Rian Pratama', '50K Ultra', 'Salomon Squad'],
      ['106', 'Fajar Nugraha', '21K Trail', 'Semarang Trail Enthusiast']
    ];

    let tableHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Data Peserta</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
        <style>
          th { background-color: #0f766e; color: #ffffff; font-weight: bold; border: 1px solid #243b4a; padding: 8px 12px; }
          td { border: 1px solid #cbd5e1; padding: 6px 10px; font-family: sans-serif; }
          .num { mso-number-format: "\\@"; text-align: center; font-weight: bold; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              ${headers.map(h => `<th>${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${sampleRows.map(row => `
              <tr>
                <td class="num">${row[0]}</td>
                <td>${row[1]}</td>
                <td>${row[2]}</td>
                <td>${row[3]}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `.trim();

    this.downloadFile(tableHtml, 'Template_Peserta_TrailTimer.xls', 'application/vnd.ms-excel;charset=utf-8;');
  }

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
    const rows = filtered.map((p, idx) => {
      const totalDur = p.totalMs || (p.finishTime && p.startTime ? p.finishTime - p.startTime : null);
      return [
        idx + 1,
        `"${p.bib}"`,
        `"${(p.name || '').replace(/"/g, '""')}"`,
        `"${(p.category || '').replace(/"/g, '""')}"`,
        TrailTimer.formatElapsed(totalDur),
        p.avgPace || '-',
        p.avgSpeed || '-'
      ];
    });

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

