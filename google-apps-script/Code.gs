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

    var isFirstColNo = sheetPeserta.getRange(1, 1).getValue().toString().toLowerCase().includes('no');
    var startCol = isFirstColNo ? 2 : 1;
    // Baca hingga kolom Status Terkini (Col B, C, D, E)
    var numColsToRead = 4;
    var data = sheetPeserta.getRange(2, startCol, lastRow - 1, numColsToRead).getValues();
    var list = [];

    for (var i = 0; i < data.length; i++) {
      var rawBib = String(data[i][0] !== null && data[i][0] !== undefined ? data[i][0] : '').trim();
      var rawName = String(data[i][1] || '').trim();
      var rawCat = String(data[i][2] || '').trim();
      var rawStatus = String(data[i][3] || '').trim().toLowerCase();

      var bib = rawBib;
      var name = rawName;
      var category = rawCat || 'Trail';
      var status = 'dns';

      if (rawStatus === 'finish' || rawStatus === 'finished') {
        status = 'finished';
      } else if (rawStatus === 'berlari' || rawStatus === 'running') {
        status = 'running';
      } else if (rawStatus === 'dnf') {
        status = 'dnf';
      }

      // Koreksi Cerdas jika kolom BIB kosong tapi Nama diawali angka
      if (!bib && name) {
        var match = name.match(/^(\d+)\s*(.*)$/);
        if (match) {
          bib = match[1];
          name = match[2] || ('Peserta ' + bib);
        } else {
          bib = String(100 + i + 1);
        }
      }

      // Pastikan BIB tidak kosong
      if (!bib) {
        bib = String(i + 1);
      }

      list.push({
        bib: bib,
        name: name || ('Peserta ' + bib),
        category: category,
        status: status,
        startTime: (status === 'running' || status === 'finished') ? Date.now() : null,
        splits: [],
        finishTime: (status === 'finished') ? Date.now() : null,
        totalMs: null,
        history: []
      });
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
 * Inisialisasi sheet dan header jika belum ada (dengan Kolom 'No.' di paling kiri)
 */
function initSpreadsheetStructure(ss) {
  // 1. Sheet Timing_Logs
  var sheetLogs = ss.getSheetByName('Timing_Logs');
  if (!sheetLogs) {
    sheetLogs = ss.insertSheet('Timing_Logs');
    sheetLogs.appendRow([
      'No.',
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
    sheetLogs.getRange(1, 1, 1, 15).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
    sheetLogs.setFrozenRows(1);
  } else {
    // Migrasi otomatis jika sheet sudah ada tapi belum ada kolom 'No.'
    if (sheetLogs.getRange(1, 1).getValue().toString().toLowerCase() !== 'no.') {
      sheetLogs.insertColumnBefore(1);
      sheetLogs.getRange(1, 1).setValue('No.').setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
      var numRows = sheetLogs.getLastRow() - 1;
      if (numRows > 0) {
        var numbers = [];
        for (var n = 1; n <= numRows; n++) numbers.push([n]);
        sheetLogs.getRange(2, 1, numRows, 1).setValues(numbers);
      }
    }
  }

  // 2. Sheet Peserta (Master & Real-time Progress)
  var sheetPeserta = ss.getSheetByName('Peserta');
  if (!sheetPeserta) {
    sheetPeserta = ss.insertSheet('Peserta');
    sheetPeserta.appendRow([
      'No.',
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
    sheetPeserta.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    sheetPeserta.setFrozenRows(1);
  } else {
    // Migrasi otomatis jika sheet sudah ada tapi belum ada kolom 'No.'
    if (sheetPeserta.getRange(1, 1).getValue().toString().toLowerCase() !== 'no.') {
      sheetPeserta.insertColumnBefore(1);
      sheetPeserta.getRange(1, 1).setValue('No.').setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
      var numRowsPeserta = sheetPeserta.getLastRow() - 1;
      if (numRowsPeserta > 0) {
        var numbersPeserta = [];
        for (var np = 1; np <= numRowsPeserta; np++) numbersPeserta.push([np]);
        sheetPeserta.getRange(2, 1, numRowsPeserta, 1).setValues(numbersPeserta);
      }
    }
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

  var startNo = sheetLogs.getLastRow(); // Baris berikutnya untuk nomor urut log

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
      startNo + i,
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
        name: participantName,
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
 * Update data ringkasan peserta di sheet Peserta (dengan kolom No. di Kolom A)
 */
function updatePesertaSheet(sheet, updates) {
  var lastRow = sheet.getLastRow();
  var bibMap = {};

  // Kolom A adalah No., Kolom B adalah BIB
  if (lastRow > 1) {
    var bibData = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
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
      // Baris sudah ada -> update kolom B sampai K (kolom 2 sampai 11), No. di kolom A tetap
      sheet.getRange(bibMap[bib], 2, 1, 10).setValues([rowValues]);
    } else {
      // Baris baru -> tambahkan No. urut baru di kolom A
      var newNo = sheet.getLastRow(); // row 2 mendapatkan No. 1, dst.
      sheet.appendRow([newNo].concat(rowValues));
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

