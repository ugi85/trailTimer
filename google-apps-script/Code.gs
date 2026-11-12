/**
 * TrailTimer - Google Apps Script Backend (v1.2)
 * Web App endpoint to receive offline-first timing logs and participant data directly into Google Sheets.
 * 
 * CARA MENGGUNAKAN & MEMPERBAIKI TAMPILAN HEADER:
 * 1. Buka spreadsheet Google Sheets Anda ("Timer").
 * 2. Klik menu 'Extensions' (Ekstensi) > 'Apps Script'.
 * 3. Hapus seluruh isi lama di 'Code.gs', lalu paste seluruh kode ini.
 * 4. Klik ikon 'Save' (Disket).
 * 5. CARA INSTAN MENAMPILKAN KEMBALI HEADER:
 *    - Di bar atas Apps Script, pilih fungsi 'perbaikiDanTampilkanHeader' dari dropdown.
 *    - Klik tombol 'Run' (Jalankan).
 *    - Buka tab Google Sheets Anda: seluruh judul kolom (Header) di sheet 'Peserta' dan 'Timing_Logs'
 *      akan langsung muncul kembali dengan warna kontras dan teks putih tebal!
 *    - Format '12/31/1899' di kolom No. juga otomatis berubah menjadi angka 1, 2, dst.
 * 6. Klik tombol biru 'Deploy' di kanan atas > 'Manage deployments' > Ikon pensil > Version: 'New version' > 'Deploy'.
 */

// ==========================================
// 1. MENU OTOMATIS DI GOOGLE SHEETS
// ==========================================
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('🏃 TrailTimer')
      .addItem('🛠️ Tampilkan & Perbaiki Header', 'perbaikiDanTampilkanHeader')
      .addItem('🔢 Rapikan Nomor Urut & Format Kolom', 'rapikanNomorDanFormat')
      .addToUi();
  } catch (e) {
    // Non-UI context
  }
}

/**
 * Menulis ulang header Baris 1 secara lengkap & merapikan format tampilan seketika
 */
function perbaikiDanTampilkanHeader() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  initSpreadsheetStructure(ss);
  rapikanNomorDanFormat();
  
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('Header dan format sheet berhasil diperbarui dan ditampilkan kembali!', 'TrailTimer', 5);
  } catch (e) {}
}

/**
 * Merapikan nomor urut baris dan memastikan kolom No. berformat angka '0' (bukan tanggal 1899)
 */
function rapikanNomorDanFormat() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Rapikan sheet Peserta
  var sheetPeserta = ss.getSheetByName('Peserta');
  if (sheetPeserta && sheetPeserta.getLastRow() > 1) {
    var lastRowP = sheetPeserta.getLastRow();
    sheetPeserta.getRange(2, 1, lastRowP - 1, 1).setNumberFormat('0');
    var numsP = [];
    for (var p = 1; p <= lastRowP - 1; p++) numsP.push([p]);
    sheetPeserta.getRange(2, 1, lastRowP - 1, 1).setValues(numsP);
    sheetPeserta.getRange(2, 2, lastRowP - 1, 1).setNumberFormat('@'); // Kolom BIB sebagai teks
  }

  // 2. Rapikan sheet Timing_Logs
  var sheetLogs = ss.getSheetByName('Timing_Logs');
  if (sheetLogs && sheetLogs.getLastRow() > 1) {
    var lastRowL = sheetLogs.getLastRow();
    sheetLogs.getRange(2, 1, lastRowL - 1, 1).setNumberFormat('0');
    var numsL = [];
    for (var l = 1; l <= lastRowL - 1; l++) numsL.push([l]);
    sheetLogs.getRange(2, 1, lastRowL - 1, 1).setValues(numsL);

    // Otomatis koreksi jika ada data baris yang tergeser (misal Kolom F kosong tapi Kolom G berisi angka BIB)
    for (var r = 2; r <= lastRowL; r++) {
      var valF = String(sheetLogs.getRange(r, 6).getValue() || '').trim();
      var valG = String(sheetLogs.getRange(r, 7).getValue() || '').trim();
      if (valF === '' && valG !== '') {
        // Kolom F kosong tapi Kolom G ada nilai -> geser Kolom G..O ke kiri menjadi Kolom F..N
        var rowData = sheetLogs.getRange(r, 7, 1, 9).getValues();
        sheetLogs.getRange(r, 6, 1, 9).setValues(rowData);
        sheetLogs.getRange(r, 16).clearContent();
      }
    }
  }
}

// ==========================================
// 2. HTTP GET: CLOUD PULL DATA PESERTA
// ==========================================
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
    // Baca hingga kolom Start Timestamp (10 kolom dari startCol)
    var numColsToRead = 10;
    var data = sheetPeserta.getRange(2, startCol, lastRow - 1, numColsToRead).getValues();
    var list = [];

    for (var i = 0; i < data.length; i++) {
      var rawBib = String(data[i][0] !== null && data[i][0] !== undefined ? data[i][0] : '').trim();
      var rawName = String(data[i][1] || '').trim();
      var rawCat = String(data[i][2] || '').trim();
      var rawStatus = String(data[i][3] || '').trim().toLowerCase();
      var rawStartTs = parseInt(data[i][9], 10);

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

      var officialStartTime = (!isNaN(rawStartTs) && rawStartTs > 0) ? rawStartTs : null;
      if (!officialStartTime && (status === 'running' || status === 'finished')) {
        // Fallback jika belum tersimpan di sheet
        officialStartTime = Date.now();
      }

      list.push({
        bib: bib,
        name: name || ('Peserta ' + bib),
        category: category,
        status: status,
        startTime: officialStartTime,
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
    version: '1.2',
    timestamp: new Date().toISOString(),
    message: 'Backend siap menerima dan mengirim data catatan waktu lomba lari!'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 3. HTTP POST: MENERIMA TIMING LOGS DARI PWA
// ==========================================
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

// ==========================================
// 4. STRUKTUR & INISIALISASI HEADER SHEET
// ==========================================
function initSpreadsheetStructure(ss) {
  // 1. Sheet Timing_Logs
  var sheetLogs = ss.getSheetByName('Timing_Logs');
  var logHeaders = [
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
  ];

  if (!sheetLogs) {
    sheetLogs = ss.insertSheet('Timing_Logs');
  }

  // Periksa apakah kolom pertama adalah 'No.'
  var firstCellLogs = sheetLogs.getRange(1, 1).getValue().toString().trim().toLowerCase();
  if (firstCellLogs !== 'no.' && (firstCellLogs.includes('server') || firstCellLogs.includes('time') || firstCellLogs.includes('1899'))) {
    sheetLogs.insertColumnBefore(1);
  }

  // SELALU tulis dan pastikan header lengkap di Baris 1
  sheetLogs.getRange(1, 1, 1, logHeaders.length)
    .setValues([logHeaders])
    .setFontWeight('bold')
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  
  sheetLogs.setFrozenRows(1);
  sheetLogs.getRange('A:A').setNumberFormat('0');

  // 2. Sheet Peserta (Master & Real-time Progress)
  var sheetPeserta = ss.getSheetByName('Peserta');
  var pesertaHeaders = [
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
    'Start Timestamp',
    'Terakhir Diperbarui'
  ];

  if (!sheetPeserta) {
    sheetPeserta = ss.insertSheet('Peserta');
  }

  var firstCellPeserta = sheetPeserta.getRange(1, 1).getValue().toString().trim().toLowerCase();
  if (firstCellPeserta !== 'no.' && firstCellPeserta.includes('bib')) {
    sheetPeserta.insertColumnBefore(1);
  }

  // SELALU tulis dan pastikan header lengkap di Baris 1
  sheetPeserta.getRange(1, 1, 1, pesertaHeaders.length)
    .setValues([pesertaHeaders])
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  sheetPeserta.setFrozenRows(1);
  sheetPeserta.getRange('A:A').setNumberFormat('0');
  sheetPeserta.getRange('B:B').setNumberFormat('@');
}

// ==========================================
// 5. PROSES BATCH LOG DARI PWA
// ==========================================
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
      var isStartAction = (l.action === 'START' || l.action === 'MASS_START');
      if (!participantUpdates[bib]) {
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
          startTimestamp: isStartAction ? (l.timestamp || '') : '',
          updatedAt: serverTime
        };
      } else {
        var existing = participantUpdates[bib];
        existing.status = (l.action === 'FINISH') ? 'Finish' : ((l.action === 'DNF') ? 'DNF' : 'Berlari');
        existing.lastStation = l.checkpoint_name || l.action;
        existing.lastSplit = formatElapsedGAS(l.split_ms);
        existing.totalTime = formatElapsedGAS(l.elapsed_ms);
        existing.pace = l.pace || '';
        existing.speed = l.speed || '';
        if (isStartAction) {
          existing.startTimestamp = l.timestamp || '';
        }
        existing.updatedAt = serverTime;
      }
    }
  }

  // Batch append ke Timing_Logs
  if (logRows.length > 0) {
    sheetLogs.getRange(sheetLogs.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
    sheetLogs.getRange(2, 1, sheetLogs.getLastRow() - 1, 1).setNumberFormat('0');
  }

  // Update sheet Peserta
  updatePesertaSheet(sheetPeserta, participantUpdates);

  return logs.length;
}

// ==========================================
// 6. UPDATE DATA RINGKASAN SHEET PESERTA
// ==========================================
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
      u.startTimestamp || '',
      u.updatedAt
    ];

    if (bibMap[bib]) {
      var rowIdx = bibMap[bib];
      // Jika baris lama sudah punya startTimestamp tapi update saat ini tidak membawa startTimestamp, pertahankan yang lama
      if (!u.startTimestamp) {
        var oldStartTs = sheet.getRange(rowIdx, 11).getValue(); // Col K
        if (oldStartTs) {
          rowValues[9] = oldStartTs;
        }
      }
      sheet.getRange(rowIdx, 2, 1, 11).setValues([rowValues]);
    } else {
      // Baris baru -> tambahkan No. urut baru di kolom A
      var newNo = sheet.getLastRow(); // row 2 mendapatkan No. 1, dst.
      sheet.appendRow([newNo].concat(rowValues));
      bibMap[bib] = sheet.getLastRow();
    }
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat('0');
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setNumberFormat('@');
  }
}

// ==========================================
// 7. FORMATTER HELPER
// ==========================================
function formatElapsedGAS(ms) {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return '-';
  var totalSec = Math.floor(ms / 1000);
  var hours = Math.floor(totalSec / 3600);
  var minutes = Math.floor((totalSec % 3600) / 60);
  var seconds = totalSec % 60;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
}
