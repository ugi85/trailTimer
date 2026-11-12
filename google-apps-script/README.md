# Panduan Setup Google Sheets Backend untuk TrailTimer

TrailTimer dirancang dengan prinsip **Offline-First**. Seluruh pencatatan waktu Start, Checkpoint, dan Finish tersimpan 100% aman di database internal browser (IndexedDB) di HP panitia / marshal pos tanpa butuh sinyal.

Ketika panitia mendapatkan sinyal (baik di puncak bukit, pos tertentu, atau setelah kembali ke basecamp/hotel), aplikasi secara otomatis mengirim seluruh antrean data ke Google Sheets menggunakan Google Apps Script.

---

## Langkah 1: Buat Google Spreadsheet Baru

1. Buka browser dan pergi ke [https://sheets.new](https://sheets.new) (atau buat Google Sheets baru di Google Drive Anda).
2. Beri nama file, misalnya: **"Merbabu Trail Run 2026 - Master Timing"**.

---

## Langkah 2: Pasang Kode Google Apps Script

1. Di Google Sheets, klik menu **Extensions** (Ekstensi) > **Apps Script**.
2. Anda akan diarahkan ke editor Google Apps Script.
3. Hapus seluruh isi kode bawaan (`function myFunction() { ... }`).
4. Buka file [`Code.gs`](./Code.gs) dari folder ini, salin seluruh kodenya, dan tempelkan ke editor Apps Script.
5. Klik ikon **Save (Disket)** atau tekan `Ctrl + S`.

---

## Langkah 3: Deploy sebagai Web App (PENTING!)

1. Di pojok kanan atas editor Apps Script, klik tombol biru **Deploy** > **New deployment** (Penyebaran baru).
2. Di jendela yang muncul, klik ikon roda gerigi di sebelah kiri dan pilih jenis **Web app**.
3. Isi kolom konfigurasi sebagai berikut:
   - **Description**: `TrailTimer Live API`
   - **Execute as** (Jalankan sebagai): **Me (email Anda)**
   - **Who has access** (Siapa yang memiliki akses): **Anyone** *(Wajib pilih "Anyone" agar aplikasi PWA di HP marshal pos dapat mengirim data tanpa perlu login akun Google panitia)*.
4. Klik tombol **Deploy**.
5. Jika muncul jendela permintaan izin (*Authorization required*):
   - Klik **Authorize access**.
   - Pilih akun Google Anda.
   - Jika muncul peringatan *"Google hasn't verified this app"*, klik **Advanced** di kiri bawah > klik **Go to Untitled project (unsafe)**.
   - Klik **Allow**.
6. Google akan memberikan **Web app URL** yang berakhiran `/exec`.
   Contoh URL:
   `https://script.google.com/macros/s/AKfycbxAbC12345xyz.../exec`
7. **Salin (Copy) URL tersebut**.

---

## Langkah 4: Hubungkan ke Aplikasi TrailTimer

1. Buka aplikasi **TrailTimer** di browser HP atau laptop.
2. Masuk ke tab **Pengaturan & Sync**.
3. Di bagian **"Koneksi Backend (Google Apps Script)"**, tempelkan URL yang sudah Anda salin tadi.
4. Masukkan nama pos Anda di kolom **"Nama Pos / Station"** (contoh: `CP 1 Puncak`, `Pos 2 Kandang Badak`, atau `Gate Finish`).
5. Klik **Simpan Pengaturan**.
6. Tekan tombol **"Sync Sekarang"** untuk menguji koneksi.
7. Sheet **`Timing_Logs`** dan **`Peserta`** akan otomatis dibuat di Google Sheets Anda dengan warna dan format yang rapi!

---

## Struktur Data di Google Sheets:

### 1. Sheet `Timing_Logs` (Semua Log Waktu Mentah)
Mencatat setiap kali tombol Start, Checkpoint, atau Finish ditekan oleh panitia di pos manapun:
- **Server Time**: Waktu penerimaan di server.
- **Device Timestamp**: Waktu persis saat tombol ditekan di HP panitia (akurat meskipun baru disinkronkan berjam-jam kemudian).
- **Device ID & Station**: Identitas HP dan nama pos pencatat.
- **BIB & Nama**: Nomor dada dan nama pelari.
- **Aksi & Checkpoint**: START, CP 1, CP 2, FINISH, DNF.
- **Split Time & Elapsed Time**: Waktu per segmen & total waktu berjalan.
- **Pace & Speed**: Pace (menit/km) dan kecepatan (km/jam).

### 2. Sheet `Peserta` (Master Status Terkini)
Menampilkan rangkuman real-time setiap peserta:
- BIB, Nama, Kategori
- Status Terkini (Belum Start / Berlari / Finish / DNF)
- Pos Terakhir yang dilewati
- Total Waktu Tempuh & Rata-rata Kecepatan

---

## Tips Lapangan untuk Lomba Trail Running:
- **Tanpa Sinyal**: Biarkan aplikasi tetap berjalan di HP. Aplikasi tidak akan macet atau kehilangan data.
- **Layar HP Mati**: Timer tetap akurat karena dihitung berbasis jam internal perangkat (`Date.now()`), bukan counter interval biasa.
- **Pencadangan Darurat**: Kapan saja panitia bisa menekan tombol **"Export CSV"** di tab Pengaturan untuk mengunduh salinan berkas fisik langsung ke memori HP.

