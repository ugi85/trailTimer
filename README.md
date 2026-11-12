# TrailTimer 🏃⛰️
### Aplikasi Web Progressive Web App (PWA) Offline-First untuk Pencatatan Waktu Lomba Lari & Trail Running Gunung

**TrailTimer** adalah aplikasi pencatatan waktu lomba lari lintas alam (mountain / trail running) yang dirancang khusus untuk kondisi ekstrem minim sinyal di area pegunungan. Seluruh data start, pos pemeriksaan (checkpoint), split time, pace, dan finish disimpan secara andal di database lokal browser (**IndexedDB**) dan tetap dapat diakses 100% tanpa sambungan internet melalui **Service Worker**.

---

## 🌟 Fitur Utama

1. **Offline-First & Auto-Sync (Siap Jalur Gunung)**:
   - Menggunakan **IndexedDB** untuk menyimpan data peserta, konfigurasi pos, dan antrean log waktu (*timing logs*).
   - Indikator status jaringan real-time (🟢 **Online** / 🔴 **Offline**) dan penghitung antrean (*queue badge*, misal: "12 Antrean").
   - **Auto-Sync Otomatis**: Saat HP mendeteksi koneksi internet kembali (`online` event), seluruh data *pending* langsung dikirim ke backend Google Apps Script / REST API.
   - Tombol manual **"Sync Sekarang"** dan fitur darurat **"Export CSV / Full JSON Backup"** untuk backup fisik langsung di HP panitia.

2. **Layar Utama Pencatatan Waktu (Race Timer Dashboard)**:
   - **Live Running Timer** akurat berbasis selisih waktu mutlak (`Date.now() - startTimestamp`) sehingga tidak terpengaruh saat layar HP mati/sleep.
   - **Tombol Aksi Dinamis**:
     - `[MULAI / START]`: Pencatatan start individu.
     - `[Start Massal]`: Menyamakan start seluruh peserta / kategori tertentu pada detik yang sama.
     - `[PUNCH CP]`: Mencatat waktu tiba di pos checkpoint tanpa menghentikan timer utama. Otomatis menghitung *split time*, *pace* (menit/km), dan kecepatan (km/jam) dari titik sebelumnya.
     - `[FINISH / STOP]`: Mengunci waktu total tempuh pelari dan kecepatan rata-rata.
     - `[DNF]`: Mencatat pelari yang mengundurkan diri (Did Not Finish).
   - **Pencatat Cepat Pos (BIB Puncher Bar)**:
     - Marshal cukup mengetik nomor BIB di bar atas lalu menekan tombol aksi atau `Enter`. Sangat cepat saat rombongan pelari tiba bersamaan.
   - **Undo / Koreksi Waktu**:
     - Tombol Undo untuk membatalkan klik tidak sengaja dan memulihkan status serta checkpoint sebelumnya.

3. **Manajemen Peserta & Rute (Setup)**:
   - Form penambahan peserta manual (Nomor Dada / BIB, Nama Lengkap, Kategori, Tim).
   - **Import Cepat CSV / Paste Teks**: Mendukung format `BIB, Nama, Kategori, Tim` dengan deteksi duplikat otomatis.
   - **Rute & Checkpoint Builder**: Pengaturan nama pos (Start, CP 1, CP 2, ..., Finish) dan jarak segmen (KM) dengan kalkulasi kumulatif otomatis.

4. **Klasemen & Rekap Hasil (Leaderboard)**:
   - Tabel peringkat otomatis terurut berdasarkan waktu tercepat pelari yang sudah Finish.
   - Medali emas, perak, dan perunggu untuk Juara 1, 2, dan 3.
   - Filter per kategori lomba dan fitur unduh **Export CSV Klasemen**.

5. **Integrasi Google Sheets Backend**:
   - Disertakan file Google Apps Script (`google-apps-script/Code.gs`) yang siap pakai untuk mengalirkan data lomba secara live ke Google Sheets.

---

## 📁 Struktur Berkas

```text
runTimer/
├── index.html                  # Halaman utama aplikasi (Mobile-first PWA)
├── manifest.json               # Konfigurasi PWA (Web App Manifest)
├── sw.js                       # Service Worker untuk caching aset offline
├── css/
│   └── style.css               # Desain modern, kontras tinggi untuk kondisi outdoor
├── js/
│   ├── db.js                   # Modul database lokal IndexedDB
│   ├── timer.js                # Mesin kalkulasi waktu, split, pace & speed
│   ├── sync.js                 # Mesin sinkronisasi offline-first & export backup
│   └── app.js                  # Controller utama aplikasi, navigasi & UI state
├── icons/
│   ├── icon-192.png            # Ikon PWA 192x192
│   ├── icon-512.png            # Ikon PWA 512x512
│   ├── icon.svg                # Ikon vektor aplikasi
│   └── favicon.svg             # Favicon tab browser
├── google-apps-script/
│   ├── Code.gs                 # Kode backend Apps Script untuk Google Sheets
│   └── README.md               # Panduan lengkap setup Google Sheets dalam 3 menit
└── README.md                   # Dokumentasi proyek
```

---

## 🚀 Cara Menjalankan Aplikasi Secara Lokal

Aplikasi ini menggunakan teknologi murni (Vanilla HTML5, CSS3, JavaScript) tanpa build-step:

### Opsi 1: Menjalankan dengan Python
Buka terminal di folder `runTimer`, lalu jalankan:
```bash
python -m http.server 8080
```
Buka browser di laptop atau HP Anda pada alamat:
`http://localhost:8080` (atau `http://<IP-Laptop-Anda>:8080` jika diakses via Wi-Fi lokal dari HP).

### Opsi 2: Menjalankan dengan Node.js (npx)
```bash
npx serve -l 8080
```

### Opsi 3: Install sebagai Aplikasi HP (PWA)
1. Buka URL aplikasi di Google Chrome (Android) atau Safari (iOS).
2. Di Chrome: Klik menu titik tiga (⋮) > **"Tambahkan ke Layar Utama"** atau **"Install TrailTimer"**.
3. Di iOS Safari: Klik tombol Share (ikon kotak panah ke atas) > **"Add to Home Screen"**.
4. Ikon TrailTimer akan muncul di layar beranda HP Anda dan dapat dibuka tanpa koneksi internet sama sekali.

---

## 📊 Menghubungkan ke Google Sheets

Lihat petunjuk lengkap langkah demi langkah di folder [`google-apps-script/README.md`](./google-apps-script/README.md).
Cukup salin [`google-apps-script/Code.gs`](./google-apps-script/Code.gs) ke Google Spreadsheet Anda, lakukan *Deploy as Web App* dengan akses *Anyone*, lalu tempelkan URL Web App tersebut ke menu **Pengaturan & Sync** di TrailTimer.

