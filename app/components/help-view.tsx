"use client";

import {
  BookMarked,
  BookOpenCheck,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Coins,
  Download,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  PackageSearch,
  Percent,
  ReceiptText,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadApiFile } from "../api-client";
import type { AppLanguage } from "../i18n";

interface HelpViewProps {
  language: AppLanguage;
}

// The help centre is intentionally hardcoded copy: it is versioned with the
// features it describes, so a code review catches drift. Each workflow answers
// the same four questions a new staff member asks — who may do it, which
// sidebar menu it lives in, what to prepare, and what gets locked afterwards.
interface WorkflowGuide {
  key: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  who: string;
  where: string;
  prepare: string;
  steps: string[];
  after: string;
}

interface MessageGuide {
  key: string;
  message: string;
  meaning: string;
  action: string;
}

interface GlossaryEntry {
  term: string;
  meaning: string;
}

const workflowsId: WorkflowGuide[] = [
  {
    key: "start",
    icon: BookOpenCheck,
    title: "Memulai: masuk dan menemukan menu",
    summary: "Cara masuk, memilih proyek dan paket, serta mengetahui menu mana untuk pekerjaan apa.",
    who: "Semua peran: Admin, Project Manager, Engineer, dan Finance.",
    where: "Sidebar kiri, lalu Dashboard.",
    prepare: "Email dan kata sandi awal dari Admin.",
    steps: [
      "Masuk dengan email dan kata sandi Anda. Centang Ingat Saya hanya pada perangkat pribadi; tanpa itu Anda otomatis keluar setelah 8 jam.",
      "Bila kata sandi salah berkali-kali, aplikasi menahan percobaan berikutnya selama beberapa menit dan jedanya memanjang bila kegagalan berlanjut. Ini berlaku juga untuk permintaan pemulihan kata sandi. Tunggu sampai jedanya habis lalu coba lagi; tidak ada akun yang terkunci permanen.",
      "Pilih proyek pada pemilih proyek di bagian atas. Selama satu proyek dipilih, semua menu operasional hanya menampilkan data proyek tersebut. Pilih Semua proyek untuk melihat ringkasan seluruh pekerjaan di Dashboard.",
      "Di bagian paling atas Dashboard ada Peta proyek. Warna titiknya mengikuti status: abu-abu untuk Deal-an, tosca untuk On progress, hijau untuk Selesai. Klik satu titik untuk langsung membuka proyeknya. Peta hanya memuat proyek yang boleh Anda akses, sama persis seperti daftar proyek di bawahnya.",
      "Titik peta ditebak otomatis dari kolom Lokasi setiap kali proyek disimpan. Bila lokasinya tidak dikenali, proyek tetap tersimpan dan dihitung pada baris \"proyek belum punya titik\" di bawah peta — tidak ada data yang hilang. Tekan Atur titik peta, pilih proyeknya, lalu klik posisinya di peta. Titik yang Anda taruh sendiri bersifat tetap dan tidak akan pernah ditimpa oleh tebakan otomatis berikutnya.",
      "Tepat di bawah peta ada tiga kartu status: Deal-an, On progress, dan Selesai. Angka besarnya adalah jumlah proyek pada status tersebut, dan baris kecil di bawahnya menyebut berapa yang sudah lewat rencana mulai atau lewat tanggal target. Bila tanggalnya memang belum diisi, baris itu mengatakan demikian dan bukan mengaku semuanya aman. Kartu Selesai hanya memuat jumlah, karena aplikasi tidak menyimpan tanggal sebuah proyek benar-benar rampung sehingga tidak ada yang jujur dapat dikatakan tentang waktunya.",
      "Angka uang — Nilai proyek berjalan dan Piutang diterima — berada di bagian paling bawah Dashboard, di bawah daftar Proyek terbaru; gulir ke bawah untuk membacanya. Nilai proyek berjalan menjumlahkan kontrak berstatus On progress saja, sedangkan Piutang diterima mengikuti porsi setiap proyek yang sudah tertutup pembayaran terkonfirmasi. Keduanya mengikuti pemilih proyek yang sama seperti seluruh isi Dashboard.",
      "Bila proyek dijual dalam beberapa lingkup, pilih juga Paket komersial di bagian atas BoQ Generator, Quotation & Invoice, Validasi Perangkat, dan BAST Digital. Setiap paket punya BoQ, penawaran, invoice, dan BAST sendiri.",
      "Paket baru langsung berstatus Aktif, dan hanya paket Aktif yang menerima dokumen baru: BoQ, penawaran, invoice, validasi, BAST, dan Addendum. Tombol status di sebelah pemilih paket mengubahnya. Bila pekerjaan paket sudah tuntas, ubah menjadi Selesai; bila paket batal dijual, ubah menjadi Batal. Paket Selesai masih bisa diaktifkan kembali bila ada pekerjaan susulan, sedangkan Batal bersifat final.",
      "Menu sidebar dibagi tiga: Utama berisi Dashboard, Manajemen Proyek, BoQ Generator, dan Quotation & Invoice; Operasional berisi Belanja Proyek, Procurement & Vendor, Validasi Perangkat, BAST Digital, dan Pembukuan; Administrasi berisi Database Item serta Pengguna & Akses.",
    ],
    after: "Pilihan proyek dan paket diingat aplikasi, jadi Anda tidak perlu memilih ulang setiap berpindah menu. Dokumen pada paket Selesai maupun Batal tetap dapat dibaca, diunduh, dan dicetak seperti biasa; yang ditolak hanyalah dokumen baru. Paket yang sudah memiliki dokumen tidak dapat dihapus — mengubah statusnya menjadi Batal adalah cara mempensiunkannya. Menghapus proyek juga hanya mungkin selama proyek itu belum menyentuh uang sama sekali: begitu ada pembayaran, penyelesaian belanja, setoran pajak, atau transaksi Pembukuan, proyek tidak dapat dihapus dan harus ditutup atau diarsipkan dengan status Selesai.",
  },
  {
    key: "quotation",
    icon: FileSpreadsheet,
    title: "Menyiapkan penawaran untuk klien",
    summary: "Dari membuat proyek sampai penawaran disetujui klien dan nilainya dikunci.",
    who: "Project Manager atau Admin menyusun BoQ. Hanya Admin dan Finance yang boleh mengubah tanggal, diskon, pembulatan, dan pajak.",
    where: "Manajemen Proyek, lalu BoQ Generator, lalu Quotation & Invoice.",
    prepare: "Data klien dan lokasi, daftar kebutuhan pekerjaan, dan pada langkah terakhir bukti persetujuan klien berupa PDF atau foto.",
    steps: [
      "Buat proyek di Manajemen Proyek: isi nama pekerjaan, klien, lokasi, tanggal, dan penanggung jawab.",
      "Buka BoQ Generator dan tambahkan item pekerjaan dari Database Item. Pilih Harga 1 atau Harga 2; harga jual dihitung otomatis dari harga pokok dan margin kategori.",
      "Buka Quotation & Invoice. Nilai penawaran terisi otomatis dari BoQ paket yang sedang dipilih.",
      "Admin atau Finance menekan Edit untuk mengatur tanggal terbit, masa berlaku, diskon, dan pembulatan. Urutan hitungannya: subtotal − diskon + pajak Tambah ± pembulatan = Total tagihan klien.",
      "Bila memakai pajak, tekan Pajak, nyalakan Gunakan pajak, lalu pilih aturannya. Pajak Tambah seperti PPN menambah tagihan klien. Pajak Potong seperti PPh tidak menambah tagihan: klien memotongnya saat membayar sehingga Kas bersih yang masuk ke rekening lebih kecil.",
      "Tekan Unduh PDF, kirim penawaran ke klien, lalu tekan Tandai sudah dikirim.",
      "Setelah klien setuju, tekan Terima klien, isi tanggal persetujuan, unggah buktinya, lalu tekan Terima & kunci.",
    ],
    after: "Penawaran berstatus Diterima. Item BoQ, diskon, pajak, dan pembulatan terkunci permanen. Sejak saat itu Anda dapat membuat invoice termin dan dokumen SPK/PO. Perubahan pekerjaan sesudahnya harus lewat Addendum. Status Batal, Ditolak, dan Digantikan bersifat akhir: penawaran seperti itu tidak dapat dikembalikan menjadi Draft atau Terkirim — buat penawaran baru. Membatalkan penawaran juga ditolak selama masih ada SPK/PO aktif, invoice yang masih terbit, atau invoice yang sudah menerima pembayaran.",
  },
  {
    key: "installment",
    icon: ReceiptText,
    title: "Menagih klien per termin",
    summary: "Membagi nilai kontrak menjadi beberapa tagihan, misalnya DP lalu pelunasan.",
    who: "Admin, Project Manager, atau Finance dengan akses Kelola pada Quotation & Invoice.",
    where: "Quotation & Invoice, tab Invoice.",
    prepare: "Penawaran yang sudah diterima klien dan kesepakatan pembagian termin.",
    steps: [
      "Buka tab Invoice lalu tekan Invoice baru. Tombol ini baru aktif setelah penawaran diterima klien.",
      "Pilih jenis tagihan (DP 30%, DP 50%, Termin 2, atau Pelunasan), lalu isi tanggal terbit dan jatuh tempo.",
      "Isi Persentase termin. Boleh sampai dua angka di belakang koma, dan nilai rupiahnya langsung muncul dari Total tagihan klien.",
      "Tekan Terbitkan invoice, lalu unduh PDF-nya dan kirim ke klien.",
      "Ulangi untuk termin berikutnya. Jumlah seluruh termin tidak boleh melebihi 100%; invoice terakhir otomatis menyerap sisa pembulatan.",
    ],
    after: "Setiap invoice punya nomor sendiri dan mewarisi pajak yang terkunci pada penawaran. Selama belum ada pembayaran aktif, invoice masih dapat diedit atau dihapus; bila pembayarannya sudah di-void, invoice terbuka kembali.",
  },
  {
    key: "invoice-payment",
    icon: WalletCards,
    title: "Mencatat uang masuk dari klien",
    summary: "Mengonfirmasi pembayaran invoice, termasuk pembayaran sebagian dan pajak yang dipotong klien.",
    who: "Admin atau Finance dengan akses Kelola pada Quotation & Invoice dan Pembukuan. Pembatalan pembayaran hanya oleh Admin.",
    where: "Quotation & Invoice, tab Invoice, tombol Konfirmasi.",
    prepare: "Bukti transfer berupa PDF atau gambar, nomor referensi, rekening perusahaan penerima, dan bukti potong bila klien memotong pajak.",
    steps: [
      "Tekan Konfirmasi pada baris invoice yang dibayar.",
      "Isi Nilai bruto diselesaikan, Pajak dipotong klien, dan Kas aktual diterima. Nilai bruto harus persis sama dengan kas ditambah pajak potong.",
      "Isi Tanggal dana diterima sesuai tanggal pada mutasi rekening, bukan tanggal Anda mencatat.",
      "Isi referensi pembayaran, pilih metode dan rekening perusahaan, lalu unggah bukti pembayaran.",
      "Tekan Posting pembayaran.",
    ],
    after: "Hanya kas nyata yang masuk ke Buku Kas. Pajak yang dipotong klien dicatat sebagai posisi pajak, bukan kas. Pembayaran boleh bertahap; status invoice berubah menjadi Dibayar Sebagian lalu Lunas.",
  },
  {
    key: "addendum",
    icon: ScrollText,
    title: "Menambah pekerjaan di tengah proyek",
    summary: "Menangani pekerjaan tambahan tanpa mengubah penawaran yang sudah disetujui klien.",
    who: "Project Manager atau Admin membuat Addendum; Admin dan Finance mengunci nilainya.",
    where: "Procurement & Vendor, tab Quotation & Addendum.",
    prepare: "Daftar pekerjaan tambahan dan bukti persetujuan klien atas tambahan tersebut.",
    steps: [
      "Buka tab Quotation & Addendum, lalu buat Addendum baru. Aplikasi langsung menyiapkan penawaran Draft untuk addendum itu.",
      "Isi item pekerjaan tambahan pada addendum tersebut.",
      "Kirim penawaran addendum ke klien, lalu tandai sudah dikirim.",
      "Setelah klien setuju, tekan Terima, isi tanggal, dan unggah bukti persetujuan.",
    ],
    after: "Nilai proyek bertambah dan SPK/PO baru dapat mengambil item dari addendum ini. Addendum melekat pada paket komersial tempat ia dibuat, sehingga ikut terhitung pada ringkasan paket itu. Pekerjaan yang sudah diterima sebelumnya tetap terkunci dan angkanya tidak berubah.",
  },
  {
    key: "procurement",
    icon: PackageSearch,
    title: "Membayar vendor lewat SPK atau PO",
    summary: "Dari membuat komitmen vendor sampai pembayaran termin, termasuk bukti progres dan penerimaan barang.",
    who: "Project Manager atau Engineer membuat dan mengajukan. Admin atau Finance menyetujui. Verifikasi progres dan penerimaan barang oleh Admin, Project Manager, atau Engineer anggota proyek — izin Procurement & Vendor cukup Lihat. Pembatalan pembayaran hanya oleh Admin.",
    where: "Procurement & Vendor.",
    prepare: "Penawaran yang sudah diterima klien beserta buktinya, data vendor, harga negosiasi, dan saat membayar: tagihan vendor, nomor referensi, serta bukti transfer.",
    steps: [
      "Kerjakan seluruh siklusnya di layar Procurement & Vendor: buat, ajukan, setujui, kirim, verifikasi, bayar, lalu tutup. Tidak ada jalur lain — dari layar mana pun yang lain, SPK dan PO hanya dapat dibaca dan diunduh PDF-nya.",
      "Pilih jenis dokumen. SPK untuk pekerjaan Jasa atau Mobilitas, PO untuk Perangkat atau Material. Tipe vendor harus cocok dengan jenis dokumennya.",
      "Pilih item dari penawaran yang sudah diterima klien, lalu isi kuantitas dan harga vendor. Total alokasi tidak boleh melebihi kuantitas pada BoQ.",
      "Atur termin. Isi DP dalam persen bila ada, sisanya menjadi Pelunasan. Jumlah seluruh termin harus persis sama dengan nilai kontrak vendor.",
      "Ajukan dokumen, lalu Admin atau Finance menyetujuinya. Finance tidak boleh menyetujui pengajuannya sendiri, dan Admin yang menyetujui pengajuan sendiri wajib menulis alasan.",
      "Persetujuan belum berarti boleh dibayar. Persetujuan adalah keputusan internal; Kirim adalah saat dokumen benar-benar berlaku bagi vendor, dan karena itu pembayaran maupun penyelesaian baru terbuka setelah dokumen dikirim. Selama status dokumen masih Disetujui, tombol Bayar dan Selesaikan memang tidak muncul, dan aplikasi menolak keduanya bila tetap dicoba. Tekan Kirim lebih dulu.",
      "Kirim dokumen ke vendor, lalu bayar DP.",
      "Sebelum termin berikutnya dibayar, pekerjaan harus dibuktikan lebih dulu. Untuk SPK, Project Manager atau Engineer mencatat Verifikasi progres. Untuk PO, mereka mencatat Penerimaan barang beserta nomor surat jalan.",
      "Catat pembayaran: isi bruto, pajak dipotong, kas aktual, tanggal bayar, nomor tagihan vendor, referensi, rekening perusahaan, lalu unggah bukti transfer.",
    ],
    after: "Dokumen yang sudah disetujui terkunci dan nilainya menjadi komitmen. Hanya kas nyata yang masuk Buku Kas. Sisa komitmen yang belum dibayar mengurangi laba yang aman dibagikan. Selesai bersifat final: dokumen yang sudah Selesai tidak dapat diselesaikan lagi, tetapi pelunasan terakhirnya tetap boleh dicatat sesudah itu, karena retensi dan pelunasan memang mendarat setelah pekerjaan ditandatangani. Seluruh perubahan SPK dan PO hanya terjadi di layar ini; di layar lain dokumen kerja bersifat baca saja.",
  },
  {
    key: "handover",
    icon: ClipboardCheck,
    title: "Serah terima di lokasi: validasi lalu BAST",
    summary: "Memeriksa perangkat di lokasi, menandatangani serah terima, dan mengunci dokumen dengan cap resmi.",
    who: "Project Manager atau Engineer dengan akses Kelola pada BAST Digital. Cap perusahaan hanya diatur Admin, dan pencabutan BAST final hanya oleh Admin.",
    where: "Validasi Perangkat, lalu BAST Digital.",
    prepare: "Perangkat sudah terpasang, perwakilan klien hadir untuk menandatangani, dan cap perusahaan sudah diunggah Admin.",
    steps: [
      "Buka Validasi Perangkat. Daftar pemeriksaan tersusun otomatis dari item Perangkat dan Material pada BoQ paket ini.",
      "Periksa setiap item di lokasi, centang bila sesuai, dan tulis temuan pada kolom catatan.",
      "Tekan Selesaikan validasi. Seluruh item harus tercentang.",
      "Bila BoQ paket ini berubah setelah validasi diselesaikan — misalnya sebuah Addendum yang diterima klien menambah Perangkat atau Material — daftar pemeriksaan otomatis kembali menjadi Draft dan seluruh centangnya hilang. Buka lagi Validasi Perangkat, sinkronkan daftarnya, periksa item baru di lokasi, lalu selesaikan validasi sekali lagi sebelum BAST dibuat.",
      "Buka BAST Digital dan buat dokumen serah terima untuk paket tersebut.",
      "Minta perwakilan klien menandatangani di layar pada kolom Pihak Klien, lalu wakil PerumNet menandatangani pada kolom Pihak PerumNet.",
      "Tekan finalisasi. Aplikasi membubuhkan cap perusahaan, mengunci berkasnya, dan menempelkan QR pemeriksaan keaslian.",
    ],
    after: "Setiap perubahan BoQ paket sesudah checklist selesai — termasuk Addendum yang diterima klien — mengembalikan checklist ke status Draft dan menghapus seluruh centangnya, sehingga BAST baru hanya dapat terbit setelah pemeriksaan diulang. BAST menjadi Final dan tidak dapat diubah. Status proyek berubah menjadi Selesai hanya setelah seluruh paket yang penawarannya sudah diterima klien memiliki BAST final yang aktif; selama masih ada paket berjalan, proyek tetap Aktif. Siapa pun yang memindai QR pada PDF dapat memeriksa apakah dokumen itu asli dan masih berlaku. Bila ada kekeliruan, Admin mencabut dokumennya dengan alasan tertulis. Dokumen yang dicabut tidak dihapus: statusnya menjadi Batal dan QR-nya menyatakan dokumen tidak berlaku. Karena serah terima itulah yang menutup proyek, pencabutan mengembalikan status proyek menjadi Aktif bila masih ada paket yang belum diserahterimakan. Tim lalu membuat BAST baru untuk paket dan siklus yang sama, dan dokumen itu tercatat sebagai revisi berikutnya.",
  },
  {
    key: "expenses",
    icon: HandCoins,
    title: "Mencatat belanja proyek",
    summary: "Nota lapangan, uang muka, dan penggantian uang pribadi pegawai.",
    who: "Project Manager atau Engineer mencatat. Admin atau Finance memverifikasi, tetapi tidak pernah pengajuannya sendiri. Pembatalan belanja yang sudah disetujui hanya oleh Admin.",
    where: "Belanja Proyek. Menu ini punya izin modulnya sendiri, Belanja Proyek — bukan izin Manajemen Proyek dan bukan izin Pembukuan. Unduhan laporan CSV atau PDF-nya memerlukan tambahan izin Pembukuan minimal Lihat, karena laporan itu memuat rekening perusahaan yang membayar dan utang reimbursement kepada tiap orang.",
    prepare: "Foto atau PDF nota, masing-masing maksimal 10 MB dan paling banyak lima berkas per pengajuan, ditambah nama toko, kategori biaya, dan sumber dana.",
    steps: [
      "Tekan Catat belanja, lalu isi proyek, tanggal, toko, kategori, dan nominal.",
      "Pilih sumber dana: Rekening perusahaan, Uang muka proyek, atau Uang pribadi pegawai.",
      "Unggah nota, lalu tekan Kirim ke Finance. Tanpa nota, pengajuan tidak dapat dikirim.",
      "Finance memeriksa nota, kategori, sumber dana, dan peringatan kemungkinan pencatatan ganda, lalu menyetujui. Bila pengajuannya dibuat, dikirim, atau ditalangi oleh akun Finance itu sendiri, mintakan persetujuan kepada Admin atau rekan Finance yang lain.",
      "Untuk uang muka, Finance mencatat pencairannya lebih dulu lewat tombol Uang muka. Nota yang memakai uang muka tidak membuat kas keluar untuk kedua kalinya.",
      "Belanja yang memakai uang pribadi menjadi utang reimbursement dan boleh dibayar bertahap.",
    ],
    after: "Belanja yang disetujui terkunci. Rekening perusahaan mencatat kas keluar, sedangkan uang muka hanya mengurangi saldo uang muka. Koreksi dilakukan Admin lewat pembatalan yang membuat catatan pembalik, bukan penghapusan data. Uang muka yang terpakai habis otomatis berstatus Selesai; bila belanja yang memakainya kemudian di-void oleh Admin, saldonya kembali dan uang muka itu kembali menjadi Terbuka, sehingga saldo tersebut benar-benar dapat dipakai lagi untuk nota berikutnya. Untuk pencairan yang memang salah catat dan belum tersentuh sama sekali, Admin dapat membatalkan uang mukanya langsung lewat tombol Batalkan pada daftar uang muka di jendela Uang muka; aplikasi mencatat pembalik kasnya dan uang muka itu berstatus Dibatalkan berikut alasannya. Bila sebagian sudah dipakai atau sudah dikembalikan, atau pencairannya sudah cocok dengan mutasi bank, pembatalan ditolak — gunakan pengembalian uang muka, karena uangnya memang sudah keluar.",
  },
  {
    key: "bank",
    icon: Landmark,
    title: "Mencocokkan mutasi bank",
    summary: "Mengimpor mutasi rekening dan memastikan satu kejadian kas hanya tercatat sekali.",
    who: "Admin dan Finance. Penambahan, perubahan, dan penghapusan rekening hanya oleh Admin.",
    where: "Pembukuan, bagian Rekening perusahaan.",
    prepare: "E-statement PDF asli dari internet banking dengan teks yang bisa diseleksi, maksimal 5 MB. Alternatifnya CSV maksimal 2 MB yang memuat kolom Tanggal, Keterangan, serta Mutasi atau Debit/Kredit.",
    steps: [
      "Admin menambahkan rekening perusahaan beserta saldo awalnya.",
      "Pilih bulan mutasi, unggah berkasnya, lalu tekan Impor mutasi. Baris yang pernah diimpor otomatis dilewati.",
      "Untuk mutasi yang belum cocok, buka daftar kandidat lalu tekan Cocokkan. Aplikasi menawarkan transaksi dengan arah dan nominal sama dalam rentang 14 hari.",
      "Mutasi impor yang belum dicocokkan tetap muncul di daftar, tetapi belum dihitung sebagai kas. Baris seperti itu hampir selalu adalah uang yang sudah tercatat lewat invoice, pembayaran vendor, atau setoran pajak, sehingga menghitungnya berarti menghitung uang yang sama dua kali. Ringkasan Pembukuan menampilkan jumlahnya secara terpisah supaya angkanya terlihat, dan begitu mutasi dicocokkan ia langsung ikut terhitung lewat catatan sumbernya.",
      "Mutasi yang bukan urusan proyek dapat dikecualikan dari pembukuan, dan sewaktu-waktu bisa dikembalikan. Saat dikembalikan, mutasi itu menempel lagi ke catatan yang sama seperti sebelum dikecualikan, bukan membuat catatan bank baru — jadi kasnya tidak pernah tercatat dua kali.",
    ],
    after: "Pencocokan menghapus transaksi bank duplikat, bukan transaksi Invoice atau SPK. Pembayaran yang sudah dicocokkan harus dilepas dulu sebelum dapat dibatalkan. Transaksi manual yang sudah dicocokkan pun terkunci: ia tidak dapat diedit maupun dihapus sebelum pencocokannya dilepas.",
  },
  {
    key: "tax",
    icon: Percent,
    title: "Menutup pembukuan dan mengurus pajak",
    summary: "Menyetel aturan pajak, melunasi utang pajak, dan mengekspor laporan bulanan.",
    who: "Admin dan Finance. Pengaturan modul pajak dan master aturan hanya Admin, begitu pula pembatalan setoran.",
    where: "Pembukuan, bagian Posisi & settlement pajak.",
    prepare: "Bukti setor pajak, nomor referensi, dan rekening perusahaan yang dipakai membayar.",
    steps: [
      "Admin mengaktifkan modul pajak, lalu mengisi kode, tarif, cakupan (klien atau vendor), efek (Tambah atau Potong), dan perlakuan akuntansinya.",
      "Aturan pajak dipilih pada penawaran selagi masih Draft. Nilainya terkunci saat penawaran diterima klien lalu diwariskan ke invoice-invoicenya.",
      "Posisi pajak muncul di Pembukuan sebagai Utang atau Piutang setelah dokumen sumbernya terkunci.",
      "Tekan Lapor untuk mencatat masa pajak, nomor faktur, dan referensi pelaporan.",
      "Status pelaporan hanya bergerak maju: Candidate, Ready, Reported, lalu Settled. Membatalkan masih bebas selama posisi itu belum dilaporkan. Setelah dilaporkan, hanya Admin yang dapat menurunkan statusnya dan wajib menuliskan alasannya minimal 10 karakter pada kolom yang muncul di jendela Lapor.",
      "Tekan Settlement untuk mencatat penyetoran: isi nominal, tanggal, referensi, rekening, lalu unggah bukti setor.",
      "Tutup bulan dengan mengekspor laporan dari Pembukuan: PDF untuk arsip dan CSV untuk pemeriksaan angka.",
    ],
    after: "Nilai pajak pada dokumen lama tidak ikut berubah walaupun tarif master diperbarui kemudian. Angka pada laporan berasal dari transaksi kas nyata, bukan laporan laba rugi akuntansi. Tanggal dan identitas pelapor tidak pernah dihapus, bahkan ketika Admin menurunkan status pelaporan, sehingga bukti bahwa laporan pernah dikirim selalu tersimpan.",
  },
  {
    key: "profit",
    icon: Coins,
    title: "Membagi keuntungan proyek",
    summary: "Menentukan porsi tiap penerima dan membayarkannya dengan aman.",
    who: "Admin dan Finance menyusun alokasi; hanya Admin yang menyetujui dan membatalkan.",
    where: "Pembukuan, bagian Pembagian keuntungan.",
    prepare: "Kesepakatan porsi untuk setiap penerima.",
    steps: [
      "Pilih proyek, tekan Tambah penerima, lalu isi nama dan persentasenya. Total seluruh penerima maksimal 100%.",
      "Periksa Laba aman dibagikan. Angka ini sudah dikurangi komitmen vendor yang belum dibayar, utang pajak, dan utang reimbursement.",
      "Admin menekan Setujui. Nominal rupiahnya dikunci pada saat itu juga.",
      "Tekan Bayar dan isi tanggal pembayaran.",
    ],
    after: "Pembayaran masuk Buku Kas sebagai kas keluar dan menunggu dicocokkan dengan mutasi bank. Alokasi yang sudah disetujui tidak dapat diedit; Admin membatalkannya lalu tim membuat alokasi baru. Pembatalan tidak menghapus pembayarannya: catatan kas keluar yang asli tetap ada dan aplikasi menambahkan catatan pembalik bertanggal hari ini, sehingga kas proyek kembali seperti sebelum pembagian dibayarkan dan kedua baris tetap terlihat.",
  },
  {
    key: "catalog-ai",
    icon: Sparkles,
    title: "Memakai AI katalog",
    summary: "Meminta bantuan AI merangkum data produk, lalu memeriksanya sebelum masuk katalog.",
    who: "Hanya Admin dan Finance.",
    where: "Database Item, panel AI Catalog Assistant.",
    prepare: "Nama atau tipe produk, sebaiknya disertai tautan halaman produk resmi. Foto atau datasheet boleh ditambahkan.",
    steps: [
      "Tulis model, SKU, atau kebutuhan perangkat pada kolom pencarian AI.",
      "Tempelkan tautan halaman produk. Halaman itu dibaca oleh server aplikasi, bukan oleh browser Anda, dan isinya diperlakukan sebagai data yang belum tentu benar.",
      "Tekan Mulai analisis. Panel boleh ditutup karena analisis tetap berjalan di server.",
      "Hasilnya berstatus Draft dan belum menjadi item katalog. Periksa nama, model, spesifikasi, satuan, harga pokok, dan marginnya.",
      "Lengkapi kategori dan merek, perbaiki apa pun yang keliru, lalu tekan Setujui ke katalog. Bila hasilnya tidak layak, tekan Tolak dan tulis alasannya.",
    ],
    after: "Item baru masuk Database Item. Harga 1 dan Harga 2 selalu dihitung aplikasi dari harga pokok dan margin, tidak pernah oleh AI. Batasnya 20 analisis per orang per hari dan paling banyak dua analisis berjalan bersamaan. Draft yang berumur lebih dari tujuh hari perlu alasan sebelum disetujui.",
  },
  {
    key: "access",
    icon: ShieldCheck,
    title: "Mengatur akun, hak akses, dan bahasa",
    summary: "Membuat akun, menentukan menu yang boleh dibuka, dan mengatur preferensi pribadi.",
    who: "Hanya Admin yang membuat akun dan mengatur hak akses. Preferensi profil dan bahasa diatur masing-masing orang.",
    where: "Pengguna & Akses, Profil Saya, dan Pengaturan.",
    prepare: "Email pengguna dan daftar menu yang boleh mereka buka.",
    steps: [
      "Admin membuat akun dengan email dan kata sandi awal, lalu memilih peran: Admin, Project Manager, Engineer, atau Finance.",
      "Untuk setiap menu, pilih Tidak ada, Lihat, atau Kelola. Lihat hanya boleh membaca, Kelola boleh menambah dan mengubah data.",
      "Dua modul mudah tertukar. Belanja Proyek berdiri sendiri: itulah izin yang menentukan siapa boleh mencatat nota lapangan. Laba & Bagi Hasil memisahkan angka laba dari buku kas: Pembukuan Lihat membuka kas masuk dan kas keluar, sedangkan Laba Bersih Dasar, Laba Ditahan, dan Budget BoQ dibanding Komitmen vendor hanya muncul bila Laba & Bagi Hasil minimal Lihat. Project Manager dan Engineer bawaan tidak memilikinya.",
      "Untuk Project Manager dan Engineer, tentukan proyek mana saja yang boleh dibuka pada bagian Akses Proyek. Admin dan Finance selalu melihat semua proyek.",
      "Setiap orang membuka Profil Saya untuk mengganti foto (JPG, PNG, atau WebP maksimal 3 MB), nama, kontak, dan jabatan.",
      "Mengganti alamat email sendiri tidak langsung berlaku. Akun tetap memakai alamat lama sampai tautan konfirmasi yang dikirim ke alamat baru dibuka, tautan itu berlaku 60 menit, dan alamat lama menerima pemberitahuan bahwa ada permintaan penggantian. Aturan ini berlaku untuk semua peran, Admin sekalipun.",
      "Buka Pengaturan untuk memilih Bahasa Indonesia atau English, mengatur notifikasi email, dan mengganti kata sandi. Mengganti kata sandi sendiri langsung mengakhiri sesi Anda di seluruh perangkat lain; hanya perangkat yang sedang Anda pakai tetap masuk.",
    ],
    after: "Perubahan hak akses langsung berlaku. Bila akses proyek dicabut, proyek itu hilang dari dashboard orang tersebut. Pilihan bahasa tersimpan pada akun dan dipakai lagi saat login berikutnya. Percobaan masuk yang gagal berulang kali hanya ditahan beberapa menit; tidak ada akun yang terkunci permanen.",
  },
];

const workflowsEn: WorkflowGuide[] = [
  {
    key: "start",
    icon: BookOpenCheck,
    title: "Getting started: signing in and finding the menus",
    summary: "How to sign in, choose a project and package, and know which menu covers which job.",
    who: "Everyone: Admin, Project Manager, Engineer, and Finance.",
    where: "The left sidebar, then Dashboard.",
    prepare: "The email address and starting password your Admin gave you.",
    steps: [
      "Sign in with your email and password. Tick Remember Me only on a private device; without it you are signed out automatically after 8 hours.",
      "After several wrong passwords the application holds off the next attempt for a few minutes, and the wait grows if the failures continue. The same applies to password recovery requests. Wait for the pause to end and try again; no account is ever locked permanently.",
      "Choose a project in the project picker at the top. While a project is selected, every operational menu shows only that project's data. Choose All projects to see the overall picture on the Dashboard.",
      "The Project map sits at the very top of the Dashboard. Pin colour follows the status: grey for In negotiation, teal for In progress, green for Completed. Click a pin to open that project. The map only ever carries the projects you are allowed to see, exactly like the project list below it.",
      "Pins are guessed from the Location field every time a project is saved. If the location cannot be recognised the project still saves and is counted on the \"projects have no pin yet\" line under the map — nothing is dropped. Press Set a map pin, choose the project, and click its position. A pin you place by hand is permanent and is never overwritten by a later automatic guess.",
      "Directly under the map sit three state cards: In negotiation, In progress, and Completed. The large figure is how many projects are in that state, and the small line under it says how many have gone past their planned start or their target date. Where the date has simply never been filled in, the line says so rather than pretending everything is on schedule. The Completed card carries its count alone, because the application does not record the date a project actually finished and so has nothing honest to say about the timing.",
      "The money — Active project value and Receivables collected — sits at the very bottom of the Dashboard, under the Recent projects list; scroll down to read it. Active project value adds up only the contracts that are In progress, while Receivables collected follows the share of each project that confirmed payments already cover. Both follow the same project picker as the rest of the Dashboard.",
      "If a project is sold as several separate scopes, also choose a Commercial package at the top of BoQ Generator, Quotations & Invoices, Device Validation, and Digital Handover. Each package has its own BoQ, quotation, invoices, and handover certificate.",
      "A new package starts as Active, and only an Active package takes new documents: a BoQ, a quotation, an invoice, a validation, a handover certificate, or an addendum. The status button beside the package picker changes it. When a package's work is finished set it to Completed; when a package is called off set it to Void. A Completed package can be reactivated if late work arrives, while Void is final.",
      "The sidebar has three groups. Main holds Dashboard, Project Management, BoQ Generator, and Quotations & Invoices. Operations holds Project Expenses, Procurement & Vendors, Device Validation, Digital Handover, and Finance. Administration holds Item Database and Users & Access.",
    ],
    after: "The app remembers your project and package, so you do not have to pick them again each time you switch menus. Documents on a Completed or Void package stay readable, downloadable, and printable as before; only new documents are refused. A package that already carries documents cannot be deleted — setting it to Void is how it is retired. A project, too, can only be deleted while it has never touched money: once a payment, an expense settlement, a tax settlement, or a Finance transaction exists, deletion is refused and the project must be closed or archived with the status Completed instead.",
  },
  {
    key: "quotation",
    icon: FileSpreadsheet,
    title: "Preparing a quotation for a client",
    summary: "From creating the project through to the client accepting it and the amounts being locked.",
    who: "A Project Manager or Admin builds the BoQ. Only Admin and Finance may change dates, discount, rounding, and tax.",
    where: "Project Management, then BoQ Generator, then Quotations & Invoices.",
    prepare: "Client and site details, the list of work required, and — for the last step — the client's written acceptance as a PDF or photo.",
    steps: [
      "Create the project in Project Management: fill in the job name, client, location, dates, and the person responsible.",
      "Open BoQ Generator and add work items from the Item Database. Choose Price 1 or Price 2; the selling price is calculated automatically from cost and the category margin.",
      "Open Quotations & Invoices. The quotation value is filled in automatically from the BoQ of the selected package.",
      "An Admin or Finance user presses Edit to set the issue date, validity, discount, and rounding. The order is: subtotal − discount + added tax ± rounding = Total billed to the client.",
      "If tax applies, press Tax, switch on Apply tax, and choose the rules. Added tax such as VAT increases the client's bill. Withheld tax such as income tax does not: the client deducts it when paying, so the net cash reaching your account is smaller.",
      "Press Download PDF, send the quotation to the client, then press Mark as sent.",
      "Once the client agrees, press Client accept, enter the acceptance date, upload the proof, and press Accept & lock.",
    ],
    after: "The quotation becomes Accepted. BoQ items, discount, tax, and rounding are locked permanently. From then on you can raise installment invoices and procurement documents. Later changes to the work must go through an Addendum. Void, Rejected, and Superseded are terminal: such a quotation cannot be returned to Draft or Sent — raise a new one instead. Voiding is also refused while an active Work Order or PO, an existing invoice, or a paid invoice still references it.",
  },
  {
    key: "installment",
    icon: ReceiptText,
    title: "Billing the client in installments",
    summary: "Splitting the contract value into staged invoices, for example a down payment and a final payment.",
    who: "Admin, Project Manager, or Finance with Manage access to Quotations & Invoices.",
    where: "Quotations & Invoices, Invoice tab.",
    prepare: "An accepted quotation and an agreement on how the payments are staged.",
    steps: [
      "Open the Invoice tab and press New invoice. The button only becomes active once the client has accepted the quotation.",
      "Choose the invoice type (DP 30%, DP 50%, Milestone 2, or Final Payment), then fill in the issue and due dates.",
      "Enter the installment percentage. Two decimal places are allowed, and the rupiah amount appears immediately, taken from the Total billed to the client.",
      "Press Issue invoice, then download the PDF and send it to the client.",
      "Repeat for the next installment. All installments together may not exceed 100%; the final invoice absorbs any rounding difference automatically.",
    ],
    after: "Each invoice gets its own number and inherits the tax locked on the quotation. As long as there is no active payment, an invoice can still be edited or deleted; once its payments have been voided, the invoice opens up again.",
  },
  {
    key: "invoice-payment",
    icon: WalletCards,
    title: "Recording money received from a client",
    summary: "Confirming an invoice payment, including partial payments and tax the client withheld.",
    who: "Admin or Finance with Manage access to Quotations & Invoices and Finance. Only an Admin may void a payment.",
    where: "Quotations & Invoices, Invoice tab, Confirm button.",
    prepare: "The transfer receipt as a PDF or image, a payment reference, the receiving company bank account, and the withholding slip if the client deducted tax.",
    steps: [
      "Press Confirm on the invoice that was paid.",
      "Fill in Gross amount settled, Tax withheld by client, and Actual cash received. The gross amount must equal cash plus withholding exactly.",
      "Enter the payment received date using the date on the bank statement, not the day you are entering it.",
      "Enter the payment reference, choose the method and company bank account, then upload the payment proof.",
      "Press Post payment.",
    ],
    after: "Only real cash enters the Cash Ledger. Tax withheld by the client is recorded as a tax position, not as cash. Payments may arrive in stages; the invoice status moves to Partially Paid and then Paid.",
  },
  {
    key: "addendum",
    icon: ScrollText,
    title: "Adding work in the middle of a project",
    summary: "Handling extra work without touching a quotation the client already accepted.",
    who: "A Project Manager or Admin creates the Addendum; Admin and Finance lock its value.",
    where: "Procurement & Vendors, Quotation & Addendum tab.",
    prepare: "The list of extra work and the client's written approval of it.",
    steps: [
      "Open the Quotation & Addendum tab and create a new Addendum. The app immediately prepares a Draft quotation for it.",
      "Add the extra work items to that addendum.",
      "Send the addendum quotation to the client, then mark it as sent.",
      "Once the client agrees, press Accept, enter the date, and upload the proof of approval.",
    ],
    after: "The project value increases and new procurement documents can draw items from this addendum. The addendum belongs to the commercial package it was created from, so it counts towards that package's summary. Work that was already accepted stays locked and its figures do not change.",
  },
  {
    key: "procurement",
    icon: PackageSearch,
    title: "Paying a vendor through a Work Order or PO",
    summary: "From creating the vendor commitment through to staged payments, including progress and goods-receipt evidence.",
    who: "A Project Manager or Engineer creates and submits. Admin or Finance approves. Progress verification and goods receipt are done by an Admin, Project Manager, or Engineer who is a project member — View on Procurement & Vendors is enough. Only an Admin may void a payment.",
    where: "Procurement & Vendors.",
    prepare: "An accepted quotation with its proof, vendor details, negotiated prices, and — when paying — the vendor invoice, a reference, and the transfer receipt.",
    steps: [
      "Do the whole cycle on the Procurement & Vendors screen: create, submit, approve, send, verify, pay, then close. There is no second route — from every other screen a Work Order or PO can only be read and downloaded as a PDF.",
      "Choose the document type. Use a Work Order (SPK) for Service or Mobility work and a PO for Devices or Materials. The vendor type must match the document.",
      "Select items from the accepted quotation, then enter quantities and vendor prices. Total allocations may not exceed the BoQ quantities.",
      "Set the payment terms. Enter the down payment as a percentage if there is one; the rest becomes the final payment. All terms together must match the vendor contract value exactly.",
      "Submit the document, then an Admin or Finance user approves it. Finance may never approve its own submission, and an Admin approving their own submission must give a reason.",
      "Approval does not yet mean payable. Approval is an internal decision; Send is the moment the document actually binds the vendor, so payment and completion only open once it has been sent. While the document still reads Approved, the Pay and Complete buttons are deliberately absent, and the application refuses both if they are attempted anyway. Press Send first.",
      "Send the document to the vendor, then pay the down payment.",
      "Before any later term is paid, the work must be evidenced first. For a Work Order, a Project Manager or Engineer records Progress verification. For a PO, they record a Goods receipt with the delivery note number.",
      "Record the payment: gross amount, tax withheld, actual cash, payment date, vendor invoice number, reference, company bank account, and the transfer receipt.",
    ],
    after: "An approved document is locked and its value becomes a commitment. Only real cash enters the Cash Ledger. Unpaid commitments reduce the profit that is safe to distribute. Completion is final: a document already Completed cannot be completed again, though its final settlement may still be recorded afterwards, because retention and final payment land after the work is signed off. Every change to a Work Order or PO happens on this screen alone; everywhere else those documents are read-only.",
  },
  {
    key: "handover",
    icon: ClipboardCheck,
    title: "Handover on site: validation, then the certificate",
    summary: "Inspecting the devices on site, signing the handover, and locking the document with the company seal.",
    who: "A Project Manager or Engineer with Manage access to Digital Handover. Only an Admin configures the company seal or revokes a final certificate.",
    where: "Device Validation, then Digital Handover.",
    prepare: "The devices installed, a client representative present to sign, and the company seal already uploaded by an Admin.",
    steps: [
      "Open Device Validation. The checklist is built automatically from the Device and Material items in this package's BoQ.",
      "Inspect each item on site, tick it when it passes, and record any findings in the notes column.",
      "Press Complete validation. Every item must be ticked.",
      "If this package's BoQ changes after the validation was completed — an accepted Addendum adding a Device or Material, for instance — the checklist automatically returns to Draft and every tick is cleared. Open Device Validation again, re-sync the list, inspect the new items on site, and complete the validation once more before creating the certificate.",
      "Open Digital Handover and create the handover certificate for that package.",
      "Ask the client's representative to sign on screen in the Client panel, then have the PerumNet representative sign in the PerumNet panel.",
      "Press finalize. The app applies the company seal, locks the file, and attaches a QR code for checking authenticity.",
    ],
    after: "Any change to the package BoQ after the checklist was completed — an accepted Addendum included — returns the checklist to Draft and clears every tick, so a new certificate can only be issued once the inspection has been redone. The certificate becomes Final and can no longer be edited. The project status changes to Completed only once every package with a client-accepted quotation has an active final certificate; while another package is still running, the project stays Active. Anyone who scans the QR code on the PDF can check whether the document is genuine and still valid. If something is wrong, an Admin revokes it with a written reason. A revoked document is not deleted: its status becomes Void and its QR reports it as no longer valid. Because it is the handover that closes the project, revoking one returns the project to Active while any package is left without a certificate. The team then issues a new certificate for the same package and cycle, recorded as the next revision.",
  },
  {
    key: "expenses",
    icon: HandCoins,
    title: "Recording project purchases",
    summary: "Field receipts, cash advances, and reimbursing money staff paid out of pocket.",
    who: "A Project Manager or Engineer records them. Admin or Finance verifies, but never their own submission. Only an Admin may void an approved purchase.",
    where: "Project Expenses. This menu has its own module permission, Project Expenses — not Project Management and not Finance. Downloading its CSV or PDF report additionally requires at least View on Finance, because that report carries the company account that paid and the reimbursement owed to each person.",
    prepare: "Photos or PDFs of the receipts — up to 10 MB each and at most five files per submission — plus the merchant name, expense category, and funding source.",
    steps: [
      "Press Record expense, then fill in the project, date, merchant, category, and amount.",
      "Choose the funding source: Company account, Project advance, or Employee paid.",
      "Upload the receipt, then press Send to Finance. A submission without a receipt cannot be sent.",
      "Finance reviews the receipt, category, funding source, and any possible-duplicate warning, then approves it.",
      "For advances, Finance records the disbursement first using the Advance button. A receipt charged to an advance never posts cash out a second time.",
      "Purchases paid with an employee's own money become a reimbursement payable and may be paid in stages.",
    ],
    after: "An approved purchase is locked. A company account posts cash out, while an advance only reduces the advance balance. Corrections are made by an Admin through a void that posts a reversing entry, never by deleting data. An advance drawn down to zero closes as Settled; if the purchase that consumed it is later voided by an Admin, the balance comes back and the advance returns to Open, so that restored balance really can fund the next receipt. For a disbursement that was simply recorded in error and never touched, an Admin can void the advance itself using the Void button on the advance list in the Advance window; the application posts the reversing cash entry and the advance then reads Voided together with its reason. If any of it has been spent or returned, or the disbursement is already matched to a bank entry, the void is refused — record an advance return instead, because the money genuinely left.",
  },
  {
    key: "bank",
    icon: Landmark,
    title: "Matching bank statement entries",
    summary: "Importing bank entries and making sure one cash event is only ever recorded once.",
    who: "Admin and Finance. Only an Admin may add, change, or delete a bank account.",
    where: "Finance, Company banking section.",
    prepare: "An original e-statement PDF from internet banking with selectable text, up to 5 MB. Alternatively a CSV of up to 2 MB containing date, description, and either a movement or debit/credit column.",
    steps: [
      "An Admin adds the company account together with its opening balance.",
      "Choose the statement month, upload the file, then press Import statement. Rows that were imported before are skipped automatically.",
      "For entries that are not matched yet, open the candidate list and press Match. The app offers records with the same direction and amount within a 14-day window.",
      "An imported entry that is not matched yet is still listed, but it is not counted as cash. Such a line nearly always represents money an invoice, a vendor payment, or a tax settlement already recorded, so counting it would count the same money twice. The Finance summary reports that figure separately so it stays visible, and as soon as the entry is matched it counts again through its source record.",
      "Entries that have nothing to do with the projects can be excluded from the books, and restored again at any time. On restore an entry re-attaches to the very record it was booked against before, rather than creating a fresh bank record — so the cash is never recorded twice.",
    ],
    after: "Matching deletes the duplicate bank record, never the Invoice or Work Order record. A payment that has been matched must be unmatched before it can be voided. A manual entry that has been matched locks in the same way: it can be neither edited nor deleted until the reconciliation is released.",
  },
  {
    key: "tax",
    icon: Percent,
    title: "Closing the books and handling tax",
    summary: "Setting up tax rules, settling tax payables, and exporting the monthly reports.",
    who: "Admin and Finance. Only an Admin configures the tax module and the master rules, or voids a settlement.",
    where: "Finance, Tax position & settlement section.",
    prepare: "The tax payment receipt, a reference number, and the company bank account used to pay.",
    steps: [
      "An Admin enables the tax module, then fills in the code, rate, scope (client or vendor), effect (added or withheld), and accounting treatment.",
      "Tax rules are chosen on a quotation while it is still a Draft. The amounts lock when the client accepts the quotation and are inherited by its invoices.",
      "Tax positions appear in Finance as Payable or Receivable once the source document is locked.",
      "Press Report to record the tax period, tax invoice number, and reporting reference.",
      "The reporting status only moves forward: Candidate, Ready, Reported, then Settled. Voiding is still free while the position has not been reported. Once it has, only an Admin may lower the status, and they must write a reason of at least 10 characters in the field that appears in the Report window.",
      "Press Settlement to record the payment: amount, date, reference, bank account, and the payment receipt.",
      "Close the month by exporting the reports from Finance: the PDF for the archive and the CSV for checking the figures.",
    ],
    after: "Tax amounts on older documents never change when a master rate is updated later. Report figures come from real cash movements, not from an accounting profit-and-loss statement. The filing date and the identity of whoever filed are never erased, not even when an Admin lowers a reporting status, so the evidence that a return was submitted always survives.",
  },
  {
    key: "profit",
    icon: Coins,
    title: "Sharing project profit",
    summary: "Setting each recipient's share and paying it out safely.",
    who: "Admin and Finance prepare the allocations; only an Admin approves or voids them.",
    where: "Finance, Profit sharing section.",
    prepare: "An agreement on each recipient's share.",
    steps: [
      "Choose the project, press Add recipient, then enter the name and percentage. All recipients together are capped at 100%.",
      "Check the safe distributable profit. It already has unpaid vendor commitments, tax payables, and reimbursement payables deducted.",
      "An Admin presses Approve. The rupiah amount is locked at that moment.",
      "Press Pay and enter the payment date.",
    ],
    after: "The payment enters the Cash Ledger as cash out and waits to be matched against the bank statement. An approved allocation cannot be edited; an Admin voids it and the team creates a new one. Voiding does not erase the payout: the original cash-out entry stays and a reversing entry dated today cancels it, so the project's cash returns to its pre-payout position with both lines still visible.",
  },
  {
    key: "catalog-ai",
    icon: Sparkles,
    title: "Using the catalog AI assistant",
    summary: "Letting AI summarize product data, then reviewing it before it reaches the catalog.",
    who: "Admin and Finance only.",
    where: "Item Database, AI Catalog Assistant panel.",
    prepare: "The product name or model, ideally with a link to the official product page. A photo or datasheet may be added.",
    steps: [
      "Type the model, SKU, or device requirement in the AI search field.",
      "Paste the product page link. The page is read by the application server, not by your browser, and its contents are treated as data that may not be correct.",
      "Press Start analysis. You may close the panel because the analysis keeps running on the server.",
      "The result is a Draft, not yet a catalog item. Review the name, model, specifications, unit, cost price, and margins.",
      "Fill in the category and brand, correct anything that is wrong, then press Approve into catalog. If the result is not usable, press Reject and give a reason.",
    ],
    after: "The new item appears in the Item Database. Price 1 and Price 2 are always calculated by the app from cost and margin, never by the AI. The limits are 20 analyses per person per day and at most two running at the same time. A draft older than seven days needs a written reason before it can be approved.",
  },
  {
    key: "access",
    icon: ShieldCheck,
    title: "Managing accounts, access, and language",
    summary: "Creating accounts, deciding which menus people may open, and setting personal preferences.",
    who: "Only an Admin creates accounts and sets permissions. Profile and language preferences are set by each person.",
    where: "Users & Access, My Profile, and Settings.",
    prepare: "The person's email address and the list of menus they are allowed to open.",
    steps: [
      "An Admin creates the account with an email and starting password, then picks the role: Admin, Project Manager, Engineer, or Finance.",
      "For each menu, choose No access, View, or Manage. View is read-only; Manage allows creating and changing data.",
      "Two modules are easy to confuse. Project Expenses stands on its own: that is the permission deciding who may record a field receipt. Profit & Profit Sharing separates the profit figures from the cash ledger: View on Finance opens cash in and cash out, while Base Net Profit, Retained Profit, and BoQ budget against vendor commitment only appear when Profit & Profit Sharing is at least View. A default Project Manager and Engineer do not have it.",
      "For Project Managers and Engineers, choose which projects they may open in the Project Access section. Admin and Finance always see every project.",
      "Each person opens My Profile to update their photo (JPG, PNG, or WebP up to 3 MB), name, contact details, and job title.",
      "Changing your own email address does not take effect immediately. The account keeps its old address until the confirmation link sent to the new address is opened, that link is valid for 60 minutes, and the old address is notified that a change was requested. This holds for every role, an Admin included.",
      "Open Settings to choose Indonesian or English, set email notifications, and change your password. Changing your own password immediately ends your sessions on every other device; only the device you are using stays signed in.",
    ],
    after: "Permission changes take effect immediately. If project access is revoked, that project disappears from the person's dashboard. The language choice is saved on the account and reused at the next sign-in. Repeated failed sign-in attempts are only held off for a few minutes; no account is ever locked permanently.",
  },
];

const messagesId: MessageGuide[] = [
  {
    key: "accepted-required",
    message: "Invoice termin hanya dapat dibuat dari Quotation yang sudah diterima klien.",
    meaning: "Penawarannya belum berstatus Diterima, jadi belum ada nilai kontrak yang boleh ditagihkan.",
    action: "Buka Quotation & Invoice, tandai penawaran sudah dikirim, lalu tekan Terima klien dan unggah bukti persetujuan. Pesan serupa “Terima Quotation paket terlebih dahulu” berarti paket yang dipilih memang belum punya penawaran yang diterima.",
  },
  {
    key: "expired",
    message: "Quotation sudah kedaluwarsa. Admin atau Finance harus memperpanjang masa berlaku sebelum dapat diterima.",
    meaning: "Tanggal Berlaku sampai pada penawaran sudah lewat.",
    action: "Minta Admin atau Finance menekan Edit pada penawaran dan memperpanjang tanggal Berlaku sampai, lalu ulangi Terima klien.",
  },
  {
    key: "installment-cap",
    message: "Akumulasi termin melebihi 100%. Sisa termin adalah ...%",
    meaning: "Persentase yang Anda isi membuat jumlah seluruh termin melampaui nilai kontrak.",
    action: "Isi persentase sebesar sisa yang disebutkan pada pesan, atau hapus dulu invoice termin yang salah selama belum ada pembayarannya.",
  },
  {
    key: "accepted-locked",
    message: "Quotation yang diterima klien sudah dikunci. Buat Addendum baru.",
    meaning: "Penawaran yang sudah disetujui klien memang tidak boleh diubah lagi.",
    action: "Buka Procurement & Vendor, tab Quotation & Addendum, buat Addendum, lalu proses pekerjaan tambahan di sana.",
  },
  {
    key: "not-earned",
    message: "Nominal melebihi nilai yang sudah berhak dibayar. Verifikasi progres atau penerimaan barang terlebih dahulu.",
    meaning: "Setelah DP, termin berikutnya baru boleh dibayar kalau pekerjaannya sudah dibuktikan.",
    action: "Untuk SPK, minta Project Manager atau Engineer mencatat Verifikasi progres. Untuk PO, minta mereka mencatat Penerimaan barang. Setelah itu ulangi pencatatan pembayaran.",
  },
  {
    key: "self-approval",
    message: "Finance tidak boleh menyetujui draft yang dibuat atau diajukannya sendiri.",
    meaning: "Pembuat dan penyetuju dokumen harus orang yang berbeda.",
    action: "Minta Admin atau pengguna Finance lain menyetujui dokumen tersebut. Admin yang terpaksa menyetujui pengajuannya sendiri wajib menulis alasan.",
  },
  {
    key: "self-approval-expense",
    message: "Finance tidak boleh menyetujui belanja yang dibuat, diajukan, atau ditalanginya sendiri.",
    meaning: "Finance hanya menyetujui belanja orang lain; yang membelanjakan bukan yang menyetujui.",
    action: "Minta Admin atau pengguna Finance lain memverifikasi pengajuan itu. Admin yang terpaksa menyetujui pengajuannya sendiri wajib menulis alasan, dan alasan itu tercatat di audit log.",
  },
  {
    key: "validation-required",
    message: "Selesaikan checklist validasi Perangkat dan Material sebelum BAST diterbitkan.",
    meaning: "BAST hanya boleh terbit setelah pemeriksaan lapangan selesai.",
    action: "Buka Validasi Perangkat pada paket yang sama, centang seluruh item, lalu tekan Selesaikan validasi.",
  },
  {
    key: "validation-incomplete",
    message: "Centang seluruh Perangkat dan Material sebelum validasi diselesaikan.",
    meaning: "Masih ada item pada daftar pemeriksaan yang belum dicentang.",
    action: "Telusuri daftar dari atas ke bawah. Item yang bermasalah tetap harus diperiksa; tulis temuannya pada kolom catatan agar terekam.",
  },
  {
    key: "signatures",
    message: "Tanda tangan klien dan PerumNet wajib lengkap sebelum finalisasi.",
    meaning: "Salah satu kolom tanda tangan pada BAST masih kosong.",
    action: "Minta perwakilan klien menandatangani pada kolom Pihak Klien dan wakil PerumNet pada kolom Pihak PerumNet, lalu ulangi finalisasi.",
  },
  {
    key: "seal",
    message: "Aktifkan dan unggah cap perusahaan sebelum finalisasi BAST.",
    meaning: "Cap perusahaan belum diatur, padahal cap itulah yang menandai dokumen final.",
    action: "Minta Admin membuka pengaturan cap di BAST Digital, mengunggah gambar cap (PNG, JPG, atau WebP maksimal 2 MB), mengisi nama dan jabatan penandatangan, lalu mengaktifkannya.",
  },
  {
    key: "category-in-use",
    message: "Kategori sudah memiliki item. Nonaktifkan kategori agar histori tetap aman.",
    meaning: "Kategori masih dipakai item lain, jadi tidak boleh dihapus supaya data lama tidak rusak.",
    action: "Ubah status kategori menjadi nonaktif. Kategori nonaktif tidak muncul lagi saat menambah item baru, tetapi dokumen lama tetap terbaca utuh.",
  },
  {
    key: "ai-not-configured",
    message: "GEMINI_API_KEY belum tersedia pada secret server.",
    meaning: "Asisten AI katalog belum dinyalakan di server ini.",
    action: "Hubungi Admin sistem untuk memasang kunci layanan AI. Sementara itu, tambahkan item katalog secara manual di Database Item.",
  },
  {
    key: "ai-limits",
    message: "Batas 20 analisis AI per pengguna per hari telah tercapai.",
    meaning: "Kuota harian AI Anda habis. Pesan sejenis, “Maksimal dua analisis AI dapat berjalan bersamaan”, berarti masih ada analisis yang belum selesai.",
    action: "Tunggu analisis yang berjalan selesai, coba lagi besok, atau minta rekan berperan Admin/Finance menjalankannya. Menambah item secara manual selalu bisa dilakukan.",
  },
  {
    key: "ai-expired",
    message: "Rekomendasi lebih dari tujuh hari. Refresh analisis atau isi alasan override.",
    meaning: "Draft AI sudah terlalu lama sehingga harganya mungkin tidak berlaku lagi.",
    action: "Jalankan analisis ulang agar datanya segar, atau isi alasan override minimal lima karakter bila harga lama masih relevan.",
  },
  {
    key: "invoice-history",
    message: "Invoice dengan histori pembayaran tidak dapat dihapus. Gunakan void pada pembayaran.",
    meaning: "Invoice sudah pernah dibayar, jadi menghapusnya akan merusak pembukuan.",
    action: "Buka jendela pembayaran invoice, tekan Void pembayaran terakhir, dan isi alasannya. Setelah tidak ada pembayaran tersisa, invoice baru dapat diedit atau dihapus.",
  },
  {
    key: "quotation-terminal",
    message: "Perubahan status Quotation tidak sesuai urutan workflow.",
    meaning: "Anda mencoba mengaktifkan kembali penawaran yang sudah Batal, Ditolak, atau Digantikan. Ketiganya status akhir.",
    action: "Buat penawaran baru untuk pekerjaan itu. Penawaran lama tetap tersimpan sebagai riwayat dan tidak dapat dikembalikan menjadi Draft atau Terkirim.",
  },
  {
    key: "quotation-paid-invoice",
    message: "Quotation ini tidak dapat dibatalkan karena Invoice-nya sudah menerima pembayaran.",
    meaning: "Uang klien sudah masuk atas dasar penawaran ini, sehingga membatalkannya akan menghapus dasar penagihannya.",
    action: "Void pembayarannya lebih dulu, hapus invoicenya bila memang keliru, baru batalkan penawarannya. Selama invoicenya masih terbit, aplikasi tetap menolak dengan pesan bahwa penawaran sudah memiliki Invoice.",
  },
  {
    key: "project-financial-history",
    message: "Proyek ini sudah memiliki riwayat kas yang tercatat sehingga tidak dapat dihapus.",
    meaning: "Ada pembayaran, penyelesaian belanja, setoran pajak, atau transaksi Pembukuan yang melekat pada proyek ini.",
    action: "Jangan hapus proyeknya. Tutup atau arsipkan: ubah statusnya menjadi Selesai dan biarkan dokumen serta pembukuannya utuh. Penghapusan hanya tersedia untuk proyek yang belum pernah menyentuh uang.",
  },
  {
    key: "reconciled",
    message: "Lepaskan rekonsiliasi bank sebelum melakukan void.",
    meaning: "Transaksi ini sudah dicocokkan dengan mutasi rekening.",
    action: "Buka Pembukuan, cari mutasi yang cocok dengan transaksi tersebut, lepaskan pencocokannya, lalu ulangi pembatalan.",
  },
  {
    key: "duplicate",
    message: "Ditemukan kemungkinan pencatatan ganda.",
    meaning: "Ada nota atau pembayaran lain dengan tanggal, toko, dan nominal yang mirip.",
    action: "Periksa nomor dokumen yang disebutkan pada peringatan. Bila memang belanja yang berbeda, kirim ulang dan setujui peringatannya. Bila ternyata sama, batalkan pengajuan.",
  },
  {
    key: "attachment-required",
    message: "Unggah minimal satu nota atau invoice sebelum mengajukan.",
    meaning: "Belanja tidak dapat dikirim ke Finance tanpa bukti.",
    action: "Lampirkan foto atau PDF nota, maksimal 10 MB per berkas dan paling banyak lima berkas, lalu tekan Kirim ke Finance.",
  },
  {
    key: "profit-unsafe",
    message: "Laba belum aman dibagikan setelah memperhitungkan komitmen vendor yang belum dibayar.",
    meaning: "Setelah dikurangi kewajiban yang belum dibayar, tidak ada laba yang aman untuk dibagi.",
    action: "Selesaikan pembayaran vendor, utang pajak, dan reimbursement yang tertunda, atau turunkan persentase pembagiannya.",
  },
  {
    key: "statement",
    message: "Periode di PDF adalah ..., bukan ... / Nomor rekening di PDF tidak sesuai dengan rekening yang dipilih.",
    meaning: "Berkas mutasi tidak cocok dengan bulan atau rekening yang Anda pilih.",
    action: "Pastikan bulan dan rekening yang dipilih sama dengan isi berkas. Gunakan e-statement asli dengan teks yang bisa diseleksi, bukan hasil scan atau foto layar.",
  },
  {
    key: "session",
    message: "Silakan masuk untuk melanjutkan. / Peran Anda tidak memiliki akses ke fitur ini.",
    meaning: "Pesan pertama berarti sesi 8 jam Anda sudah berakhir. Pesan kedua berarti hak akses menu Anda belum mencukupi.",
    action: "Masuk kembali untuk pesan pertama. Untuk pesan kedua, minta Admin memeriksa hak akses akun Anda di Pengguna & Akses.",
  },
  {
    key: "expense-report",
    message: "Laporan belanja proyek memuat rekening perusahaan dan utang reimbursement, sehingga memerlukan izin Pembukuan minimal Lihat.",
    meaning: "Anda boleh membuka Belanja Proyek dan mencatat nota, tetapi unduhan laporannya adalah dokumen keuangan lintas proyek. Izin bawaan Engineer memang tidak mencakupnya.",
    action: "Minta laporannya kepada Admin atau Finance, atau minta Admin menaikkan izin Pembukuan akun Anda menjadi Lihat bila memang Anda perlu mengunduhnya sendiri.",
  },
  {
    key: "procurement-source",
    message: "SPK/PO hanya dapat memakai item dari Quotation yang sudah diterima beserta bukti persetujuannya.",
    meaning: "Dokumen vendor selalu bersumber dari pekerjaan yang sudah disetujui klien.",
    action: "Selesaikan dulu Terima klien pada penawaran atau addendum yang bersangkutan, lengkap dengan tanggal dan bukti persetujuan.",
  },
  {
    key: "legacy-spk",
    message: "Endpoint SPK lama hanya dapat dibaca. Gunakan /api/procurement-orders.",
    meaning: "Sebuah layar atau integrasi lama mencoba membuat, mengubah, membayar, atau menghapus SPK di luar layar Procurement & Vendor. Jalur lama itu pernah mencatat pembayaran vendor dua kali.",
    action: "Kerjakan seluruh siklusnya di Procurement & Vendor: Buat, Ajukan, Setujui, Kirim, Verifikasi, Bayar, lalu Selesai. Membaca SPK dan mengunduh PDF-nya tetap dapat dilakukan dari mana pun.",
  },
  {
    key: "package-not-active",
    message: "Paket berstatus Selesai atau Batal sehingga tidak dapat menerima dokumen baru.",
    meaning: "Paket komersial yang dipilih sudah dipensiunkan. Hanya paket Aktif yang menerima BoQ, penawaran, invoice, validasi, BAST, dan Addendum baru.",
    action: "Pilih paket lain di bagian atas layar, atau aktifkan kembali paket Selesai lewat tombol status di sebelah pemilih paket. Paket Batal tidak dapat dihidupkan lagi — buat paket baru bila pekerjaannya memang berlanjut. Dokumen lama pada paket itu tetap dapat dibaca dan diunduh.",
  },
  {
    key: "package-status",
    message: "Perubahan status paket tidak sesuai urutan workflow.",
    meaning: "Anda mencoba mengaktifkan kembali paket yang sudah Batal. Batal adalah status akhir.",
    action: "Buat paket komersial baru untuk pekerjaan itu. Paket lama tetap tersimpan lengkap dengan dokumennya sebagai riwayat.",
  },
  {
    key: "reporting-downgrade",
    message: "Status pelaporan hanya dapat maju. Hanya Admin yang dapat menurunkannya, dengan alasan tercatat.",
    meaning: "Posisi pajak ini sudah dilaporkan, dan Anda mencoba mengembalikannya ke status sebelumnya atau membatalkannya.",
    action: "Bila laporan memang perlu dikoreksi, minta Admin menurunkan statusnya sambil menuliskan alasannya; tanggal dan identitas pelapor tetap tersimpan. Bila tujuannya hanya membuka kunci invoice agar bisa dihapus, jangan lakukan ini — terbitkan dokumen pengganti.",
  },
  {
    key: "reporting-reason",
    message: "Isi alasan penurunan status pelaporan pajak.",
    meaning: "Admin menurunkan status pelaporan tanpa menuliskan alasan.",
    action: "Tulis alasan yang bermakna, minimal 10 karakter, misalnya SPT masa yang sama sedang dikoreksi. Alasan itu masuk ke jejak audit.",
  },
  {
    key: "system-transaction",
    message: "Transaksi otomatis harus diperbarui dari dokumen asal atau rekonsiliasi bank.",
    meaning: "Baris ini dicatat aplikasi dari invoice, pembayaran vendor, belanja proyek, setoran pajak, bagi hasil, atau mutasi bank. Buku Kas hanya menyunting baris yang memang diketik manusia.",
    action: "Buka dokumen sumbernya dan perbaiki di sana — void pembayarannya, lalu catat ulang dengan angka yang benar.",
  },
  {
    key: "transaction-reconciled",
    message: "Transaksi ini sudah dicocokkan dengan mutasi bank. Lepaskan rekonsiliasinya terlebih dahulu.",
    meaning: "Sebuah baris mutasi menunjuk transaksi ini sebagai pasangannya, jadi mengubah atau menghapusnya akan merusak rekonsiliasi.",
    action: "Buka Pembukuan, bagian Rekening perusahaan, kecualikan atau cocokkan ulang mutasinya, baru sunting atau hapus transaksinya.",
  },
  {
    key: "validation-stale",
    message: "BoQ paket ini berubah setelah checklist validasi diselesaikan.",
    meaning: "Ada item Perangkat atau Material baru, biasanya dari Addendum, yang tidak pernah tercakup dalam daftar pemeriksaan yang sudah ditandatangani.",
    action: "Buka Validasi Perangkat, sinkronkan daftarnya, periksa item baru di lokasi, centang seluruhnya, lalu selesaikan validasi sekali lagi sebelum menerbitkan BAST.",
  },
  {
    key: "boq-below-invoiced",
    message: "Nilai BoQ tidak boleh lebih kecil dari total Invoice yang sudah diterbitkan.",
    meaning: "Perubahan yang Anda simpan akan membuat nilai paket lebih kecil daripada jumlah yang sudah ditagihkan ke klien.",
    action: "Hapus atau perbaiki dulu invoice terminnya selama belum ada pembayarannya, baru turunkan nilai BoQ-nya.",
  },
  {
    key: "auth-rate-limited",
    message: "Terlalu banyak percobaan. Tunggu beberapa menit sebelum mencoba lagi.",
    meaning: "Terlalu banyak percobaan masuk atau permintaan pemulihan yang gagal dalam waktu singkat, entah dari perangkat Anda atau terhadap alamat email Anda. Penahanan ini melindungi akun dari penebakan kata sandi.",
    action: "Tunggu beberapa menit lalu coba lagi; penahanan berakhir dengan sendirinya dan tidak ada akun yang terkunci permanen. Bila Anda tidak merasa mencoba masuk berkali-kali, segera ganti kata sandi setelah bisa masuk kembali dan beri tahu Admin.",
  },
  {
    key: "email-confirmation",
    message: "Tautan konfirmasi email tidak valid atau sudah kedaluwarsa.",
    meaning: "Tautan konfirmasi penggantian alamat email hanya berlaku 60 menit dan hanya sekali pakai. Tautan juga hangus bila ada permintaan penggantian yang lebih baru atau bila kata sandi akun telah diatur ulang.",
    action: "Buka Profil Saya dan ajukan penggantian alamat email sekali lagi agar tautan baru dikirim ke alamat yang dituju. Selama tautannya belum dibuka, akun tetap memakai alamat lama dan alamat lama itu sudah diberi tahu bahwa ada permintaan penggantian.",
  },
  {
    key: "rounding-too-large",
    message: "Pembulatan khusus maksimal Rp ... untuk nilai ini.",
    meaning: "Selisih pembulatan yang Anda ketik lebih besar daripada yang masih masuk akal disebut pembulatan: batasnya Rp 100.000 atau 1% dari nilai sebelum pembulatan, mana yang lebih besar.",
    action: "Bila memang bermaksud memotong harga, isi kolom Diskon; bila menambah biaya, gunakan aturan pajak Tambah. Keduanya tercetak apa adanya di PDF dan ikut terbawa ke invoice, sedangkan pembulatan tidak dimaksudkan untuk itu.",
  },
  {
    key: "project-value-derived",
    message: "Nilai proyek ini mengikuti Quotation yang sudah diterima klien dan tidak dapat diketik manual.",
    meaning: "Proyek ini sudah punya penawaran berstatus Diterima, jadi nilainya diturunkan dari kontrak dan bukan lagi angka yang diketik.",
    action: "Kosongkan kembali kolom Nilai ke angka semula. Bila nilai kontraknya memang berubah, buat Addendum; nilai proyek akan menyesuaikan sendiri begitu addendum itu diterima klien.",
  },
  {
    key: "validation-locked-by-bast",
    message: "Checklist ini sudah menjadi dasar BAST yang diterbitkan.",
    meaning: "Daftar pemeriksaan Perangkat dan Material ini sudah dipakai untuk memfinalisasi BAST, jadi centang dan statusnya terkunci.",
    action: "Bila daftarnya memang perlu diperiksa ulang, minta Admin mencabut BAST-nya lebih dulu, lalu sinkronkan dan centang ulang daftar pemeriksaannya.",
  },
  {
    key: "approval-required",
    message: "Dokumen harus sudah disetujui dan dikirim ke vendor sebelum dibayar.",
    meaning: "Dokumen masih berstatus Disetujui: keputusan internal sudah selesai, tetapi vendor belum menerima dokumennya.",
    action: "Tekan Kirim pada dokumen tersebut, lalu ulangi pembayarannya. Pesan senada muncul pada Selesaikan, dan dokumen yang sudah Selesai tidak dapat diselesaikan untuk kedua kalinya.",
  },
  {
    key: "advance-already-used",
    message: "Uang muka ini sudah terpakai atau sebagian sudah dikembalikan, jadi tidak dapat dibatalkan.",
    meaning: "Pembatalan uang muka hanya untuk pencairan yang murni salah catat dan belum tersentuh. Uang muka ini sudah punya catatan penyelesaian.",
    action: "Gunakan Pengembalian uang muka untuk menutup sisa saldonya. Bila pencairannya sudah cocok dengan mutasi bank, pengembalian memang satu-satunya jalan, karena uangnya benar-benar keluar.",
  },
  {
    key: "legacy-invoice-payment",
    message: "Endpoint konfirmasi pembayaran lama sudah tidak berlaku.",
    meaning: "Sebuah alat atau integrasi lama masih memanggil jalur penandaan Lunas versi lawas, yang menandai invoice lunas tanpa referensi dan tanpa bukti pembayaran yang sesungguhnya.",
    action: "Catat pembayarannya lewat histori pembayaran pada invoice, yang meminta nominal, tanggal, referensi, metode, dan bukti transfer. Pembatalannya juga ada di sana dan otomatis mencatat pembalik kasnya.",
  },
];

const messagesEn: MessageGuide[] = [
  {
    key: "accepted-required",
    message: "Installment invoices can only be created from a quotation the client has accepted.",
    meaning: "The quotation is not Accepted yet, so there is no contract value to bill against.",
    action: "Open Quotations & Invoices, mark the quotation as sent, then press Client accept and upload the proof. A similar message about accepting the package quotation first means the selected package has no accepted quotation at all.",
  },
  {
    key: "expired",
    message: "The quotation has expired and its validity must be extended by an Admin or Finance before it can be accepted.",
    meaning: "The Valid until date on the quotation has passed.",
    action: "Ask an Admin or Finance user to press Edit on the quotation and extend the Valid until date, then repeat Client accept.",
  },
  {
    key: "installment-cap",
    message: "The installments add up to more than 100%; the remaining share is shown in the message.",
    meaning: "The percentage you entered would bill more than the contract value.",
    action: "Enter the remaining percentage quoted in the message, or first delete the incorrect installment invoice while it still has no payment.",
  },
  {
    key: "accepted-locked",
    message: "A client-accepted quotation is locked and cannot be changed.",
    meaning: "A quotation the client has approved may not be edited any more.",
    action: "Open Procurement & Vendors, Quotation & Addendum tab, create an Addendum, and handle the extra work there.",
  },
  {
    key: "not-earned",
    message: "The amount exceeds what has been earned; record progress verification or a goods receipt first.",
    meaning: "After the down payment, later terms are only payable once the work has been evidenced.",
    action: "For a Work Order, ask a Project Manager or Engineer to record Progress verification. For a PO, ask them to record a Goods receipt. Then record the payment again.",
  },
  {
    key: "self-approval",
    message: "Finance may not approve a draft it created or submitted itself.",
    meaning: "The person who submits a document and the person who approves it must be different.",
    action: "Ask an Admin or another Finance user to approve it. An Admin who has to approve their own submission must write a reason.",
  },
  {
    key: "self-approval-expense",
    message: "Finance may not approve an expense it created, submitted, or paid for itself.",
    meaning: "Finance only approves other people's spending; whoever spends is not whoever approves.",
    action: "Ask an Admin or another Finance user to verify that submission. An Admin who has to approve their own submission must write a reason, and that reason is recorded in the audit log.",
  },
  {
    key: "validation-required",
    message: "Complete the Device and Material validation before issuing the handover certificate.",
    meaning: "A handover certificate may only be issued after the site inspection is finished.",
    action: "Open Device Validation for the same package, tick every item, then press Complete validation.",
  },
  {
    key: "validation-incomplete",
    message: "Check every Device and Material before completing validation.",
    meaning: "Some items on the checklist are still unticked.",
    action: "Work down the list from top to bottom. Items with problems still have to be inspected; record the finding in the notes column so it is on file.",
  },
  {
    key: "signatures",
    message: "Client and PerumNet signatures are required before finalization.",
    meaning: "One of the signature panels on the handover certificate is still empty.",
    action: "Ask the client's representative to sign in the Client panel and the PerumNet representative to sign in the PerumNet panel, then finalize again.",
  },
  {
    key: "seal",
    message: "Enable and upload the company seal before finalizing the handover certificate.",
    meaning: "The company seal has not been configured, and it is the seal that marks a document as final.",
    action: "Ask an Admin to open the seal settings in Digital Handover, upload the seal image (PNG, JPG, or WebP up to 2 MB), fill in the signer's name and title, and switch it on.",
  },
  {
    key: "category-in-use",
    message: "The category already has items; deactivate it instead so the history stays intact.",
    meaning: "The category is still used by other items, so deleting it would damage older records.",
    action: "Set the category to inactive. An inactive category no longer appears when adding new items, but existing documents remain fully readable.",
  },
  {
    key: "ai-not-configured",
    message: "The AI assistant is not configured on this server yet.",
    meaning: "The catalog AI assistant has not been switched on for this installation.",
    action: "Ask your system Admin to install the AI service key. In the meantime, add catalog items manually in the Item Database.",
  },
  {
    key: "ai-limits",
    message: "The limit of 20 AI analyses per user per day has been reached.",
    meaning: "Your daily AI quota is used up. A related message, at most two AI analyses can run at the same time, means one is still finishing.",
    action: "Wait for the running analysis to finish, try again tomorrow, or ask an Admin or Finance colleague to run it. Adding items manually always works.",
  },
  {
    key: "ai-expired",
    message: "The recommendation is older than seven days. Refresh the analysis or provide an override reason.",
    meaning: "The AI draft is old enough that its prices may no longer hold.",
    action: "Run the analysis again for fresh data, or enter an override reason of at least five characters if the old pricing is still valid.",
  },
  {
    key: "invoice-history",
    message: "An invoice with payment history cannot be deleted. Void the payment instead.",
    meaning: "The invoice has already been paid, so deleting it would corrupt the books.",
    action: "Open the invoice payment window, press Void latest payment, and give a reason. Once no payments remain, the invoice can be edited or deleted.",
  },
  {
    key: "quotation-terminal",
    message: "That quotation status change does not follow the workflow.",
    meaning: "You are trying to reactivate a quotation that is already Void, Rejected, or Superseded. All three are terminal.",
    action: "Raise a new quotation for that work. The old one stays as history and cannot be returned to Draft or Sent.",
  },
  {
    key: "quotation-paid-invoice",
    message: "The quotation cannot be voided because its invoice has already received a payment.",
    meaning: "Client money has already arrived on the strength of this quotation, so voiding it would remove the basis of the billing.",
    action: "Void the payment first, delete the invoice if it really is wrong, and only then void the quotation. While the invoice still exists, the application refuses with the message that the quotation already has an invoice.",
  },
  {
    key: "project-financial-history",
    message: "This project already has recorded cash, so it cannot be deleted.",
    meaning: "A payment, an expense settlement, a tax settlement, or a Finance transaction is attached to this project.",
    action: "Do not delete the project. Close or archive it: set its status to Completed and leave its documents and books intact. Deletion is only available for a project that has never touched money.",
  },
  {
    key: "reconciled",
    message: "Detach the bank reconciliation before voiding.",
    meaning: "This transaction is already matched to a bank statement entry.",
    action: "Open Finance, find the statement entry matched to it, unmatch it, then void again.",
  },
  {
    key: "duplicate",
    message: "A possible duplicate record was found.",
    meaning: "Another receipt or payment has a similar date, merchant, and amount.",
    action: "Check the document number quoted in the warning. If it really is a different purchase, submit again and confirm the warning. If it is the same one, cancel the submission.",
  },
  {
    key: "attachment-required",
    message: "Upload at least one receipt or invoice before submitting.",
    meaning: "An expense cannot be sent to Finance without evidence.",
    action: "Attach a photo or PDF of the receipt — up to 10 MB per file and at most five files — then press Send to Finance.",
  },
  {
    key: "profit-unsafe",
    message: "Profit is not safe to distribute once unpaid vendor commitments are taken into account.",
    meaning: "After deducting outstanding obligations there is no profit left to share.",
    action: "Settle the outstanding vendor payments, tax payables, and reimbursements, or lower the share percentages.",
  },
  {
    key: "statement",
    message: "The statement period or account number in the PDF does not match the one selected.",
    meaning: "The uploaded file does not belong to the month or the bank account you selected.",
    action: "Make sure the selected month and account match the file. Use the original e-statement with selectable text, not a scan or a screenshot.",
  },
  {
    key: "session",
    message: "Your eight-hour session has expired. / Your account is not authorized to perform this action.",
    meaning: "The first message means your 8-hour session ended. The second means your menu permissions are not sufficient.",
    action: "Sign in again for the first message. For the second, ask an Admin to review your permissions in Users & Access.",
  },
  {
    key: "expense-report",
    message: "The project expense report needs at least View on Finance.",
    meaning: "You may open Project Expenses and record receipts, but downloading its report is a cross-project financial document. A default Engineer's permissions do not cover it.",
    action: "Ask an Admin or Finance for the report, or ask an Admin to raise your Finance permission to View if you genuinely need to download it yourself.",
  },
  {
    key: "procurement-source",
    message: "Work Orders and POs may only use items from an accepted quotation together with its proof of approval.",
    meaning: "Vendor documents always originate from work the client has already approved.",
    action: "Finish Client accept on the relevant quotation or addendum first, including the date and the proof of approval.",
  },
  {
    key: "legacy-spk",
    message: "Work orders can only be read here; use the Procurement screen.",
    meaning: "An old screen or integration tried to create, change, pay, or delete a Work Order outside the Procurement & Vendors screen. That old route used to record vendor payments twice.",
    action: "Do the whole cycle on Procurement & Vendors: Create, Submit, Approve, Send, Verify, Pay, then Complete. Reading a Work Order and downloading its PDF still works from anywhere.",
  },
  {
    key: "package-not-active",
    message: "The package is Completed or Void, so it cannot take new documents.",
    meaning: "The selected commercial package has been retired. Only an Active package accepts a new BoQ, quotation, invoice, validation, certificate, or addendum.",
    action: "Choose another package at the top of the screen, or reactivate a Completed one with the status button beside the package picker. A Void package can never be revived — create a new package if the work really continues. The documents already on it stay readable and downloadable.",
  },
  {
    key: "package-status",
    message: "That package status change does not follow the workflow.",
    meaning: "You are trying to reactivate a package that is already Void. Void is terminal.",
    action: "Create a new commercial package for that work. The old one stays with all of its documents as history.",
  },
  {
    key: "reporting-downgrade",
    message: "Tax reporting only moves forward; only an Admin can walk it back, with a recorded reason.",
    meaning: "This tax position has already been reported and you are trying to return it to an earlier status or void it.",
    action: "If the return genuinely needs correcting, ask an Admin to lower the status while stating a reason; the filing date and filer are kept either way. If the goal is merely to unlock the invoice for deletion, do not do this — issue a replacement document instead.",
  },
  {
    key: "reporting-reason",
    message: "State a reason for lowering the tax reporting status.",
    meaning: "An Admin is lowering a reporting status without writing a reason.",
    action: "Write a meaningful reason of at least 10 characters, for example that the return is being corrected for the same period. The reason lands in the audit trail.",
  },
  {
    key: "system-transaction",
    message: "This cash entry was posted by a source document; change it there.",
    meaning: "The application posted this line from an invoice, a vendor payment, a project expense, a tax settlement, a profit share, or a bank statement. The Cash Ledger only edits lines a human typed in.",
    action: "Open the source document and fix it there — void the payment, then record it again with the correct figures.",
  },
  {
    key: "transaction-reconciled",
    message: "This entry is already matched to a bank statement line; release the reconciliation first.",
    meaning: "A statement line points at this transaction as its counterpart, so changing or deleting it would break the reconciliation.",
    action: "Open Finance, the Company banking section, exclude or re-match that entry, and only then edit or delete the transaction.",
  },
  {
    key: "validation-stale",
    message: "This package's BoQ changed after the checklist was completed.",
    meaning: "New Device or Material items, usually from an Addendum, were never covered by the checklist that was signed off.",
    action: "Open Device Validation, re-sync the list, inspect the new items on site, tick them all, and complete the validation once more before issuing the certificate.",
  },
  {
    key: "boq-below-invoiced",
    message: "The BoQ may not fall below the invoices already issued.",
    meaning: "The change you are saving would make the package worth less than what has already been billed to the client.",
    action: "Delete or correct the installment invoices first while they still have no payments, and only then reduce the BoQ value.",
  },
  {
    key: "auth-rate-limited",
    message: "Too many attempts. Wait a few minutes before trying again.",
    meaning: "Too many failed sign-in attempts or recovery requests in a short time, either from your device or against your email address. The hold protects the account from password guessing.",
    action: "Wait a few minutes and try again; the hold expires on its own and no account is locked permanently. If those attempts were not yours, change your password as soon as you can sign in again and tell your Admin.",
  },
  {
    key: "email-confirmation",
    message: "This email confirmation link is invalid or has already expired.",
    meaning: "An email change confirmation link is valid for 60 minutes and only once. It also lapses if a newer change was requested or if the account password was reset.",
    action: "Open My Profile and request the email address change again so a fresh link is sent to the intended address. Until the link is opened the account keeps its old address, and that old address has already been notified that a change was requested.",
  },
  {
    key: "rounding-too-large",
    message: "The message names the maximum custom rounding allowed for this value.",
    meaning: "The adjustment you typed is larger than anything that could still be called a rounding: the limit is Rp 100,000 or 1% of the value before rounding, whichever is larger.",
    action: "If you meant to reduce the price, use the Discount field; if you meant to add a charge, use an Add-effect tax rule. Both print for what they are on the PDF and carry through to the invoices, which is not what rounding is for.",
  },
  {
    key: "project-value-derived",
    message: "This project's value follows its client-accepted quotation and cannot be typed in by hand.",
    meaning: "This project already has an Accepted quotation, so its value is derived from the contract instead of typed.",
    action: "Put the Value field back to its previous figure. If the contract value genuinely changed, create an Addendum; the project value updates itself once the client accepts it.",
  },
  {
    key: "validation-locked-by-bast",
    message: "This checklist is the evidence behind an issued handover certificate.",
    meaning: "This Device and Material checklist was used to finalize a handover certificate, so its ticks and its status are locked.",
    action: "If the checklist genuinely needs redoing, ask an Admin to revoke the certificate first, then re-sync and re-check the list.",
  },
  {
    key: "approval-required",
    message: "The document must be approved and sent to the vendor before it can be paid.",
    meaning: "The document is still at Approved: the internal decision is done, but the vendor has not received the document.",
    action: "Press Send on the document, then repeat the payment. A matching message appears for Complete, and a document already Completed cannot be completed a second time.",
  },
  {
    key: "advance-already-used",
    message: "This advance has already been spent or partly returned, so it cannot be voided.",
    meaning: "Voiding an advance is only for a disbursement recorded purely in error and never touched. This one already has settlement records.",
    action: "Use Advance return to close the remaining balance. If the disbursement is already matched to a bank entry, a return is the only route, because the money genuinely left.",
  },
  {
    key: "legacy-invoice-payment",
    message: "The old payment-confirmation endpoint has been retired.",
    meaning: "An old tool or integration is still calling the legacy mark-as-paid route, which marked an invoice paid with no reference and no real payment evidence.",
    action: "Record the payment through the invoice payment history, which asks for the amount, date, reference, method, and transfer proof. Its void action lives there too and posts the reversing cash entry automatically.",
  },
];

const glossaryId: GlossaryEntry[] = [
  { term: "BoQ (Bill of Quantity)", meaning: "Daftar rinci pekerjaan dan barang beserta jumlah dan harganya. BoQ menjadi dasar penawaran, dokumen vendor, dan daftar pemeriksaan lapangan." },
  { term: "Quotation", meaning: "Surat penawaran harga yang dikirim ke klien." },
  { term: "Addendum", meaning: "Penawaran tambahan untuk pekerjaan yang muncul setelah penawaran awal disetujui klien." },
  { term: "Paket komersial", meaning: "Kelompok pekerjaan yang dijual sebagai satu kesatuan. Satu proyek boleh punya beberapa paket, masing-masing dengan BoQ, penawaran, invoice, dan BAST sendiri." },
  { term: "Termin", meaning: "Bagian dari nilai kontrak yang ditagih atau dibayar bertahap, misalnya DP 30% lalu pelunasan 70%." },
  { term: "Invoice", meaning: "Dokumen penagihan resmi kepada klien." },
  { term: "SPK (Surat Perintah Kerja)", meaning: "Perintah kerja untuk vendor jasa, misalnya pemasangan atau mobilitas." },
  { term: "PO (Purchase Order)", meaning: "Pesanan pembelian untuk vendor barang, yaitu perangkat atau material." },
  { term: "BAST (Berita Acara Serah Terima)", meaning: "Dokumen yang menyatakan pekerjaan sudah selesai, diperiksa bersama, dan diserahkan kepada klien." },
  { term: "Cap digital", meaning: "Cap perusahaan yang dibubuhkan aplikasi saat BAST difinalisasi, disertai QR untuk memeriksa keaslian dokumen. Ini cap internal PerumNet, bukan tanda tangan elektronik tersertifikasi." },
  { term: "PPN (pajak Tambah)", meaning: "Pajak yang ditambahkan di atas nilai pekerjaan sehingga tagihan klien bertambah." },
  { term: "PPh (pajak Potong)", meaning: "Pajak yang dipotong klien saat membayar. Tagihan tidak berkurang, tetapi uang yang masuk ke rekening menjadi lebih kecil." },
  { term: "Total tagihan klien", meaning: "Subtotal − diskon + pajak Tambah ± pembulatan. Inilah angka yang tertera pada penawaran dan invoice." },
  { term: "Kas bersih", meaning: "Total tagihan klien dikurangi pajak Potong. Inilah uang yang benar-benar masuk ke rekening perusahaan." },
  { term: "Uang muka proyek", meaning: "Dana yang dicairkan lebih dulu untuk belanja lapangan. Nota yang memakainya hanya mengurangi saldo uang muka, tidak membuat kas keluar lagi." },
  { term: "Reimbursement", meaning: "Penggantian uang pribadi pegawai yang dipakai untuk keperluan proyek." },
  { term: "Rekonsiliasi", meaning: "Mencocokkan catatan di aplikasi dengan mutasi rekening bank supaya satu kejadian kas hanya tercatat sekali." },
  { term: "Void", meaning: "Pembatalan yang tidak menghapus data, melainkan membuat catatan pembalik agar jejaknya tetap lengkap." },
  { term: "Laba aman dibagikan", meaning: "Laba kas setelah dikurangi komitmen vendor yang belum dibayar, utang pajak, dan utang reimbursement." },
];

const glossaryEn: GlossaryEntry[] = [
  { term: "BoQ (Bill of Quantity)", meaning: "The itemized list of work and goods with quantities and prices. The BoQ drives the quotation, the vendor documents, and the site checklist." },
  { term: "Quotation", meaning: "The priced offer sent to the client." },
  { term: "Addendum", meaning: "An additional quotation for work that appears after the client accepted the original offer." },
  { term: "Commercial package", meaning: "A group of work sold as one unit. A project may have several packages, each with its own BoQ, quotation, invoices, and handover certificate." },
  { term: "Installment (termin)", meaning: "A staged portion of the contract value that is billed or paid separately, for example 30% up front and 70% on completion." },
  { term: "Invoice", meaning: "The formal billing document sent to the client." },
  { term: "SPK (Work Order)", meaning: "A work order issued to a service vendor, for example for installation or mobility work." },
  { term: "PO (Purchase Order)", meaning: "A purchase order issued to a goods vendor, for devices or materials." },
  { term: "BAST (handover certificate)", meaning: "The document confirming that the work is finished, jointly inspected, and handed over to the client." },
  { term: "Digital seal", meaning: "The company seal the app applies when a handover certificate is finalized, together with a QR code for checking the document. It is PerumNet's own internal seal, not a certified electronic signature." },
  { term: "Added tax (VAT)", meaning: "Tax added on top of the work value, which increases the client's bill." },
  { term: "Withheld tax (income tax)", meaning: "Tax the client deducts when paying. The bill itself does not go down, but less money reaches the bank account." },
  { term: "Total billed to the client", meaning: "Subtotal − discount + added tax ± rounding. This is the figure printed on the quotation and the invoice." },
  { term: "Net cash", meaning: "The total billed minus withheld tax. This is what actually arrives in the company bank account." },
  { term: "Project advance", meaning: "Money released up front for field purchases. A receipt charged to it only reduces the advance balance and never posts cash out again." },
  { term: "Reimbursement", meaning: "Paying back an employee who used their own money for project needs." },
  { term: "Reconciliation", meaning: "Matching the app's records against the bank statement so that one cash event is recorded only once." },
  { term: "Void", meaning: "A cancellation that does not delete data but posts a reversing entry, so the trail stays complete." },
  { term: "Safe distributable profit", meaning: "Cash profit after deducting unpaid vendor commitments, tax payables, and reimbursement payables." },
];

const content = {
  id: { workflows: workflowsId, messages: messagesId, glossary: glossaryId },
  en: { workflows: workflowsEn, messages: messagesEn, glossary: glossaryEn },
};

function matches(needle: string, ...fields: Array<string | string[]>) {
  if (!needle) return true;
  return fields
    .flat()
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

// How long `.help-guide-backdrop.is-closing` runs, plus a frame of slack. The
// exit normally ends on `animationend`; this is the safety net for the cases
// that never fire one — a background tab, or a browser that honours
// `prefers-reduced-motion` by dropping the animation rather than shortening it.
const GUIDE_EXIT_FALLBACK_MS = 320;

export function HelpView({ language }: HelpViewProps) {
  const [query, setQuery] = useState("");
  // The guide opens in the shared modal rather than expanding in place: an
  // open `<details>` made its grid column run far past its neighbour, and no
  // amount of tidying fixes a two-column grid with one tall cell in it.
  const [activeGuide, setActiveGuide] = useState<WorkflowGuide | null>(null);
  const [closingGuide, setClosingGuide] = useState(false);
  // The card that opened the dialog, so focus can go back to it on close
  // instead of falling to the top of the document.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const id = language === "id";
  const needle = query.trim().toLowerCase();
  const { workflows, messages, glossary } = content[language];

  const visibleWorkflows = useMemo(
    () =>
      workflows.filter((workflow) =>
        matches(needle, workflow.title, workflow.summary, workflow.who, workflow.where, workflow.prepare, workflow.steps, workflow.after),
      ),
    [needle, workflows],
  );
  const visibleMessages = useMemo(
    () => messages.filter((entry) => matches(needle, entry.message, entry.meaning, entry.action)),
    [needle, messages],
  );
  const visibleGlossary = useMemo(
    () => glossary.filter((entry) => matches(needle, entry.term, entry.meaning)),
    [needle, glossary],
  );
  const anyResult =
    visibleWorkflows.length > 0 || visibleMessages.length > 0 || visibleGlossary.length > 0;

  // Closing is a two-step: flag the dialog so the exit animation can play, then
  // drop it once the animation reports it is finished. Unmounting on the click
  // would make a dialog that fades in vanish on the way out.
  const closeGuide = useCallback(() => setClosingGuide(true), []);
  const dropGuide = useCallback(() => {
    setActiveGuide(null);
    setClosingGuide(false);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, []);

  function openGuide(workflow: WorkflowGuide, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setClosingGuide(false);
    setActiveGuide(workflow);
  }

  // Escape closes it, like every other modal in the app.
  useEffect(() => {
    if (!activeGuide) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeGuide();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeGuide, closeGuide]);

  // Move focus into the dialog so Tab walks the guide, not the page behind it.
  useEffect(() => {
    if (!activeGuide) return;
    dialogRef.current?.focus();
  }, [activeGuide]);

  useEffect(() => {
    if (!closingGuide) return;
    const timer = window.setTimeout(dropGuide, GUIDE_EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closingGuide, dropGuide]);

  async function downloadSop() {
    await downloadApiFile(
      `/api/help/sop.pdf?language=${language}`,
      id
        ? "SOP-Lengkap-PerumNet-Enterprise.pdf"
        : "PerumNet-Enterprise-Complete-SOP.pdf",
    );
  }

  return (
    <div className="page-stack help-page" data-testid="help-view">
      <section className="help-hero">
        <span className="metric-icon teal"><CircleHelp size={24} /></span>
        <span className="eyebrow">{id ? "PUSAT BANTUAN" : "HELP CENTER"}</span>
        <h1>{id ? "Apa yang ingin Anda kerjakan?" : "What do you need to get done?"}</h1>
        <p>{id
          ? "Panduan langkah demi langkah untuk pekerjaan sehari-hari di PerumNet Enterprise: menyiapkan penawaran, menagih klien, membayar vendor, serah terima, dan menutup pembukuan."
          : "Step-by-step guidance for everyday work in PerumNet Enterprise: preparing quotations, billing clients, paying vendors, handing over on site, and closing the books."}</p>
        <label className="help-search"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={id ? "Cari langkah, pesan kesalahan, atau istilah..." : "Search steps, error messages, or terms..."} /></label>
      </section>

      {visibleWorkflows.length > 0 && (
        <>
          <div className="help-section-head">
            <span className="metric-icon blue"><BookOpenCheck size={19} /></span>
            <div>
              <h2>{id ? "Alur kerja langkah demi langkah" : "Step-by-step workflows"}</h2>
              <p>{id
                ? "Buka satu bagian untuk melihat siapa yang boleh mengerjakan, menu mana yang dipakai, apa yang perlu disiapkan, dan apa yang terkunci sesudahnya."
                : "Open a section to see who may do it, which menu to use, what to prepare, and what gets locked afterwards."}</p>
            </div>
          </div>
          <section className="help-guide-grid">
            {visibleWorkflows.map((workflow) => {
              const Icon = workflow.icon;
              return (
                // Every card is the same shape and the same height whatever the
                // reader has open, because nothing expands here any more.
                <button
                  className="panel help-guide-card"
                  type="button"
                  key={workflow.key}
                  aria-haspopup="dialog"
                  onClick={(event) => openGuide(workflow, event.currentTarget)}
                >
                  <span className="help-guide-card-head">
                    <span className="metric-icon blue"><Icon size={19} /></span>
                    <strong>{workflow.title}</strong>
                  </span>
                  <span className="help-guide-card-summary">{workflow.summary}</span>
                  <span className="help-guide-card-cue">{id ? "Buka panduan" : "Open guide"}<ChevronRight size={15} /></span>
                </button>
              );
            })}
          </section>
        </>
      )}

      {visibleMessages.length > 0 && (
        <>
          <div className="help-section-head">
            <span className="metric-icon orange"><TriangleAlert size={19} /></span>
            <div>
              <h2>{id ? "Kalau muncul pesan ini" : "If you see this message"}</h2>
              <p>{id
                ? "Pesan berikut muncul ketika aplikasi menolak menyimpan sesuatu. Semuanya bukan kerusakan, melainkan pengaman agar dokumen dan pembukuan tetap benar."
                : "These messages appear when the app refuses to save something. None of them mean a fault: they are safeguards that keep the documents and the books correct. Some screens still show the Indonesian wording."}</p>
            </div>
          </div>
          <section className="help-message-grid">
            {visibleMessages.map((entry) => (
              <article className="panel help-message" key={entry.key}>
                <strong>&ldquo;{entry.message}&rdquo;</strong>
                <span>{entry.meaning}</span>
                <small><b>{id ? "Yang perlu dilakukan: " : "What to do: "}</b>{entry.action}</small>
              </article>
            ))}
          </section>
        </>
      )}

      {visibleGlossary.length > 0 && (
        <>
          <div className="help-section-head">
            <span className="metric-icon green"><BookMarked size={19} /></span>
            <div>
              <h2>{id ? "Istilah yang sering dipakai" : "Terms you will meet"}</h2>
              <p>{id
                ? "Penjelasan singkat untuk istilah yang muncul di layar dan pada dokumen PDF."
                : "Short explanations of the terms that appear on screen and in the PDF documents."}</p>
            </div>
          </div>
          <section className="panel help-glossary-panel">
            <dl className="help-glossary">
              {visibleGlossary.map((entry) => (
                <div key={entry.term}>
                  <dt>{entry.term}</dt>
                  <dd>{entry.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}

      {!anyResult && (
        <section className="panel empty-state">
          <Search size={28} />
          <h3>{id ? "Tidak ada yang cocok" : "Nothing matched"}</h3>
          <p>{id ? "Coba kata kunci yang lebih singkat, misalnya “invoice”, “vendor”, atau “BAST”." : "Try a shorter search term such as “invoice”, “vendor”, or “handover”."}</p>
        </section>
      )}

      <section className="help-support panel">
        <div><span className="metric-icon green"><ShieldCheck size={20} /></span><span><strong>{id ? "Panduan operasional lengkap" : "Complete operations guide"}</strong><small>{id ? "Unduh SOP proyek, dokumen, keuangan, rekonsiliasi, pembagian laba, dan hak akses." : "Download the SOP for projects, documents, finance, reconciliation, profit sharing, and access control."}</small></span></div>
        <div className="title-actions">
          <button className="button primary" type="button" onClick={downloadSop}><Download size={16} /> {id ? "Unduh SOP PDF" : "Download SOP PDF"}</button>
          <a className="button secondary" href="mailto:it@perumnet.id">{id ? "Email dukungan" : "Email support"}</a>
        </div>
      </section>

      {activeGuide && (
        <div
          className={`modal-backdrop help-guide-backdrop${closingGuide ? " is-closing" : ""}`}
          role="presentation"
          onMouseDown={closeGuide}
          // The exit ends here rather than on a timer, so the dialog leaves the
          // tree the moment the animation is actually done. Child animations
          // bubble, so only the backdrop's own run counts.
          onAnimationEnd={(event) => {
            if (closingGuide && event.target === event.currentTarget) dropGuide();
          }}
        >
          <section
            className="modal-card wide help-guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-guide-title"
            tabIndex={-1}
            ref={dialogRef}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">{id ? "ALUR KERJA" : "WORKFLOW"}</span>
                <h2 id="help-guide-title">{activeGuide.title}</h2>
              </div>
              <button className="icon-button" type="button" aria-label={id ? "Tutup" : "Close"} onClick={closeGuide}><X size={18} /></button>
            </div>
            <div className="help-guide-body">
              <p>{activeGuide.summary}</p>
              <dl>
                <div><dt>{id ? "Siapa" : "Who"}</dt><dd>{activeGuide.who}</dd></div>
                <div><dt>{id ? "Di mana" : "Where"}</dt><dd>{activeGuide.where}</dd></div>
                <div><dt>{id ? "Siapkan" : "Prepare"}</dt><dd>{activeGuide.prepare}</dd></div>
              </dl>
              <ol>
                {activeGuide.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <p className="help-outcome"><ShieldCheck size={15} /><span><strong>{id ? "Setelah itu: " : "Afterwards: "}</strong>{activeGuide.after}</span></p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
