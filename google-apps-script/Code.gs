/**
 * TrailTimer - Google Apps Script Backend (v1.3)
 * Web App endpoint to receive offline-first timing logs and participant data directly into Google Sheets.
 * 
 * CARA MENGGUNAKAN & MEMPERBAIKI TAMPILAN HEADER:
 * 1. Buka spreadsheet Google Sheets Anda ("Timer").
 * 2. Klik menu 'Extensions' (Ekstensi) > 'Apps Script'.
 * 3. Hapus seluruh isi lama di 'Code.gs', lalu paste seluruh kode ini.
 * 4. Klik ikon 'Save' (Disket).
 * 5. CARA INSTAN MERAPIKAN & MENAMPILKAN HEADER:
 *    - Di bar atas Apps Script, pilih fungsi 'perbaikiDanTampilkanHeader' dari dropdown.
 *    - Klik tombol 'Run' (Jalankan).
 *    - Buka tab Google Sheets Anda: seluruh kolom di sheet 'Peserta' dan 'Timing_Logs'
 *      akan langsung rapi dan otomatis menyesuaikan kolom BIB dan Nama!
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
      .addItem('🔢 Rapikan Nomor & Kolom Tergeser', 'rapikanNomorDanFormat')
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
  rapikanNomorDanFormat();
  initSpreadsheetStructure(ss);
  
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('Header dan format sheet berhasil diperbarui dan ditampilkan kembali!', 'TrailTimer', 5);
  } catch (e) {}
}

/**
 * Merapikan nomor urut baris dan otomatis menggeser kolom jika data ter-paste mulai dari Kolom A
 */
function rapikanNomorDanFormat() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Sheet Peserta
  var sheetPeserta = ss.getSheetByName('Peserta');
  if (sheetPeserta && sheetPeserta.getLastRow() > 1) {
    var lastRowP = sheetPeserta.getLastRow();

    // Deteksi cerdas: Jika user mem-paste data Excel mulai dari sel A2 (misal sel A2 berisi angka BIB 101 dan B2 adalah Nama)
    var sampleA = String(sheetPeserta.getRange(2, 1).getValue() || '').trim();
    var sampleB = String(sheetPeserta.getRange(2, 2).getValue() || '').trim();
    var numA = parseInt(sampleA, 10);

    // Jika Kolom A adalah angka BIB (seperti 101, 102) dan Kolom B adalah teks nama orang (ada spasi/huruf)
    if (!isNaN(numA) && numA > (lastRowP + 5) && isNaN(parseInt(sampleB, 10)) && sampleB.length > 0) {
      var lowerB = sampleB.toLowerCase();
      if (lowerB !== 'finish' && lowerB !== 'berlari' && lowerB !== 'running' && lowerB !== 'dns' && lowerB !== 'dnf') {
        // Data tertempel mulai dari Kolom A -> Sisipkan kolom baru di paling kiri untuk Kolom 'No.'
        sheetPeserta.insertColumnBefore(1);
      }
    }

    initSpreadsheetStructure(ss);

    // Tulis nomor urut 1, 2, 3... di Kolom A
    var numRowsP = sheetPeserta.getLastRow() - 1;
    if (numRowsP > 0) {
      sheetPeserta.getRange(2, 1, numRowsP, 1).setNumberFormat('0');
      var numsP = [];
      for (var p = 1; p <= numRowsP; p++) numsP.push([p]);
      sheetPeserta.getRange(2, 1, numRowsP, 1).setValues(numsP);
      sheetPeserta.getRange(2, 2, numRowsP, 1).setNumberFormat('@'); // Kolom BIB sebagai teks

      // 1b. Bersihkan dan format Kolom L (Start Timestamp) menjadi format tanggal & jam rapi "yyyy-MM-dd HH:mm:ss"
      var sheetLogs = ss.getSheetByName('Timing_Logs');
      var startLogsMap = getStartLogsMap(sheetLogs);
      var timeZone = Session.getScriptTimeZone() || 'Asia/Jakarta';

      sheetPeserta.getRange(2, 12, numRowsP, 1).setNumberFormat('@'); // Format plain text agar tidak diubah Sheets
      var bibsP = sheetPeserta.getRange(2, 2, numRowsP, 1).getValues();
      var startsP = sheetPeserta.getRange(2, 12, numRowsP, 1).getValues();
      var statusP = sheetPeserta.getRange(2, 6, numRowsP, 1).getValues();
      var updatedStarts = [];

      for (var r = 0; r < numRowsP; r++) {
        var rBib = String(bibsP[r][0]).trim();
        var rVal = startsP[r][0];
        var rStat = String(statusP[r][0]).toLowerCase();
        var parsed = parseStartTimestamp(rVal);

        // Jika rusak (misal 1/1/1970) atau kosong padahal pelari sedang berlari / finish, pulihkan dari Timing_Logs!
        if (!parsed && (rStat === 'berlari' || rStat === 'running' || rStat === 'finish' || rStat === 'finished')) {
          if (rBib && startLogsMap[rBib]) {
            parsed = startLogsMap[rBib];
          }
        }

        if (parsed) {
          updatedStarts.push([Utilities.formatDate(new Date(parsed), timeZone, 'yyyy-MM-dd HH:mm:ss')]);
        } else {
          updatedStarts.push(['']);
        }
      }
      sheetPeserta.getRange(2, 12, numRowsP, 1).setValues(updatedStarts);
    }
  }

  // 2. Sheet Timing_Logs
  var sheetLogs = ss.getSheetByName('Timing_Logs');
  if (sheetLogs && sheetLogs.getLastRow() > 1) {
    var lastRowL = sheetLogs.getLastRow();
    sheetLogs.getRange(2, 1, lastRowL - 1, 1).setNumberFormat('0');
    sheetLogs.getRange(2, 2, lastRowL - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
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
// 1b. SMART TIME PARSER & LOGS RECOVERY
// ==========================================

/**
 * Smart Parser untuk Start Timestamp:
 * Mampu membaca: Date object, epoch ms (1794753209612), serial number Sheets/Excel, dan string "yyyy-MM-dd HH:mm:ss"
 * Menolak epoch 0 / tahun 1970 (seperti 1/1/1970 7:00:00) yang merupakan tanggal rusak/kosong.
 */
function parseStartTimestamp(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    var t = val.getTime();
    return t > 946684800000 ? t : null; // Tahun 2000 ke atas
  }
  if (typeof val === 'number') {
    if (val > 1e11) return val; // Epoch ms
    // Serial hari Sheets/Excel (relatif th 1899)
    var ms = Math.round((val - 25569) * 86400 * 1000);
    return ms > 946684800000 ? ms : null;
  }
  var s = String(val).trim();
  if (!s) return null;
  if (/^\d{12,14}$/.test(s)) {
    var num = parseInt(s, 10);
    return num > 946684800000 ? num : null;
  }
  var cleaned = s.replace(/-/g, '/');
  var parsed = Date.parse(cleaned);
  if (!isNaN(parsed) && parsed > 946684800000) return parsed;
  var d = new Date(s);
  if (!isNaN(d.getTime()) && d.getTime() > 946684800000) return d.getTime();
  return null;
}

/**
 * Mengambil peta waktu start pertama untuk setiap BIB dari sheet Timing_Logs
 */
function getStartLogsMap(sheetLogs) {
  var map = {};
  if (!sheetLogs || sheetLogs.getLastRow() <= 1) return map;
  var numRows = sheetLogs.getLastRow() - 1;
  var numCols = Math.min(15, sheetLogs.getLastColumn());
  var data = sheetLogs.getRange(2, 1, numRows, numCols).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    // Col F: BIB (idx 5), Col I: Aksi (idx 8), Col C: Device Timestamp (idx 2), Col B: Server Time (idx 1)
    var bib = String(row[5] || '').trim();
    var action = String(row[8] || '').trim().toUpperCase();
    if (bib && (action === 'START' || action === 'MASS_START') && !map[bib]) {
      var ts = parseStartTimestamp(row[2]) || parseStartTimestamp(row[1]);
      if (ts) map[bib] = ts;
    }
  }
  return map;
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

    // Ambil log start untuk fallback jika startTimestamp di sheet Peserta belum tercatat atau rusak
    var sheetLogs = ss.getSheetByName('Timing_Logs');
    var startLogsMap = getStartLogsMap(sheetLogs);

    // Baca data dari baris 2, mulai kolom 1 (Kolom A) sampai kolom 13
    var numCols = Math.min(13, Math.max(5, sheetPeserta.getLastColumn()));
    var allData = sheetPeserta.getRange(2, 1, lastRow - 1, numCols).getValues();
    var list = [];

    // DETEKSI CERDAS: Apakah user menempelkan data Excel mulai dari Kolom A?
    var isShiftedPaste = false;
    if (allData.length > 0) {
      var sampleA = String(allData[0][0] || '').trim();
      var sampleB = String(allData[0][1] || '').trim();
      var numA = parseInt(sampleA, 10);
      if (!isNaN(numA) && isNaN(parseInt(sampleB, 10)) && sampleB.length > 0) {
        var lowerB = sampleB.toLowerCase();
        if (lowerB !== 'finish' && lowerB !== 'berlari' && lowerB !== 'running' && lowerB !== 'dns' && lowerB !== 'dnf') {
          isShiftedPaste = true;
        }
      }
    }

    for (var i = 0; i < allData.length; i++) {
      var row = allData[i];
      var bib, name, category, team, status = 'dns', officialStartTime = null;

      if (isShiftedPaste) {
        bib = String(row[0] !== null && row[0] !== undefined ? row[0] : '').trim();
        name = String(row[1] || '').trim();
        category = String(row[2] || 'Trail').trim();
        team = String(row[3] || '').trim();
        var rawStatusShifted = String(row[4] || '').trim().toLowerCase();
        if (rawStatusShifted === 'finish' || rawStatusShifted === 'finished') status = 'finished';
        else if (rawStatusShifted === 'berlari' || rawStatusShifted === 'running') status = 'running';
        else if (rawStatusShifted === 'dnf') status = 'dnf';
      } else {
        bib = String(row[1] !== null && row[1] !== undefined ? row[1] : '').trim();
        name = String(row[2] || '').trim();
        category = String(row[3] || 'Trail').trim();
        team = String(row[4] || '').trim();
        var rawStatus = String(row[5] || '').trim().toLowerCase();

        if (team.toLowerCase() === 'finish' || team.toLowerCase() === 'berlari' || team.toLowerCase() === 'dns' || team.toLowerCase() === 'dnf') {
          rawStatus = team.toLowerCase();
          team = '';
        }

        if (rawStatus === 'finish' || rawStatus === 'finished') status = 'finished';
        else if (rawStatus === 'berlari' || rawStatus === 'running') status = 'running';
        else if (rawStatus === 'dnf') status = 'dnf';

        // Baca Start Timestamp cerdas dari Kolom L (index 11)
        officialStartTime = parseStartTimestamp(row[11] || row[10] || row[9]);
      }

      // Pastikan nomor BIB tidak kosong
      if (!bib && name) {
        var match = name.match(/^(\d+)\s*(.*)$/);
        if (match) {
          bib = match[1];
          name = match[2];
        } else {
          bib = String(100 + i + 1);
        }
      }
      if (!bib) {
        bib = String(i + 1);
      }

      // Pulihkan waktu start dari Timing_Logs jika di Peserta belum ada atau rusak (1970)
      if (!officialStartTime && (status === 'running' || status === 'finished')) {
        if (bib && startLogsMap[bib]) {
          officialStartTime = startLogsMap[bib];
        } else {
          officialStartTime = Date.now();
        }
      }

      list.push({
        bib: bib,
        name: name || ('Peserta ' + bib),
        category: category || 'Trail',
        team: team || '',
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
      isShiftedPaste: isShiftedPaste,
      participants: list
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    app: 'TrailTimer Google Apps Script Backend',
    version: '1.3',
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

  var firstCellLogs = sheetLogs.getRange(1, 1).getValue().toString().trim().toLowerCase();
  if (firstCellLogs !== 'no.' && (firstCellLogs.includes('server') || firstCellLogs.includes('time') || firstCellLogs.includes('1899'))) {
    sheetLogs.insertColumnBefore(1);
  }

  sheetLogs.getRange(1, 1, 1, logHeaders.length)
    .setValues([logHeaders])
    .setFontWeight('bold')
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  
  sheetLogs.setFrozenRows(1);
  sheetLogs.getRange('A:A').setNumberFormat('0');
  sheetLogs.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  // 2. Sheet Peserta (Master & Real-time Progress)
  var sheetPeserta = ss.getSheetByName('Peserta');
  var pesertaHeaders = [
    'No.',
    'BIB',
    'Nama Peserta',
    'Kategori',
    'Tim / Grup',
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

  sheetPeserta.getRange(1, 1, 1, pesertaHeaders.length)
    .setValues([pesertaHeaders])
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  sheetPeserta.setFrozenRows(1);
  sheetPeserta.getRange('A:A').setNumberFormat('0');
  sheetPeserta.getRange('B:B').setNumberFormat('@');
  sheetPeserta.getRange('L:L').setNumberFormat('@'); // Start Timestamp plain text format "yyyy-MM-dd HH:mm:ss"
  sheetPeserta.getRange('M:M').setNumberFormat('yyyy-mm-dd hh:mm:ss');
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

  var startNo = sheetLogs.getLastRow();

  for (var i = 0; i < logs.length; i++) {
    var l = logs[i];
    var bib = String(l.bib || '').trim();
    var participantName = String(l.participant_name || '').trim();

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

    if (bib) {
      var isStartAction = (l.action === 'START' || l.action === 'MASS_START');
      if (!participantUpdates[bib]) {
        participantUpdates[bib] = {
          bib: bib,
          name: participantName,
          category: l.category || '',
          team: l.team || '',
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
        if (l.team) existing.team = l.team;
        if (isStartAction) {
          existing.startTimestamp = l.timestamp || '';
        }
        existing.updatedAt = serverTime;
      }
    }
  }

  if (logRows.length > 0) {
    sheetLogs.getRange(sheetLogs.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
    sheetLogs.getRange(2, 1, sheetLogs.getLastRow() - 1, 1).setNumberFormat('0');
  }

  updatePesertaSheet(sheetPeserta, participantUpdates);

  return logs.length;
}

// ==========================================
// 6. UPDATE DATA RINGKASAN SHEET PESERTA
// ==========================================
function updatePesertaSheet(sheet, updates) {
  var lastRow = sheet.getLastRow();
  var bibMap = {};

  if (lastRow > 1) {
    var bibData = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var r = 0; r < bibData.length; r++) {
      var rowBib = String(bibData[r][0]).trim();
      if (rowBib) {
        bibMap[rowBib] = r + 2;
      }
    }
  }

  var timeZone = Session.getScriptTimeZone() || 'Asia/Jakarta';
  var sheetLogs = sheet.getParent().getSheetByName('Timing_Logs');
  var startLogsMap = getStartLogsMap(sheetLogs);

  for (var bib in updates) {
    var u = updates[bib];
    var formattedStart = '';
    var parsedNew = parseStartTimestamp(u.startTimestamp);
    if (parsedNew) {
      formattedStart = Utilities.formatDate(new Date(parsedNew), timeZone, 'yyyy-MM-dd HH:mm:ss');
    }

    var rowValues = [
      u.bib,
      u.name,
      u.category,
      u.team || '',
      u.status,
      u.lastStation,
      u.lastSplit,
      u.totalTime,
      u.pace,
      u.speed,
      formattedStart,
      u.updatedAt
    ];

    if (bibMap[bib]) {
      var rowIdx = bibMap[bib];
      // Pertahankan nilai yang sudah ada di sheet jika update baru tidak membawanya
      if (!u.team) {
        var oldTeam = sheet.getRange(rowIdx, 5).getValue();
        if (oldTeam) {
          rowValues[3] = oldTeam;
        }
      }
      if (!u.name) {
        var oldName = sheet.getRange(rowIdx, 3).getValue();
        if (oldName) {
          rowValues[1] = oldName;
        }
      }
      if (!u.category) {
        var oldCat = sheet.getRange(rowIdx, 4).getValue();
        if (oldCat) {
          rowValues[2] = oldCat;
        }
      }
      if (!formattedStart) {
        var oldStartTs = sheet.getRange(rowIdx, 12).getValue();
        var parsedOld = parseStartTimestamp(oldStartTs);
        if (parsedOld) {
          rowValues[10] = Utilities.formatDate(new Date(parsedOld), timeZone, 'yyyy-MM-dd HH:mm:ss');
        } else if (startLogsMap && startLogsMap[bib]) {
          rowValues[10] = Utilities.formatDate(new Date(startLogsMap[bib]), timeZone, 'yyyy-MM-dd HH:mm:ss');
        }
      }
      sheet.getRange(rowIdx, 2, 1, 12).setValues([rowValues]);
    } else {
      var newNo = sheet.getLastRow();
      sheet.appendRow([newNo].concat(rowValues));
      bibMap[bib] = sheet.getLastRow();
    }
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat('0');
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setNumberFormat('@');
    sheet.getRange(2, 12, sheet.getLastRow() - 1, 1).setNumberFormat('@');
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
