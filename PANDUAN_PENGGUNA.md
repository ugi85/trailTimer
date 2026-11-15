# 📖 Panduan Penggunaan TrailTimer

Panduan ringkas operasional sistem pencatatan waktu **TrailTimer** untuk **Admin (Race Director / Basecamp)** dan **Panitia / Marshal di Pos Checkpoint**.

---

## 👑 Bagian 1: Panduan untuk ADMIN (Basecamp & Race Director)

Admin bertanggung jawab atas setup data peserta, pengaturan rute pos, pelepasan start, dan rekapitulasi hasil akhir lomba.

### 1. Persiapan Sebelum Lomba (Tab Peserta & Tab Sync)
1. **Hubungkan Database Google Sheets**:
   - Buka tab **Sync**.
   - Masukkan URL Web App Google Apps Script ke kolom **URL Google Apps Script**, lalu klik **Simpan Pengaturan**.
2. **Setup Data Peserta (Pilih salah satu cara)**:
   - **Opsi A (Rekomendasi via Excel)**: Klik tombol **Download Template Excel** di tab **Peserta**, isi data pelari (BIB, Nama, Kategori, Tim), lalu salin ke Google Sheets sheet `Peserta` atau klik **Import CSV / Teks**.
   - **Opsi B (Langsung di Google Sheets)**: Ketik data peserta di sheet `Peserta`.
   - **Opsi C (Tambah Manual di Web)**: Isi form **Tambah Peserta Manual** di tab Peserta.
3. **Tarik Data Peserta ke Sistem**:
   - Klik tombol hijau **"Tarik dari Google Sheets"**.
   - Pastikan seluruh kartu pelari sudah muncul di tab **Timer**.
4. **Atur Pos Checkpoint & Jarak**:
   - Di tab **Peserta**, gulir ke bagian **Pengaturan Checkpoint & Rute Lari**.
   - Sesuaikan nama pos dan jarak segmen (KM). Jarak ini menentukan perhitungan otomatis Pace (min/km) dan Kecepatan (km/jam).
   - Klik **Simpan Pengaturan Rute**.

---

### 2. Saat Perlombaan Dimulai (Tab Timer)
1. **Start Massal (Semua Pelari / Per Kategori / Per Grup)**:
   - Klik tombol oranye **Start Massal** di bagian atas tab Timer.
   - Pilih kategori atau grup yang akan dilepas (atau pilih *Semua Pelari*).
   - Klik **Mulai Sekarang (START)** tepat saat peluit/sirine start dibunyikan.
   - Seluruh timer pelari terpilih akan mulai berdetik serempak pada detik yang sama.
2. **Start Individu (Wave / Time Trial)**:
   - Cari kartu pelari atau ketik nomor BIB di bar pencarian atas.
   - Klik tombol hijau **`▶ MULAI / START`** pada kartu pelari tersebut.

---

### 3. Pemantauan & Rekap Hasil Akhir
1. **Pantau Status Pelari**:
   - Gunakan filter status di atas kartu: **Semua**, **Sedang Berlari**, **Telah Finish**, atau **Belum Start / DNF**.
2. **Lihat Peringkat & Juara (Tab Klasemen)**:
   - Buka tab **Klasemen** untuk melihat urutan juara otomatis berdasarkan total waktu tercepat.
   - Filter per kategori lomba jika diperlukan.
3. **Unduh Rekap**:
   - Di tab Klasemen, klik tombol **Export CSV** untuk mengunduh rekap hasil resmi dalam format spreadsheet Excel/CSV.

---

## 🚩 Bagian 2: Panduan untuk PANITIA DI CHECKPOINT (Marshal Pos Jalur)

Panitia pos bertugas mencatat kedatangan pelari di titik checkpoint (pos bayangan, puncak, dll.) di area gunung tanpa koneksi internet.

### 1. Sebelum Naik ke Pos (Saat Masih di Basecamp / Ada Sinyal)
> ⚠️ **SANGAT PENTING**: Jangan naik ke pos sebelum langkah ini selesai!

1. **Buka Aplikasi di HP**:
   - Buka URL TrailTimer di browser Chrome (Android) atau Safari (iPhone).
   - *Tips Praktis*: Pasang aplikasi ke layar utama HP (klik titik tiga ⋮ di Chrome > **Tambahkan ke Layar Utama** / *Install App*).
2. **Tarik Data Peserta Terbaru**:
   - Buka tab **Peserta**, klik tombol hijau **"Tarik dari Google Sheets"** sampai muncul notifikasi sukses.
   - Seluruh data peserta dan waktu start resmi kini **sudah tersimpan offline di memori HP Anda**.
3. **Pilih Pos Tugas Anda**:
   - Kembali ke tab **Timer**.
   - Di bar atas, pada dropdown **Pos Anda**, pilih pos tugas Anda (misal: *CP 1 Pos Bayangan* atau *CP 2 Puncak*).

---

### 2. Saat Bertugas di Pos (Kondisi Tanpa Sinyal / OFFLINE)
Aplikasi tetap berjalan normal 100% meskipun HP beralih ke indikator 🔴 **Offline**.

1. **Mencatat Pelari Tunggal**:
   - Ketik nomor BIB pelari di kotak atas (misal: `102`), lalu tekan **Enter** atau klik tombol hijau **PUNCH CP**.
   - *Atau*: Cari nama/nomor pelari di daftar kartu, lalu klik tombol biru **`[✓ PUNCH CP]`**.
2. **Mencatat Rombongan Pelari (Tiba Bersamaan)**:
   - Ketik nomor-nomor BIB dipisah koma pada kotak atas: `101, 102, 105` lalu klik **PUNCH CP**.
   - Atau ketik nama grup: `Grup 1` lalu klik **PUNCH CP**.
3. **Jika Salah Pencet / Salah Nomor (Koreksi Instan)**:
   - Klik tombol **`[↶ Undo]`** di bawah tombol kartu pelari untuk membatalkan aksi terakhir dan mengembalikan status sebelumnya.
4. **Jika Ada Pelari Mengundurkan Diri (Evakuasi / DNF)**:
   - Klik tombol merah **`[DNF]`** pada kartu pelari tersebut.
5. **Indikator Antrean**:
   - Setiap kali Anda mencatat pelari, angka antrean di kanan atas akan bertambah (misal: **`15 Antrean`**). Ini menandakan data tersimpan aman di HP dan siap disinkronkan saat ada sinyal.

---

### 3. Setelah Sinyal Kembali Tersedia (Turun Pos / Sinyal Muncul)
1. **Auto-Sync Otomatis**:
   - Begitu HP menangkap sinyal internet (WiFi atau 4G), aplikasi akan otomatis mengirim antrean data ke Google Sheets pusat.
2. **Manual Sync (Memastikan Data Tuntas)**:
   - Buka tab **Sync**, lalu klik tombol hijau **"Sync Sekarang"**.
   - Pastikan indikator berubah menjadi 🟢 **Online** dan badge menjadi **`Tersinkron`** (0 antrean).
   - Seluruh panitia di basecamp sekarang sudah melihat catatan waktu yang Anda ambil di pos!

---

## 💡 Tips & Trik Penting di Lapangan
* 🔋 **Hemat Baterai**: TrailTimer bekerja menghitung waktu berdasarkan selisih jam (`Date.now() - Start`), sehingga layar HP boleh dimatikan/dikunci saat menunggu pelari berikutnya.
* 💾 **Backup Darurat**: Jika kuota internet habis saat turun gunung, panitia pos bisa membuka tab **Sync** > klik **Export JSON Backup** untuk mengirim file catatan waktu via Bluetooth/WhatsApp ke panitia pusat.
