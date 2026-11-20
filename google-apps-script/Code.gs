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
 * Smart Parser untuk Total Waktu Tempuh & Durasi Split:
 * Mengubah string "5:45:17", "02:03:08", "00:14:08", Date object, atau time fraction menjadi Milidetik (ms)
 */
function parseDurationToMs(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (val > 100000000000) return null; // Epoch timestamp, bukan durasi
    if (val > 1000) return Math.round(val);
    return Math.round(val * 86400 * 1000); // Format serial hari Sheets/Excel
  }
  if (val instanceof Date) {
    var h = val.getHours();
    var m = val.getMinutes();
    var s = val.getSeconds();
    var ms = val.getMilliseconds();
    return (h * 3600 + m * 60 + s) * 1000 + ms;
  }
  var str = String(val).trim();
  if (!str || str === '-' || str === '--:--:--') return null;

  var parts = str.split(':');
  if (parts.length === 3) {
    var hrs = parseFloat(parts[0]) || 0;
    var mins = parseFloat(parts[1]) || 0;
    var secs = parseFloat(parts[2]) || 0;
    return Math.round((hrs * 3600 + mins * 60 + secs) * 1000);
  } else if (parts.length === 2) {
    var mins = parseFloat(parts[0]) || 0;
    var secs = parseFloat(parts[1]) || 0;
    return Math.round((mins * 60 + secs) * 1000);
  }
  return null;
}

/**
 * Membersihkan tampilan durasi split / waktu agar bebas dari teks tanggal (1899) dan embel-embel GMT / Timezone
 */
function cleanDurationGAS(val) {
  if (val === null || val === undefined) return '-';
  var ms = parseDurationToMs(val);
  if (ms !== null && ms !== undefined) {
    return formatElapsedGAS(ms);
  }
  var s = String(val).trim();
  if (!s || s === '-') return '-';
  var match = s.match(/(\d{1,2}:\d{2}:\d{2})/);
  if (match) return match[1];
  var shortMatch = s.match(/(\d{1,2}:\d{2})/);
  if (shortMatch) return shortMatch[1];
  return s.replace(/GMT.*$/i, '').trim();
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

/**
 * Ekstraksi lengkap riwayat log (Start, CP splits, dan Finish) dari sheet Timing_Logs
 */
function getTimingLogsDetailsMap(sheetLogs, routeConfig) {
  var result = {
    startLogsMap: {},
    splitsMap: {},
    finishMap: {}
  };
  if (!sheetLogs || sheetLogs.getLastRow() <= 1) return result;

  var numRows = sheetLogs.getLastRow() - 1;
  var numCols = Math.min(15, sheetLogs.getLastColumn());
  var data = sheetLogs.getRange(2, 1, numRows, numCols).getValues();
  var cps = (routeConfig && Array.isArray(routeConfig.checkpoints)) ? routeConfig.checkpoints : [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var bib = String(row[5] || '').trim();
    if (!bib) continue;

    var action = String(row[8] || '').trim().toUpperCase();
    var cpName = String(row[9] || '').trim();
    var rawDeviceTs = row[2];
    var rawServerTs = row[1];
    var ts = parseStartTimestamp(rawDeviceTs) || parseStartTimestamp(rawServerTs) || Date.now();

    var splitMs = parseDurationToMs(row[10]);
    var splitFormatted = cleanDurationGAS(row[10]);
    var elapsedMs = parseDurationToMs(row[11]);
    var paceFormatted = String(row[12] || '').trim();
    var speedFormatted = String(row[13] || '').trim();

    if (action === 'START' || action === 'MASS_START') {
      if (!result.startLogsMap[bib]) {
        result.startLogsMap[bib] = ts;
      }
    } else if (action === 'CP' || action === 'SPLIT') {
      if (!result.splitsMap[bib]) result.splitsMap[bib] = [];

      var cpIdx = -1;
      if (cps.length > 0) {
        for (var c = 0; c < cps.length; c++) {
          if (cps[c].name.toLowerCase() === cpName.toLowerCase()) {
            cpIdx = c;
            break;
          }
        }
      }
      if (cpIdx === -1) {
        var numMatch = cpName.match(/\d+/);
        cpIdx = numMatch ? parseInt(numMatch[0], 10) : (result.splitsMap[bib].length + 1);
      }

      var splitItem = {
        cpIndex: cpIdx,
        cpName: cpName || ('CP ' + cpIdx),
        timestamp: ts,
        splitMs: splitMs || 0,
        splitFormatted: splitFormatted,
        cumulativeMs: elapsedMs || 0,
        paceFormatted: paceFormatted,
        speedFormatted: speedFormatted
      };

      var existingIdx = -1;
      for (var s = 0; s < result.splitsMap[bib].length; s++) {
        if (result.splitsMap[bib][s].cpIndex === cpIdx || result.splitsMap[bib][s].cpName.toLowerCase() === cpName.toLowerCase()) {
          existingIdx = s;
          break;
        }
      }
      if (existingIdx >= 0) {
        result.splitsMap[bib][existingIdx] = splitItem;
      } else {
        result.splitsMap[bib].push(splitItem);
      }

    } else if (action === 'FINISH' || action === 'MASS_FINISH') {
      result.finishMap[bib] = {
        finishTime: ts,
        totalMs: elapsedMs,
        pace: paceFormatted,
        speed: speedFormatted,
        lastStation: cpName || 'Finish'
      };

      if (!result.splitsMap[bib]) result.splitsMap[bib] = [];
      var finishCpIdx = cps.length > 0 ? (cps.length - 1) : 999;
      var finishSplitItem = {
        cpIndex: finishCpIdx,
        cpName: cpName || 'Finish',
        timestamp: ts,
        splitMs: splitMs || elapsedMs || 0,
        splitFormatted: (splitFormatted && splitFormatted !== '-') ? splitFormatted : formatElapsedGAS(elapsedMs || splitMs),
        cumulativeMs: elapsedMs || 0,
        paceFormatted: paceFormatted,
        speedFormatted: speedFormatted
      };

      var existingFinishIdx = -1;
      for (var f = 0; f < result.splitsMap[bib].length; f++) {
        if (result.splitsMap[bib][f].cpIndex === finishCpIdx || result.splitsMap[bib][f].cpName.toLowerCase() === (cpName || 'finish').toLowerCase()) {
          existingFinishIdx = f;
          break;
        }
      }
      if (existingFinishIdx >= 0) {
        result.splitsMap[bib][existingFinishIdx] = finishSplitItem;
      } else {
        result.splitsMap[bib].push(finishSplitItem);
      }
    } else if (action === 'UNDO') {
      if (result.finishMap[bib]) {
        delete result.finishMap[bib];
      }
      if (result.splitsMap[bib] && result.splitsMap[bib].length > 0) {
        result.splitsMap[bib].pop();
      }
    }
  }

  // Urutkan splits berdasarkan cpIndex
  for (var b in result.splitsMap) {
    result.splitsMap[b].sort(function(a, b) {
      return a.cpIndex - b.cpIndex;
    });
  }

  return result;
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
    var routeConfig = getRouteConfigFromSheet(ss);

    if (!sheetPeserta) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        participants: [],
        route_config: routeConfig
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var lastRow = sheetPeserta.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        participants: [],
        route_config: routeConfig
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Ambil detail log start, splits, dan finish dari sheet Timing_Logs
    var sheetLogs = ss.getSheetByName('Timing_Logs');
    var logsDetails = getTimingLogsDetailsMap(sheetLogs, routeConfig);
    var startLogsMap = logsDetails.startLogsMap;
    var splitsMap = logsDetails.splitsMap;
    var finishMap = logsDetails.finishMap;

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
      var rawLastCp = '', rawLastSplit = '', rawTotalTime = '', rawPace = '', rawSpeed = '';

      if (isShiftedPaste) {
        bib = String(row[0] !== null && row[0] !== undefined ? row[0] : '').trim();
        name = String(row[1] || '').trim();
        category = String(row[2] || 'Trail').trim();
        team = String(row[3] || '').trim();
        var rawStatusShifted = String(row[4] || '').trim().toLowerCase();
        if (rawStatusShifted === 'finish' || rawStatusShifted === 'finished') status = 'finished';
        else if (rawStatusShifted === 'berlari' || rawStatusShifted === 'running') status = 'running';
        else if (rawStatusShifted === 'dnf') status = 'dnf';

        rawLastCp = row[5];
        rawLastSplit = cleanDurationGAS(row[6]);
        rawTotalTime = row[7];
        rawPace = row[8];
        rawSpeed = row[9];
        officialStartTime = parseStartTimestamp(row[10] || row[9] || row[8]);
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

        rawLastCp = row[6];
        rawLastSplit = cleanDurationGAS(row[7]);
        rawTotalTime = row[8];
        rawPace = row[9];
        rawSpeed = row[10];

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

      // Parse Total Waktu Tempuh, Pace, Speed, dan Pos Terakhir
      var totalMs = parseDurationToMs(rawTotalTime);
      var avgPace = String(rawPace || '').trim();
      var avgSpeed = String(rawSpeed || '').trim();
      var lastCp = String(rawLastCp || '').trim();

      // Sinkronkan dengan log finish jika di sheet Peserta belum lengkap
      if (finishMap[bib]) {
        if ((totalMs === null || totalMs === undefined) && finishMap[bib].totalMs) {
          totalMs = finishMap[bib].totalMs;
        }
        if (!avgPace && finishMap[bib].pace) avgPace = finishMap[bib].pace;
        if (!avgSpeed && finishMap[bib].speed) avgSpeed = finishMap[bib].speed;
        if (!lastCp && finishMap[bib].lastStation) lastCp = finishMap[bib].lastStation;
      }

      // Hitung finishTime secara presisi
      var finishTime = null;
      if (status === 'finished') {
        if (officialStartTime && totalMs) {
          finishTime = officialStartTime + totalMs;
        } else if (finishMap[bib] && finishMap[bib].finishTime) {
          finishTime = finishMap[bib].finishTime;
        } else {
          finishTime = Date.now();
        }
      }

      // Ambil splits pos checkpoint
      var participantSplits = (splitsMap[bib] && splitsMap[bib].length > 0) ? splitsMap[bib] : [];
      if (participantSplits.length === 0 && status === 'finished' && totalMs) {
        var finishCpIdx = (routeConfig && routeConfig.checkpoints) ? (routeConfig.checkpoints.length - 1) : 999;
        var finishCpName = (routeConfig && routeConfig.checkpoints && routeConfig.checkpoints[finishCpIdx]) ? routeConfig.checkpoints[finishCpIdx].name : (lastCp || 'Finish');
        participantSplits = [{
          cpIndex: finishCpIdx,
          cpName: finishCpName,
          timestamp: finishTime,
          splitMs: totalMs,
          splitFormatted: formatElapsedGAS(totalMs),
          cumulativeMs: totalMs,
          paceFormatted: avgPace || '-',
          speedFormatted: avgSpeed || '-'
        }];
      }

      list.push({
        bib: bib,
        name: name || ('Peserta ' + bib),
        category: category || 'Trail',
        team: team || '',
        status: status,
        startTime: officialStartTime,
        splits: participantSplits,
        finishTime: finishTime,
        totalMs: totalMs,
        avgPace: avgPace,
        avgSpeed: avgSpeed,
        lastCp: lastCp || (status === 'finished' ? 'Finish' : (status === 'running' ? 'Start' : '')),
        history: []
      });
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      count: list.length,
      isShiftedPaste: isShiftedPaste,
      participants: list,
      route_config: routeConfig
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    app: 'TrailTimer Google Apps Script Backend',
    version: '1.4',
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
    } else if (action === 'save_route_config' && data.route) {
      saveRouteConfigToSheet(ss, data.route);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        message: 'Konfigurasi rute berhasil disimpan di Google Sheets!',
        route: data.route,
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

// ==========================================
// 8. RUTE & CHECKPOINT SYNC HELPER
// ==========================================
function saveRouteConfigToSheet(ss, routeObj) {
  if (!routeObj || !Array.isArray(routeObj.checkpoints) || routeObj.checkpoints.length === 0) return;
  var sheetRute = ss.getSheetByName('Rute');
  if (!sheetRute) {
    sheetRute = ss.insertSheet('Rute');
  } else {
    sheetRute.clearContents();
  }

  var headers = ['No.', 'ID Pos', 'Nama Checkpoint / Pos', 'Jarak Segmen (KM)', 'Jarak Kumulatif (KM)'];
  var rows = [headers];

  var cps = routeObj.checkpoints;
  for (var i = 0; i < cps.length; i++) {
    var c = cps[i];
    rows.push([
      i + 1,
      c.id || (i === 0 ? 'start' : (i === cps.length - 1 ? 'finish' : ('cp_' + i))),
      c.name || ('Pos ' + i),
      c.distFromPrevKm || 0,
      c.cumulativeKm || 0
    ]);
  }

  sheetRute.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheetRute.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sheetRute.setFrozenRows(1);
  sheetRute.getRange('A:A').setNumberFormat('0');
  sheetRute.getRange('D:E').setNumberFormat('0.00');
}

function getRouteConfigFromSheet(ss) {
  var sheetRute = ss.getSheetByName('Rute');
  if (!sheetRute || sheetRute.getLastRow() < 2) return null;
  var data = sheetRute.getRange(2, 1, sheetRute.getLastRow() - 1, 5).getValues();
  var checkpoints = [];
  var totalDist = 0;
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var id = String(row[1] || '').trim() || ('cp_' + i);
    var name = String(row[2] || '').trim();
    if (!name) continue;
    var dist = parseFloat(row[3]) || 0;
    var cum = parseFloat(row[4]) || 0;
    totalDist = Math.max(totalDist, cum);
    checkpoints.push({
      id: id,
      name: name,
      distFromPrevKm: dist,
      cumulativeKm: cum
    });
  }
  if (checkpoints.length === 0) return null;
  return {
    checkpoints: checkpoints,
    totalDistanceKm: totalDist
  };
}
