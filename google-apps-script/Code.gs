/**
 * TrailTimer - Google Apps Script Backend
 * Web App endpoint to receive offline-first timing logs and participant data directly into Google Sheets.
 * 
 * CARA DEPLOY:
 * 1. Buat Google Spreadsheet baru (misal: "Hasil Trail Running Merbabu 2026").
 * 2. Klik menu 'Extensions' (Ekstensi) > 'Apps Script'.
 * 3. Hapus kode default, paste seluruh isi file ini ke 'Code.gs'.
 * 4. Klik tombol 'Save' (ikon disket).
 * 5. Klik tombol biru 'Deploy' di kanan atas > 'New deployment' (Penyebaran baru).
 * 6. Pilih type 'Web app' (ikon gerigi).
 * 7. Atur:
 *    - Description: "TrailTimer API v1"
 *    - Execute as: "Me" (email Anda)
 *    - Who has access: "Anyone" (Siapa saja - penting agar PWA bisa mengirim tanpa login akun Google)
 * 8. Klik 'Deploy'. Berikan izin otorisasi jika diminta oleh Google.
 * 9. Salin "Web app URL" (akhiran /exec) dan paste ke menu 'Pengaturan & Sync' di aplikasi TrailTimer.
 */

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Aksi untuk menarik data peserta dari Google Sheets ke HP Panitia
  if (action === 'get_participants') {
    var sheetPeserta = ss.getSheetByName('Peserta');
    if (!sheetPeserta) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        participants: []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastRow = sheetPeserta.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        participants: []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheetPeserta.getRange(2, 1, lastRow - 1, 3).getValues();
    var list = [];
    for (var i = 0; i < data.length; i++) {
      var bib = String(data[i][0]).trim();
      var name = String(data[i][1]).trim();
      var category = String(data[i][2]).trim();
      if (bib || name) {
        list.push({
          bib: bib,
          name: name,
          category: category || 'Trail',
          status: 'dns',
          startTime: null,
          splits: [],
          finishTime: null,
          totalMs: null,
          history: []
        });
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      count: list.length,
      participants: list
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    app: 'TrailTimer Google Apps Script Backend',
    version: '1.1',
    timestamp: new Date().toISOString(),
    message: 'Backend siap menerima dan mengirim data catatan waktu lomba lari!'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  // Lock 30 detik untuk menghindari race condition jika banyak pos sync bersamaan
  try {
    lock.waitLock(30000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Server sedang sibuk memproses data lain. Silakan coba lagi.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var rawContent = e.postData ? e.postData.contents : '';
    if (!rawContent) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'Payload kosong.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(rawContent);
    var action = data.action || 'batch_timing_sync';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    initSpreadsheetStructure(ss);

    if (action === 'batch_timing_sync' && Array.isArray(data.logs)) {
      var count = processBatchLogs(ss, data);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Berhasil menyimpan ' + count + ' data log waktu.',
        synced_count: count,
        server_timestamp: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'Aksi tidak dikenal: ' + action
      })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Terjadi kesalahan server: ' + err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Inisialisasi sheet dan header jika belum ada
 */
function initSpreadsheetStructure(ss) {
  // 1. Sheet Timing_Logs
  var sheetLogs = ss.getSheetByName('Timing_Logs');
  if (!sheetLogs) {
    sheetLogs = ss.insertSheet('Timing_Logs');
    sheetLogs.appendRow([
      'Server Time',
      'Device Timestamp',
      'Device ID',
      'Station / Pos',
      'BIB',
      'Nama Peserta',
      'Kategori',
      'Aksi',
      'Checkpoint',
      'Split Time',
      'Elapsed Time',
      'Pace',
      'Kecepatan (km/h)',
      'Log ID'
    ]);
    sheetLogs.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
    sheetLogs.setFrozenRows(1);
  }

  // 2. Sheet Peserta (Master & Real-time Progress)
  var sheetPeserta = ss.getSheetByName('Peserta');
  if (!sheetPeserta) {
    sheetPeserta = ss.insertSheet('Peserta');
    sheetPeserta.appendRow([
      'BIB',
      'Nama Peserta',
      'Kategori',
      'Status Terkini',
      'Pos Terakhir',
      'Waktu Split Terakhir',
      'Total Waktu Tempuh',
      'Avg Pace',
      'Avg Speed (km/h)',
      'Terakhir Diperbarui'
    ]);
    sheetPeserta.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    sheetPeserta.setFrozenRows(1);
  }
}

/**
 * Proses batch log dari PWA
 */
function processBatchLogs(ss, data) {
  var sheetLogs = ss.getSheetByName('Timing_Logs');
  var sheetPeserta = ss.getSheetByName('Peserta');

  var logs = data.logs;
  var deviceId = data.device_id || '-';
  var stationName = data.station_name || '-';
  var serverTime = new Date();

  var logRows = [];
  var participantUpdates = {};

  for (var i = 0; i < logs.length; i++) {
    var l = logs[i];
    var bib = String(l.bib || '').trim();
    var participantName = String(l.participant_name || '').trim();

    // Fallback cerdas: Jika BIB kosong tapi Nama diawali angka (misal "103 Dewi Lestari")
    if (!bib && participantName) {
      var match = participantName.match(/^(\d+)\s*(.*)$/);
      if (match) {
        bib = match[1];
        participantName = match[2];
      }
    }

    logRows.push([
      serverTime,
      l.device_timestamp || '',
      deviceId,
      stationName,
      bib,
      participantName,
      l.category || '',
      l.action || '',
      l.checkpoint_name || '',
      formatElapsedGAS(l.split_ms),
      formatElapsedGAS(l.elapsed_ms),
      l.pace || '',
      l.speed || '',
      l.id || ''
    ]);

    // Track latest status for this BIB
    if (bib) {
      participantUpdates[bib] = {
        bib: bib,
        name: l.participant_name || '',
        category: l.category || '',
        status: (l.action === 'FINISH') ? 'Finish' : ((l.action === 'DNF') ? 'DNF' : 'Berlari'),
        lastStation: l.checkpoint_name || l.action,
        lastSplit: formatElapsedGAS(l.split_ms),
        totalTime: formatElapsedGAS(l.elapsed_ms),
        pace: l.pace || '',
        speed: l.speed || '',
        updatedAt: serverTime
      };
    }
  }

  // Batch append ke Timing_Logs
  if (logRows.length > 0) {
    sheetLogs.getRange(sheetLogs.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
  }

  // Update sheet Peserta
  updatePesertaSheet(sheetPeserta, participantUpdates);

  return logs.length;
}

/**
 * Update data ringkasan peserta di sheet Peserta
 */
function updatePesertaSheet(sheet, updates) {
  var lastRow = sheet.getLastRow();
  var bibMap = {};

  if (lastRow > 1) {
    var bibData = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < bibData.length; r++) {
      var rowBib = String(bibData[r][0]).trim();
      if (rowBib) {
        bibMap[rowBib] = r + 2; // Row number in sheet (1-based)
      }
    }
  }

  for (var bib in updates) {
    var u = updates[bib];
    var rowValues = [
      u.bib,
      u.name,
      u.category,
      u.status,
      u.lastStation,
      u.lastSplit,
      u.totalTime,
      u.pace,
      u.speed,
      u.updatedAt
    ];

    if (bibMap[bib]) {
      // Row exists -> update
      sheet.getRange(bibMap[bib], 1, 1, 10).setValues([rowValues]);
    } else {
      // New row -> append
      sheet.appendRow(rowValues);
      bibMap[bib] = sheet.getLastRow();
    }
  }
}

/**
 * Format MS to HH:MM:SS
 */
function formatElapsedGAS(ms) {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return '-';
  var totalSec = Math.floor(ms / 1000);
  var hours = Math.floor(totalSec / 3600);
  var minutes = Math.floor((totalSec % 3600) / 60);
  var seconds = totalSec % 60;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
}

