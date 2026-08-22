import "server-only";

// Content model for the downloadable operations manual. Every string is a
// [Indonesian, English] pair so the same layout engine renders both editions.
// This file is deliberately data-only: sop-pdf.ts owns the layout.

export type Bilingual = [string, string];

export interface MetaRow {
  label: Bilingual;
  value: Bilingual;
}

export interface CalcRow {
  label: Bilingual;
  // Amounts are stored as plain numbers so the layout engine can format them
  // with the separators of the edition being printed. Use `text` for anything
  // that is not a rupiah figure, such as a percentage or a dash.
  amount?: number;
  text?: Bilingual;
  tone?: "normal" | "sub" | "total" | "muted";
}

export type Block =
  | { kind: "lead"; text: Bilingual }
  | { kind: "para"; text: Bilingual }
  | { kind: "heading"; text: Bilingual }
  | { kind: "meta"; rows: MetaRow[] }
  | { kind: "steps"; items: Bilingual[] }
  | { kind: "bullets"; items: Bilingual[] }
  | { kind: "locked"; text: Bilingual }
  | { kind: "pitfalls"; items: Bilingual[] }
  | { kind: "note"; title: Bilingual; text: Bilingual }
  | {
      kind: "table";
      widths: number[];
      head: Bilingual[];
      rows: Bilingual[][];
    }
  | { kind: "flow"; steps: Bilingual[] }
  // Gambar yang disiapkan server sebelum tata letak (lihat renderSopPdf):
  // bagan alur aplikasi yang sama persis dengan yang tampil di Pusat Bantuan.
  | { kind: "image"; source: "alur"; caption: Bilingual }
  | { kind: "calc"; title: Bilingual; rows: CalcRow[] }
  | { kind: "terms"; rows: MetaRow[] }
  | {
      kind: "messages";
      rows: Array<{ message: Bilingual; meaning: Bilingual; action: Bilingual }>;
    };

export interface Chapter {
  id: string;
  title: Bilingual;
  blocks: Block[];
}

const roleMatrix: Bilingual[][] = [
  [
    ["Dashboard", "Dashboard"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
    ["Lihat", "View"],
    ["Lihat", "View"],
  ],
  [
    ["Manajemen Proyek", "Project Management"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
  ],
  [
    ["Belanja Proyek", "Project Expenses"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
  ],
  [
    ["BoQ Generator (termasuk Database Item)", "BoQ Generator (includes Item Database)"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
    ["Kelola", "Manage"],
  ],
  [
    ["Quotation & Invoice", "Quotations & Invoices"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Tidak ada", "No access"],
    ["Kelola", "Manage"],
  ],
  [
    ["Procurement & Vendor", "Procurement & Vendors"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
    ["Kelola", "Manage"],
  ],
  [
    ["BAST Digital (termasuk Validasi Perangkat)", "Digital Handover (includes Device Validation)"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
  ],
  [
    ["Pembukuan", "Finance"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
    ["Tidak ada", "No access"],
    ["Kelola", "Manage"],
  ],
  [
    ["Laba & Bagi Hasil", "Profit & Profit Sharing"],
    ["Kelola", "Manage"],
    ["Tidak ada", "No access"],
    ["Tidak ada", "No access"],
    ["Kelola", "Manage"],
  ],
  [
    ["Calon Klien", "Prospects"],
    ["Kelola", "Manage"],
    ["Tidak ada", "No access"],
    ["Tidak ada", "No access"],
    ["Kelola", "Manage"],
  ],
  [
    ["Pengguna & Akses", "Users & Access"],
    ["Kelola", "Manage"],
    ["Tidak ada", "No access"],
    ["Tidak ada", "No access"],
    ["Tidak ada", "No access"],
  ],
  [
    ["Pengaturan", "Settings"],
    ["Kelola", "Manage"],
    ["Lihat", "View"],
    ["Lihat", "View"],
    ["Lihat", "View"],
  ],
];

const specialActions: Bilingual[][] = [
  [
    ["Mengubah tanggal, masa berlaku, diskon, pembulatan, dan pajak Quotation", "Changing a quotation's dates, validity, discount, rounding, and tax"],
    ["Admin atau Finance", "Admin or Finance"],
  ],
  [
    ["Menyetujui atau menolak SPK/PO", "Approving or rejecting a Work Order / PO"],
    ["Admin atau Finance. Finance tidak boleh menyetujui dokumen yang ia buat atau ajukan sendiri; Admin yang menyetujui pengajuannya sendiri wajib menulis alasan minimal 5 karakter.", "Admin or Finance. Finance may not approve a document it created or submitted itself; an Admin approving their own submission must write a reason of at least 5 characters."],
  ],
  [
    ["Verifikasi progres SPK dan penerimaan barang PO", "SPK progress verification and PO goods receipt"],
    ["Admin, Project Manager, atau Engineer yang menjadi anggota proyek. Izin Procurement & Vendor cukup Lihat, jadi Engineer bawaan langsung dapat mencatat verifikasi dan penerimaan barang tanpa perlu dinaikkan ke Kelola. Membuat, menyetujui, dan membayar dokumen tetap memerlukan Kelola. Finance tidak dapat melakukannya.", "Admin, Project Manager, or Engineer who is a member of the project. View on Procurement & Vendors is enough, so a default Engineer can record verification and goods receipt without being raised to Manage. Creating, approving, and paying documents still require Manage. Finance cannot do this."],
  ],
  [
    ["Mencatat pembayaran vendor dan pembayaran invoice klien", "Recording vendor payments and client invoice payments"],
    ["Admin atau Finance", "Admin or Finance"],
  ],
  [
    ["Memverifikasi (menyetujui/menolak) belanja proyek", "Verifying (approving/rejecting) project expenses"],
    ["Admin atau Finance dengan izin Pembukuan Kelola. Finance hanya menyetujui belanja orang lain: pengajuan yang ia buat, ajukan, atau talangi sendiri harus diverifikasi orang lain. Admin yang menyetujui pengajuannya sendiri wajib menulis alasan minimal 5 karakter yang tercatat di audit log.", "Admin or Finance with Manage on Finance. Finance only approves other people's spending: an expense they recorded, submitted, or paid for themselves must be verified by someone else. An Admin approving their own submission must write a reason of at least 5 characters, which is recorded in the audit log."],
  ],
  [
    ["Mencairkan uang muka proyek", "Disbursing a project advance"],
    ["Admin atau Finance. Penerima harus anggota proyek berperan Project Manager atau Engineer.", "Admin or Finance. The recipient must be a project member with the Project Manager or Engineer role."],
  ],
  [
    ["Void (pembatalan dengan catatan pembalik) atas pembayaran, belanja, settlement pajak, dan bagi hasil", "Voiding (cancelling with a reversing entry) payments, expenses, tax settlements, and profit shares"],
    ["Hanya Admin", "Admin only"],
  ],
  [
    ["Menambah, mengubah, atau menghapus rekening perusahaan", "Adding, changing, or deleting a company bank account"],
    ["Hanya Admin. Mengimpor dan mencocokkan mutasi boleh Admin atau Finance.", "Admin only. Importing and matching statement entries may be done by Admin or Finance."],
  ],
  [
    ["Mengatur cap perusahaan dan mencabut BAST final", "Configuring the company seal and revoking a final handover certificate"],
    ["Hanya Admin", "Admin only"],
  ],
  [
    ["Membuka angka laba proyek dan pembagian keuntungan", "Opening the project profit figures and profit sharing"],
    ["Izin Laba & Bagi Hasil minimal Lihat. Menyusun alokasi memerlukan Kelola pada Laba & Bagi Hasil sekaligus Kelola pada Pembukuan, dan tetap terbatas pada peran Admin atau Finance.", "At least View on Profit & Profit Sharing. Preparing an allocation requires Manage on both Profit & Profit Sharing and Finance, and is still limited to the Admin or Finance role."],
  ],
  [
    ["Menyetujui pembagian keuntungan", "Approving a profit share"],
    ["Hanya Admin", "Admin only"],
  ],
  [
    ["Mengaktifkan modul pajak dan mengelola master aturan pajak", "Enabling the tax module and managing the master tax rules"],
    ["Hanya Admin", "Admin only"],
  ],
  [
    ["Membuat akun, mengubah peran, dan mengatur hak akses", "Creating accounts, changing roles, and setting permissions"],
    ["Hanya Admin", "Admin only"],
  ],
  [
    ["Mengelola Database Item dan memakai AI Catalog Assistant", "Managing the Item Database and using the AI Catalog Assistant"],
    ["Admin atau Finance", "Admin or Finance"],
  ],
];

export const chapterRoles: Chapter = {
  id: "roles",
  title: ["Peran dan hak akses", "Roles and permissions"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Aplikasi memakai dua lapis izin. Lapis pertama adalah peran akun: Admin, Project Manager, Engineer, atau Finance. Lapis kedua adalah izin per modul yang disetel Admin untuk tiap orang: Tidak ada, Lihat, atau Kelola. Peran menentukan tindakan sensitif seperti persetujuan dan pembatalan; izin per modul menentukan menu mana yang boleh dibuka dan diubah.",
        "The application uses two layers of permission. The first is the account role: Admin, Project Manager, Engineer, or Finance. The second is the per-module permission an Admin sets for each person: No access, View, or Manage. The role governs sensitive actions such as approval and cancellation; the per-module permission governs which menus may be opened and changed.",
      ],
    },
    {
      kind: "para",
      text: [
        "Lihat berarti hanya membaca. Kelola berarti boleh menambah dan mengubah data pada modul itu. Tabel berikut adalah pengaturan bawaan yang dipakai aplikasi ketika sebuah akun dibuat atau perannya diganti. Admin dapat menaikkan atau menurunkan izin siapa pun setelah itu, kecuali izin Admin sendiri yang memang tidak dapat diturunkan.",
        "View means read-only. Manage means the person may add and change data in that module. The table below shows the defaults the application applies when an account is created or its role is changed. An Admin may raise or lower anyone's permissions afterwards, except an Admin's own permissions, which cannot be reduced.",
      ],
    },
    {
      kind: "table",
      widths: [64, 28.5, 28.5, 28.5, 28.5],
      head: [
        ["Modul", "Module"],
        ["Admin", "Admin"],
        ["Project Manager", "Project Manager"],
        ["Engineer", "Engineer"],
        ["Finance", "Finance"],
      ],
      rows: roleMatrix,
    },
    {
      kind: "note",
      title: ["Cakupan proyek", "Project scope"],
      text: [
        "Admin dan Finance selalu melihat seluruh proyek. Project Manager dan Engineer hanya melihat proyek tempat mereka terdaftar sebagai anggota. Proyek di luar akses tidak muncul sama sekali, dan membuka tautannya langsung akan dijawab dengan pesan data tidak ditemukan.",
        "Admin and Finance always see every project. Project Managers and Engineers only see projects they are members of. A project outside their access does not appear at all, and opening its link directly returns a not-found message.",
      ],
    },
    {
      kind: "heading",
      text: ["Tindakan yang dibatasi peran, bukan hanya izin modul", "Actions restricted by role, not only by module permission"],
    },
    {
      kind: "table",
      widths: [82, 96],
      head: [
        ["Tindakan", "Action"],
        ["Siapa yang boleh", "Who may do it"],
      ],
      rows: specialActions,
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Menaikkan peran seseorang akan mengembalikan seluruh izin modulnya ke pengaturan bawaan peran baru. Periksa ulang halaman Pengguna & Akses setelah mengganti peran.",
          "Changing someone's role resets all of their module permissions to the new role's defaults. Re-check the Users & Access page after every role change.",
        ],
        [
          "Belanja Proyek adalah modulnya sendiri. Jika seseorang tidak dapat mencatat nota, periksa izin Belanja Proyek-nya, bukan izin Manajemen Proyek maupun Pembukuan. Mengunduh laporan belanja (CSV atau PDF) memerlukan tambahan izin Pembukuan minimal Lihat, karena laporan itu memuat rekening perusahaan yang membayar dan utang reimbursement kepada tiap orang; Engineer bawaan karena itu mencatat nota tetapi tidak mengunduh laporannya.",
          "Project Expenses is its own module. If someone cannot record a receipt, check their Project Expenses permission — not Project Management and not Finance. Downloading the expense report (CSV or PDF) additionally requires View on Finance, because that report carries the company account that paid and the reimbursement owed to each person; a default Engineer therefore records receipts but does not download the report.",
        ],
        [
          "Angka laba mengikuti izin Laba & Bagi Hasil, bukan izin Pembukuan. Pembukuan Lihat membuka buku kas: kas masuk, kas keluar, dan mutasi proyek yang boleh diakses. Laba Bersih Dasar, Laba Ditahan, dan perbandingan Budget BoQ dengan Komitmen vendor hanya muncul pada laporan bila izin Laba & Bagi Hasil minimal Lihat. Project Manager dan Engineer bawaan tidak memilikinya; laporan kas mereka tetap dapat diunduh, hanya bagian labanya yang tidak ikut.",
          "The profit figures follow the Profit & Profit Sharing permission, not the Finance permission. View on Finance opens the cash ledger: cash in, cash out, and the entries of the projects the account may reach. Base Net Profit, Retained Profit, and BoQ budget against vendor commitment only appear in the report when Profit & Profit Sharing is at least View. A default Project Manager and Engineer do not have it; their cash report still downloads, only the profit sections are left out of it.",
        ],
        [
          "Menu Database Item hanya muncul untuk Admin dan Finance walaupun izin BoQ Generator sudah Kelola.",
          "The Item Database menu only appears for Admin and Finance even when the BoQ Generator permission is already set to Manage.",
        ],
        [
          "Admin tidak dapat menonaktifkan akunnya sendiri dan tidak dapat menurunkan izin Pengguna & Akses miliknya sendiri. Ini disengaja agar perusahaan tidak pernah terkunci di luar sistem.",
          "An Admin cannot deactivate their own account nor lower their own Users & Access permission. This is deliberate so the company can never be locked out of its own system.",
        ],
        [
          "Mengganti kata sandi seseorang, mengganti alamat email orang lain, atau menonaktifkan akunnya langsung mengakhiri seluruh sesi aktif orang tersebut.",
          "Changing someone's password, changing another person's email address, or deactivating their account immediately ends all of that person's active sessions.",
        ],
        [
          "Admin sekalipun tidak dapat mengganti alamat email akunnya sendiri secara langsung. Permintaan itu selalu menunggu konfirmasi dari alamat baru, persis seperti dari menu Profil Saya, agar sesi yang dicuri tidak pernah bisa memindahkan alamat pemulihan akun.",
          "Not even an Admin can change the email address of their own account directly. That request always waits for confirmation from the new address, exactly as it does from My Profile, so a stolen session can never move an account's recovery address.",
        ],
      ],
    },
  ],
};

export const chapterFlow: Chapter = {
  id: "flow",
  title: ["Alur kerja dari awal sampai penutupan", "The workflow from start to closeout"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Semua pekerjaan komersial mengikuti satu rantai yang sama. Setiap tahap mengunci tahap sebelumnya, sehingga angka pada dokumen tidak pernah berubah diam-diam di belakang dokumen yang sudah disepakati.",
        "All commercial work follows the same chain. Each stage locks the one before it, so the figures on a document never change quietly behind an agreement that has already been made.",
      ],
    },
    {
      kind: "image",
      source: "alur",
      caption: [
        "Bagan alur pemakaian aplikasi, dari calon klien sampai laba dan pajak. Gambar yang sama tampil di Pusat Bantuan; sumbernya satu (shared/alur-aplikasi.ts), jadi keduanya tidak bisa berbeda.",
        "The application flow chart, from prospect to profit and tax. The same picture appears in the Help Center; both come from one source (shared/alur-aplikasi.ts), so they cannot diverge.",
      ],
    },
    {
      kind: "flow",
      steps: [
        ["Proyek", "Project"],
        ["Paket komersial", "Commercial package"],
        ["BoQ", "BoQ"],
        ["Quotation (revisi)", "Quotation (revisions)"],
        ["Terima klien", "Client accept"],
        ["Invoice termin", "Installment invoices"],
        ["Pembayaran klien", "Client payment"],
        ["SPK / PO vendor", "Vendor SPK / PO"],
        ["Validasi perangkat", "Device validation"],
        ["BAST", "Handover certificate"],
        ["Penutupan proyek", "Project closeout"],
      ],
    },
    {
      kind: "para",
      text: [
        "Satu proyek boleh dijual dalam beberapa paket komersial. Setiap paket punya BoQ, Quotation, invoice, siklus validasi, dan BAST sendiri. Karena itu, di BoQ Generator, Quotation & Invoice, Validasi Perangkat, dan BAST Digital selalu ada pemilih paket di bagian atas layar. Salah memilih paket adalah penyebab paling umum dari angka yang terasa tidak cocok.",
        "One project may be sold as several commercial packages. Each package has its own BoQ, quotation, invoices, validation cycle, and handover certificate. That is why BoQ Generator, Quotations & Invoices, Device Validation, and Digital Handover always show a package picker at the top of the screen. Picking the wrong package is the most common reason figures appear not to match.",
      ],
    },
    {
      kind: "table",
      widths: [40, 68, 70],
      head: [
        ["Tahap", "Stage"],
        ["Yang dihasilkan", "What it produces"],
        ["Yang terkunci setelahnya", "What it locks"],
      ],
      rows: [
        [
          ["Proyek", "Project"],
          ["Nomor proyek, klien, lokasi, tanggal, penanggung jawab, dan daftar anggota tim.", "The project number, client, site, dates, person responsible, and the team member list."],
          ["Belum ada yang terkunci. Akses Project Manager dan Engineer ditentukan di sini.", "Nothing is locked yet. Project Manager and Engineer access is decided here."],
        ],
        [
          ["Paket komersial", "Commercial package"],
          ["Kode paket (PKG-01, PKG-02, dan seterusnya) sebagai wadah satu lingkup penjualan.", "A package code (PKG-01, PKG-02, and so on) as the container for one scope of sale."],
          ["Paket yang sudah memiliki dokumen tidak dapat dihapus; ubah statusnya menjadi Void.", "A package that already has documents cannot be deleted; set its status to Void instead."],
        ],
        [
          ["BoQ", "BoQ"],
          ["Daftar item Perangkat, Material, Jasa, dan Mobilitas beserta kuantitas dan harga jual.", "The list of Device, Material, Service, and Mobility items with quantities and selling prices."],
          ["Nilai BoQ langsung menjadi subtotal Quotation paket tersebut.", "The BoQ value becomes the subtotal of that package's quotation."],
        ],
        [
          ["Quotation", "Quotation"],
          ["Nomor penawaran, diskon, pajak, pembulatan, dan Total tagihan klien.", "The quotation number, discount, tax, rounding, and the Total billed to the client."],
          ["Mengubah BoQ atau isi penawaran setelah dikirim membuat revisi baru; versi lama menjadi Digantikan.", "Changing the BoQ or the quotation after it was sent creates a new revision; the old one becomes Superseded."],
        ],
        [
          ["Terima klien", "Client accept"],
          ["Tanggal persetujuan dan berkas buktinya, tersimpan menempel pada penawaran.", "The acceptance date and its proof file, stored attached to the quotation."],
          ["Item BoQ, diskon, pajak, dan pembulatan terkunci permanen. Nilai proyek disamakan dengan total yang diterima.", "BoQ items, discount, tax, and rounding lock permanently. The project value is set to the accepted total."],
        ],
        [
          ["Invoice termin", "Installment invoices"],
          ["Satu atau beberapa invoice sebagai persentase dari Total tagihan klien.", "One or more invoices, each a percentage of the Total billed to the client."],
          ["Akumulasi seluruh termin dibatasi 100%. Invoice terakhir menyerap sisa pembulatan.", "All installments together are capped at 100%. The final invoice absorbs the rounding residual."],
        ],
        [
          ["Pembayaran klien", "Client payment"],
          ["Catatan bruto, pajak dipotong, dan kas aktual; hanya kas aktual masuk Buku Kas.", "A record of gross, tax withheld, and actual cash; only the actual cash enters the Cash Ledger."],
          ["Invoice yang pernah dibayar tidak dapat diedit atau dihapus lagi, meskipun pembayarannya sudah di-void.", "An invoice that has ever been paid can no longer be edited or deleted, even after the payment is voided."],
        ],
        [
          ["SPK / PO vendor", "Vendor SPK / PO"],
          ["Komitmen kepada vendor yang bersumber dari item penawaran yang sudah diterima klien.", "A commitment to a vendor, sourced from items on a quotation the client has accepted."],
          ["Setelah disetujui, nilai dokumen terkunci menjadi komitmen dan mengurangi laba yang aman dibagikan.", "Once approved, the document value locks as a commitment and reduces the profit that is safe to distribute."],
        ],
        [
          ["Validasi perangkat", "Device validation"],
          ["Daftar pemeriksaan lapangan per paket dan per siklus penyerahan.", "The site checklist per package and per delivery cycle."],
          ["Checklist harus berstatus Selesai sebelum BAST siklus itu boleh dibuat maupun difinalkan.", "The checklist must be Completed before that cycle's handover certificate may be created or finalized."],
        ],
        [
          ["BAST", "Handover certificate"],
          ["Dokumen serah terima bertanda tangan dua pihak, bercap, dan ber-QR pemeriksaan keaslian.", "A handover document signed by both parties, sealed, and carrying an authenticity QR code."],
          ["BAST final tidak dapat diedit maupun dihapus. Status proyek berubah menjadi Selesai hanya setelah seluruh paket yang penawarannya sudah diterima klien memiliki BAST final yang aktif.", "A final certificate cannot be edited or deleted. The project status changes to Completed only once every package with a client-accepted quotation has an active final certificate."],
        ],
        [
          ["Penutupan", "Closeout"],
          ["Rekonsiliasi bank selesai, pajak diselesaikan, laba dibagikan, laporan diekspor.", "Bank reconciliation finished, tax settled, profit distributed, reports exported."],
          ["Arsip PDF dan CSV menjadi catatan akhir periode.", "The PDF and CSV archives become the end-of-period record."],
        ],
      ],
    },
    {
      kind: "note",
      title: ["Dua alur yang berjalan terus-menerus", "Two tracks that run continuously"],
      text: [
        "Belanja Proyek dan Pembukuan tidak menunggu rantai di atas. Nota lapangan dicatat kapan pun belanja terjadi, dan mutasi bank dicocokkan setiap kali rekening koran terbit. Keduanya tetap tunduk pada aturan yang sama: satu kejadian kas hanya boleh tercatat satu kali.",
        "Project Expenses and Finance do not wait for the chain above. Field receipts are recorded whenever a purchase happens, and bank entries are matched every time a statement is issued. Both still obey the same rule: one cash event may only ever be recorded once.",
      ],
    },
  ],
};

export const chapterStart: Chapter = {
  id: "start",
  title: ["Memulai: masuk, memilih proyek, memilih paket", "Getting started: signing in, choosing a project, choosing a package"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Bab ini adalah lima menit pertama setiap orang baru. Tujuannya satu: sampai Anda yakin sedang melihat proyek dan paket yang benar, jangan mengubah apa pun.",
        "This chapter covers every new user's first five minutes. It has one goal: until you are sure you are looking at the right project and the right package, do not change anything.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Semua peran: Admin, Project Manager, Engineer, dan Finance.", "Everyone: Admin, Project Manager, Engineer, and Finance."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Halaman masuk, lalu sidebar kiri dan pemilih proyek di bagian atas layar.", "The sign-in page, then the left sidebar and the project picker at the top of the screen."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Email dan kata sandi awal dari Admin, serta akses proyek yang sudah diberikan bila Anda Project Manager atau Engineer.", "The email address and starting password from your Admin, plus the project access already granted if you are a Project Manager or Engineer."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Masuk dengan email dan kata sandi Anda. Centang Ingat Saya hanya pada perangkat pribadi. Tanpa Ingat Saya, sesi berlaku 8 jam; dengan Ingat Saya, sesi perangkat itu berlaku sampai 30 hari.",
          "Sign in with your email and password. Tick Remember Me only on a private device. Without Remember Me a session lasts 8 hours; with it, that device's session lasts up to 30 days.",
        ],
        [
          "Bila kata sandi salah berkali-kali, aplikasi menahan percobaan berikutnya selama beberapa menit dan jedanya memanjang bila percobaan gagal terus. Ini berlaku juga untuk permintaan pemulihan kata sandi. Tunggu sampai jedanya habis, lalu coba lagi dengan kata sandi yang benar atau minta tautan pemulihan; tidak ada akun yang terkunci permanen.",
          "After several wrong passwords the application holds off the next attempt for a few minutes, and the wait grows if failures continue. The same applies to password recovery requests. Wait for the pause to end, then try again with the correct password or ask for a recovery link; no account is ever locked permanently.",
        ],
        [
          "Buka Pengaturan sekali di awal untuk memilih Bahasa Indonesia atau English. Pilihan ini tersimpan pada akun Anda dan dipakai lagi pada login berikutnya, termasuk untuk bahasa dokumen PDF yang Anda unduh.",
          "Open Settings once at the start to choose Indonesian or English. The choice is saved on your account and reused at the next sign-in, including for the language of the PDF documents you download.",
        ],
        [
          "Pilih proyek pada pemilih proyek di bagian atas layar. Selama satu proyek dipilih, seluruh menu operasional hanya menampilkan data proyek tersebut. Pilih Semua proyek untuk melihat gambaran keseluruhan di Dashboard.",
          "Choose a project in the project picker at the top of the screen. While one project is selected, every operational menu shows only that project's data. Choose All projects to see the overall picture on the Dashboard.",
        ],
        [
          "Baca Peta proyek di bagian paling atas Dashboard untuk melihat sebaran pekerjaan. Warna titik mengikuti status: abu-abu untuk Deal-an, tosca untuk On progress, hijau untuk Selesai. Klik satu titik untuk membuka proyeknya. Peta memakai daftar proyek yang sama dengan Dashboard, jadi isinya persis sebatas hak akses Anda.",
          "Read the Project map at the very top of the Dashboard to see where the work is. Pin colour follows the status: grey for In negotiation, teal for In progress, green for Completed. Click a pin to open that project. The map is drawn from the same project list as the rest of the Dashboard, so it shows exactly what your access allows and nothing more.",
        ],
        [
          "Titik peta ditebak otomatis dari kolom Lokasi setiap kali proyek disimpan. Bila lokasi tidak dikenali, proyek tetap tersimpan tanpa titik dan jumlahnya ditulis apa adanya di bawah peta. Tekan Atur titik peta, pilih proyeknya, lalu klik posisi yang benar. Titik yang diletakkan manusia tidak akan pernah ditimpa tebakan otomatis berikutnya.",
          "Pins are guessed from the Location field each time a project is saved. When a location cannot be recognised the project still saves without a pin, and the number of such projects is stated plainly under the map. Press Set a map pin, choose the project, and click the correct position. A pin placed by a person is never overwritten by a later automatic guess.",
        ],
        [
          "Baca tiga kartu status tepat di bawah peta: Deal-an, On progress, dan Selesai. Angka besarnya adalah jumlah proyek pada status itu; baris kecil di bawahnya menyebut berapa yang sudah lewat rencana mulai atau lewat tanggal target, dan mengatakan apa adanya bila tanggal tersebut memang belum diisi. Kartu Selesai hanya memuat jumlah, karena tanggal sebuah proyek benar-benar rampung tidak pernah dicatat sehingga tidak ada keterangan waktu yang dapat dipertanggungjawabkan.",
          "Read the three state cards directly under the map: In negotiation, In progress, and Completed. The large figure is how many projects are in that state; the small line beneath says how many have gone past their planned start or their target date, and says so plainly when that date has never been filled in. The Completed card carries its count alone, because the date a project actually finished is never recorded and so no claim about timing can be supported.",
        ],
        [
          "Gulir ke bagian paling bawah Dashboard untuk angka uang. Nilai proyek berjalan dan Piutang diterima berada di bawah daftar Proyek terbaru, bukan di baris teratas. Nilai proyek berjalan menjumlahkan kontrak berstatus On progress saja; Piutang diterima mengikuti porsi setiap proyek yang sudah tertutup pembayaran terkonfirmasi, bukan saldo rekening. Keduanya mengikuti pemilih proyek yang sama seperti seluruh isi Dashboard.",
          "Scroll to the very bottom of the Dashboard for the money. Active project value and Receivables collected sit below the Recent projects list rather than in the top row. Active project value adds up only the contracts that are In progress; Receivables collected follows the share of each project that confirmed payments already cover, not a bank balance. Both follow the same project picker as the rest of the Dashboard.",
        ],
        [
          "Bila proyek dijual dalam beberapa lingkup, pilih juga paket komersial di bagian atas BoQ Generator, Quotation & Invoice, Validasi Perangkat, dan BAST Digital. Paket pertama dibuat otomatis dengan kode PKG-01 dan judul Lingkup Utama.",
          "If the project is sold as several scopes, also choose the commercial package at the top of BoQ Generator, Quotations & Invoices, Device Validation, and Digital Handover. The first package is created automatically with the code PKG-01 and the title Main Scope.",
        ],
        [
          "Kenali tiga kelompok menu di sidebar. UTAMA berisi Dashboard, Manajemen Proyek, BoQ Generator, dan Quotation & Invoice. OPERASIONAL berisi Belanja Proyek, Procurement & Vendor, Validasi Perangkat, BAST Digital, dan Pembukuan. ADMINISTRASI berisi Database Item serta Pengguna & Akses.",
          "Learn the three sidebar groups. MAIN holds Dashboard, Project Management, BoQ Generator, and Quotations & Invoices. OPERATIONS holds Project Expenses, Procurement & Vendors, Device Validation, Digital Handover, and Finance. ADMINISTRATION holds Item Database and Users & Access.",
        ],
        [
          "Lengkapi Profil Saya: foto (JPG, PNG, atau WebP maksimal 3 MB), nama, kontak, dan jabatan. Nama dan jabatan inilah yang tercetak pada dokumen yang Anda buat.",
          "Complete My Profile: photo (JPG, PNG, or WebP up to 3 MB), name, contact details, and job title. That name and title are what get printed on the documents you create.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Aplikasi mengingat proyek dan paket yang terakhir Anda pilih, jadi Anda tidak perlu memilih ulang setiap berpindah menu. Menu yang tidak Anda miliki izinnya tidak akan muncul sama sekali di sidebar.",
        "The application remembers the last project and package you chose, so you do not have to pick them again when you switch menus. Menus you have no permission for do not appear in the sidebar at all.",
      ],
    },
    {
      kind: "note",
      title: ["Status paket komersial", "The commercial package lifecycle"],
      text: [
        "Paket baru langsung berstatus Aktif dan hanya paket Aktif yang menerima dokumen baru — BoQ, Quotation, Invoice, Validasi Perangkat, BAST, dan Addendum. Paket yang pekerjaannya sudah tuntas dapat diubah menjadi Selesai, dan paket yang batal dijual diubah menjadi Batal (Void). Keduanya menolak dokumen baru, tetapi seluruh dokumen lamanya tetap dapat dibaca, diunduh, dan dicetak seperti biasa. Paket Selesai masih dapat diaktifkan kembali bila ada pekerjaan susulan; Batal bersifat final dan tidak dapat dihidupkan lagi. Paket yang sudah memiliki dokumen memang tidak dapat dihapus — mengubah statusnya menjadi Batal adalah cara mempensiunkannya.",
        "A new package starts as Active, and only an Active package accepts new documents — BoQ, quotation, invoice, device validation, handover certificate, and addendum. A package whose work is finished can be set to Completed, and one that was called off can be set to Void. Both refuse new documents, while every document already on them stays readable, downloadable, and printable as before. A Completed package can still be reactivated when late work arrives; Void is final and can never be revived. A package that already carries documents cannot be deleted — setting it to Void is how it is retired.",
      ],
    },
    {
      kind: "note",
      title: ["Menghapus proyek", "Deleting a project"],
      text: [
        "Menghapus proyek hanya dapat dilakukan Admin, dan hanya selama proyek itu belum memiliki riwayat kas sama sekali. Begitu ada pembayaran invoice, pembayaran vendor, penyelesaian belanja proyek, setoran pajak, atau satu pun transaksi di Pembukuan, penghapusan ditolak — uang yang sudah tercatat tidak boleh hilang bersama proyeknya. Proyek seperti itu ditutup atau diarsipkan: ubah statusnya menjadi Selesai dan biarkan dokumen serta pembukuannya tetap utuh. Proyek yang benar-benar salah buat dan belum menyentuh uang tetap dapat dihapus seperti biasa; saat itu terjadi, jumlah dokumen yang ikut terhapus dicatat di audit log.",
        "Only an Admin may delete a project, and only while that project has no cash history at all. As soon as there is an invoice payment, a vendor payment, a project-expense settlement, a tax settlement, or a single Finance transaction, the deletion is refused — recorded money must never disappear with its project. Such a project is closed or archived instead: set its status to Completed and leave its documents and books intact. A project that was genuinely created by mistake and has never touched money can still be deleted as before; when that happens, the number of documents removed is recorded in the audit log.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Angka terasa salah karena paket yang dipilih bukan paket yang dimaksud. Sebelum melapor ada kekeliruan hitung, periksa dulu nama paket di bagian atas layar.",
          "Figures look wrong because the selected package is not the intended one. Before reporting a calculation error, check the package name at the top of the screen first.",
        ],
        [
          "Memakai Ingat Saya di komputer bersama. Sesi perangkat itu tetap hidup sampai 30 hari. Selalu tekan Keluar bila meninggalkan perangkat bersama.",
          "Using Remember Me on a shared computer. That device's session stays alive for up to 30 days. Always press Sign out when leaving a shared device.",
        ],
        [
          "Menganggap proyek hilang padahal akses proyeknya belum diberikan. Project Manager dan Engineer hanya melihat proyek tempat mereka terdaftar sebagai anggota.",
          "Assuming a project has disappeared when project access has simply not been granted. Project Managers and Engineers only see projects they are members of.",
        ],
      ],
    },
  ],
};

export const chapterQuotation: Chapter = {
  id: "quotation",
  title: ["Menyiapkan penawaran untuk klien", "Preparing a quotation for a client"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Bab terpanjang dan paling penting. Semua nilai proyek, semua invoice, dan semua komitmen vendor berasal dari penawaran yang diterima klien. Selama penawaran masih Draft, semuanya bebas diubah. Sesudah diterima klien, hampir semuanya terkunci selamanya.",
        "The longest and most important chapter. Every project value, every invoice, and every vendor commitment originates from the quotation the client accepted. While the quotation is still a Draft, everything is freely editable. Once the client accepts it, almost everything is locked for good.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Project Manager atau Admin menyusun BoQ. Hanya Admin dan Finance yang boleh mengubah tanggal terbit, masa berlaku, diskon, pembulatan, dan pajak.", "A Project Manager or Admin builds the BoQ. Only Admin and Finance may change the issue date, validity, discount, rounding, and tax."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Manajemen Proyek, lalu BoQ Generator, lalu Quotation & Invoice.", "Project Management, then BoQ Generator, then Quotations & Invoices."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Data klien dan lokasi, daftar kebutuhan pekerjaan, item yang sudah ada di Database Item, dan pada langkah terakhir bukti persetujuan klien berupa PDF, PNG, JPG, atau WebP (maksimal sekitar 6 MB).", "Client and site details, the list of work required, items already present in the Item Database, and for the final step the client's written acceptance as PDF, PNG, JPG, or WebP (up to about 6 MB)."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Buat proyek di Manajemen Proyek: isi nama pekerjaan, klien, lokasi, tanggal mulai dan selesai, serta penanggung jawab. Tambahkan Project Manager dan Engineer sebagai anggota proyek agar mereka dapat melihatnya.",
          "Create the project in Project Management: fill in the job name, client, site, start and end dates, and the person responsible. Add the Project Managers and Engineers as project members so they can see it.",
        ],
        [
          "Buka BoQ Generator, pastikan paket yang benar terpilih, lalu tambahkan item pekerjaan dari Database Item. Setiap item punya kategori BoQ: Perangkat, Material, Jasa, atau Mobilitas.",
          "Open BoQ Generator, make sure the correct package is selected, then add work items from the Item Database. Every item has a BoQ category: Device, Material, Service, or Mobility.",
        ],
        [
          "Pilih Harga 1 atau Harga 2 untuk tiap item. Aplikasi membaca harga pokok item lalu menghitung harga jualnya sendiri dari margin yang tersimpan pada item tersebut. Harga jual tidak pernah diketik langsung.",
          "Choose Price 1 or Price 2 for each item. The application reads the item's cost price and calculates the selling price itself from the margin stored on that item. Selling prices are never typed in directly.",
        ],
        [
          "Buka Quotation & Invoice. Nilai penawaran sudah terisi otomatis dari BoQ paket yang sedang dipilih. Periksa subtotalnya sebelum melanjutkan.",
          "Open Quotations & Invoices. The quotation value is already filled in from the BoQ of the selected package. Check the subtotal before going on.",
        ],
        [
          "Admin atau Finance menekan Edit untuk mengatur tanggal terbit dan masa berlaku. Bila masa berlaku dikosongkan, aplikasi mengisinya 14 hari setelah tanggal terbit. Masa berlaku tidak boleh lebih awal dari tanggal terbit.",
          "An Admin or Finance user presses Edit to set the issue date and the validity date. If validity is left empty, the application sets it to 14 days after the issue date. Validity may not be earlier than the issue date.",
        ],
        [
          "Pada layar yang sama, atur diskon. Pilih Nominal untuk potongan rupiah tetap, atau Persen untuk potongan persentase (maksimal 100%). Diskon tidak pernah boleh melebihi subtotal.",
          "On the same screen, set the discount. Choose Nominal for a fixed rupiah reduction, or Percent for a percentage reduction (maximum 100%). A discount can never exceed the subtotal.",
        ],
        [
          "Atur pembulatan bila perlu. Pilihannya: Tidak ada, Ke atas, Ke bawah, atau Khusus. Ke atas dan Ke bawah memerlukan kelipatan Rp 1.000, Rp 10.000, atau Rp 100.000. Khusus berarti Anda mengetik sendiri selisihnya dan wajib menulis alasan minimal 5 karakter.",
          "Set rounding if needed. The options are None, Up, Down, or Custom. Up and Down require a step of Rp 1,000, Rp 10,000, or Rp 100,000. Custom means you type the adjustment yourself and must write a reason of at least 5 characters.",
        ],
        [
          "Pembulatan Khusus tetap harus berupa pembulatan. Batasnya adalah Rp 100.000 atau 1% dari nilai sebelum pembulatan, mana yang lebih besar; di luar itu aplikasi menolak dengan pesan yang menyebut batasnya. Perubahan harga yang lebih besar dari itu adalah diskon atau pajak, dan harus dicatat di kolomnya sendiri agar terlihat apa adanya di PDF dan di invoice.",
          "A Custom rounding must still be a rounding. The limit is Rp 100,000 or 1% of the value before rounding, whichever is larger; beyond that the application refuses and names the limit. A larger change to the price is a discount or a tax, and belongs in its own field so it shows up for what it is on the PDF and on the invoices.",
        ],
        [
          "Bila memakai pajak, tekan Pajak, nyalakan Gunakan pajak, lalu pilih aturannya. Aturan pajak beserta tarifnya disiapkan perusahaan di Pembukuan; tidak ada tarif yang tertanam mati di dalam aplikasi. Pajak hanya dapat diubah selama penawaran masih Draft.",
          "If tax applies, press Tax, switch on Apply tax, and choose the rules. The tax rules and their rates are configured by the company in Finance; no rate is hard-wired into the application. Tax can only be changed while the quotation is still a Draft.",
        ],
        [
          "Periksa ringkasan angka di panel kanan: subtotal, diskon, dasar pengenaan pajak, pajak Tambah, pembulatan, Total tagihan klien, dan Kas bersih diterima. Bab Contoh perhitungan lengkap menjelaskan setiap barisnya.",
          "Check the figure summary in the right-hand panel: subtotal, discount, taxable base, added tax, rounding, Total billed to the client, and Net cash received. The worked example chapter explains every line.",
        ],
        [
          "Tekan Unduh PDF, kirim penawaran ke klien lewat saluran resmi Anda, lalu kembali ke aplikasi dan tekan Tandai sudah dikirim. Status penawaran berubah menjadi Terkirim.",
          "Press Download PDF, send the quotation to the client through your usual channel, then come back to the application and press Mark as sent. The quotation status becomes Sent.",
        ],
        [
          "Bila klien meminta perubahan, ubah saja BoQ atau isi penawarannya. Karena statusnya sudah Terkirim, aplikasi otomatis membuat revisi baru dengan akhiran -R2, -R3, dan seterusnya. Versi lama berubah menjadi Digantikan dan tetap tersimpan di panel Riwayat revisi.",
          "If the client asks for changes, simply change the BoQ or the quotation. Because the status is already Sent, the application automatically creates a new revision suffixed -R2, -R3, and so on. The old version becomes Superseded and stays available in the Revision history panel.",
        ],
        [
          "Setelah klien setuju, tekan Terima klien, isi tanggal persetujuan, unggah berkas buktinya, lalu tekan Terima & kunci. Kedua isian ini wajib; penawaran tidak dapat diterima tanpa tanggal dan bukti.",
          "Once the client agrees, press Client accept, enter the acceptance date, upload the proof file, then press Accept & lock. Both fields are mandatory; a quotation cannot be accepted without a date and proof.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Penawaran berstatus Diterima. Item BoQ paket itu, diskon, pajak, dan pembulatan terkunci permanen dan tidak dapat diedit maupun dihapus. Nilai proyek langsung disamakan dengan Total tagihan klien, dan sejak saat itu nilai proyek mengikuti kontrak: kolom Nilai pada data proyek tidak lagi dapat diketik manual, dan aplikasi menolak bila dicoba. Sejak saat itu Anda dapat membuat invoice termin dan dokumen SPK/PO. Setiap perubahan pekerjaan sesudahnya harus lewat Addendum.",
        "The quotation is now Accepted. That package's BoQ items, discount, tax, and rounding are locked permanently and can be neither edited nor deleted. The project value is immediately set to the Total billed to the client, and from then on the project value follows the contract: the Value field on the project record can no longer be typed in by hand, and the application refuses the attempt. From then on you can raise installment invoices and procurement documents. Any later change to the work must go through an Addendum.",
      ],
    },
    {
      kind: "note",
      title: ["Menghapus revisi yang salah", "Deleting a wrong revision"],
      text: [
        "Selama sebuah revisi belum diterima klien dan belum punya invoice maupun dokumen procurement, revisi itu boleh dihapus. Saat dihapus, revisi sebelumnya otomatis dikembalikan menjadi Draft yang dapat diedit lagi, lengkap dengan pajaknya yang ikut terbuka kembali. Ini jalan keluar yang aman bila sebuah revisi terlanjur dibuat karena salah klik.",
        "As long as a revision has not been accepted by the client and has no invoice or procurement document attached, it may be deleted. When it is deleted, the previous revision is automatically returned to an editable Draft, with its tax figures unlocked again. This is the safe way out when a revision was created by mistake.",
      ],
    },
    {
      kind: "note",
      title: ["Membatalkan penawaran, dan mengapa Batal bersifat final", "Voiding a quotation, and why Void is final"],
      text: [
        "Alur status penawaran berjalan satu arah: Draft menjadi Terkirim, Terkirim menjadi Diterima, Ditolak, atau Batal, dan mengubah penawaran yang sudah Terkirim membuat revisi baru sementara versi lamanya menjadi Digantikan. Batal, Ditolak, dan Digantikan adalah status akhir. Penawaran berstatus tersebut tidak dapat dikembalikan menjadi Draft atau Terkirim, baik lewat tombol status maupun lewat penyuntingan biasa; bila pekerjaannya kembali berjalan, buat penawaran baru. Membatalkan penawaran juga ditolak selama masih ada dokumen yang bergantung padanya: SPK atau PO yang belum di-void, invoice yang masih terbit, dan terutama invoice yang sudah menerima pembayaran. Urutan koreksinya selalu dari uang ke dokumen: void pembayarannya, hapus invoicenya, void dokumen procurementnya, baru penawarannya dapat dibatalkan.",
        "The quotation status flow runs one way: Draft becomes Sent; Sent becomes Accepted, Rejected, or Void; and changing an already-Sent quotation issues a new revision while the older one becomes Superseded. Void, Rejected, and Superseded are terminal. A quotation in one of those states cannot be returned to Draft or Sent, neither through the status buttons nor through an ordinary edit; if the work restarts, raise a new quotation. Voiding is also refused while any document still depends on it: an unvoided Work Order or PO, an invoice that still exists, and above all an invoice that has already received a payment. The correction order always runs from the money back to the document: void the payment, delete the invoice, void the procurement document, and only then can the quotation be voided.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mengubah BoQ setelah penawaran dikirim tanpa menyadari bahwa itu membuat revisi baru. Kirim ulang PDF revisi terbaru ke klien, jangan pakai PDF yang sudah dicetak sebelumnya.",
          "Changing the BoQ after the quotation was sent without realizing it creates a new revision. Send the latest revision's PDF to the client again; do not use the PDF you printed earlier.",
        ],
        [
          "Menekan Terima klien padahal masa berlaku sudah lewat. Aplikasi menolaknya. Minta Admin atau Finance menekan Edit dan memperpanjang tanggal Berlaku sampai, lalu ulangi.",
          "Pressing Client accept after the validity date has passed. The application refuses. Ask an Admin or Finance user to press Edit, extend the Valid until date, and try again.",
        ],
        [
          "Lupa menyalakan pajak sebelum penawaran diterima. Setelah diterima, pajak tidak dapat ditambahkan lagi pada dokumen itu. Bila modul pajak aktif, aplikasi mewajibkan minimal satu aturan pajak dipilih sebelum penawaran dikirim maupun diterima.",
          "Forgetting to switch on tax before the quotation is accepted. Once accepted, tax can no longer be added to that document. When the tax module is on, the application requires at least one tax rule to be chosen before a quotation may be sent or accepted.",
        ],
        [
          "Mengira pajak Potong mengurangi tagihan. Tidak. Pajak Potong tidak mengubah Total tagihan klien sama sekali; yang berkurang hanya Kas bersih yang benar-benar masuk ke rekening.",
          "Assuming withheld tax reduces the bill. It does not. Withheld tax leaves the Total billed to the client untouched; only the Net cash that actually reaches the bank account is smaller.",
        ],
        [
          "Memakai pembulatan Khusus tanpa alasan yang jelas. Alasan itu ikut tercetak sebagai catatan internal dan akan ditanyakan saat audit. Tulis alasan yang bermakna, misalnya kesepakatan pembulatan dengan klien.",
          "Using Custom rounding without a clear reason. The reason is retained as an internal note and will be asked about during an audit. Write something meaningful, for example an agreed rounding with the client.",
        ],
      ],
    },
    {
      kind: "bullets",
      items: [
        ["Nilai proyek adalah jumlah per paket: kontrak yang diterima klien untuk paket yang sudah punya kontrak, dan BoQ untuk paket yang belum. Dulu paket yang masih Draft lenyap dari nilai proyek begitu paket lain diterima.", "The project value is a per-package sum: the accepted contract for packages that have one, the BoQ for those that do not. A Draft package used to vanish from the project value as soon as another package was accepted."],
        ["Revisi lama (Superseded) menyimpan angka historisnya; perubahan BoQ berikutnya tidak menimpanya lagi, jadi riwayat revisi memang riwayat.", "Old (Superseded) revisions keep their historic figures; later BoQ changes no longer overwrite them, so the revision history really is history."],
        ["Diskon nominal yang dibawa ke revisi dipotong ke subtotal yang baru; tidak ada lagi diskon tersimpan yang lebih besar dari pekerjaannya.", "A nominal discount carried into a revision is clipped to the new subtotal; no stored discount is ever larger than the job."],
      ],
    },
  ],
};

export const chapterInstallment: Chapter = {
  id: "installment",
  title: ["Menagih klien per termin", "Billing the client in installments"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Invoice tidak dibuat dengan mengetik nominal. Anda mengetik persentase, dan aplikasi menghitung rupiahnya dari Total tagihan klien pada penawaran yang sudah diterima. Cara ini menjamin jumlah seluruh termin tidak pernah melebihi nilai kontrak.",
        "Invoices are not created by typing an amount. You type a percentage, and the application calculates the rupiah figure from the Total billed to the client on the accepted quotation. This guarantees that all installments together never exceed the contract value.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin, Project Manager, atau Finance dengan izin Kelola pada Quotation & Invoice.", "Admin, Project Manager, or Finance with Manage on Quotations & Invoices."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Quotation & Invoice, tab Invoice.", "Quotations & Invoices, Invoice tab."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Penawaran paket ini sudah berstatus Diterima, dan pembagian termin sudah disepakati dengan klien.", "This package's quotation is already Accepted, and the installment split has been agreed with the client."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Buka tab Invoice lalu tekan Invoice baru. Tombol ini tidak aktif sampai penawaran diterima klien, dan mati lagi setelah akumulasi termin mencapai 100%.",
          "Open the Invoice tab and press New invoice. The button stays inactive until the client has accepted the quotation, and turns off again once the installments reach 100%.",
        ],
        [
          "Pilih jenis tagihan: DP 30%, DP 50%, Termin 2, atau Pelunasan. Label ini hanya penamaan dokumen; angka sesungguhnya diambil dari persentase yang Anda isi berikutnya.",
          "Choose the invoice type: DP 30%, DP 50%, Termin 2 (Milestone 2), or Pelunasan (Final Payment). These labels only name the document; the real figure comes from the percentage you enter next.",
        ],
        [
          "Isi tanggal terbit dan tanggal jatuh tempo.",
          "Enter the issue date and the due date.",
        ],
        [
          "Isi Persentase termin. Dua angka di belakang koma diperbolehkan, misalnya 33,33. Nilai rupiahnya langsung muncul, dihitung dari Total tagihan klien.",
          "Enter the installment percentage. Two decimal places are allowed, for example 33.33. The rupiah figure appears immediately, calculated from the Total billed to the client.",
        ],
        [
          "Tekan Terbitkan invoice. Invoice mendapat nomornya sendiri dan mewarisi pajak yang sudah terkunci pada penawaran.",
          "Press Issue invoice. The invoice receives its own number and inherits the tax already locked on the quotation.",
        ],
        [
          "Tekan Unduh PDF lalu kirim ke klien.",
          "Press Download PDF and send it to the client.",
        ],
        [
          "Ulangi untuk termin berikutnya. Bila persentase yang Anda isi membuat akumulasi melebihi 100%, aplikasi menolak dan menyebutkan berapa sisa persentase yang masih tersedia. Isi angka sisa itu untuk invoice terakhir.",
          "Repeat for the next installment. If your percentage would push the cumulative total past 100%, the application refuses and states how much percentage remains. Enter that remaining figure for the final invoice.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Selama belum ada pembayaran aktif, invoice masih dapat diedit maupun dihapus. Begitu sebuah pembayaran dicatat, invoice terkunci: mengedit atau menghapusnya akan merusak pembukuan, sehingga aplikasi menolaknya. Kuncinya terbuka kembali bila seluruh pembayarannya di-void — pembayaran yang dibatalkan bukan lagi pembayaran aktif, sehingga koreksi tetap mungkin dilakukan. Yang tidak pernah terbuka kembali adalah kunci pajak: invoice yang kewajiban pajaknya sudah disetor atau dilaporkan tetap tidak dapat diedit maupun dihapus.",
        "As long as there is no active payment, an invoice can still be edited or deleted. Once a payment is recorded the invoice is locked: editing or deleting it would corrupt the books, so the application refuses. The lock lifts again once every payment on it has been voided — a cancelled payment is no longer an active one, so a correction remains possible. What never lifts is the tax lock: an invoice whose tax obligations are already settled or reported can be neither edited nor deleted.",
      ],
    },
    {
      kind: "note",
      title: ["Invoice terakhir menyerap sisa pembulatan", "The final invoice absorbs the rounding residual"],
      text: [
        "Ketika sebuah invoice membuat akumulasi termin tepat mencapai 100%, aplikasi berhenti mengalikan persentase dan memakai rumus sisa: nilai penuh dikurangi seluruh nilai yang sudah ditagihkan. Ini berlaku untuk nominal invoice sekaligus untuk setiap komponen pajaknya. Hasilnya, jumlah seluruh invoice selalu sama persis dengan Total tagihan klien, tanpa selisih satu rupiah pun. Contoh angkanya ada di bab Contoh perhitungan lengkap.",
        "When an invoice brings the cumulative installments to exactly 100%, the application stops multiplying by a percentage and uses the remainder instead: the full value minus everything already billed. This applies to the invoice amount and to every tax component on it. As a result the invoices always add up to exactly the Total billed to the client, without a single rupiah of drift. The figures are shown in the worked example chapter.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Membuat invoice terakhir dengan persentase bulat, misalnya 33,33% padahal sisanya 33,34%. Selalu pakai angka sisa yang disebutkan aplikasi agar penyerapan pembulatan berjalan.",
          "Creating the final invoice with a rounded percentage, for example 33.33% when 33.34% is what remains. Always use the remaining figure the application quotes so the rounding absorption takes effect.",
        ],
        [
          "Menghapus invoice yang salah setelah pembayaran dicatat. Yang benar: buka jendela pembayaran, tekan Void pada pembayaran, isi alasannya, baru perbaiki dokumennya bila memang masih memungkinkan.",
          "Deleting a wrong invoice after a payment was recorded. The correct route: open the payment window, press Void on the payment, give a reason, then correct the document if that is still possible.",
        ],
        [
          "Menagih dari paket yang salah pada proyek bertingkat paket. Nomor invoice mengikuti paket yang sedang dipilih di bagian atas layar.",
          "Billing from the wrong package on a multi-package project. The invoice belongs to whichever package is selected at the top of the screen.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["Invoice Nominal dibatasi per paket", "Nominal invoices are capped per package"],
      text: [
        "Invoice bernominal bebas (tanpa persentase) tidak boleh membuat total invoice sebuah PAKET melampaui kontrak paket itu. Sejak 21 Agustus 2026 batasnya dihitung per paket; dulu dihitung se-proyek, sehingga invoice paket B bisa ditolak karena jatah paket A sudah habis.",
        "Free-amount invoices (without a percentage) may not push a PACKAGE's invoice total past that package's contract. Since 21 August 2026 the cap is computed per package; it used to be computed project-wide, so a package B invoice could be refused because package A's headroom was used up.",
      ],
    },
  ],
};

export const chapterInvoicePayment: Chapter = {
  id: "invoice-payment",
  title: ["Mencatat uang masuk dari klien", "Recording money received from a client"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Aturan tunggal bab ini: hanya uang yang benar-benar masuk ke rekening yang boleh dicatat sebagai kas. Pajak yang dipotong klien bukan kas; ia dicatat sebagai posisi pajak tersendiri.",
        "The single rule of this chapter: only money that actually arrives in the bank account may be recorded as cash. Tax the client withheld is not cash; it is recorded as a separate tax position.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin atau Finance. Pembatalan (void) pembayaran hanya oleh Admin.", "Admin or Finance. Only an Admin may void a payment."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Quotation & Invoice, tab Invoice, tombol Konfirmasi pada baris invoice.", "Quotations & Invoices, Invoice tab, the Confirm button on the invoice row."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Bukti transfer berupa PDF, PNG, JPG, atau WebP; nomor referensi pembayaran; rekening perusahaan penerima; dan bukti potong bila klien memotong pajak.", "The transfer receipt as PDF, PNG, JPG, or WebP; a payment reference number; the receiving company bank account; and the withholding slip if the client deducted tax."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Tekan Konfirmasi pada baris invoice yang dibayar. Bila invoice sudah Lunas dan Anda perlu mengoreksi, tombolnya berbunyi Koreksi bayar.",
          "Press Confirm on the invoice that was paid. If the invoice is already Paid and you need to correct it, the button reads Correct payment.",
        ],
        [
          "Isi Nilai bruto diselesaikan, yaitu bagian tagihan yang dianggap lunas oleh pembayaran ini.",
          "Enter the Gross amount settled, that is the portion of the bill this payment settles.",
        ],
        [
          "Isi Pajak dipotong klien. Nilainya tidak boleh melebihi pajak Potong yang terkunci pada dokumen.",
          "Enter the Tax withheld by client. It may not exceed the withholding tax locked on the document.",
        ],
        [
          "Periksa Kas aktual diterima. Aplikasi mengisinya otomatis, dan tombol simpan baru aktif bila bruto tepat sama dengan kas ditambah pajak dipotong.",
          "Check the Actual cash received. The application fills it in automatically, and the save button only activates when gross equals cash plus withholding exactly.",
        ],
        [
          "Isi Tanggal dana diterima memakai tanggal yang tertera pada mutasi rekening, bukan tanggal Anda mencatatnya. Tanggal ini yang membuat pencocokan bank berhasil nanti.",
          "Enter the payment received date using the date shown on the bank statement, not the day you are entering it. This date is what makes the bank match succeed later.",
        ],
        [
          "Isi referensi pembayaran, pilih metode dan rekening perusahaan penerima, lalu unggah bukti pembayaran.",
          "Enter the payment reference, choose the method and the receiving company bank account, then upload the payment proof.",
        ],
        [
          "Tekan Posting pembayaran.",
          "Press Post payment.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Hanya kas aktual yang masuk ke Buku Kas. Pajak yang dipotong klien dicatat sebagai posisi pajak, bukan kas. Pembayaran boleh bertahap: status invoice berubah menjadi Dibayar Sebagian lalu Lunas. Transaksi kas yang terbentuk menunggu dicocokkan dengan mutasi bank.",
        "Only the actual cash enters the Cash Ledger. Tax withheld by the client is recorded as a tax position, not as cash. Payments may arrive in stages: the invoice status moves to Partially Paid and then Paid. The cash entry that is created then waits to be matched against the bank statement.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mengisi bruto sama dengan kas padahal klien memotong pajak. Akibatnya utang pajak tidak pernah muncul di Pembukuan dan tagihan terlihat kurang bayar.",
          "Entering gross equal to cash when the client did withhold tax. The tax position then never appears in Finance and the bill looks underpaid.",
        ],
        [
          "Memakai tanggal pencatatan, bukan tanggal mutasi. Pencocokan bank hanya menawarkan transaksi dengan arah dan nominal sama dalam rentang 14 hari, sehingga tanggal yang meleset jauh membuat kandidatnya tidak muncul.",
          "Using the entry date instead of the statement date. Bank matching only offers records with the same direction and amount within a 14-day window, so a date that is far off makes the candidate disappear.",
        ],
        [
          "Mencatat lagi uang yang sama sebagai transaksi manual di Buku Kas. Satu kejadian kas hanya boleh tercatat sekali.",
          "Recording the same money again as a manual entry in the Cash Ledger. One cash event may only be recorded once.",
        ],
        [
          "Mencoba void pembayaran yang sudah dicocokkan dengan mutasi bank. Lepaskan dulu pencocokannya di Pembukuan, baru lakukan void.",
          "Trying to void a payment that is already matched to a bank statement entry. Unmatch it in Finance first, then void.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["Pembatalan bertanggal tanggal bayar asal", "A void is dated on the original payment date"],
      text: [
        "Membatalkan pembayaran berarti catatannya keliru — bukan uangnya dikembalikan. Sejak 21 Agustus 2026 baris pembalik memakai tanggal pembayaran asal, jadi laporan bulanan bulan itu kembali benar. Dulu pembalik bertanggal hari pembatalan: total kas memang kembali nol, tetapi dua bulan sekaligus salah. Aturan yang sama berlaku untuk pembatalan pembayaran vendor, belanja, uang muka, bagi laba, dan setoran pajak.",
        "Voiding a payment means the record was wrong — not that the money was refunded. Since 21 August 2026 the reversing entry carries the original payment date, so that month's report is right again. The reversal used to be dated on the day of the void: total cash did return to zero, but two months were wrong at once. The same rule applies to voided vendor payments, expenses, advances, profit shares, and tax settlements.",
      ],
    },
  ],
};

export const chapterAddendum: Chapter = {
  id: "addendum",
  title: ["Menambah pekerjaan di tengah proyek (Addendum)", "Adding work mid-project (Addendum)"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Penawaran yang sudah diterima klien tidak boleh disentuh lagi. Semua pekerjaan tambahan ditangani lewat Addendum: lingkup baru dengan penawaran baru, yang menambah nilai proyek tanpa mengubah angka apa pun yang sudah disepakati sebelumnya.",
        "A quotation the client has accepted may never be touched again. All extra work is handled through an Addendum: a new scope with a new quotation, which increases the project value without altering any figure that was already agreed.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Pengguna dengan izin Kelola pada BoQ Generator sekaligus Quotation & Invoice. Tanggal, diskon, pembulatan, dan pajaknya tetap hanya boleh diatur Admin atau Finance.", "A user with Manage on both BoQ Generator and Quotations & Invoices. Its dates, discount, rounding, and tax may still only be set by an Admin or Finance user."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Procurement & Vendor, panel Quotation Original & Addendum.", "Procurement & Vendors, the Original Quotation & Addendum panel."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["BoQ Original proyek sudah ada, daftar pekerjaan tambahan sudah jelas, dan bukti persetujuan klien atas tambahan tersebut sudah dipegang.", "The project's Original BoQ already exists, the list of extra work is clear, and the client's written approval of it is in hand."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Buka Procurement & Vendor, cari panel Quotation Original & Addendum, lalu tekan Addendum.",
          "Open Procurement & Vendors, find the Original Quotation & Addendum panel, then press Addendum.",
        ],
        [
          "Isi judul addendum dan seluruh item pekerjaan tambahan beserta kuantitas, satuan, dan harganya. Kategorinya sama seperti BoQ biasa: Perangkat, Material, Jasa, atau Mobilitas.",
          "Enter the addendum title and all the extra work items with quantities, units, and prices. The categories are the same as an ordinary BoQ: Device, Material, Service, or Mobility.",
        ],
        [
          "Tekan Buat Addendum. Aplikasi langsung membuat lingkup Addendum berstatus Draft sekaligus penawaran Draft baru dengan nomornya sendiri, dan masa berlaku 14 hari bila tidak diisi.",
          "Press Create Addendum. The application immediately creates a Draft addendum scope together with a new Draft quotation with its own number, valid for 14 days if left unset.",
        ],
        [
          "Bila perlu, Admin atau Finance mengatur diskon, pembulatan, dan pajak penawaran addendum itu selagi masih Draft.",
          "If needed, an Admin or Finance user sets the discount, rounding, and tax on that addendum quotation while it is still a Draft.",
        ],
        [
          "Unduh PDF-nya, kirim ke klien, lalu tekan Kirim untuk menandai sudah dikirim.",
          "Download its PDF, send it to the client, then press Send to mark it as sent.",
        ],
        [
          "Setelah klien setuju, tekan Terima, isi tanggal persetujuan, dan unggah bukti persetujuannya. Sama seperti penawaran biasa, tanggal dan bukti wajib ada.",
          "Once the client agrees, press Accept, enter the acceptance date, and upload the proof of approval. As with an ordinary quotation, the date and the proof are mandatory.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Nilai proyek bertambah sebesar addendum yang diterima. SPK dan PO baru sekarang boleh mengambil item dari addendum ini. Pekerjaan yang sudah diterima sebelumnya tetap terkunci dan angkanya tidak berubah sama sekali.",
        "The project value increases by the accepted addendum. New Work Orders and POs may now draw items from this addendum. Work that was accepted earlier stays locked and its figures do not change at all.",
      ],
    },
    {
      kind: "note",
      title: ["Addendum melekat pada satu paket komersial", "An addendum belongs to one commercial package"],
      text: [
        "Seperti BoQ Original, addendum selalu melekat pada satu paket komersial, yaitu paket tempat ia dibuat. Karena itu ia ikut terhitung pada ringkasan paket dan muncul pada tab Quotation yang disaring per paket tersebut. Paket lain pada proyek yang sama tidak terpengaruh sama sekali. Panel Quotation Original & Addendum pada Procurement & Vendor tetap menampilkan seluruh lingkup proyek, sehingga addendum dari paket mana pun dapat ditemukan di sana.",
        "Like the Original BoQ, an addendum always belongs to one commercial package: the package it was created from. It is therefore counted in that package summary and appears on the Quotation tab filtered to that package. Other packages on the same project are not affected at all. The Original Quotation & Addendum panel under Procurement & Vendors still lists every scope of the project, so an addendum from any package can be found there.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mencoba mengedit penawaran yang sudah diterima demi memasukkan pekerjaan tambahan. Aplikasi menolaknya dan menyarankan Addendum. Ikuti saran itu; jangan mencari jalan memutar.",
          "Trying to edit an accepted quotation in order to squeeze in extra work. The application refuses and points to an Addendum. Follow that advice; do not look for a workaround.",
        ],
        [
          "Membuat addendum pada paket yang BoQ Original-nya belum ada. Aplikasi meminta BoQ Original paket itu dibuat lebih dulu.",
          "Creating an addendum on a package that has no Original BoQ yet. The application asks for that package's Original BoQ to be created first.",
        ],
        [
          "Menghapus addendum yang sudah dipakai dokumen procurement atau sudah diterima klien. Keduanya ditolak; addendum yang diterima bersifat final seperti penawaran biasa.",
          "Deleting an addendum that a procurement document already uses or that the client has accepted. Both are refused; an accepted addendum is final just like an ordinary quotation.",
        ],
        [
          "Mengira mengubah item sebuah lingkup akan menulis ulang penawaran yang sudah terkirim. Tidak. Penawaran yang sudah Terkirim digantikan revisi baru berstatus Draft yang memuat angka barunya, sementara revisi lama tersimpan sebagai Digantikan lengkap dengan rincian yang dulu dikirim ke klien. Nilai lingkup juga tidak boleh turun di bawah total Invoice yang sudah terbit untuk paket itu.",
          "Assuming that changing a scope's items rewrites the quotation that was already sent. It does not. A Sent quotation is superseded by a new Draft revision carrying the new figures, while the old revision is kept as Superseded with exactly the lines the client received. The scope value may also never fall below the invoices already issued for that package.",
        ],
      ],
    },
  ],
};

export const chapterProcurement: Chapter = {
  id: "procurement",
  title: ["Membayar vendor lewat SPK atau PO", "Paying a vendor through an SPK or a PO"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Komitmen kepada vendor selalu bersumber dari pekerjaan yang sudah disetujui klien. Uang muka boleh dibayar segera setelah dokumen disetujui, tetapi termin berikutnya baru terbuka setelah pekerjaan atau barangnya dibuktikan.",
        "A commitment to a vendor always originates from work the client has already approved. The down payment may be paid as soon as the document is approved, but later terms only open once the work or the goods have been evidenced.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Project Manager atau Engineer membuat dan mengajukan. Admin atau Finance menyetujui. Verifikasi progres dan penerimaan barang dilakukan Admin, Project Manager, atau Engineer, bukan Finance. Pembayaran dicatat Admin atau Finance. Void hanya oleh Admin.", "A Project Manager or Engineer creates and submits. Admin or Finance approves. Progress verification and goods receipt are done by an Admin, Project Manager, or Engineer, never by Finance. Payments are recorded by Admin or Finance. Only an Admin may void."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Procurement & Vendor.", "Procurement & Vendors."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Penawaran yang sudah diterima klien lengkap dengan tanggal dan bukti persetujuannya, vendor aktif dengan tipe yang cocok, harga negosiasi, dan saat membayar: tagihan vendor, nomor referensi, rekening perusahaan, serta bukti transfer.", "An accepted quotation complete with its acceptance date and proof, an active vendor of the matching type, negotiated prices, and when paying: the vendor invoice, a reference number, the company bank account, and the transfer receipt."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Siapkan master vendor lebih dulu. Buat kategori vendor, lalu vendor bertipe Supplier, Jasa, atau Hybrid, dan pastikan statusnya Aktif.",
          "Set up the vendor master first. Create a vendor category, then a vendor typed Supplier, Jasa (services), or Hybrid, and make sure its status is Aktif (active).",
        ],
        [
          "Seluruh siklus SPK dan PO — membuat, mengubah, menyetujui, memverifikasi, membayar, dan menutup — berjalan di layar Procurement & Vendor. Tidak ada jalur lain: dokumen vendor hanya dapat dibaca dari luar layar itu.",
          "The whole Work Order and PO cycle — creating, editing, approving, verifying, paying, and closing — runs on the Procurement & Vendors screen. There is no second route: from anywhere else a vendor document can only be read.",
        ],
        [
          "Pilih jenis dokumen. SPK untuk pekerjaan Jasa atau Mobilitas, PO untuk Perangkat atau Material. SPK memerlukan vendor bertipe Jasa atau Hybrid; PO memerlukan vendor bertipe Supplier atau Hybrid. Jenis dokumen tidak dapat diubah setelah dokumen dibuat.",
          "Choose the document type. An SPK (Work Order) covers Service or Mobility work; a PO covers Devices or Materials. An SPK needs a Jasa or Hybrid vendor; a PO needs a Supplier or Hybrid vendor. The document type cannot be changed once the document exists.",
        ],
        [
          "Pilih item dari penawaran yang sudah diterima klien, lalu isi kuantitas dan harga vendor. Satu item BoQ tidak boleh dipilih dua kali dalam satu dokumen, dan total alokasi seluruh dokumen aktif tidak boleh melebihi kuantitas pada BoQ.",
          "Select items from the accepted quotation, then enter quantities and vendor prices. One BoQ item may not be selected twice in the same document, and the total allocation across all active documents may not exceed the BoQ quantity.",
        ],
        [
          "Atur termin pembayaran. Isi DP dalam persen bila ada, dan sisanya otomatis menjadi Pelunasan. Jumlah seluruh termin harus sama persis dengan nilai kontrak vendor; bila tidak, aplikasi menyebutkan selisihnya.",
          "Set the payment terms. Enter the down payment as a percentage if there is one; the remainder automatically becomes the final payment. All terms together must equal the vendor contract value exactly; if not, the application states the difference.",
        ],
        [
          "Tekan Ajukan. Lalu Admin atau Finance menekan Setujui. Finance tidak boleh menyetujui dokumen yang ia buat atau ajukan sendiri. Admin yang terpaksa menyetujui pengajuannya sendiri wajib menulis alasan.",
          "Press Submit. Then an Admin or Finance user presses Approve. Finance may not approve a document it created or submitted itself. An Admin who has to approve their own submission must write a reason.",
        ],
        [
          "Tekan Kirim untuk menandai dokumen sudah dikirim ke vendor, lalu tekan Bayar untuk mencatat pembayaran DP.",
          "Press Send to mark the document as sent to the vendor, then press Pay to record the down payment.",
        ],
        [
          "Sebelum termin berikutnya dapat dibayar, buktikan dulu pekerjaannya. Untuk SPK, tekan Verifikasi lalu pilih terminnya, isi nilai yang terverifikasi, persentase progres, dan catatan. Untuk PO, tekan Terima barang lalu isi nomor surat jalan; seluruh sisa item dianggap diterima dan kuantitas yang sudah diterima tidak dihitung dua kali.",
          "Before any later term can be paid, evidence the work first. For an SPK, press Verify, choose the term, and enter the verified amount, the progress percentage, and any notes. For a PO, press Receive and enter the delivery note number; all remaining items are treated as received and previously received quantities are not counted twice.",
        ],
        [
          "Tekan Bayar untuk termin berikutnya. Isi bruto diselesaikan, pajak dipotong, kas aktual dibayar, tanggal bayar, nomor tagihan vendor, referensi pembayaran, dan metode. Untuk Transfer Bank, pilih rekening perusahaan yang aktif. Unggah bukti transfer, lalu tekan Catat pembayaran.",
          "Press Pay for the next term. Enter the gross settled, tax withheld, actual cash paid, payment date, vendor invoice number, payment reference, and method. For a bank transfer, choose an active company account. Upload the transfer receipt, then press Post payment.",
        ],
        [
          "Setelah seluruh kuantitas PO diterima, atau seluruh termin non-DP pada SPK diverifikasi, dokumen boleh diselesaikan. Selesai bersifat final: dokumen yang sudah Selesai tidak dapat diselesaikan lagi, tetapi pelunasan terakhirnya tetap boleh dicatat sesudah itu.",
          "Once every PO quantity has been received, or every non-DP term on an SPK has been verified, the document may be completed. Completion is final: a document already marked Completed cannot be completed again, though its final settlement may still be recorded afterwards.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Dokumen yang sudah disetujui terkunci dan nilainya menjadi komitmen perusahaan. Pajak pada dokumen itu ikut terkunci saat persetujuan. Hanya kas aktual yang masuk Buku Kas. Sisa komitmen yang belum dibayar langsung mengurangi laba yang aman dibagikan.",
        "An approved document is locked and its value becomes a company commitment. Its tax figures lock at approval too. Only the actual cash enters the Cash Ledger. Any unpaid commitment immediately reduces the profit that is safe to distribute.",
      ],
    },
    {
      kind: "note",
      title: ["Disetujui belum berarti boleh dibayar", "Approved does not yet mean payable"],
      text: [
        "Persetujuan adalah keputusan internal; Kirim adalah saat dokumen benar-benar berlaku bagi vendor. Karena itu pembayaran dan penyelesaian baru terbuka setelah dokumen dikirim. Dokumen yang masih berstatus Disetujui — sudah disetujui tetapi belum dikirim ke vendor — ditolak bila dicoba dibayar atau diselesaikan. Tekan Kirim lebih dulu.",
        "Approval is an internal decision; Send is the moment the document actually binds the vendor. Payment and completion therefore only open once the document has been sent. A document still sitting at Approved — signed off internally but never sent to the vendor — is refused for both payment and completion. Press Send first.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mencoba membayar termin kedua sebelum verifikasi atau penerimaan barang dicatat. Aplikasi menolak karena nominalnya melebihi yang sudah berhak dibayar. Catat buktinya lebih dulu.",
          "Trying to pay the second term before verification or goods receipt has been recorded. The application refuses because the amount exceeds what has been earned. Record the evidence first.",
        ],
        [
          "Engineer tidak dapat mencatat verifikasi walau perannya benar. Izin bawaan Engineer untuk Procurement & Vendor hanya Lihat. Minta Admin menaikkannya menjadi Kelola di Pengguna & Akses.",
          "An Engineer cannot record a verification even though the role is right. The Engineer default for Procurement & Vendors is only View. Ask an Admin to raise it to Manage in Users & Access.",
        ],
        [
          "Memakai vendor bertipe Supplier untuk pekerjaan jasa. Tipe vendor harus cocok dengan jenis dokumen, atau pakai vendor bertipe Hybrid.",
          "Using a Supplier-typed vendor for service work. The vendor type must match the document type, or use a Hybrid vendor.",
        ],
        [
          "Membuat SPK sebelum penawaran diterima klien lengkap dengan buktinya. Dokumen vendor selalu bersumber dari pekerjaan yang sudah disetujui klien beserta bukti persetujuannya.",
          "Creating an SPK before the client accepted the quotation together with its proof. Vendor documents always originate from work the client has approved, evidence included.",
        ],
        [
          "Membatalkan dokumen padahal masih ada pembayaran aktif. Void seluruh pembayarannya lebih dulu, dan lepaskan rekonsiliasi bank bila pembayaran itu sudah dicocokkan.",
          "Voiding a document while active payments remain. Void every payment first, and unmatch the bank reconciliation if the payment was already matched.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["Setiap pembayaran menempel pada satu termin", "Every payment belongs to one term"],
      text: [
        "Sejak 21 Agustus 2026 termin wajib dipilih saat mencatat pembayaran vendor. Tanpa termin, status termin tidak pernah bergerak dan dokumen bisa terbaca Lunas dengan semua termin masih Pending. Bukti juga diperiksa PER TERMIN untuk SPK: uang muka boleh dibayar sebesar rencananya, termin lain hanya sebesar verifikasi termin itu sendiri — bukan jumlah verifikasi termin lain.",
        "Since 21 August 2026 a term must be chosen when recording a vendor payment. Without one, term statuses never move and a document can read Paid with every term still Pending. Evidence is also checked PER TERM on a work order: the advance may be paid up to its plan, any other term only up to its own verification — not the sum of other terms' evidence.",
      ],
    },
    {
      kind: "bullets",
      items: [
        ["Status termin dihitung dari pembayaran gross terhadap nilai termin yang sudah termasuk pajak. Termin 1.000.000 dengan PPN 11% baru Paid setelah 1.110.000 gross masuk, bukan 1.000.000.", "Term status compares gross payments against the term value including tax. A 1,000,000 term with 11% VAT is Paid only once 1,110,000 gross has arrived, not 1,000,000."],
        ["Pembayaran yang seluruhnya pajak potong (kas nol) ditolak dengan jelas. Tarif potongan yang ada tidak pernah memakan seluruh pembayaran, jadi itu hampir pasti salah ketik.", "A payment that is entirely withholding tax (zero cash) is refused plainly. No withholding rate in use ever consumes a whole payment, so that is almost certainly a typo."],
        ["Menyunting harga SPK atau PO yang masih Draft ikut menghitung ulang pajaknya. Angka yang dikunci saat disetujui adalah angka harga terakhir, bukan harga saat pajak pertama dipilih.", "Editing the price of a Draft work order or PO recalculates its taxes. The figure locked at approval is the latest price, not the price when the tax was first chosen."],
      ],
    },
  ],
};

export const chapterDocumentEmail: Chapter = {
  id: "document-email",
  title: [
    "Mengirim dokumen resmi lewat email",
    "Sending official documents by email",
  ],
  blocks: [
    {
      kind: "lead",
      text: [
        "SPK dan PO dapat dikirim ke vendor; Quotation, Invoice, dan BAST ke klien — langsung dari dokumennya. Surat pengantarnya disusun server dari template yang Anda simpan, dan PDF resminya dilampirkan aplikasi, bukan berkas yang diunggah ulang seseorang. Yang Anda lihat di pratinjau memang persis yang diterima penerima.",
        "An SPK or PO can be sent to the vendor; a quotation, invoice, or handover certificate to the client — straight from the document itself. The covering letter is composed on the server from a template you saved, and the official PDF is attached by the application rather than re-uploaded by hand. What the preview shows is exactly what the recipient receives.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: [
            "Mengirim SPK atau PO memerlukan izin Kelola pada Procurement & Vendor. Mengirim Quotation atau Invoice memerlukan izin Kelola pada Quotation & Invoice. Mengirim BAST memerlukan izin Kelola pada BAST Digital — bukan Quotation & Invoice, karena yang menandatangani serah terima adalah orang lapangan, bukan yang menagih. Template tiap jenis mengikuti izin yang sama; izin Lihat hanya cukup untuk membaca template dan riwayat.",
            "Sending an SPK or PO requires Manage on Procurement & Vendors. Sending a quotation or invoice requires Manage on Quotations & Invoices. Sending a handover certificate requires Manage on Digital Handover — not Quotations & Invoices, because the people who sign a handover are the site team, not the people who bill. Each type's templates follow the same permission; View is only enough to read the templates and the delivery history.",
          ],
        },
        {
          label: ["Di mana", "Where"],
          value: [
            "Tombol Kirim Email pada dokumennya masing-masing. Templatenya di Procurement & Vendor, tab Template surat.",
            "The Send Email button on each document. The templates live on the Procurement & Vendors screen, under the Letter templates tab.",
          ],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: [
            "Mailserver sudah dikonfigurasi; satu template tersimpan untuk jenis dokumen yang bersangkutan; dan alamat penerima sudah terisi — email vendor di master vendor untuk SPK dan PO, atau alamat email klien pada proyek untuk Quotation, Invoice, dan BAST. Khusus BAST ada satu prasyarat lagi: dokumennya sudah difinalisasi dan belum dicabut.",
            "A configured mail server; one saved template for that document type; and a recipient address already on file — the vendor email in the vendor master for an SPK or PO, or the project's client email for a quotation, invoice, or handover certificate. A handover certificate carries one further prerequisite: it must already be finalised and not revoked.",
          ],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Siapkan templatenya lebih dulu. Buka tab Template surat pada modul dokumennya, lalu pilih jenis: SPK, Quotation, Invoice, atau BAST. Template dibuat per jenis dan tidak dapat dipakai lintas jenis.",
          "Prepare the template first. Open the Letter templates tab on that document's module, then choose the type: SPK, quotation, invoice, or handover certificate. Templates belong to one type and cannot be used across types.",
        ],
        [
          "Tulis subjek dan isi surat. Penanda yang tersedia ditampilkan layar sesuai jenis dokumennya, dan seluruh nilainya diambil dari baris dokumen — tidak ada satu pun yang berasal dari ketikan pengirim.",
          "Write the subject and the body. The available placeholders are listed on screen for that document type, and every value is read from the document record — none of them come from anything the sender types.",
        ],
        [
          "Isi surat dapat berupa teks biasa atau memakai editor kaya. Kop berlogo, identitas perusahaan, tanda tangan, dan alamat kantor ditambahkan aplikasi; tidak ada yang perlu menulis HTML. Kolom tanda tangan yang dikosongkan jatuh ke kontak perusahaan.",
          "The body may be plain text or written in the rich editor. The letterhead with the logo, the company identity, the signature, and the office address are added by the application; nobody needs to write HTML. Signature fields left blank fall back to the company contact details.",
        ],
        [
          "Buka dokumen yang hendak dikirim dan tekan Kirim Email. Pilih template, lalu buat pratinjau. Pratinjau dibuat server, lengkap dengan kop, tanda tangan, penerima, dan PDF dokumennya — bukan tiruan yang digambar di layar.",
          "Open the document you want to send and press Send Email. Choose a template, then generate the preview. The preview is produced by the server, complete with the letterhead, the signature, the recipient, and the document PDF — not an imitation drawn on screen.",
        ],
        [
          "Bila perlu, tambahkan lampiran lain. Dokumen resminya sendiri tidak perlu — dan tidak boleh — diunggah ulang; aplikasi selalu melampirkan versi yang dirender dari data terkini.",
          "Add other attachments if needed. The official document itself never has to be — and must not be — uploaded again; the application always attaches the version rendered from the current data.",
        ],
        [
          "Tekan Kirim. Suratnya masuk antrean, bukan langsung keluar. Riwayat kirim di dialog yang sama menunjukkan keadaannya: Masih diproses, Terkirim, Gagal, atau Dilewati, lengkap dengan penerima, subjek, dan daftar lampirannya.",
          "Press Send. The letter enters a queue rather than leaving immediately. The delivery history in the same dialog shows its state — In progress, Sent, Failed, or Skipped — together with the recipient, the subject, and the list of attachments.",
        ],
      ],
    },
    {
      kind: "note",
      title: [
        "Kirim dan Kirim Email adalah dua hal yang berbeda",
        "Send and Send Email are two different things",
      ],
      text: [
        "Kirim berarti seseorang menyatakan dokumen sudah sampai ke vendor, dengan cara apa pun — diantar, dicetak, dikirim lewat kurir. Ia gerbang yang membuka pembayaran. Kirim Email benar-benar mengirimkan suratnya. Keduanya sengaja dipisah supaya kemampuan membayar dokumen tidak pernah bergantung pada berhasil atau gagalnya satu jabat tangan SMTP. Menekan Kirim Email pada SPK yang sudah Disetujui ikut menandainya Dikirim, karena itu memang tindakan mengirim.",
        "Send means somebody states the document has reached the vendor by whatever means — delivered, printed, couriered. It is the gate that opens payment. Send Email actually sends the letter. The two are kept apart deliberately so that the ability to pay a document never depends on whether one SMTP handshake succeeded. Pressing Send Email on an approved SPK also marks it as Sent, because that genuinely is an act of sending.",
      ],
    },
    {
      kind: "bullets",
      items: [
        [
          "Quotation berstatus Draft yang dikirim lewat email ikut ditandai sudah dikirim, lewat transisi yang sama dengan tombol Tandai sudah dikirim — termasuk penguncian item BoQ-nya. Mengirim penawaran memang menguncinya.",
          "A Draft quotation sent by email is also marked as sent, through the same transition as the Mark as sent button — BoQ item locking included. Sending a quotation does lock it.",
        ],
        [
          "Status Invoice TIDAK berubah karena dikirim. Status invoice adalah keadaan pembayaran, bukan keadaan pengiriman; menumpanginya akan mencampur dua hal yang kebetulan sama-sama bernama status.",
          "An invoice's status does NOT change when it is emailed. An invoice status describes payment, not delivery; overloading it would merge two different things that happen to share the word status.",
        ],
        [
          "PDF SPK yang dikirim ke vendor adalah edisi vendor, yang tidak pernah memuat kolom Budget — harga modal PerumNet per item. Edisi internal hanya dapat diambil dari dalam aplikasi oleh yang memang sudah boleh membacanya.",
          "The SPK PDF sent to a vendor is the vendor edition, which never carries the Budget column — PerumNet's own cost per item. The internal edition can only be fetched from inside the application by someone already entitled to read it.",
        ],
        [
          "BAST hanya dapat dikirim setelah difinalisasi. Selama masih Draft isinya belum tentu sama dengan yang akhirnya berlaku, dan surat yang sudah masuk kotak masuk klien tidak bisa ditarik kembali. BAST yang sudah dicabut juga ditolak: halaman verifikasinya akan menyatakan dokumen itu tidak aktif.",
          "A handover certificate can only be sent once it has been finalised. While it is still a draft its contents may yet change, and a letter already in the client's inbox cannot be recalled. A revoked certificate is refused too: its verification page would declare the document inactive.",
        ],
        [
          "Surat yang gagal dicoba ulang otomatis setelah 1, 5, 15, dan 60 menit. Setelah lima percobaan ia berhenti dan tercatat Gagal, bukan dicoba selamanya.",
          "A failed letter is retried automatically after 1, 5, 15, and 60 minutes. After five attempts it stops and is recorded as Failed rather than retried forever.",
        ],
      ],
    },
    {
      kind: "table",
      widths: [38, 62],
      head: [
        ["Batas lampiran", "Attachment limits"],
        ["Nilai", "Value"],
      ],
      rows: [
        [
          ["Lampiran tambahan per email", "Extra attachments per email"],
          ["5 berkas; dokumen resminya tidak ikut dihitung", "5 files; the official document is not counted"],
        ],
        [
          ["Ukuran satu berkas", "Size of a single file"],
          ["10 MB", "10 MB"],
        ],
        [
          ["Total seluruh lampiran", "Total of all attachments"],
          [
            "10 MB, termasuk dokumen resminya. Banyak gateway email perusahaan membuang lampiran di atas itu tanpa memberi tahu siapa pun.",
            "10 MB, the official document included. Many corporate email gateways silently drop attachments above that.",
          ],
        ],
        [
          ["Jenis berkas", "File types"],
          [
            "PDF, PNG, JPEG, dan WebP. Diperiksa dari isi berkasnya, bukan dari namanya.",
            "PDF, PNG, JPEG, and WebP. Checked from the file contents, not from its name.",
          ],
        ],
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Memakai template Invoice untuk mengirim SPK. Template terikat pada satu jenis dokumen; aplikasi menolak dan menyebutkan jenis template yang sebenarnya.",
          "Using an Invoice template to send an SPK. A template is bound to one document type; the application refuses and states what type the template actually is.",
        ],
        [
          "Mengirim Quotation atau Invoice untuk proyek yang belum punya alamat email klien. Isi lebih dulu di Manajemen Proyek; kolom itu baru ada sejak Agustus 2026 dan proyek lama belum mengisinya.",
          "Sending a quotation or invoice for a project with no client email address. Fill it in first under Project Management; the field is new as of August 2026 and older projects do not have it.",
        ],
        [
          "Mengirim SPK yang belum Disetujui. Hanya dokumen yang sudah disetujui yang boleh dikirim ke vendor, dan pratinjau pun ditolak dengan alasan yang sama.",
          "Sending an SPK that has not been approved. Only approved documents may go to a vendor, and the preview is refused for the same reason.",
        ],
        [
          "Melampirkan ulang PDF dokumennya sendiri. Salinan yang diunggah tangan bisa saja versi lama; yang dilampirkan aplikasi selalu berkas resminya sendiri.",
          "Attaching the document's own PDF again by hand. A hand-uploaded copy may be an old version; the one the application attaches is always the official file itself.",
        ],
        [
          "Mengirim BAST yang masih Draft, lalu memfinalisasinya kemudian. Aplikasi menolak sejak awal — tetapi kalau klien terlanjur menerima berkas lain lewat jalur di luar aplikasi, ia akan memegang dokumen yang sidiknya tidak akan pernah cocok dengan halaman verifikasi.",
          "Sending a handover certificate while it is still a draft and finalising it afterwards. The application refuses from the outset — but if the client has already received some other file through a channel outside the application, they hold a document whose fingerprint will never match the verification page.",
        ],
      ],
    },
    {
      kind: "note",
      title: [
        "Lampiran BAST adalah arsipnya, bukan cetakan baru",
        "A handover attachment is the archive, not a fresh printout",
      ],
      text: [
        "Quotation, Invoice, dan SPK dicetak ulang saat tombol Kirim ditekan — dokumennya masih hidup, jadi yang benar adalah angka terbaru. BAST tidak. Saat difinalisasi, PDF-nya dicetak sekali, disimpan, dan sidik SHA-256-nya dicatat; angka itulah yang dipajang halaman verifikasi publik dan yang ditunjuk QR di dalam PDF-nya. Karena itu surat BAST melampirkan berkas yang tersimpan itu juga, bukan cetakan baru. Cetakan baru akan menghasilkan sidik yang berbeda, dan klien yang membandingkan lampirannya dengan halaman verifikasi akan melihat dua angka yang tidak cocok — lalu menyimpulkan hal yang paling masuk akal: dokumennya palsu. Kalau arsipnya ternyata tidak lagi cocok dengan catatannya, aplikasi menolak mengirim apa pun.",
        "Quotations, invoices, and work orders are re-rendered when Send is pressed — those documents are still live, so the current figures are the right ones. A handover certificate is not. When it is finalised its PDF is rendered once, stored, and its SHA-256 fingerprint recorded; that is the number the public verification page displays and the QR code inside the PDF points to. The covering letter therefore attaches that stored file, not a new rendering. A new rendering would produce a different fingerprint, and a client comparing the attachment against the verification page would see two numbers that disagree — and draw the obvious conclusion: the document is forged. If the archive no longer matches its record, the application refuses to send anything at all.",
      ],
    },
    {
      kind: "note",
      title: ["Di mana template surat dokumen dikelola", "Where document letter templates live"],
      text: [
        "Template surat dokumen berbeda dari template surat Calon Klien, dan memang harus berbeda: penerimanya klien atau vendor yang sudah berkontrak, penandanya nomor dokumen dan nilai, dan PDF resminya ikut dilampirkan. Template SPK dan PO dikelola di Procurement & Vendor; template Quotation dan Invoice di Quotation & Invoice; template BAST di BAST Digital. Izinnya mengikuti jenis dokumennya — sejak 22 Agustus 2026 Finance tidak lagi perlu izin Procurement untuk menulis surat pengantar invoice, dan daftar template yang di luar izin disaring, bukan menolak seluruh layar. Finance yang izin BAST-nya hanya Lihat tetap dapat membaca template BAST, tetapi tidak membuatnya.",
        "Document letter templates differ from the Prospects letter templates, and they should: the recipient is a client or vendor already under contract, the placeholders are document numbers and amounts, and the official PDF is attached. SPK and PO templates are managed under Procurement & Vendors; quotation and invoice templates under Quotations & Invoices; handover templates under Digital Handover. Permissions follow the document type — since 22 August 2026 Finance no longer needs Procurement rights to write an invoice covering letter, and templates outside your permission are filtered out rather than refusing the whole screen. Finance, whose Digital Handover permission is View only, can still read handover templates but not create them.",
      ],
    },
  ],
};

export const chapterHandover: Chapter = {
  id: "handover",
  title: ["Serah terima di lokasi: validasi lalu BAST", "Handover on site: validation, then the certificate"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Serah terima berjalan dua langkah dan tidak dapat dibalik urutannya. Pemeriksaan lapangan harus selesai sepenuhnya sebelum dokumen serah terima boleh dibuat, apalagi difinalkan.",
        "Handover runs in two steps and the order cannot be reversed. The site inspection must be fully complete before the handover document may be created, let alone finalized.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin, Project Manager, atau Engineer dengan izin Kelola pada BAST Digital. Pengaturan cap perusahaan dan pencabutan BAST final hanya oleh Admin.", "Admin, Project Manager, or Engineer with Manage on Digital Handover. Only an Admin configures the company seal or revokes a final certificate."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Validasi Perangkat, lalu BAST Digital.", "Device Validation, then Digital Handover."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["BoQ paket ini memuat minimal satu item Perangkat atau Material, perangkat sudah terpasang, perwakilan klien hadir untuk menandatangani di layar, dan cap perusahaan sudah diunggah serta diaktifkan Admin.", "This package's BoQ contains at least one Device or Material item, the devices are installed, a client representative is present to sign on screen, and the company seal has been uploaded and enabled by an Admin."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Admin membuka BAST Digital dan menekan Pengaturan cap sekali saja untuk seluruh perusahaan. Unggah gambar cap (PNG, JPG, atau WebP maksimal 2 MB dan maksimal 4096 x 4096 piksel), isi nama dan jabatan penanda tangan, lalu centang Aktifkan cap saat finalisasi.",
          "An Admin opens Digital Handover and presses Seal settings once for the whole company. Upload the seal image (PNG, JPG, or WebP up to 2 MB and no larger than 4096 x 4096 pixels), fill in the signer's name and title, then tick Enable seal during finalization.",
        ],
        [
          "Buka Validasi Perangkat dan pastikan paket serta siklus penyerahan yang benar terpilih. Daftar pemeriksaan tersusun otomatis dari item Perangkat dan Material pada BoQ paket ini.",
          "Open Device Validation and make sure the right package and delivery cycle are selected. The checklist is built automatically from the Device and Material items in this package's BoQ.",
        ],
        [
          "Periksa setiap item di lokasi, centang bila sesuai, dan tulis temuan pada kolom catatan. Item bermasalah tetap harus diperiksa dan dicatat temuannya.",
          "Inspect every item on site, tick it when it passes, and record findings in the notes column. Items with problems must still be inspected and their findings recorded.",
        ],
        [
          "Tekan Selesaikan validasi. Tombolnya baru aktif bila seluruh item sudah tercentang.",
          "Press Complete validation. The button only becomes active once every item is ticked.",
        ],
        [
          "Bila BoQ paket ini berubah setelah validasi diselesaikan — misalnya sebuah Addendum menambah Perangkat atau Material — daftar pemeriksaan otomatis kembali menjadi Draft dan seluruh centangnya hilang. Buka lagi Validasi Perangkat, sinkronkan daftarnya, periksa item yang baru di lokasi, lalu selesaikan validasi sekali lagi sebelum BAST dibuat.",
          "If this package's BoQ changes after the checklist was completed — an Addendum adding a Device or Material, for instance — the checklist automatically returns to Draft and every tick is cleared. Open Device Validation again, re-sync the list, inspect the new items on site, and complete the validation once more before creating the certificate.",
        ],
        [
          "Buka BAST Digital, buat dokumen serah terima untuk paket dan siklus tersebut, lalu lengkapi datanya.",
          "Open Digital Handover, create the handover certificate for that package and cycle, then complete its details.",
        ],
        [
          "Minta perwakilan klien menandatangani di layar pada kolom Tanda tangan klien, lalu wakil PerumNet menandatangani pada kolom Tanda tangan PerumNet.",
          "Ask the client's representative to sign on screen in the Client signature panel, then have the PerumNet representative sign in the PerumNet signature panel.",
        ],
        [
          "Tekan Finalkan & unduh PDF. Aplikasi membubuhkan cap perusahaan, mengunci berkasnya, menghitung sidik jari digital SHA-256 atas berkas itu, dan menempelkan QR pemeriksaan keaslian.",
          "Press Finalize & download PDF. The application applies the company seal, locks the file, computes a SHA-256 digital fingerprint of it, and attaches an authenticity QR code.",
        ],
        [
          "Terakhir, tekan Kirim Email untuk mengirimkan BAST final itu ke klien sebagai bukti bahwa suratnya ada. Langkah ini hanya tersedia setelah finalisasi, dan yang dilampirkan adalah arsip yang barusan dikunci — berkas yang sama persis, dengan sidik yang sama persis, dengan yang dipajang halaman verifikasinya.",
          "Finally, press Send Email to deliver that finalised certificate to the client as proof the document exists. This step only appears after finalisation, and what it attaches is the archive just locked — the very same file, with the very same fingerprint, that the verification page displays.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "BAST menjadi Final dan tidak dapat diedit maupun dihapus. Status proyek berubah menjadi Selesai hanya bila serah terima ini adalah yang terakhir: setiap paket komersial yang penawarannya sudah diterima klien harus memiliki BAST final yang aktif dan belum dicabut. Selama masih ada paket yang berjalan, proyek tetap Aktif. Berkas PDF yang tersimpan itulah yang diunduh berikutnya, bukan hasil cetak ulang. Siapa pun yang memindai QR pada PDF dapat memeriksa apakah dokumen itu asli dan masih berlaku. Bila ada kekeliruan, Admin mencabut dokumennya dengan alasan tertulis, lalu tim membuat BAST baru untuk paket dan siklus yang sama.",
        "The certificate becomes Final and can be neither edited nor deleted. The project status changes to Completed only when this handover is the last one: every commercial package with a client-accepted quotation must have an active, unrevoked final certificate. While any package is still running, the project stays Active. The stored PDF is what is downloaded afterwards, never a fresh re-print. Anyone who scans the QR code on the PDF can check whether the document is genuine and still valid. If something is wrong, an Admin revokes it with a written reason, and the team then creates a new certificate for the same package and cycle.",
      ],
    },
    {
      kind: "note",
      title: ["Checklist yang sudah dipakai BAST final ikut terkunci", "A checklist a final certificate was issued against locks too"],
      text: [
        "Begitu sebuah BAST difinalisasi untuk paket dan siklus tersebut, daftar pemeriksaan yang menjadi dasarnya ikut terkunci: centangnya tidak dapat diubah dan statusnya tidak dapat dikembalikan ke Draft. Alasannya sederhana — daftar itu adalah bukti serah terima yang sudah ditandatangani dan dicap, dan menariknya kembali berarti menghapus bukti dokumen yang masih berlaku. Selama BAST-nya masih Draft daftar itu tetap boleh diubah, karena finalisasi memeriksa ulang kelengkapannya. Bila daftarnya perlu diperiksa ulang setelah final, cabut BAST-nya lebih dulu; setelah itu daftar pemeriksaan dapat disinkronkan dan dicentang kembali.",
        "Once a handover certificate has been finalized for that package and cycle, the checklist behind it locks as well: its ticks can no longer be changed and its status cannot be returned to Draft. The reason is simple — that checklist is the evidence behind a signed and sealed handover, and withdrawing it would erase the evidence for a document that is still valid. While the certificate is still a Draft the checklist may still be edited, because finalization re-checks it. If the checklist needs redoing after finalization, revoke the certificate first; it can then be re-synced and re-checked.",
      ],
    },
    {
      kind: "note",
      title: ["Mencabut BAST final dan menerbitkannya ulang", "Revoking a final certificate and re-issuing it"],
      text: [
        "Hanya Admin yang dapat mencabut BAST final, dan alasannya wajib ditulis. Dokumen yang dicabut tidak pernah dihapus: statusnya menjadi Batal, alasan serta waktu pencabutannya tersimpan, dan halaman pemeriksaan QR akan menyatakan dokumen itu sudah tidak berlaku. Karena serah terima itulah yang menutup proyek, pencabutan juga membuka kembali proyeknya: bila setelah pencabutan masih ada paket yang penawarannya diterima klien tetapi belum punya BAST aktif, status proyek kembali menjadi Aktif. Setelah itu tim membuat BAST baru untuk paket dan siklus yang sama; dokumen baru tersebut tercatat sebagai revisi berikutnya (Revisi 2, 3, dan seterusnya), sementara dokumen yang dicabut tetap tersimpan sebagai riwayat.",
        "Only an Admin may revoke a final certificate, and a written reason is mandatory. A revoked document is never deleted: its status becomes Void, the reason and the moment of revocation are stored, and the QR verification page reports the document as no longer valid. Because it is the handover that closes the project, revoking one re-opens it: if any package with a client-accepted quotation is left without an active certificate, the project status returns to Active. The team then creates a new certificate for the same package and cycle; that new document is recorded as the next revision (Revision 2, 3, and so on) while the revoked one is kept as history.",
      ],
    },
    {
      kind: "note",
      title: [
        "Mengirim BAST ke klien sebagai bukti",
        "Emailing the certificate to the client as proof",
      ],
      text: [
        "BAST yang sudah final dapat dikirim ke alamat email klien pada proyek, lengkap dengan surat pengantar dari template BAST. Penandanya memuat nomor dokumen, nama paket, tanggal serah terima, sidik SHA-256, dan tautan halaman verifikasi — tautan yang sama dengan QR di dalam PDF-nya, sehingga klien yang mengeklik dari email dan yang memindai dari kertas mendarat di halaman yang sama. Yang dilampirkan adalah arsip finalnya, bukan cetakan baru; kalau arsipnya tidak lagi cocok dengan sidik yang tercatat, aplikasi menolak mengirim. BAST yang masih Draft dan yang sudah dicabut sama-sama ditolak. Riwayat pengirimannya tersimpan permanen bersama lampirannya, karena pertanyaan \"kapan BAST ini kita kirim, ke alamat mana\" biasanya muncul bertahun-tahun kemudian, saat ada sengketa.",
        "A finalised certificate can be emailed to the project's client address with a covering letter drawn from a handover template. Its placeholders carry the document number, the package name, the handover date, the SHA-256 fingerprint, and the verification link — the same link the QR code inside the PDF points to, so a client clicking from the email and one scanning from paper land on the same page. What is attached is the final archive, not a fresh printout; if the archive no longer matches its recorded fingerprint, the application refuses to send. Draft and revoked certificates are both refused. The delivery history is kept permanently along with its attachments, because the question \"when did we send this certificate, and to what address\" usually surfaces years later, during a dispute.",
      ],
    },
    {
      kind: "note",
      title: ["Status hukum cap digital", "The legal standing of the digital seal"],
      text: [
        "Cap dan QR pada BAST adalah segel internal PerumNet yang membuat pemalsuan mudah terdeteksi: berkasnya dikunci, sidik jari digitalnya disimpan, dan halaman pemeriksaan akan menolak berkas yang isinya sudah diubah. Fitur ini bukan Tanda Tangan Elektronik Tersertifikasi dan PerumNet bukan Penyelenggara Sertifikasi Elektronik (PSrE). Bila sebuah dokumen memerlukan tanda tangan elektronik tersertifikasi menurut hukum, gunakan penyedia PSrE terdaftar di luar aplikasi ini.",
        "The seal and QR code on a handover certificate are PerumNet's own internal seal, designed to make tampering easy to detect: the file is locked, its digital fingerprint is stored, and the verification page rejects a file whose contents have changed. This is not a Certified Electronic Signature and PerumNet is not a certified electronic certification provider (PSrE). If a document legally requires a certified electronic signature, use a registered PSrE provider outside this application.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Membuat BAST sebelum validasi diselesaikan. Aplikasi menolak pada saat pembuatan dan sekali lagi pada saat finalisasi.",
          "Creating a certificate before validation is complete. The application refuses at creation and again at finalization.",
        ],
        [
          "Menerbitkan BAST atas validasi lama sesudah Addendum diterima. Aplikasi menolak karena daftar pemeriksaan itu tidak pernah mencakup item tambahannya; validasi harus disinkronkan dan dicentang ulang.",
          "Issuing a certificate against an old validation after an Addendum was accepted. The application refuses because that checklist never covered the extra items; the validation has to be re-synced and re-checked.",
        ],
        [
          "Mengedit BoQ setelah checklist diselesaikan. Setiap perubahan item BoQ mengembalikan checklist ke status Draft dan menghapus centangnya, sehingga pemeriksaan harus diulang.",
          "Editing the BoQ after the checklist was completed. Any change to a BoQ item returns the checklist to Draft and clears the ticks, so the inspection has to be redone.",
        ],
        [
          "Finalisasi tanpa cap perusahaan yang aktif. Cap harus sudah diunggah dan sakelarnya dinyalakan, bukan sekadar diunggah.",
          "Finalizing without an active company seal. The seal must be uploaded and its switch turned on, not merely uploaded.",
        ],
        [
          "Menunggu status proyek berubah menjadi Selesai setelah memfinalkan BAST paket pertama. Pada proyek dengan beberapa paket, proyek baru berstatus Selesai setelah paket terakhir yang penawarannya diterima klien ikut diserahterimakan. Periksa daftar paket bila statusnya belum berubah.",
          "Waiting for the project status to flip to Completed after finalizing the first package's certificate. On a multi-package project, the project only reads Completed once the last package with a client-accepted quotation has been handed over too. Check the package list if the status has not changed yet.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["BAST hanya menutup proyek yang punya kontrak", "A certificate only closes a project that has a contract"],
      text: [
        "Proyek menjadi Selesai ketika setiap paket yang punya quotation diterima klien sudah punya BAST final. Proyek yang belum punya satu pun quotation diterima tetap Aktif walau BAST-nya final — dulu BAST pertama langsung menutupnya tanpa kontrak. Finalisasi sekarang menang-atau-kalah utuh: status Final, PDF, cap digital, dan penutupan proyek ditulis bersama.",
        "A project becomes Selesai when every package with a client-accepted quotation carries a final certificate. A project with no accepted quotation at all stays active even after a final certificate — the first certificate used to close it without any contract. Finalisation is now all-or-nothing: the Final status, the PDF, the digital seal, and the project closeout are written together.",
      ],
    },
  ],
};

export const chapterExpenses: Chapter = {
  id: "expenses",
  title: ["Mencatat belanja proyek", "Recording project purchases"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Setiap nota lapangan melewati verifikasi Finance. Yang menentukan bagaimana uangnya dicatat bukan nominalnya, melainkan sumber dananya: rekening perusahaan, uang muka proyek, atau uang pribadi pegawai.",
        "Every field receipt passes through Finance verification. What decides how the money is recorded is not the amount but the funding source: company account, project advance, or the employee's own money.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin, Project Manager, atau Engineer mencatat. Admin atau Finance memverifikasi, tetapi tidak pernah pengajuannya sendiri. Pencairan uang muka oleh Admin atau Finance. Pembatalan belanja yang sudah disetujui hanya oleh Admin.", "Admin, Project Manager, or Engineer records them. Admin or Finance verifies, but never their own submission. Advances are disbursed by Admin or Finance. Only an Admin may void an approved purchase."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Belanja Proyek. Menu ini mengikuti izin Belanja Proyek tersendiri; unduhan laporannya juga memerlukan izin Pembukuan minimal Lihat.", "Project Expenses. This menu follows its own Project Expenses permission; downloading its report also requires at least View on Finance."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Foto atau PDF nota (JPG, PNG, WebP, atau PDF, maksimal 10 MB per berkas dan paling banyak lima berkas per pengajuan), nama toko, kategori biaya, sumber dana, dan metode pembayaran.", "Photos or PDFs of the receipts (JPG, PNG, WebP, or PDF, up to 10 MB each and at most five files per submission), the merchant name, expense category, funding source, and payment method."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Tekan Catat belanja, lalu isi proyek, tanggal pembelian, nama toko, kategori biaya, dan nominal.",
          "Press Record expense, then fill in the project, purchase date, merchant, expense category, and amount.",
        ],
        [
          "Pilih Sumber dana: Rekening perusahaan, Uang muka proyek, atau Uang pribadi pegawai.",
          "Choose the Funding source: Company account, Project advance, or Employee paid.",
        ],
        [
          "Pilih Metode pembayaran: Tunai, QRIS, atau Transfer Bank. Untuk belanja rekening perusahaan yang dibayar lewat Transfer Bank, aplikasi mewajibkan Anda menyebut rekening perusahaan mana yang dipakai. Rekening itu diambil dari daftar rekening aktif di Pembukuan.",
          "Choose the Payment method: Cash, QRIS, or Bank transfer. For a company-account purchase paid by bank transfer, the application requires you to name which company account was used. That account is taken from the active accounts list in Finance.",
        ],
        [
          "Untuk belanja yang dibayar dengan uang pribadi, isi Dana pribadi milik. Isinya boleh Anda sendiri atau anggota proyek lain yang masih aktif. Utang reimbursement dicatat atas nama orang inilah, bukan otomatis atas nama pengaju.",
          "For a purchase paid with personal money, fill in Personal funds owner. It may be yourself or another active project member. The reimbursement payable is recorded in that person's name, not automatically in the submitter's name.",
        ],
        [
          "Unggah nota, lalu tekan Kirim ke Finance. Pengajuan tanpa nota tidak dapat dikirim. Berkas yang isinya persis sama dengan nota yang sudah pernah diunggah akan ditolak.",
          "Upload the receipt, then press Send to Finance. A submission without a receipt cannot be sent. A file whose contents are identical to a receipt already uploaded elsewhere is rejected.",
        ],
        [
          "Finance memeriksa nota, kategori, sumber dana, dan peringatan kemungkinan pencatatan ganda, lalu memilih tanggal penyelesaian, rekening perusahaan atau uang muka yang dipakai, dan referensi pembayaran, kemudian menekan Setujui.",
          "Finance reviews the receipt, category, funding source, and any possible-duplicate warning, then chooses the settlement date, the company account or advance used, and a payment reference, and presses Approve.",
        ],
        [
          "Untuk belanja yang memakai uang muka, Finance mencairkan uang mukanya lebih dulu lewat tombol Uang muka. Isi penerima (harus anggota proyek berperan Project Manager atau Engineer), nominal, dan rekening perusahaan sumbernya.",
          "For a purchase charged to an advance, Finance disburses the advance first using the Advance button. Enter the recipient (who must be a project member with the Project Manager or Engineer role), the amount, and the source company account.",
        ],
        [
          "Untuk belanja yang memakai uang pribadi, Finance kemudian menekan Bayar reimbursement, mengisi nominal, rekening perusahaan, dan referensi pembayaran, lalu menekan Catat pembayaran. Reimbursement boleh dibayar bertahap.",
          "For an employee-paid purchase, Finance later presses Pay reimbursement, enters the amount, the company account, and a payment reference, then presses Record payment. Reimbursements may be paid in stages.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Belanja yang disetujui terkunci: tidak dapat diedit, dihapus, maupun ditambah lampirannya. Belanja rekening perusahaan langsung mencatat kas keluar, dan rekening yang Anda pilih ikut tersimpan pada catatan penyelesaiannya sehingga pencocokan mutasi bank nanti dapat menemukannya. Belanja uang muka hanya mengurangi saldo uang muka dan tidak membuat kas keluar untuk kedua kalinya. Belanja uang pribadi menjadi utang reimbursement.",
        "An approved purchase is locked: it can no longer be edited, deleted, or given more attachments. A company-account purchase posts cash out immediately, and the account you chose is stored on its settlement record so the later bank match can find it. An advance-funded purchase only reduces the advance balance and never posts cash out a second time. An employee-paid purchase becomes a reimbursement payable.",
      ],
    },
    {
      kind: "note",
      title: ["Yang membelanjakan bukan yang menyetujui", "Whoever spends is not whoever approves"],
      text: [
        "Finance hanya menyetujui belanja orang lain. Bila pengajuannya dibuat, dikirim, atau uangnya ditalangi oleh akun Finance itu sendiri, aplikasi menolak persetujuannya dan meminta orang lain yang memverifikasi — Admin atau pengguna Finance yang lain. Aturannya sama persis dengan persetujuan SPK dan PO. Admin boleh menerobos bila memang tidak ada pilihan lain, tetapi wajib menuliskan alasannya, dan alasan itu tersimpan di audit log bersama nama serta waktunya.",
        "Finance only approves other people's spending. If the submission was recorded, sent, or fronted by that same Finance account, the application refuses the approval and asks someone else to verify it — an Admin or another Finance user. The rule is exactly the same as for Work Order and PO approvals. An Admin may override when there really is no alternative, but must write a reason, and that reason is stored in the audit log together with their name and the time.",
      ],
    },
    {
      kind: "note",
      title: ["Uang muka hanya dapat dipakai bila memang ada saldonya", "An advance can only be used when a balance actually exists"],
      text: [
        "Pilihan Uang muka proyek mati selama proyek belum punya saldo uang muka yang belum habis dipakai. Ini disengaja agar tidak ada nota yang menunjuk uang muka yang belum pernah dicairkan. Finance mencairkan uang mukanya dulu lewat tombol Uang muka, barulah pilihannya menyala. Pada jendela pencairan, aplikasi menampilkan berapa kas yang sudah masuk dari invoice proyek ini sebagai bahan pertimbangan saja; angka itu tidak membatasi besaran pencairan.",
        "The Project advance option stays disabled while the project has no unspent advance balance. This is deliberate, so no receipt can point at an advance that was never disbursed. Finance disburses the advance first using the Advance button, and only then does the option light up. In the disbursement window the application shows how much cash has come in from this project's invoices as background for the decision only; that figure does not cap the disbursement.",
      ],
    },
    {
      kind: "note",
      title: ["Void mengembalikan saldo uang muka dan membukanya kembali", "Voiding gives the advance balance back and reopens it"],
      text: [
        "Uang muka yang terpakai habis otomatis berstatus Selesai. Bila belanja yang memakainya kemudian di-void oleh Admin, saldonya kembali dan status uang muka itu kembali menjadi Terbuka, sehingga saldo tersebut benar-benar dapat dipakai lagi untuk nota berikutnya. Untuk pencairan yang memang salah catat dan belum tersentuh sama sekali, Admin dapat membatalkan uang mukanya langsung; aplikasi mencatat pembalik kasnya. Bila sebagian sudah dipakai atau sudah dikembalikan, atau pencairannya sudah cocok dengan mutasi bank, pembatalan ditolak — gunakan pengembalian uang muka, karena uangnya memang sudah keluar.",
        "An advance drawn down to zero closes as Settled. If the purchase that consumed it is later voided by an Admin, the balance comes back and the advance returns to Open, so that restored balance really can fund the next receipt. For a disbursement that was simply recorded in error and never touched, an Admin can void the advance itself; the application posts the reversing cash entry. If any of it has been spent or returned, or the disbursement is already matched to a bank entry, the void is refused — record an advance return instead, because the money genuinely left.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mengisi Dana pribadi milik dengan nama pengaju padahal uangnya ditalangi orang lain. Utang reimbursement akan mengikuti nama yang tertulis di sini, jadi salah isi berarti salah bayar.",
          "Entering the submitter's name in Personal funds owner when someone else actually fronted the money. The reimbursement payable follows the name written here, so a wrong entry means paying the wrong person.",
        ],
        [
          "Memilih Transfer Bank tanpa menyebut rekening perusahaan. Aplikasi menolak, dan tanpa rekening itu mutasi bank tidak akan pernah cocok.",
          "Choosing Bank transfer without naming the company account. The application refuses, and without that account the bank entry will never reconcile.",
        ],
        [
          "Mengabaikan peringatan kemungkinan pencatatan ganda. Periksa nomor dokumen yang disebut pada peringatan. Bila memang belanja berbeda, kirim ulang dan setujui peringatannya; bila ternyata sama, batalkan pengajuan.",
          "Ignoring the possible-duplicate warning. Check the document number quoted in the warning. If it really is a different purchase, submit again and confirm the warning; if it is the same one, cancel the submission.",
        ],
        [
          "Menghapus belanja yang salah setelah disetujui. Yang benar: Admin melakukan Void dengan reversal, yang membuat catatan pembalik dan menjaga jejaknya tetap utuh. Lepaskan rekonsiliasi banknya lebih dulu bila sudah dicocokkan.",
          "Deleting a wrong purchase after approval. The correct route: an Admin performs Void with reversal, which posts a reversing entry and keeps the trail intact. Unmatch the bank reconciliation first if it was already matched.",
        ],
        [
          "Berharap dapat menyetujui belanja yang Anda ajukan sendiri dengan menuliskan alasan. Untuk akun Finance hal ini tidak mungkin sama sekali; mintakan persetujuan kepada Admin atau rekan Finance yang lain.",
          "Expecting to approve your own submission by writing a reason. For a Finance account this is simply not possible; ask an Admin or another Finance colleague to approve it.",
        ],
      ],
    },
  ],
};

export const chapterBank: Chapter = {
  id: "bank",
  title: ["Mencocokkan mutasi bank", "Matching bank statement entries"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Rekonsiliasi adalah pengaman terakhir terhadap pencatatan ganda. Setiap baris mutasi rekening harus punya pasangan tepat satu catatan di aplikasi, atau dinyatakan bukan urusan proyek.",
        "Reconciliation is the last safeguard against double recording. Every line on the bank statement must be paired with exactly one record in the application, or declared as none of the projects' business.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin dan Finance mengimpor dan mencocokkan. Penambahan, perubahan, dan penghapusan rekening perusahaan hanya oleh Admin, begitu pula penghapusan baris mutasi.", "Admin and Finance import and match. Only an Admin may add, change, or delete a company bank account, or delete a statement line."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Pembukuan, bagian Rekening perusahaan.", "Finance, the Company banking section."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["E-statement PDF asli dari internet banking dengan teks yang dapat diseleksi, maksimal 5 MB. Alternatifnya CSV maksimal 2 MB yang memuat kolom tanggal, keterangan, serta mutasi atau debit/kredit. Satu berkas maksimal 5.000 baris.", "An original e-statement PDF from internet banking with selectable text, up to 5 MB. Alternatively a CSV up to 2 MB containing date, description, and either a movement or debit/credit column. One file may hold at most 5,000 lines."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Admin menambahkan rekening perusahaan beserta saldo awalnya. Saldo awal terkunci setelah rekening itu punya aktivitas.",
          "An Admin adds the company account together with its opening balance. The opening balance locks once the account has activity.",
        ],
        [
          "Pilih rekening dan bulan mutasi, unggah berkasnya, lalu tekan Impor mutasi. Untuk PDF, periode dan empat digit terakhir nomor rekening di dalam berkas harus cocok dengan yang Anda pilih.",
          "Choose the account and the statement month, upload the file, then press Import statement. For a PDF, the period and the last four digits of the account number inside the file must match your selection.",
        ],
        [
          "Baris yang pernah diimpor otomatis dilewati, sehingga mengunggah ulang berkas yang sama tidak menghasilkan data ganda. Saat impor, baris yang punya tepat satu pasangan dengan arah dan nominal sama dalam rentang tiga hari langsung dicocokkan sendiri.",
          "Lines that were imported before are skipped automatically, so re-uploading the same file produces no duplicates. During import, a line with exactly one counterpart of the same direction and amount within three days is matched automatically.",
        ],
        [
          "Untuk mutasi yang belum cocok, buka daftar kandidat lalu tekan Cocokkan. Di sini aplikasi menawarkan catatan dengan arah dan nominal sama dalam rentang 14 hari.",
          "For entries that are still unmatched, open the candidate list and press Match. Here the application offers records with the same direction and amount within a 14-day window.",
        ],
        [
          "Mutasi yang bukan urusan proyek, misalnya biaya administrasi bank atau mutasi pribadi, dapat dikecualikan dari pembukuan. Mutasi yang dikecualikan dapat dikembalikan sewaktu-waktu, dan saat dikembalikan ia menempel lagi ke catatan yang sama seperti sebelum dikecualikan, bukan membuat catatan bank baru.",
          "Entries that have nothing to do with the projects, such as bank charges or personal movements, can be excluded from the books. An excluded entry can be restored at any time, and on restore it re-attaches to the very record it was booked against before, rather than creating a fresh bank record.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Pencocokan menghapus catatan bank yang menduplikasi, bukan catatan Invoice atau SPK yang menjadi sumbernya. Pembayaran yang sudah dicocokkan harus dilepas pencocokannya sebelum dapat di-void, baik itu pembayaran invoice, pembayaran vendor, belanja proyek, settlement pajak, maupun bagi hasil. Transaksi manual yang sudah dicocokkan pun ikut terkunci: ia tidak dapat diedit maupun dihapus sebelum pencocokannya dilepas.",
        "Matching removes the duplicating bank record, never the Invoice or Work Order record that is its source. A payment that has been matched must be unmatched before it can be voided, whether it is an invoice payment, a vendor payment, a project expense, a tax settlement, or a profit share. A manual entry that has been matched locks in the same way: it can be neither edited nor deleted until the reconciliation is released.",
      ],
    },
    {
      kind: "note",
      title: ["Mutasi yang belum dicocokkan tidak dihitung sebagai kas", "An unreconciled entry is not counted as cash"],
      text: [
        "Baris mutasi yang tidak memiliki pasangan tunggal saat impor tetap masuk daftar, tetapi tidak ikut dihitung dalam Kas masuk, Kas keluar, Kas bersih, grafik bulanan, laba proyek, maupun laba yang aman dibagikan. Alasannya sederhana: baris itu hampir selalu adalah uang yang sudah tercatat lewat invoice, pembayaran vendor, atau setoran pajak, sehingga menghitungnya berarti menghitung uang yang sama dua kali. Ringkasan Pembukuan menampilkan jumlah mutasi yang belum dicocokkan secara terpisah supaya angkanya terlihat, bukan tersembunyi. Begitu mutasi itu dicocokkan, ia langsung ikut terhitung melalui catatan sumbernya.",
        "A statement line that had no single counterpart at import still appears in the list, but it is left out of Cash in, Cash out, Net cash, the monthly chart, project profit, and the profit that is safe to distribute. The reason is simple: such a line is nearly always money that an invoice, a vendor payment, or a tax settlement already recorded, so counting it would count the same money twice. The Finance summary reports the unreconciled figure separately so it stays visible rather than hidden. As soon as the entry is matched it counts again, through its source record.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mengunggah hasil scan atau tangkapan layar. Gunakan e-statement asli yang teksnya dapat diseleksi; berkas gambar tidak dapat dibaca aplikasi.",
          "Uploading a scan or a screenshot. Use the original e-statement whose text can be selected; an image file cannot be read by the application.",
        ],
        [
          "Membuat transaksi manual di Buku Kas untuk kas yang sudah berasal dari mutasi, invoice, atau SPK. Inilah cara paling cepat merusak angka laporan. Catatan yang dibuat aplikasi sendiri memang tidak dapat diedit atau dihapus dari Buku Kas; perbaikannya selalu lewat dokumen sumbernya.",
          "Creating a manual entry in the Cash Ledger for cash that already came from a statement, an invoice, or a Work Order. This is the fastest way to break the report figures. Entries the application posts itself cannot be edited or deleted from the Cash Ledger at all; they are always corrected through their source document.",
        ],
        [
          "Menghapus rekening yang pernah dipakai. Aplikasi menolak; nonaktifkan rekeningnya agar histori tetap utuh.",
          "Deleting an account that has been used. The application refuses; deactivate the account instead so the history stays intact.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["Jendela pencocokan 14 hari, satu angka untuk semua", "A 14-day matching window, one figure everywhere"],
      text: [
        "Sejak 21 Agustus 2026 pencocokan otomatis saat impor, daftar kandidat, dan pencocokan manual memakai jendela yang sama: 14 hari dari tanggal mutasi. Dulu otomatis memakai 3 hari (terlalu sempit untuk kliring akhir pekan), kandidat 14 hari, dan pencocokan manual tanpa batas sama sekali.",
        "Since 21 August 2026 automatic matching on import, the candidate list, and manual matching all use the same window: 14 days from the statement date. Automatic matching used to allow 3 days (too narrow for weekend clearing), candidates 14, and manual matching no limit at all.",
      ],
    },
    {
      kind: "bullets",
      items: [
        ["Bila beberapa transaksi sama arah, nominal, dan tanggalnya, yang dibayar lewat rekening yang sedang diimpor yang dicocokkan. Kalau masih lebih dari satu, tidak ada yang dicocokkan otomatis — lebih baik menunggu tangan manusia daripada salah pasang.", "When several transactions share direction, amount, and date, the one paid through the account being imported is matched. If more than one remains, nothing is matched automatically — better to wait for a human than to pair the wrong one."],
        ["Mutasi yang tidak cocok tetap tercatat tetapi tidak dihitung sebagai kas; Buku Kas dan laba aman dibagikan tidak pernah menghitung uang yang sama dua kali.", "An unmatched line stays recorded but never counts as cash; the Cash Ledger and distributable profit never count the same money twice."],
      ],
    },
  ],
};

export const chapterTax: Chapter = {
  id: "tax",
  title: ["Menutup pembukuan dan mengurus pajak", "Closing the books and handling tax"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Modul pajak adalah alat pencatatan operasional, bukan penasihat pajak. Perusahaan sendiri yang menetapkan kode, tarif, cakupan, efek, dan perlakuan akuntansinya; aplikasi hanya menghitung dan mengingat.",
        "The tax module is an operational record-keeping tool, not a tax adviser. The company itself sets the code, rate, scope, effect, and accounting treatment; the application only calculates and remembers.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin dan Finance dengan izin Pembukuan Kelola menjalankan pelaporan dan setoran. Mengaktifkan modul pajak, mengelola master aturan, dan membatalkan setoran hanya oleh Admin.", "Admin and Finance with Manage on Finance handle reporting and settlement. Enabling the tax module, managing the master rules, and voiding a settlement are Admin only."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Pembukuan, bagian posisi dan settlement pajak.", "Finance, the tax position and settlement section."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Bukti setor pajak (PDF, PNG, JPG, atau WebP) yang wajib dilampirkan, nomor referensi, dan rekening perusahaan yang dipakai membayar.", "The tax payment receipt (PDF, PNG, JPG, or WebP), which is mandatory, a reference number, and the company bank account used to pay."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Admin mengaktifkan modul pajak, lalu mengisi master aturan: kode, nama, tarif, cakupan (Klien, Vendor, atau Keduanya), efek (Tambah atau Potong), dan perlakuan akuntansinya. Aturan bawaan dikirim dengan tarif nol dan status Nonaktif, jadi harus diisi lebih dulu sebelum dapat dipakai.",
          "An Admin enables the tax module, then fills in the master rules: code, name, rate, scope (Client, Vendor, or Both), effect (Add or Withhold), and accounting treatment. The shipped presets carry a zero rate and Inactive status, so they must be filled in before they can be used.",
        ],
        [
          "Aturan pajak dipilih pada penawaran selagi masih Draft. Nilainya terkunci ketika penawaran diterima klien, lalu diwariskan ke seluruh invoice terminnya.",
          "Tax rules are chosen on a quotation while it is still a Draft. The amounts lock when the client accepts the quotation and are then inherited by all of its installment invoices.",
        ],
        [
          "Posisi pajak muncul di Pembukuan setelah dokumen sumbernya terkunci, dengan arah Utang atau Piutang sesuai perlakuan akuntansi aturannya. Posisi pajak dari penawaran belum terbentuk; yang membentuknya adalah invoice dan dokumen procurement.",
          "Tax positions appear in Finance once the source document is locked, with a Payable or Receivable direction according to the rule's accounting treatment. A quotation does not yet create a tax position; invoices and procurement documents do.",
        ],
        [
          "Tekan Lapor untuk mencatat masa pajak, nomor faktur pajak, tanggal faktur, dan referensi pelaporan. Untuk menandai status Dilaporkan, referensi pelaporan wajib diisi.",
          "Press Report to record the tax period, tax invoice number, invoice date, and reporting reference. To mark the status as Reported, the reporting reference is mandatory.",
        ],
        [
          "Status pelaporan hanya bergerak maju: Kandidat, Siap, Dilaporkan, lalu Selesai. Membatalkan (Void) masih bebas selama posisi itu belum dilaporkan. Setelah dilaporkan, hanya Admin yang dapat menurunkan statusnya dan wajib menuliskan alasannya; tanggal serta identitas pelapor tidak pernah dihapus, sehingga bukti bahwa laporan pernah dikirim tetap ada.",
          "The reporting status only moves forward: Candidate, Ready, Reported, then Settled. Voiding is still free while the position has not been reported. Once it has, only an Admin may lower the status and must state a reason; the filing date and the identity of whoever filed it are never erased, so the evidence that a return was submitted always survives.",
        ],
        [
          "Tekan Settlement untuk mencatat penyetoran: nominal, tanggal, referensi pembayaran, metode, dan rekening perusahaan bila metodenya Transfer Bank. Unggah bukti setornya, karena lampiran ini wajib.",
          "Press Settlement to record the payment: amount, date, payment reference, method, and the company bank account when the method is a bank transfer. Upload the payment receipt, as this attachment is mandatory.",
        ],
        [
          "Tutup bulan dengan mengekspor laporan dari Pembukuan: PDF untuk arsip yang dibaca manusia dan CSV untuk pemeriksaan angka. Laporan mengikuti periode, proyek, bahasa, kategori, dan rekening yang Anda pilih.",
          "Close the month by exporting the reports from Finance: the PDF as the human-readable archive and the CSV for checking the figures. The report follows the period, project, language, category, and account you select.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Nilai pajak pada dokumen lama tidak ikut berubah walaupun tarif master diperbarui kemudian, karena tarif yang berlaku sudah menempel pada dokumen saat dikunci. Setoran pajak yang dicatat langsung membentuk transaksi kas: kas keluar untuk Utang, kas masuk untuk Piutang. Angka pada laporan berasal dari transaksi kas nyata, bukan dari laporan laba rugi akuntansi.",
        "Tax amounts on older documents never change when a master rate is updated later, because the applicable rate was attached to the document when it locked. A recorded settlement immediately creates a cash entry: cash out for a Payable, cash in for a Receivable. Report figures come from real cash movements, not from an accounting profit-and-loss statement.",
      ],
    },
    {
      kind: "note",
      title: ["Batasan tanggung jawab", "Scope of responsibility"],
      text: [
        "Aplikasi tidak menentukan jenis pajak yang seharusnya dikenakan, tidak memilihkan tarif, dan tidak menggantikan pelaporan resmi. Keputusan atas jenis, tarif, dan perlakuan pajak tetap berada pada Admin dan Finance bersama penasihat pajak perusahaan.",
        "The application does not decide which tax should apply, does not choose rates, and does not replace official filing. Decisions on tax type, rate, and treatment remain with Admin and Finance together with the company's tax adviser.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Memakai aturan pajak yang tarifnya masih nol atau statusnya masih Nonaktif. Aplikasi menolaknya; lengkapi dulu master aturannya.",
          "Using a tax rule whose rate is still zero or whose status is still Inactive. The application refuses; complete the master rule first.",
        ],
        [
          "Mengubah tarif master lalu berharap dokumen lama ikut berubah. Tidak akan. Bila dokumen lama memang keliru dan belum diterima klien, perbaiki dokumennya, bukan tarif masternya.",
          "Changing a master rate and expecting older documents to follow. They will not. If an older document really is wrong and has not been accepted yet, fix the document, not the master rate.",
        ],
        [
          "Menurunkan status pelaporan agar invoice-nya bisa dihapus. Itu menghapus jejak pelaporan yang sudah dikirim ke DJP. Bila invoice memang keliru, koreksi lewat pembatalan setoran dan penerbitan dokumen pengganti, bukan lewat mengubah status pelaporan.",
          "Lowering the reporting status just to unlock an invoice for deletion. That erases the trail of a return already filed with the tax office. If an invoice really is wrong, correct it by voiding the settlement and issuing a replacement document, not by moving the reporting status.",
        ],
        [
          "Menghapus invoice yang kewajiban pajaknya sudah dilaporkan atau disetor. Aplikasi menolak agar pelaporan pajak tetap konsisten.",
          "Deleting an invoice whose tax obligations were already reported or settled. The application refuses so tax reporting stays consistent.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["Kewajiban PPh lahir saat dipotong, bukan saat disetujui", "Withholding obligations arise when withheld, not at approval"],
      text: [
        "Sejak 21 Agustus 2026 pajak potong (PPh 23 dan sejenisnya) menjadi kewajiban sebesar yang benar-benar dipotong pada setiap pembayaran — bertambah saat pembayaran dicatat, berkurang saat pembayaran dibatalkan. Dulu seluruh snapshot dicatat sebagai utang begitu dokumen disetujui, sehingga SPK yang baru dibayar separuh sudah mengurangi laba aman dibagikan sebesar PPh penuh.",
        "Since 21 August 2026 withholding taxes (Art. 23 and the like) become an obligation for the amount actually withheld on each payment — growing as payments are recorded, shrinking when one is voided. The full snapshot used to be booked as payable the moment a document was approved, so a work order only half paid already reduced distributable profit by the whole withholding.",
      ],
    },
    {
      kind: "bullets",
      items: [
        ["Arah kewajiban pajak potong mengikuti siapa yang memotong: kita memotong vendor → utang (Payable); klien memotong kita → piutang (Receivable). Aturan potong hanya boleh dibukukan sebagai Payable atau Receivable — pilihan lain ditolak.", "The direction of a withholding obligation follows who withholds: we withhold from a vendor → payable; the client withholds from us → receivable. A withholding rule may only be booked as Payable or Receivable — other treatments are refused."],
        ["Mematikan saklar pajak tidak menghitung ulang dokumen yang sudah terkunci. Quotation, invoice, dan SPK yang sudah memuat pajak tetap memuatnya; yang berubah hanya dokumen baru.", "Switching tax off never recalculates locked documents. Quotations, invoices, and work orders that already carry tax keep it; only new documents change."],
        ["Quotation yang sudah Sent tidak bisa ditambahi pajak. Ubah BoQ-nya supaya lahir revisi Draft, lalu pilih aturannya di revisi itu.", "A quotation already Sent cannot gain tax. Change its BoQ so a Draft revision is born, then choose the rules on that revision."],
      ],
    },
  ],
};

export const chapterProfit: Chapter = {
  id: "profit",
  title: ["Membagi keuntungan proyek", "Sharing project profit"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Yang boleh dibagi bukan seluruh laba kas, melainkan laba yang aman dibagikan: laba kas setelah dikurangi seluruh kewajiban yang belum dibayar.",
        "What may be shared is not the whole cash profit but the safe distributable profit: cash profit after every unpaid obligation has been deducted.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin dan Finance menyusun alokasi, dengan izin Laba & Bagi Hasil serta Pembukuan sama-sama Kelola. Hanya Admin yang menyetujui dan membatalkan.", "Admin and Finance prepare the allocations, holding Manage on both Profit & Profit Sharing and Finance. Only an Admin approves or voids them."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Pembukuan, bagian Pembagian keuntungan.", "Finance, the Profit sharing section."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Kesepakatan porsi untuk setiap penerima, dan pembayaran vendor, pajak, serta reimbursement yang tertunda sudah diketahui.", "An agreement on each recipient's share, and a clear view of any pending vendor payments, tax, and reimbursements."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Pilih proyek, tekan Tambah penerima, lalu isi nama dan persentasenya. Total seluruh penerima dibatasi 100%; tidak ada batas jumlah orang.",
          "Choose the project, press Add recipient, then enter the name and percentage. All recipients together are capped at 100%; there is no limit on how many people.",
        ],
        [
          "Periksa Laba aman dibagikan. Angka ini adalah laba kas proyek dikurangi tiga hal: komitmen vendor yang belum dibayar, utang pajak yang belum disetor, dan utang reimbursement yang belum dibayar.",
          "Check the Safe distributable profit. It is the project's cash profit minus three things: unpaid vendor commitments, tax payables not yet settled, and reimbursement payables not yet paid.",
        ],
        [
          "Admin menekan Setujui. Nominal rupiahnya dikunci pada saat itu juga, dihitung dari laba aman dibagikan saat persetujuan.",
          "An Admin presses Approve. The rupiah amount is locked at that moment, calculated from the safe distributable profit at the time of approval.",
        ],
        [
          "Tekan Bayar dan isi tanggal pembayaran. Alokasi harus sudah disetujui sebelum dapat dibayar.",
          "Press Pay and enter the payment date. An allocation must be approved before it can be paid.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Pembayaran masuk Buku Kas sebagai kas keluar dan menunggu dicocokkan dengan mutasi bank. Alokasi yang sudah disetujui tidak dapat diedit maupun dihapus; Admin membatalkannya lalu tim membuat alokasi baru. Pembatalan tidak menghapus pembayarannya: catatan kas keluar yang asli tetap ada dan aplikasi menambahkan satu catatan pembalik bertanggal hari pembatalan, sehingga posisi kas proyek kembali seperti sebelum pembagian dibayarkan dan kedua baris tetap terlihat saat audit. Pembatalan ditolak bila pembayarannya sudah dicocokkan dengan mutasi bank.",
        "The payment enters the Cash Ledger as cash out and waits to be matched against the bank statement. An approved allocation can be neither edited nor deleted; an Admin voids it and the team creates a new one. Voiding does not erase the payment: the original cash-out entry stays and the application posts a reversing entry dated on the day of the cancellation, so the project's cash position returns to where it was before the share was paid while both lines remain visible for audit. Voiding is refused if the payment has already been matched to a bank entry.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Menyetujui pembagian saat laba aman dibagikan masih nol atau negatif. Aplikasi menolak. Selesaikan dulu pembayaran vendor, utang pajak, dan reimbursement yang tertunda.",
          "Approving a share while the safe distributable profit is still zero or negative. The application refuses. Settle the pending vendor payments, tax payables, and reimbursements first.",
        ],
        [
          "Menyetujui alokasi terlalu dini, sebelum seluruh belanja proyek dicatat. Nominal terkunci pada saat persetujuan, jadi biaya yang datang belakangan tidak akan menguranginya.",
          "Approving an allocation too early, before all project purchases have been recorded. The amount locks at approval, so costs that arrive later will not reduce it.",
        ],
        [
          "Mencatat bonus atau fee sebagai pembagian keuntungan. Bonus dan fee adalah biaya proyek; catat lewat Belanja Proyek pada kategori biaya yang tepat.",
          "Recording a bonus or a fee as a profit share. Bonuses and fees are project costs; record them through Project Expenses under the right expense category.",
        ],
      ],
    },
    {
      kind: "note",
      title: ["Total yang dikunci tidak boleh melampaui laba aman saat ini", "The locked total may never exceed today's safe profit"],
      text: [
        "Persentase dibatasi 100%, tetapi rupiahnya dikunci satu per satu pada waktu yang berbeda. Sejak 21 Agustus 2026 menyetujui sebuah alokasi juga memeriksa: nominal yang sudah dikunci untuk alokasi lain ditambah nominal ini tidak boleh melebihi laba aman dibagikan SAAT INI. Kalau laba turun setelah alokasi pertama dikunci, alokasi berikutnya ditolak sampai labanya kembali.",
        "Percentages are capped at 100%, but the rupiah amounts lock one at a time at different moments. Since 21 August 2026 approving an allocation also checks that the amounts already locked for other allocations plus this one never exceed TODAY's distributable profit. If profit dropped after the first allocation locked, the next one is refused until it recovers.",
      ],
    },
    {
      kind: "bullets",
      items: [
        ["Laba ditahan kini memakai satu rumus di panel bagi laba dan di laporan keuangan: laba aman dibagikan dikurangi yang dialokasikan. Dulu laporan mengabaikan pajak terpulihkan dan utang pajak, jadi dua layar menunjukkan dua angka.", "Retained profit now uses one formula on the profit-sharing panel and in the finance report: distributable profit minus what is allocated. The report used to ignore recoverable and payable tax, so two screens showed two figures."],
        ["Ringkasan membedakan yang sudah dikunci (Approved dan Paid) dari alokasi Draft yang masih bergerak mengikuti kas.", "The summary separates what is locked (Approved and Paid) from Draft allocations that still move with cash."],
        ["Pembatalan bagi laba hanya terhalang bila pembayarannya sudah dicocokkan dengan mutasi bank — sama dengan pembatalan lain di aplikasi ini.", "Voiding a profit share is only blocked when its payout is matched to a bank line — the same rule as every other void in this application."],
      ],
    },
  ],
};

export const chapterCatalog: Chapter = {
  id: "catalog",
  title: ["Database Item dan AI Catalog Assistant", "The Item Database and the AI Catalog Assistant"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Database Item adalah sumber seluruh harga di aplikasi. Harga jual tidak pernah diketik: Anda mengisi harga pokok dan margin, lalu aplikasi menghitung Harga 1 dan Harga 2. AI hanya membantu menyusun draf, tidak pernah menetapkan harga.",
        "The Item Database is the source of every price in the application. Selling prices are never typed in: you enter a cost price and margins, and the application calculates Price 1 and Price 2. The AI only helps draft an entry; it never sets a price.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Hanya Admin dan Finance, baik untuk mengelola katalog maupun untuk memakai AI Catalog Assistant. Pengguna lain tetap dapat memakai item katalog di BoQ.", "Admin and Finance only, both for managing the catalog and for using the AI Catalog Assistant. Other users can still use catalog items in a BoQ."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Database Item, dan panel AI Catalog Assistant di dalamnya.", "Item Database, and the AI Catalog Assistant panel inside it."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Kategori dan merek sudah ada; nama atau tipe produk; sebaiknya tautan halaman produk resmi; foto atau datasheet bila ada (PNG, JPG, WebP, atau PDF, maksimal sekitar 9,5 MB).", "Categories and brands already exist; the product name or model; ideally a link to the official product page; a photo or datasheet if available (PNG, JPG, WebP, or PDF, up to about 9.5 MB)."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Susun kategori lebih dulu. Setiap kategori punya peran BoQ (Perangkat, Material, Jasa, atau Mobilitas) dan margin bawaan untuk Harga 1 dan Harga 2, yaitu 20% dan 30% bila tidak diubah.",
          "Set up the categories first. Each category has a BoQ role (Device, Material, Service, or Mobility) and default margins for Price 1 and Price 2, which are 20% and 30% unless changed.",
        ],
        [
          "Tambahkan merek di bawah kategorinya. Untuk item Perangkat dan Material, merek wajib dipilih.",
          "Add brands under their category. For Device and Material items, a brand is mandatory.",
        ],
        [
          "Tambahkan item: SKU (harus unik di seluruh katalog), nama, model, spesifikasi, satuan, harga pokok, serta margin 1 dan margin 2. Harga 1 dan Harga 2 dihitung aplikasi dari harga pokok dikali margin tersebut.",
          "Add the item: SKU (which must be unique across the catalog), name, model, specifications, unit, cost price, and margins 1 and 2. Price 1 and Price 2 are calculated by the application from cost times those margins.",
        ],
        [
          "Untuk memakai bantuan AI, tulis model, SKU, atau kebutuhan perangkat pada kolom pencarian AI.",
          "To use the AI, type the model, SKU, or device requirement in the AI search field.",
        ],
        [
          "Tempelkan tautan halaman produk resmi. Halaman itu dibaca oleh server aplikasi, bukan oleh browser Anda, dan isinya diperlakukan sebagai bahan yang belum tentu benar. Tanpa tautan dan tanpa berkas, seluruh harga yang dihasilkan hanya berupa perkiraan.",
          "Paste the official product page link. That page is read by the application server, not by your browser, and its contents are treated as material that may not be correct. Without a link and without a file, every price produced is only an estimate.",
        ],
        [
          "Tekan Mulai analisis. Panel boleh ditutup karena analisis tetap berjalan di server. Analisis yang tersangkut lebih dari sepuluh menit dihentikan otomatis dan ditandai gagal.",
          "Press Start analysis. The panel may be closed because the analysis keeps running on the server. An analysis stuck for more than ten minutes is stopped automatically and marked failed.",
        ],
        [
          "Hasilnya berstatus Draft dan belum menjadi item katalog. Periksa nama, model, spesifikasi, satuan, harga pokok, dan marginnya satu per satu.",
          "The result is a Draft and is not yet a catalog item. Check the name, model, specifications, unit, cost price, and margins one by one.",
        ],
        [
          "Lengkapi kategori dan merek, perbaiki apa pun yang keliru, lalu tekan Setujui ke katalog. Bila hasilnya tidak layak, tekan Tolak dan tulis alasannya minimal 5 karakter.",
          "Fill in the category and brand, correct anything wrong, then press Approve into catalog. If the result is not usable, press Reject and write a reason of at least 5 characters.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Item yang disetujui masuk Database Item dan dapat dipakai di BoQ. Harga 1 dan Harga 2 selalu dihitung aplikasi dari harga pokok dan margin, tidak pernah oleh AI. Batasnya 20 analisis per orang per hari dan paling banyak dua analisis berjalan bersamaan. Draft yang berumur lebih dari tujuh hari memerlukan alasan tertulis sebelum dapat disetujui, karena harganya mungkin sudah tidak berlaku.",
        "An approved item enters the Item Database and can be used in a BoQ. Price 1 and Price 2 are always calculated by the application from cost and margin, never by the AI. The limits are 20 analyses per person per day and at most two running at the same time. A draft older than seven days needs a written reason before it can be approved, because its prices may no longer hold.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Menyetujui draf AI tanpa memeriksanya. AI dapat salah membaca spesifikasi maupun harga. Draf adalah usulan, bukan kebenaran.",
          "Approving an AI draft without checking it. The AI can misread specifications and prices alike. A draft is a proposal, not a fact.",
        ],
        [
          "Menghapus kategori, merek, atau item yang masih dipakai. Aplikasi menolak agar dokumen lama tetap terbaca utuh; ubah statusnya menjadi Nonaktif. Item nonaktif tidak muncul lagi saat menambah item baru ke BoQ, tetapi dokumen lama tidak terganggu.",
          "Deleting a category, brand, or item that is still in use. The application refuses so older documents stay fully readable; set its status to Inactive instead. An inactive item no longer appears when adding items to a new BoQ, but existing documents are untouched.",
        ],
        [
          "Mengharapkan AI berjalan pada server yang belum dipasangi kunci layanannya. Bila muncul pesan bahwa asisten AI belum tersedia, tambahkan item secara manual sambil menunggu Admin sistem memasang kuncinya.",
          "Expecting the AI to run on a server where its service key has not been installed. If a message says the AI assistant is not available, add items manually while waiting for the system Admin to install the key.",
        ],
      ],
    },
  ],
};

export const chapterProspects: Chapter = {
  id: "prospects",
  title: ["Calon Klien dan surat penawaran", "Prospects and outreach letters"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Calon Klien adalah daftar kontak yang dikumpulkan tim sendiri — dari kartu nama, telepon masuk, atau berkas yang diserahkan pimpinan. Berbeda dengan Lead yang datang dari formulir situs, orang-orang ini tidak pernah meminta dihubungi. Karena itu dua hal wajib menempel pada setiap kontak: catatan dari mana kontaknya didapat, dan cara berhenti dihubungi.",
        "Prospects is a list of contacts gathered by the team itself — from business cards, incoming calls, or a file handed over by management. Unlike Leads, which arrive through the website form, these people never asked to be contacted. That is why two things are attached to every contact: a written note of where it came from, and a way to stop being contacted.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Admin dan Finance secara bawaan. Admin dapat memberikannya kepada siapa pun lewat Pengguna & Akses, modul Calon Klien. Izin Lihat cukup untuk membaca daftar, laporan, dan pratinjau; izin Kelola diperlukan untuk menyimpan, mengimpor, dan mengirim.", "Admin and Finance by default. An Admin can grant it to anyone through Users & Access, module Prospects. View is enough to read the list, the report, and previews; Manage is required to save, import, and send."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Menu Calon Klien, dengan lima tab: Daftar prospek, Tambah prospek, Impor XLSX, Susun email, Template surat, dan Laporan kirim.", "The Prospects menu, with tabs for the list, adding a contact, importing XLSX, composing an email, letter templates, and the delivery report."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Catatan sumber kontak untuk setiap orang, dan satu template surat yang sudah disimpan. Pengiriman hanya berjalan bila mailserver sudah dikonfigurasi.", "A source note for every contact, and one saved letter template. Sending only works when the mail server is configured."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Tambahkan kontak satu per satu lewat Tambah prospek, atau banyak sekaligus lewat Impor XLSX. Kolom yang dikenali: Nama, Email, Perusahaan, Jabatan, No.Telepon, Kota, dan Industri. Judul kolom dibaca dari isinya, bukan dari urutannya, jadi susunan kolom boleh berbeda.",
          "Add contacts one at a time under Add prospect, or many at once under Import XLSX. The recognised columns are Name, Email, Company, Job title, Phone, City, and Industry. Headings are matched by their text, not their position, so the column order may differ.",
        ],
        [
          "Nama lembar di dalam berkas Excel menentukan segmen: Konstruksi & Arsitektur, Developer, Smart Home, atau Hotel & Villa. Lembar dengan nama lain masuk ke segmen Lainnya.",
          "The worksheet name inside the Excel file decides the segment: Construction & Architecture, Developer, Smart Home, or Hotel & Villa. Any other sheet name lands in Other.",
        ],
        [
          "Jalankan impor sebagai uji kering lebih dulu. Laporannya menyebut berapa baris terbaca, berapa akan tersimpan, dan setiap masalah lengkap dengan nama lembar dan nomor barisnya. Baris bermasalah dilaporkan, bukan dibuang diam-diam: sel yang memuat dua alamat email membuat kontaknya tetap masuk tanpa email, dan alamat yang sudah dipakai prospek lain dilewati.",
          "Run the import as a dry run first. The report states how many rows were read, how many would be saved, and every problem with its sheet name and row number. Problem rows are reported rather than silently dropped: a cell holding two email addresses still saves the contact without an email, and an address already used by another prospect is skipped.",
        ],
        [
          "Buka Template surat dan tekan Pakai contoh untuk memulai dari naskah perkenalan yang sudah ada. Isi surat diketik sebagai teks biasa — baris kosong memisahkan paragraf. Kop berlogo, tanda tangan, alamat kantor, dan catatan cara berhenti dihubungi ditambahkan aplikasi; tidak ada yang perlu menulis HTML.",
          "Open Letter templates and press Use example to start from the existing introduction text. The body is typed as plain text — a blank line separates paragraphs. The letterhead with the logo, the signature, the office address, and the note on how to stop receiving letters are added by the application; nobody needs to write HTML.",
        ],
        [
          "Isi tanda tangan dengan nama dan kontak orang yang mengirim, bukan alamat umum perusahaan. Balasan calon klien diarahkan ke alamat itu, sehingga jawaban mereka sampai ke kotak masuk orang yang menunggunya.",
          "Fill in the signature with the name and contact details of the person sending, not a general company address. Replies from the prospect are directed there, so their answer reaches the inbox of the person waiting for it.",
        ],
        [
          "Sisipkan placeholder lewat tombol, jangan mengetiknya sendiri: {{nama}}, {{perusahaan}}, {{jabatan}}, {{kota}}, dan {{segmen}}. Placeholder yang salah ketik sengaja dibiarkan terlihat apa adanya di surat, supaya kesalahannya ketahuan pada pratinjau pertama dan bukan setelah terkirim ke ratusan orang.",
          "Insert placeholders using the buttons rather than typing them: {{nama}}, {{perusahaan}}, {{jabatan}}, {{kota}}, and {{segmen}}. A mistyped placeholder is deliberately left visible in the letter, so the mistake shows up in the first preview instead of after it reaches hundreds of people.",
        ],
        [
          "Jalankan pratinjau ke satu kontak nyata sebelum mengirim. Yang tampil di pratinjau adalah surat yang sama persis dengan yang akan diterima calon klien, bukan perkiraan.",
          "Run a preview against one real contact before sending. What the preview shows is exactly the letter the prospect will receive, not an approximation.",
        ],
        [
          "Pilih penerima di Daftar prospek, lalu Susun email. Kotak centang mati sendiri untuk kontak yang tidak boleh disurati: tanpa alamat email, atau sudah meminta berhenti dihubungi. Jeda antar surat bawaannya 60 detik, jadi 40 penerima memakan sekitar 40 menit — itu bukan macet.",
          "Select recipients in the prospect list, then Compose email. The checkbox is disabled for contacts who may not be written to: those without an email address, or who have asked to stop. The default gap between letters is 60 seconds, so 40 recipients take about 40 minutes — that is not a stall.",
        ],
        [
          "Buka Laporan kirim untuk melihat hasilnya. Satu penekanan tombol Kirim tampil sebagai satu batch, dengan hitungan per status, dan bisa dibuka untuk melihat setiap penerima satu per satu.",
          "Open the delivery report to see the outcome. One press of the Send button appears as one batch, with a count per status, and can be opened to see each recipient individually.",
        ],
      ],
    },
    {
      kind: "table",
      widths: [26, 74],
      head: [["Status", "Status"], ["Artinya", "What it means"]],
      rows: [
        [
          ["Masih diproses", "In progress"],
          ["Surat menunggu jadwalnya, atau sempat gagal tetapi masih akan diulang. Bukan kegagalan — jangan dikejar.", "The letter is waiting for its slot, or failed once but will still be retried. Not a failure — no need to chase it."],
        ],
        [
          ["Terkirim", "Sent"],
          ["Sudah diterima server surat penerima.", "Accepted by the recipient's mail server."],
        ],
        [
          ["Gagal", "Failed"],
          ["Lima percobaan sudah habis dan tidak akan diulang lagi. Alasannya tertulis pada barisnya.", "Five attempts have been used and it will not be retried. The reason is written on the row."],
        ],
        [
          ["Tidak dikirim", "Not sent"],
          ["Tidak pernah masuk antrean: kontaknya minta berhenti dihubungi, tidak punya alamat email, atau lingkungan ini memang menahan email.", "It never entered the queue: the contact asked to stop, has no email address, or this environment holds email back on purpose."],
        ],
      ],
    },
    {
      kind: "note",
      title: ["Menghormati permintaan berhenti", "Honouring a request to stop"],
      text: [
        "Bila seseorang meminta tidak dihubungi lagi, buka detail kontaknya dan tandai Jangan hubungi lagi. Server menolak mengirim ke kontak tersebut sejak saat itu, dan penolakannya tidak bergantung pada layar — siapa pun yang mencoba tetap ditolak. Tanda ini tidak bisa dibatalkan lewat layar, dan memang disengaja.",
        "If someone asks not to be contacted again, open their contact detail and mark Do not contact. From that moment the server refuses to send to that contact, and the refusal does not depend on the screen — anyone who tries is refused. The mark cannot be undone from the screen, and that is deliberate.",
      ],
    },
    {
      kind: "locked",
      text: [
        "Surat yang sudah masuk antrean tidak bisa ditarik kembali; yang bisa dilakukan hanyalah membatalkan sisanya dengan menandai kontak berhenti dihubungi. Riwayat surat menempel pada kontaknya dan bertahan meski catatan pengiriman aslinya sudah dibersihkan, karena pertanyaan surat apa yang pernah kita kirim ke klien ini muncul bertahun-tahun kemudian. Jumlah percobaan dan jadwal ulang hilang setelah 180 hari; statusnya tetap terbaca.",
        "A letter already queued cannot be recalled; all that can be done is to stop the rest by marking the contact as do-not-contact. The letter history stays attached to the contact and survives even after the original delivery record is cleaned up, because the question of what we have sent this client comes up years later. Attempt counts and retry schedules disappear after 180 days; the status itself stays readable.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mengirim tanpa pratinjau. Pratinjau adalah satu-satunya tempat kesalahan ketik dan placeholder yang keliru masih bisa diperbaiki tanpa biaya.",
          "Sending without a preview. The preview is the only place where a typo or a wrong placeholder can still be fixed at no cost.",
        ],
        [
          "Mengosongkan jeda antar surat agar cepat selesai. Mailserver yang sama membawa invoice dan tautan pemulihan kata sandi; reputasi yang rusak karena satu kampanye membuat keduanya ikut tidak sampai, dan itu baru ketahuan saat ada yang tidak bisa masuk atau tidak menerima tagihan.",
          "Removing the gap between letters to finish faster. The same mail server carries invoices and password recovery links; a reputation damaged by one campaign stops those arriving too, and that only surfaces when someone cannot sign in or never receives a bill.",
        ],
        [
          "Mengisi catatan sumber seadanya. Catatan itu satu-satunya jawaban ketika seseorang bertanya dari mana Anda mendapatkan alamat saya.",
          "Filling the source note carelessly. That note is the only answer available when someone asks where you got their address.",
        ],
        [
          "Membaca status Masih diproses sebagai kegagalan lalu mengirim ulang. Surat yang sama akan sampai dua kali.",
          "Reading In progress as a failure and sending again. The same letter then arrives twice.",
        ],
        [
          "Menguji dengan data pelanggan sungguhan di lingkungan demo. Bila lingkungan itu diizinkan mengirim, surat uji benar-benar sampai ke mereka.",
          "Testing with real customer data in the demo environment. If that environment is allowed to send, the test letters really do reach them.",
        ],
      ],
    },
    {
      kind: "heading",
      text: ["Jadikan proyek: dari calon klien ke proyek", "Convert to project: from prospect to project"],
    },
    {
      kind: "para",
      text: [
        "Sejak 21 Agustus 2026 status Won bukan lagi sekadar label. Tombol Jadikan proyek membuat proyek langsung dari prospek: nama perusahaan menjadi klien, nama kontak menjadi PIC klien, alamat email menjadi email klien (alamat tujuan quotation dan invoice nanti), dan lokasi ikut dibawa. Yang perlu diisi hanya yang tidak dimiliki prospek — nama proyek bila berbeda, manajer, dan tanggal.",
        "Since 21 August 2026 the Won status is no longer just a label. The Convert to project button creates the project straight from the prospect: the company name becomes the client, the contact name the client PIC, the email address the client email (where quotations and invoices will later be sent), and the location carries over. Only what the prospect lacks has to be typed — the project name if it differs, the manager, and the dates.",
      ],
    },
    {
      kind: "bullets",
      items: [
        ["Satu prospek paling banyak satu proyek. Menekan tombol itu dua kali tidak membuat kembaran; aplikasi menyebutkan kode proyek yang sudah ada.", "One prospect makes at most one project. Pressing the button twice never creates a twin; the application names the project that already exists."],
        ["Prospek Lost atau yang minta berhenti dihubungi tidak dapat dijadikan proyek. Buka kembali ke New lebih dulu bila memang mereka menghubungi lagi.", "A Lost prospect, or one who asked not to be contacted, cannot be converted. Reopen it to New first if they really did get back in touch."],
        ["Butuh dua izin sekaligus: Kelola Calon Klien dan Kelola Proyek. Finance yang hanya boleh melihat proyek tidak bisa menekannya.", "Two permissions are needed at once: Manage Prospects and Manage Projects. A Finance user who may only view projects cannot press it."],
        ["Daftar dan detail prospek menampilkan kode proyek yang lahir darinya, jadi pertanyaan \"proyek ini dari sumber mana\" akhirnya punya jawaban.", "The prospect list and detail show the code of the project born from it, so \"where did this project come from\" finally has an answer."],
      ],
    },
    {
      kind: "table",
      widths: [44, 134],
      head: [["Dari status", "From status"], ["Boleh pindah ke", "May move to"]],
      rows: [
        [["New", "New"], ["Contacted, Qualified, Lost", "Contacted, Qualified, Lost"]],
        [["Contacted", "Contacted"], ["Qualified, Proposal, Lost", "Qualified, Proposal, Lost"]],
        [["Qualified", "Qualified"], ["Proposal, Lost", "Proposal, Lost"]],
        [["Proposal", "Proposal"], ["Won, Lost, atau mundur ke Qualified", "Won, Lost, or back to Qualified"]],
        [["Won", "Won"], ["Tidak ke mana-mana — sudah jadi klien", "Nowhere — already a client"]],
        [["Lost", "Lost"], ["New (dibuka kembali)", "New (reopened)"]],
      ],
    },
    {
      kind: "note",
      title: ["Lompatan status ditolak", "Status jumps are refused"],
      text: [
        "Dulu status bisa diubah ke apa pun, termasuk Lost langsung ke Won. Sekarang perpindahan mengikuti tabel di atas; yang di luar tabel dijawab Status prospek tidak bisa berpindah dari … ke ….",
        "Status used to be changeable to anything, including Lost straight to Won. Moves now follow the table above; anything outside it is answered with the message that the status cannot move from … to ….",
      ],
    },
  ],
};

export const chapterAccess: Chapter = {
  id: "access",
  title: ["Mengatur akun, hak akses, dan preferensi", "Managing accounts, permissions, and preferences"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Akun adalah pintu masuk seluruh pengaman lain di aplikasi ini. Satu akun untuk satu orang, tidak pernah dibagi, dan izinnya diberikan seperlunya saja.",
        "Accounts are the doorway to every other safeguard in this application. One account per person, never shared, and permissions granted only as far as needed.",
      ],
    },
    {
      kind: "meta",
      rows: [
        {
          label: ["Siapa yang boleh", "Who may do it"],
          value: ["Hanya Admin yang membuat akun, mengubah peran, dan mengatur hak akses. Preferensi profil, bahasa, notifikasi, dan kata sandi diatur masing-masing orang.", "Only an Admin creates accounts, changes roles, and sets permissions. Profile, language, notification, and password preferences are set by each person."],
        },
        {
          label: ["Di mana", "Where"],
          value: ["Pengguna & Akses, Profil Saya, dan Pengaturan.", "Users & Access, My Profile, and Settings."],
        },
        {
          label: ["Prasyarat", "Prerequisites"],
          value: ["Email pengguna, peran yang sesuai pekerjaannya, dan daftar menu yang boleh mereka buka.", "The person's email address, the role that matches their job, and the list of menus they may open."],
        },
      ],
    },
    {
      kind: "steps",
      items: [
        [
          "Admin membuat akun dengan email dan kata sandi awal minimal 10 karakter, lalu memilih peran: Admin, Project Manager, Engineer, atau Finance.",
          "An Admin creates the account with an email address and a starting password of at least 10 characters, then picks the role: Admin, Project Manager, Engineer, or Finance.",
        ],
        [
          "Untuk setiap modul, pilih Tidak ada, Lihat, atau Kelola. Pengaturan bawaan peran sudah terisi otomatis; ubah hanya bila memang perlu. Daftar modul di layar ini mengikuti modul yang benar-benar ada di aplikasi, jadi modul baru muncul dengan sendirinya — termasuk Calon Klien, yang bawaannya Kelola untuk Admin dan Finance serta Tidak ada untuk peran lain.",
          "For each module, choose No access, View, or Manage. The role defaults are filled in automatically; change them only where genuinely needed. The module list on this screen follows the modules the application actually has, so a new module appears on its own — including Prospects, which defaults to Manage for Admin and Finance and No access for the other roles.",
        ],
        [
          "Untuk Project Manager dan Engineer, tentukan proyek mana saja yang boleh mereka buka dengan menambahkan mereka sebagai anggota proyek. Admin dan Finance selalu melihat seluruh proyek.",
          "For Project Managers and Engineers, decide which projects they may open by adding them as project members. Admin and Finance always see every project.",
        ],
        [
          "Setiap orang membuka Profil Saya untuk mengganti foto (JPG, PNG, atau WebP maksimal 3 MB), nama, kontak, dan jabatan.",
          "Each person opens My Profile to change their photo (JPG, PNG, or WebP up to 3 MB), name, contact details, and job title.",
        ],
        [
          "Mengganti alamat email sendiri tidak langsung berlaku. Akun tetap memakai alamat lama sampai tautan konfirmasi yang dikirim ke alamat baru dibuka, dan alamat lama menerima pemberitahuan bahwa ada permintaan penggantian. Tautan konfirmasi berlaku 60 menit. Setelah alamat benar-benar berganti, seluruh sesi akun tersebut diakhiri dan pemiliknya masuk kembali dengan alamat baru.",
          "Changing your own email address does not take effect immediately. The account keeps its old address until the confirmation link sent to the new address is opened, and the old address is notified that a change was requested. The confirmation link is valid for 60 minutes. Once the address really changes, every session on that account ends and the owner signs in again with the new address.",
        ],
        [
          "Buka Pengaturan untuk memilih Bahasa Indonesia atau English, mengatur notifikasi email, dan mengganti kata sandi. Mengganti kata sandi sendiri memerlukan kata sandi lama. Syarat kata sandi barunya ditampilkan di form itu sendiri dan tidak selalu sama: aplikasi menuntut minimal 10 karakter, dan bila mailserver menuntut lebih — panjang lain, angka, huruf besar-kecil, atau karakter spesial — syarat yang lebih ketat itulah yang berlaku. Karena itu jangan menghafal angkanya; baca yang tertulis di form. Mengganti kata sandi sendiri juga langsung mengakhiri sesi Anda di seluruh perangkat lain; hanya perangkat yang Anda pakai saat itu tetap masuk.",
          "Open Settings to choose Indonesian or English, set email notifications, and change your password. Changing your own password requires the current password. The requirements for the new one are shown on the form itself and are not always the same: the application asks for at least 10 characters, and where the mail server asks for more — a different length, a digit, mixed case, or a special character — the stricter requirement applies. So do not memorise the number; read what the form says. Changing your own password also immediately ends your sessions on every other device; only the device you are using stays signed in.",
        ],
        [
          "Bila seseorang berhenti, Admin menonaktifkan akunnya, bukan menghapusnya. Menonaktifkan langsung mengakhiri seluruh sesi aktif orang tersebut sekaligus menjaga jejak dokumen yang pernah ia buat.",
          "When someone leaves, an Admin deactivates their account rather than deleting it. Deactivating immediately ends all of that person's active sessions while preserving the trail of documents they created.",
        ],
      ],
    },
    {
      kind: "locked",
      text: [
        "Perubahan hak akses langsung berlaku. Bila keanggotaan proyek dicabut, proyek itu hilang dari dashboard orang tersebut. Pilihan bahasa tersimpan pada akun dan dipakai lagi saat login berikutnya, termasuk untuk bahasa dokumen PDF yang diunduh.",
        "Permission changes take effect immediately. If project membership is revoked, that project disappears from the person's dashboard. The language choice is saved on the account and reused at the next sign-in, including for the language of downloaded PDF documents.",
      ],
    },
    {
      kind: "pitfalls",
      items: [
        [
          "Mengganti peran seseorang tanpa memeriksa ulang izinnya. Perubahan peran mengembalikan seluruh izin modul ke pengaturan bawaan peran baru.",
          "Changing someone's role without re-checking their permissions. A role change resets every module permission to the new role's defaults.",
        ],
        [
          "Memberi izin Kelola pada modul yang tidak diperlukan. Semakin sedikit yang bisa mengubah data sensitif, semakin mudah menelusuri bila ada yang keliru.",
          "Granting Manage on modules that are not needed. The fewer people who can change sensitive data, the easier it is to trace a mistake.",
        ],
        [
          "Berbagi satu akun untuk beberapa orang. Jejak audit menjadi tidak berarti, dan aturan pemisahan pembuat dan penyetuju dokumen menjadi tidak berlaku.",
          "Sharing one account between several people. The audit trail becomes meaningless, and the rule separating who submits a document from who approves it stops working.",
        ],
        [
          "Mengira kata sandi aplikasi terpisah dari kata sandi email. Bila aplikasi memakai akun mailserver, kata sandi yang Anda ganti di Pengaturan adalah kata sandi kotak surat Anda — webmail dan aplikasi lain ikut berganti.",
          "Assuming the application password is separate from the email password. When the application uses mail server accounts, the password you change in Settings is your mailbox password — webmail and other applications change with it.",
        ],
      ],
    },
  ],
};

export const chapterExample: Chapter = {
  id: "example",
  title: ["Contoh perhitungan lengkap", "A complete worked example"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Bab ini menelusuri satu penawaran dari subtotal BoQ sampai invoice terakhir, dengan seluruh aritmetikanya ditulis terbuka. Angkanya sengaja dibuat bulat agar mudah diperiksa ulang dengan kalkulator.",
        "This chapter follows one quotation from the BoQ subtotal through to the last invoice, with every step of the arithmetic written out. The figures are deliberately round so they are easy to check with a calculator.",
      ],
    },
    {
      kind: "heading",
      text: ["Langkah 1: dari subtotal BoQ ke Total tagihan klien", "Step 1: from the BoQ subtotal to the Total billed to the client"],
    },
    {
      kind: "para",
      text: [
        "Urutan hitungnya selalu sama dan tidak pernah berubah: subtotal dikurangi diskon menghasilkan dasar pengenaan pajak; pajak Tambah ditambahkan di atasnya; pembulatan diterapkan terakhir. Pajak Potong tidak ikut dalam rantai ini sama sekali.",
        "The order of calculation is always the same and never varies: subtotal minus discount gives the taxable base; added tax goes on top of that; rounding is applied last. Withheld tax plays no part in this chain at all.",
      ],
    },
    {
      kind: "calc",
      title: ["Penawaran QUO/PN/08/2026/001", "Quotation QUO/PN/08/2026/001"],
      rows: [
        { label: ["Subtotal BoQ paket", "Package BoQ subtotal"], amount: 100_000_000 },
        { label: ["Diskon 10% (jenis Persen)", "Discount 10% (Percent type)"], amount: -10_000_000 },
        { label: ["Dasar pengenaan pajak", "Taxable base"], amount: 90_000_000, tone: "sub" },
        { label: ["PPN 11% dari dasar pengenaan (efek Tambah)", "VAT 11% of the taxable base (Add effect)"], amount: 9_900_000 },
        { label: ["Nilai sebelum pembulatan", "Value before rounding"], amount: 99_900_000, tone: "sub" },
        {
          label: ["Pembulatan Ke atas kelipatan Rp 100.000", "Rounding Up to a step of Rp 100,000"],
          amount: 0,
          tone: "muted",
        },
        {
          label: ["Pembulatan Khusus, alasan: kesepakatan angka bulat dengan klien", "Custom rounding, reason: round contract figure agreed with the client"],
          amount: 100_000,
        },
        { label: ["Total tagihan klien", "Total billed to the client"], amount: 100_000_000, tone: "total" },
        { label: ["PPh 23 2% dari dasar pengenaan (efek Potong)", "Income tax 2% of the taxable base (Withhold effect)"], amount: -1_800_000 },
        { label: ["Kas bersih diterima", "Net cash received"], amount: 98_200_000, tone: "total" },
      ],
    },
    {
      kind: "bullets",
      items: [
        [
          "Diskon 10% dihitung dari subtotal: 100.000.000 x 10% = 10.000.000. Diskon tidak pernah boleh melebihi subtotal.",
          "The 10% discount is calculated from the subtotal: 100,000,000 x 10% = 10,000,000. A discount can never exceed the subtotal.",
        ],
        [
          "PPN dihitung dari dasar pengenaan, bukan dari subtotal: 90.000.000 x 11% = 9.900.000. Bila diskonnya berbeda, PPN-nya ikut berbeda.",
          "VAT is calculated from the taxable base, not from the subtotal: 90,000,000 x 11% = 9,900,000. A different discount produces a different VAT.",
        ],
        [
          "Pembulatan Ke atas kelipatan Rp 100.000 tidak mengubah apa pun di sini, karena 99.900.000 memang sudah kelipatan 100.000. Inilah sebabnya contoh ini memakai pembulatan Khusus untuk mencapai angka kontrak yang bulat, dan alasannya wajib ditulis.",
          "Rounding Up to a Rp 100,000 step changes nothing here, because 99,900,000 is already a multiple of 100,000. That is why this example uses Custom rounding to reach a round contract figure, and why the reason is mandatory.",
        ],
        [
          "PPh 23 tidak menaikkan maupun menurunkan Total tagihan klien. Klien tetap ditagih 100.000.000; yang berkurang hanya uang yang benar-benar masuk ke rekening, yaitu 98.200.000, karena 1.800.000 disetorkan klien ke kas negara atas nama PerumNet.",
          "Income tax neither raises nor lowers the Total billed to the client. The client is still billed 100,000,000; only the money that actually reaches the bank account is smaller, at 98,200,000, because the client pays 1,800,000 to the tax office on PerumNet's behalf.",
        ],
      ],
    },
    {
      kind: "heading",
      text: ["Langkah 2: membagi tagihan menjadi DP 30% dan Pelunasan 70%", "Step 2: splitting the bill into a 30% down payment and a 70% final payment"],
    },
    {
      kind: "calc",
      title: ["Invoice termin dari Total tagihan klien Rp 100.000.000", "Installment invoices from a Total billed of Rp 100,000,000"],
      rows: [
        { label: ["Invoice 1, DP 30%", "Invoice 1, DP 30%"], amount: 30_000_000 },
        { label: ["  Bagian dasar pengenaan pajak", "  Share of the taxable base"], amount: 27_000_000, tone: "muted" },
        { label: ["  Bagian PPN", "  Share of the VAT"], amount: 2_970_000, tone: "muted" },
        { label: ["  Bagian pembulatan", "  Share of the rounding"], amount: 30_000, tone: "muted" },
        { label: ["Invoice 2, Pelunasan 70% (invoice terakhir)", "Invoice 2, Final payment 70% (the last invoice)"], amount: 70_000_000 },
        { label: ["  Bagian dasar pengenaan pajak, sisa", "  Share of the taxable base, remainder"], amount: 63_000_000, tone: "muted" },
        { label: ["  Bagian PPN, sisa", "  Share of the VAT, remainder"], amount: 6_930_000, tone: "muted" },
        { label: ["  Bagian pembulatan, sisa", "  Share of the rounding, remainder"], amount: 70_000, tone: "muted" },
        { label: ["Jumlah seluruh invoice", "All invoices together"], amount: 100_000_000, tone: "total" },
      ],
    },
    {
      kind: "para",
      text: [
        "Perhatikan invoice terakhir. Aplikasi tidak mengalikan 70% pada setiap komponen, melainkan mengambil sisanya: dasar pengenaan 90.000.000 dikurangi 27.000.000 yang sudah ditagihkan menghasilkan 63.000.000, dan PPN 9.900.000 dikurangi 2.970.000 menghasilkan 6.930.000. Cara ini menjamin jumlah seluruh invoice sama persis dengan penawaran, tanpa selisih satu rupiah pun.",
        "Look at the last invoice. The application does not multiply each component by 70%; it takes the remainder instead: a taxable base of 90,000,000 minus the 27,000,000 already billed leaves 63,000,000, and VAT of 9,900,000 minus 2,970,000 leaves 6,930,000. This guarantees that the invoices add up to exactly the quotation, without a single rupiah of drift.",
      ],
    },
    {
      kind: "heading",
      text: ["Langkah 3: kapan sisa pembulatan benar-benar terlihat", "Step 3: when the rounding residual actually becomes visible"],
    },
    {
      kind: "para",
      text: [
        "Pada pembagian 30% dan 70% angkanya kebetulan habis dibagi. Sisa pembulatan baru terlihat jelas bila persentasenya berkoma. Contoh berikut membagi tagihan yang sama menjadi tiga termin yang hampir sama besar.",
        "With a 30% and 70% split the figures happen to divide evenly. The rounding residual only becomes obvious when the percentages carry decimals. The example below splits the same bill into three nearly equal installments.",
      ],
    },
    {
      kind: "calc",
      title: ["Tiga termin: 33,33% + 33,33% + sisa", "Three installments: 33.33% + 33.33% + the remainder"],
      rows: [
        { label: ["Invoice 1, 33,33% dari 100.000.000", "Invoice 1, 33.33% of 100,000,000"], amount: 33_330_000 },
        { label: ["Invoice 2, 33,33% dari 100.000.000", "Invoice 2, 33.33% of 100,000,000"], amount: 33_330_000 },
        { label: ["Sudah ditagihkan (66,66%)", "Billed so far (66.66%)"], amount: 66_660_000, tone: "sub" },
        { label: ["Invoice 3, sisa 33,34% sebagai invoice terakhir", "Invoice 3, the remaining 33.34% as the last invoice"], amount: 33_340_000 },
        { label: ["Jumlah seluruh invoice", "All invoices together"], amount: 100_000_000, tone: "total" },
      ],
    },
    {
      kind: "para",
      text: [
        "Bila invoice ketiga dihitung dengan cara biasa, yaitu 33,34% dikali 100.000.000, hasilnya adalah 33.340.000 juga. Namun bila persentasenya diisi 33,33% seperti dua invoice sebelumnya, jumlah seluruh termin hanya mencapai 99,99% dan tagihan kurang Rp 10.000. Karena itu isilah invoice terakhir dengan angka sisa yang disebutkan aplikasi, bukan dengan angka yang terlihat rapi.",
        "If the third invoice were calculated the ordinary way, 33.34% of 100,000,000, the result would also be 33,340,000. But if it were entered as 33.33% like the two before it, the installments would only reach 99.99% and the client would be under-billed by Rp 10,000. So always enter the remaining figure the application quotes on the last invoice, not the number that looks tidiest.",
      ],
    },
    {
      kind: "note",
      title: ["Ringkasan rumus", "The formulas in one place"],
      text: [
        "Dasar pengenaan pajak = subtotal - diskon. Pajak Tambah = dasar pengenaan x tarif. Total tagihan klien = dasar pengenaan + pajak Tambah + pembulatan. Kas bersih diterima = Total tagihan klien - pajak Potong. Nilai invoice termin = Total tagihan klien x persentase termin, kecuali invoice yang membuat akumulasi mencapai 100%, yang memakai sisa.",
        "Taxable base = subtotal - discount. Added tax = taxable base x rate. Total billed to the client = taxable base + added tax + rounding. Net cash received = Total billed to the client - withheld tax. An installment invoice = Total billed x the installment percentage, except for the invoice that brings the cumulative total to 100%, which uses the remainder.",
      ],
    },
  ],
};

export const chapterGlossary: Chapter = {
  id: "glossary",
  title: ["Kamus istilah", "Glossary"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Istilah berikut muncul di layar, pada dokumen PDF, dan sepanjang panduan ini.",
        "The terms below appear on screen, in the PDF documents, and throughout this manual.",
      ],
    },
    {
      kind: "terms",
      rows: [
        {
          label: ["BoQ (Bill of Quantity)", "BoQ (Bill of Quantity)"],
          value: ["Daftar rinci pekerjaan dan barang beserta jumlah dan harganya. BoQ menjadi dasar penawaran, dokumen vendor, dan daftar pemeriksaan lapangan.", "The itemized list of work and goods with quantities and prices. The BoQ drives the quotation, the vendor documents, and the site checklist."],
        },
        {
          label: ["Paket komersial", "Commercial package"],
          value: ["Kelompok pekerjaan yang dijual sebagai satu kesatuan. Satu proyek boleh punya beberapa paket, masing-masing dengan BoQ, penawaran, invoice, siklus validasi, dan BAST sendiri.", "A group of work sold as one unit. A project may have several packages, each with its own BoQ, quotation, invoices, validation cycle, and handover certificate."],
        },
        {
          label: ["Quotation", "Quotation"],
          value: ["Surat penawaran harga yang dikirim ke klien. Statusnya: Draft, Terkirim, Diterima, Ditolak, Digantikan, atau Batal.", "The priced offer sent to the client. Its statuses are Draft, Sent, Accepted, Rejected, Superseded, and Void."],
        },
        {
          label: ["Revisi penawaran", "Quotation revision"],
          value: ["Versi baru dari penawaran yang sudah dikirim, bernomor akhiran -R2, -R3, dan seterusnya. Versi sebelumnya berubah menjadi Digantikan dan tetap tersimpan.", "A new version of a quotation that was already sent, numbered with the suffix -R2, -R3, and so on. The previous version becomes Superseded and is retained."],
        },
        {
          label: ["Addendum", "Addendum"],
          value: ["Lingkup dan penawaran tambahan untuk pekerjaan yang muncul setelah penawaran awal disetujui klien.", "An additional scope and quotation for work that appears after the client accepted the original offer."],
        },
        {
          label: ["Termin", "Installment (termin)"],
          value: ["Bagian dari nilai kontrak yang ditagih atau dibayar bertahap, misalnya DP 30% lalu pelunasan 70%.", "A staged portion of the contract value that is billed or paid separately, for example 30% up front and 70% on completion."],
        },
        {
          label: ["Invoice", "Invoice"],
          value: ["Dokumen penagihan resmi kepada klien, diterbitkan sebagai persentase dari Total tagihan klien.", "The formal billing document sent to the client, issued as a percentage of the Total billed to the client."],
        },
        {
          label: ["SPK (Surat Perintah Kerja)", "SPK (Work Order)"],
          value: ["Perintah kerja untuk vendor jasa, misalnya pemasangan atau mobilitas. Termin lanjutannya terbuka setelah verifikasi progres.", "A work order issued to a service vendor, for example for installation or mobility work. Its later terms open after progress verification."],
        },
        {
          label: ["PO (Purchase Order)", "PO (Purchase Order)"],
          value: ["Pesanan pembelian untuk vendor barang, yaitu perangkat atau material. Termin lanjutannya terbuka setelah penerimaan barang.", "A purchase order issued to a goods vendor, for devices or materials. Its later terms open after goods receipt."],
        },
        {
          label: ["Siklus penyerahan", "Delivery cycle"],
          value: ["Nomor putaran serah terima pada satu paket. Satu paket boleh diserahkan bertahap, dan setiap siklus punya checklist validasi serta BAST sendiri.", "The handover round number within one package. A package may be handed over in stages, and each cycle has its own validation checklist and handover certificate."],
        },
        {
          label: ["BAST (Berita Acara Serah Terima)", "BAST (handover certificate)"],
          value: ["Dokumen yang menyatakan pekerjaan sudah selesai, diperiksa bersama, dan diserahkan kepada klien.", "The document confirming that the work is finished, jointly inspected, and handed over to the client."],
        },
        {
          label: ["Cap digital", "Digital seal"],
          value: ["Cap perusahaan yang dibubuhkan aplikasi saat BAST difinalisasi, disertai QR untuk memeriksa keaslian dokumen. Ini cap internal PerumNet, bukan tanda tangan elektronik tersertifikasi.", "The company seal the application applies when a handover certificate is finalized, together with a QR code for checking authenticity. It is PerumNet's own internal seal, not a certified electronic signature."],
        },
        {
          label: ["Sidik jari digital (SHA-256)", "Digital fingerprint (SHA-256)"],
          value: ["Deretan karakter yang dihitung dari isi sebuah berkas. Bila satu huruf pun berubah, deretannya berubah total, sehingga pemalsuan mudah terdeteksi.", "A string of characters computed from a file's contents. If even one character changes, the string changes completely, which makes tampering easy to detect."],
        },
        {
          label: ["Pajak Tambah (misalnya PPN)", "Added tax (for example VAT)"],
          value: ["Pajak yang ditambahkan di atas nilai pekerjaan sehingga tagihan klien bertambah, dan dicatat sebagai utang pajak.", "Tax added on top of the work value, which increases the client's bill and is recorded as a tax payable."],
        },
        {
          label: ["Pajak Potong (misalnya PPh)", "Withheld tax (for example income tax)"],
          value: ["Pajak yang dipotong klien saat membayar. Tagihan tidak berkurang, tetapi uang yang masuk ke rekening menjadi lebih kecil.", "Tax the client deducts when paying. The bill itself does not go down, but less money reaches the bank account."],
        },
        {
          label: ["Dasar pengenaan pajak", "Taxable base"],
          value: ["Subtotal dikurangi diskon. Inilah angka yang dikalikan tarif pajak.", "The subtotal minus the discount. This is the figure the tax rate is applied to."],
        },
        {
          label: ["Total tagihan klien", "Total billed to the client"],
          value: ["Dasar pengenaan pajak ditambah pajak Tambah ditambah pembulatan. Inilah angka yang tertera pada penawaran dan menjadi dasar seluruh invoice termin.", "The taxable base plus added tax plus rounding. This is the figure printed on the quotation and the basis of every installment invoice."],
        },
        {
          label: ["Kas bersih diterima", "Net cash received"],
          value: ["Total tagihan klien dikurangi pajak Potong. Inilah uang yang benar-benar masuk ke rekening perusahaan.", "The Total billed to the client minus withheld tax. This is what actually arrives in the company bank account."],
        },
        {
          label: ["Uang muka proyek", "Project advance"],
          value: ["Dana yang dicairkan lebih dulu untuk belanja lapangan. Nota yang memakainya hanya mengurangi saldo uang muka, tidak membuat kas keluar lagi.", "Money released up front for field purchases. A receipt charged to it only reduces the advance balance and never posts cash out again."],
        },
        {
          label: ["Reimbursement", "Reimbursement"],
          value: ["Penggantian uang pribadi pegawai yang dipakai untuk keperluan proyek, dicatat atas nama orang yang menalanginya.", "Paying back an employee who used their own money for project needs, recorded in the name of the person who fronted it."],
        },
        {
          label: ["Rekonsiliasi", "Reconciliation"],
          value: ["Mencocokkan catatan di aplikasi dengan mutasi rekening bank supaya satu kejadian kas hanya tercatat sekali.", "Matching the application's records against the bank statement so that one cash event is recorded only once."],
        },
        {
          label: ["Void", "Void"],
          value: ["Pembatalan yang tidak menghapus data, melainkan membuat catatan pembalik agar jejaknya tetap lengkap.", "A cancellation that does not delete data but posts a reversing entry, so the trail stays complete."],
        },
        {
          label: ["Laba aman dibagikan", "Safe distributable profit"],
          value: ["Laba kas proyek setelah dikurangi komitmen vendor yang belum dibayar, utang pajak, dan utang reimbursement.", "The project's cash profit after deducting unpaid vendor commitments, tax payables, and reimbursement payables."],
        },
        {
          label: ["Buku Kas", "Cash Ledger"],
          value: ["Catatan seluruh kas masuk dan kas keluar perusahaan di Pembukuan. Hanya uang nyata yang masuk ke sini.", "The record of all company cash in and cash out in Finance. Only real money enters it."],
        },
      ],
    },
  ],
};

export const chapterMessages: Chapter = {
  id: "messages",
  title: ["Daftar pesan kesalahan dan cara menanganinya", "Error messages and how to handle them"],
  blocks: [
    {
      kind: "lead",
      text: [
        "Pesan berikut muncul ketika aplikasi menolak menyimpan sesuatu. Tidak satu pun menandakan kerusakan; semuanya adalah pengaman agar dokumen dan pembukuan tetap benar. Setiap entri menyebutkan apa artinya dan apa yang perlu dilakukan.",
        "The messages below appear when the application refuses to save something. None of them indicate a fault; they are all safeguards that keep the documents and the books correct. Each entry states what it means and what to do. Note that some screens still show the Indonesian wording even in the English edition.",
      ],
    },
    {
      kind: "messages",
      rows: [
        {
          message: ["Alamat email itu sudah terdaftar pada prospek lain.", "That email address is already listed on another prospect."],
          meaning: ["Satu alamat email hanya boleh menempel pada satu calon klien. Dua perusahaan yang berbagi satu alamat hampir selalu berarti salah tempel.", "One email address may belong to only one prospect. Two companies sharing an address is almost always a copy-paste mistake."],
          action: ["Aplikasi menunjukkan prospek lama yang memakai alamat itu; buka dan periksa. Bila memang orang yang berbeda, pakai alamat masing-masing. Pada impor, baris seperti ini dilewati dan dilaporkan lengkap dengan nomor barisnya.", "The application points to the existing prospect using that address; open it and check. If they really are different people, use their own addresses. During an import such rows are skipped and reported with their row number."],
        },
        {
          message: ["Peran Anda tidak memiliki akses ke Calon Klien.", "Your role does not have access to Prospects."],
          meaning: ["Modul Calon Klien belum dinyalakan untuk akun Anda.", "The Prospects module has not been enabled for your account."],
          action: ["Minta Admin membuka Pengguna & Akses, mencari nama Anda, dan menyetel modul Calon Klien ke Lihat atau Kelola. Pesan serupa yang menyebut Anda hanya bisa melihat berarti izinnya baru Lihat, sedangkan menyimpan, mengimpor, dan mengirim memerlukan Kelola.", "Ask an Admin to open Users & Access, find your name, and set the Prospects module to View or Manage. A similar message saying you can only view means the permission is still View, while saving, importing, and sending require Manage."],
        },
        {
          message: ["Kata sandi baru harus minimal sekian karakter, mengandung angka, dan seterusnya.", "The new password must be at least so many characters, contain a digit, and so on."],
          meaning: ["Kata sandi baru belum memenuhi syarat yang berlaku. Syarat itu gabungan aturan aplikasi dan aturan mailserver, dan yang berlaku selalu yang lebih ketat.", "The new password does not meet the requirements in force. Those combine the application's own rule and the mail server's, and the stricter one always applies."],
          action: ["Pesannya menyebut seluruh syarat yang belum terpenuhi sekaligus, bukan satu per satu. Perbaiki semuanya lalu ulangi. Syarat yang sama juga tertulis di dekat kolom kata sandi baru sebelum Anda mengetik.", "The message lists every unmet requirement at once rather than one at a time. Fix them all and try again. The same requirements are also written next to the new-password field before you start typing."],
        },
        {
          message: ["Penggantian kata sandi email belum disiapkan di server ini. Hubungi IT.", "Changing the email password has not been set up on this server. Contact IT."],
          meaning: ["Aplikasi memakai akun mailserver untuk login, tetapi sambungan ke mailserver untuk mengganti kata sandi belum dikonfigurasi. Aplikasi memilih menolak dengan jelas daripada diam-diam mengganti kata sandi di tempat yang salah.", "The application uses mail server accounts for sign-in, but the connection used to change the password is not configured. The application refuses plainly rather than quietly changing a password in the wrong place."],
          action: ["Hubungi administrator sistem. Sampai itu beres, kata sandi email dapat diganti lewat webmail.", "Contact the system administrator. Until it is resolved, the email password can be changed through webmail."],
        },
        {
          message: ["Mailserver sedang tidak bisa dihubungi, jadi kata sandi belum diganti.", "The mail server cannot be reached, so the password has not been changed."],
          meaning: ["Sambungan ke mailserver gagal. Kata sandi lama Anda masih berlaku dan tidak ada yang berubah.", "The connection to the mail server failed. Your old password still works and nothing changed."],
          action: ["Coba lagi beberapa saat kemudian. Bila berulang, laporkan ke administrator sistem — pesan ini berbeda dari kata sandi salah, dan tidak perlu mereset apa pun.", "Try again shortly. If it keeps happening, report it to the system administrator — this message is not the same as a wrong password, and nothing needs resetting."],
        },
        {
          message: ["Invoice termin hanya dapat dibuat dari Quotation yang sudah diterima klien.", "Installment invoices can only be created from a quotation the client has accepted."],
          meaning: ["Penawaran belum berstatus Diterima, jadi belum ada nilai kontrak yang boleh ditagihkan.", "The quotation is not Accepted yet, so there is no contract value to bill against."],
          action: ["Buka Quotation & Invoice, tandai penawaran sudah dikirim, lalu tekan Terima klien dan unggah bukti persetujuan. Pesan serupa Terima Quotation paket terlebih dahulu berarti paket yang sedang dipilih memang belum punya penawaran yang diterima.", "Open Quotations & Invoices, mark the quotation as sent, then press Client accept and upload the proof. A similar message about accepting the package quotation first means the selected package has no accepted quotation at all."],
        },
        {
          message: ["Quotation sudah kedaluwarsa. Admin atau Finance harus memperpanjang masa berlaku sebelum dapat diterima.", "The quotation has expired and its validity must be extended by an Admin or Finance before it can be accepted."],
          meaning: ["Tanggal Berlaku sampai pada penawaran sudah lewat.", "The Valid until date on the quotation has passed."],
          action: ["Minta Admin atau Finance menekan Edit pada penawaran, memperpanjang tanggal Berlaku sampai, lalu ulangi Terima klien.", "Ask an Admin or Finance user to press Edit on the quotation, extend the Valid until date, then repeat Client accept."],
        },
        {
          message: ["Pilih minimal satu aturan pajak sebelum menerima Quotation.", "Choose at least one tax rule before accepting the quotation."],
          meaning: ["Modul pajak sedang aktif, tetapi penawaran ini belum memilih aturan pajak apa pun.", "The tax module is switched on, but this quotation has no tax rule selected."],
          action: ["Tekan Pajak pada penawaran selagi masih Draft, nyalakan Gunakan pajak, lalu pilih aturan yang sesuai. Bila memang tidak ada pajak, mintalah Admin menonaktifkan modul pajak.", "Press Tax on the quotation while it is still a Draft, switch on Apply tax, and choose the applicable rules. If there genuinely is no tax, ask an Admin to switch the tax module off."],
        },
        {
          message: ["Akumulasi termin melebihi 100%. Sisa termin adalah ...%", "The installments add up to more than 100%; the message states the remaining share."],
          meaning: ["Persentase yang Anda isi membuat jumlah seluruh termin melampaui nilai kontrak.", "The percentage you entered would bill more than the contract value."],
          action: ["Isi persentase sebesar sisa yang disebutkan pada pesan, atau hapus dulu invoice termin yang salah selama belum ada pembayarannya.", "Enter the remaining percentage quoted in the message, or first delete the incorrect installment invoice while it still has no payment."],
        },
        {
          message: ["Pembulatan khusus maksimal Rp ... untuk nilai ini.", "The message names the maximum custom rounding allowed for this value."],
          meaning: ["Selisih pembulatan yang Anda ketik lebih besar daripada yang masih masuk akal disebut pembulatan: batasnya Rp 100.000 atau 1% dari nilai sebelum pembulatan, mana yang lebih besar.", "The adjustment you typed is larger than anything that could still be called a rounding: the limit is Rp 100,000 or 1% of the value before rounding, whichever is larger."],
          action: ["Bila memang bermaksud memotong harga, isi kolom Diskon; bila menambah biaya, gunakan aturan pajak Tambah. Keduanya tercetak apa adanya di PDF dan ikut terbawa ke invoice, sedangkan pembulatan tidak dimaksudkan untuk itu.", "If you meant to reduce the price, use the Discount field; if you meant to add a charge, use an Add-effect tax rule. Both print for what they are on the PDF and carry through to the invoices, which is not what rounding is for."],
        },
        {
          message: ["Nilai proyek ini mengikuti Quotation yang sudah diterima klien dan tidak dapat diketik manual.", "This project's value follows its client-accepted quotation and cannot be typed in by hand."],
          meaning: ["Proyek ini sudah punya penawaran berstatus Diterima, jadi nilainya diturunkan dari kontrak dan bukan lagi angka yang diketik.", "This project already has an Accepted quotation, so its value is derived from the contract instead of typed."],
          action: ["Kosongkan kembali kolom Nilai ke angka semula. Bila nilai kontraknya memang berubah, buat Addendum; nilai proyek akan menyesuaikan sendiri begitu addendum itu diterima klien.", "Put the Value field back to its previous figure. If the contract value genuinely changed, create an Addendum; the project value updates itself once the client accepts it."],
        },
        {
          message: ["Checklist ini sudah menjadi dasar BAST yang diterbitkan.", "This checklist is the evidence behind an issued handover certificate."],
          meaning: ["Daftar pemeriksaan Perangkat dan Material ini sudah dipakai untuk memfinalisasi BAST, jadi centang dan statusnya terkunci.", "This Device and Material checklist was used to finalize a handover certificate, so its ticks and its status are locked."],
          action: ["Bila daftarnya memang perlu diperiksa ulang, minta Admin mencabut BAST-nya lebih dulu, lalu sinkronkan dan centang ulang daftar pemeriksaannya.", "If the checklist genuinely needs redoing, ask an Admin to revoke the certificate first, then re-sync and re-check the list."],
        },
        {
          message: ["Dokumen harus sudah disetujui dan dikirim ke vendor sebelum dibayar.", "The document must be approved and sent to the vendor before it can be paid."],
          meaning: ["Dokumen masih berstatus Disetujui: keputusan internal sudah selesai, tetapi vendor belum menerima dokumennya.", "The document is still at Approved: the internal decision is done, but the vendor has not received the document."],
          action: ["Tekan Kirim pada dokumen tersebut, lalu ulangi pembayarannya. Pesan senada muncul pada Selesaikan, dan dokumen yang sudah Selesai tidak dapat diselesaikan untuk kedua kalinya.", "Press Send on the document, then repeat the payment. A matching message appears for Complete, and a document already Completed cannot be completed a second time."],
        },
        {
          message: ["Uang muka ini sudah terpakai atau sebagian sudah dikembalikan, jadi tidak dapat dibatalkan.", "This advance has already been spent or partly returned, so it cannot be voided."],
          meaning: ["Pembatalan uang muka hanya untuk pencairan yang murni salah catat dan belum tersentuh. Uang muka ini sudah punya catatan penyelesaian.", "Voiding an advance is only for a disbursement recorded purely in error and never touched. This one already has settlement records."],
          action: ["Gunakan Pengembalian uang muka untuk menutup sisa saldonya. Bila pencairannya sudah cocok dengan mutasi bank, pengembalian memang satu-satunya jalan, karena uangnya benar-benar keluar.", "Use Advance return to close the remaining balance. If the disbursement is already matched to a bank entry, a return is the only route, because the money genuinely left."],
        },
        {
          message: ["Endpoint konfirmasi pembayaran lama sudah tidak berlaku.", "The old payment-confirmation endpoint has been retired."],
          meaning: ["Sebuah alat atau integrasi lama masih memanggil jalur penandaan Lunas versi lawas, yang menandai invoice lunas tanpa referensi dan tanpa bukti pembayaran yang sesungguhnya.", "An old tool or integration is still calling the legacy mark-as-paid route, which marked an invoice paid with no reference and no real payment evidence."],
          action: ["Catat pembayarannya lewat histori pembayaran pada invoice, yang meminta nominal, tanggal, referensi, metode, dan bukti transfer. Pembatalannya juga ada di sana dan otomatis mencatat pembalik kasnya.", "Record the payment through the invoice payment history, which asks for the amount, date, reference, method, and transfer proof. Its void action lives there too and posts the reversing cash entry automatically."],
        },
        {
          message: ["Quotation yang diterima klien sudah dikunci. Buat Addendum baru.", "A client-accepted quotation is locked and cannot be changed."],
          meaning: ["Penawaran yang sudah disetujui klien memang tidak boleh diubah lagi.", "A quotation the client has approved may not be edited any more."],
          action: ["Buka Procurement & Vendor, panel Quotation Original & Addendum, buat Addendum, lalu proses pekerjaan tambahan di sana.", "Open Procurement & Vendors, the Original Quotation & Addendum panel, create an Addendum, and handle the extra work there."],
        },
        {
          message: ["Item yang sudah diterima klien tidak dapat diedit. Buat Addendum baru.", "Items the client has accepted cannot be edited. Create a new Addendum."],
          meaning: ["Anda mencoba mengubah item BoQ yang sudah ikut terkunci bersama penawarannya.", "You are trying to change a BoQ item that locked together with its quotation."],
          action: ["Jangan mengubah BoQ yang sudah diterima. Buat Addendum berisi selisih pekerjaannya, lalu proses seperti penawaran biasa.", "Do not change an accepted BoQ. Create an Addendum containing the difference in work and process it like an ordinary quotation."],
        },
        {
          message: ["Alasan pembulatan khusus wajib diisi.", "A reason for custom rounding is required."],
          meaning: ["Anda memilih pembulatan Khusus tetapi kolom alasannya masih kosong.", "You chose Custom rounding but left the reason field empty."],
          action: ["Tulis alasan yang bermakna, minimal 5 karakter, misalnya kesepakatan pembulatan dengan klien. Alasan ini tersimpan sebagai catatan internal.", "Write a meaningful reason of at least 5 characters, for example an agreed rounding with the client. The reason is stored as an internal note."],
        },
        {
          message: ["Invoice dengan histori pembayaran tidak dapat dihapus. Gunakan void pada pembayaran.", "An invoice with payment history cannot be deleted. Void the payment instead."],
          meaning: ["Invoice sudah pernah dibayar, jadi menghapusnya akan merusak pembukuan.", "The invoice has already been paid, so deleting it would corrupt the books."],
          action: ["Buka jendela pembayaran invoice, tekan Void pada pembayaran, dan isi alasannya. Setelah seluruh pembayarannya di-void, invoice dapat diedit maupun dihapus kembali, kecuali bila kewajiban pajaknya sudah disetor atau dilaporkan.", "Open the invoice payment window, press Void on the payment, and give a reason. Once every payment on it has been voided the invoice can be edited or deleted again, unless its tax obligations are already settled or reported."],
        },
        {
          message: ["Invoice dengan kewajiban pajak yang sudah disetor atau dilaporkan tidak dapat dihapus.", "An invoice whose tax obligations are already settled or reported cannot be deleted."],
          meaning: ["Pajak dari invoice ini sudah masuk ke pelaporan atau sudah disetorkan.", "The tax from this invoice has already entered a filing or has been paid."],
          action: ["Jangan hapus invoicenya. Bila memang keliru, koreksi lewat pembatalan setoran oleh Admin, lalu perbaiki posisinya di Pembukuan.", "Do not delete the invoice. If it really is wrong, correct it through an Admin voiding the settlement, then fix the position in Finance."],
        },
        {
          message: ["Quotation tidak dapat dihapus karena sudah dirujuk dokumen procurement (SPK/PO).", "The quotation cannot be deleted because a procurement document still references it."],
          meaning: ["Sebuah SPK atau PO mengambil itemnya dari penawaran ini.", "A Work Order or PO draws its items from this quotation."],
          action: ["Hapus atau void dokumen procurement tersebut lebih dulu, baru penawarannya dapat dihapus.", "Delete or void that procurement document first, and only then can the quotation be deleted."],
        },
        {
          message: ["Quotation ini tidak dapat dibatalkan karena Invoice-nya sudah menerima pembayaran.", "The quotation cannot be voided because its invoice has already received a payment."],
          meaning: ["Uang klien sudah masuk atas dasar penawaran ini, jadi membatalkannya akan menghapus dasar penagihannya.", "Client money has already come in on the strength of this quotation, so voiding it would remove the basis of the billing."],
          action: ["Buka jendela pembayaran invoice, tekan Void pada pembayarannya dan isi alasannya, hapus invoicenya bila memang keliru, baru batalkan penawarannya. Bila invoicenya masih terbit tanpa pembayaran, aplikasi tetap menolak dengan pesan bahwa penawaran sudah memiliki Invoice.", "Open the invoice payment window, press Void on the payment and give a reason, delete the invoice if it really is wrong, and only then void the quotation. While the invoice still exists without a payment, the application still refuses with the message that the quotation already has an invoice."],
        },
        {
          message: ["Endpoint SPK lama hanya dapat dibaca. Gunakan /api/procurement-orders.", "Work orders can only be read here; use the Procurement screen."],
          meaning: ["Sebuah layar atau integrasi lama mencoba membuat, mengubah, membayar, atau menghapus SPK di luar layar Procurement & Vendor. Jalur lama itu pernah mencatat pembayaran vendor dua kali.", "An old screen or integration tried to create, change, pay, or delete a Work Order outside the Procurement & Vendors screen. That old route used to record vendor payments twice."],
          action: ["Kerjakan seluruh siklusnya di Procurement & Vendor: Buat, Ajukan, Setujui, Kirim, Verifikasi, Bayar, lalu Selesai. Membaca dan mengunduh PDF SPK tetap dapat dilakukan dari mana pun.", "Do the whole cycle on the Procurement & Vendors screen: Create, Submit, Approve, Send, Verify, Pay, then Complete. Reading a Work Order and downloading its PDF still works from anywhere."],
        },
        {
          message: ["Paket berstatus Selesai atau Batal sehingga tidak dapat menerima dokumen baru.", "The package is Completed or Void, so it cannot take new documents."],
          meaning: ["Paket komersial yang dipilih sudah dipensiunkan. Hanya paket Aktif yang menerima BoQ, Quotation, Invoice, validasi, BAST, dan Addendum baru.", "The selected commercial package has been retired. Only an Active package accepts a new BoQ, quotation, invoice, validation, certificate, or addendum."],
          action: ["Pilih paket lain di bagian atas layar, atau minta paket Selesai diaktifkan kembali. Paket Batal tidak dapat dihidupkan lagi — buat paket baru bila pekerjaannya memang berlanjut. Dokumen lama pada paket itu tetap dapat dibaca dan diunduh.", "Choose another package at the top of the screen, or ask for a Completed package to be reactivated. A Void package can never be revived — create a new package if the work really continues. The documents already on it stay readable and downloadable."],
        },
        {
          message: ["Perubahan status paket tidak sesuai urutan workflow.", "That package status change does not follow the workflow."],
          meaning: ["Anda mencoba mengaktifkan kembali paket yang sudah Batal. Batal adalah status akhir.", "You are trying to reactivate a package that is already Void. Void is terminal."],
          action: ["Buat paket komersial baru untuk pekerjaan itu. Paket lama tetap tersimpan lengkap dengan dokumennya sebagai riwayat.", "Create a new commercial package for that work. The old one stays with all of its documents as history."],
        },
        {
          message: ["Status pelaporan hanya dapat maju. Hanya Admin yang dapat menurunkannya, dengan alasan tercatat.", "Tax reporting only moves forward; only an Admin can walk it back, with a recorded reason."],
          meaning: ["Posisi pajak ini sudah dilaporkan, dan Anda mencoba mengembalikannya ke status sebelumnya atau membatalkannya.", "This tax position has already been reported and you are trying to return it to an earlier status or void it."],
          action: ["Bila laporan memang perlu dikoreksi, minta Admin menurunkan statusnya sambil menuliskan alasannya; tanggal dan identitas pelapor tetap tersimpan. Bila hanya ingin menghapus invoicenya, jangan lakukan ini — terbitkan dokumen pengganti.", "If the return genuinely needs correcting, ask an Admin to lower the status while stating a reason; the filing date and filer are kept either way. If the goal is merely to delete the invoice, do not do this — issue a replacement document instead."],
        },
        {
          message: ["Isi alasan penurunan status pelaporan pajak.", "State a reason for lowering the tax reporting status."],
          meaning: ["Admin menurunkan status pelaporan tanpa menuliskan alasan.", "An Admin is lowering a reporting status without writing a reason."],
          action: ["Tulis alasan yang bermakna, minimal 10 karakter, misalnya SPT dikoreksi untuk masa yang sama. Alasan itu masuk ke jejak audit.", "Write a meaningful reason of at least 10 characters, for example that the return is being corrected for the same period. The reason lands in the audit trail."],
        },
        {
          message: ["Transaksi otomatis harus diperbarui dari dokumen asal atau rekonsiliasi bank.", "This cash entry was posted by a source document; change it there."],
          meaning: ["Baris ini dicatat aplikasi dari invoice, pembayaran vendor, belanja proyek, setoran pajak, bagi hasil, atau mutasi bank. Buku Kas hanya menyunting baris yang memang diketik manusia.", "The application posted this line from an invoice, a vendor payment, a project expense, a tax settlement, a profit share, or a bank statement. The Cash Ledger only edits lines a human typed in."],
          action: ["Buka dokumen sumbernya dan perbaiki di sana — void pembayarannya, lalu catat ulang dengan angka yang benar.", "Open the source document and fix it there — void the payment, then record it again with the correct figures."],
        },
        {
          message: ["Transaksi ini sudah dicocokkan dengan mutasi bank. Lepaskan rekonsiliasinya terlebih dahulu.", "This entry is already matched to a bank statement line; release the reconciliation first."],
          meaning: ["Sebuah baris mutasi menunjuk transaksi ini sebagai pasangannya, jadi mengubah atau menghapusnya akan merusak rekonsiliasi.", "A statement line points at this transaction as its counterpart, so changing or deleting it would break the reconciliation."],
          action: ["Buka Pembukuan, bagian Rekening perusahaan, kecualikan atau cocokkan ulang mutasinya, baru sunting transaksinya.", "Open Finance, the Company banking section, exclude or re-match that entry, and only then edit the transaction."],
        },
        {
          message: ["BoQ paket ini berubah setelah checklist validasi diselesaikan.", "This package's BoQ changed after the checklist was completed."],
          meaning: ["Ada item Perangkat atau Material baru, biasanya dari Addendum, yang tidak pernah tercakup dalam daftar pemeriksaan yang sudah ditandatangani.", "New Device or Material items, usually from an Addendum, were never covered by the checklist that was signed off."],
          action: ["Buka Validasi Perangkat, sinkronkan daftarnya, periksa item baru di lokasi, centang seluruhnya, lalu selesaikan validasi sekali lagi sebelum menerbitkan BAST.", "Open Device Validation, re-sync the list, inspect the new items on site, tick them all, and complete the validation once more before issuing the certificate."],
        },
        {
          message: ["Nilai BoQ tidak boleh lebih kecil dari total Invoice yang sudah diterbitkan.", "The BoQ may not fall below the invoices already issued."],
          meaning: ["Perubahan yang Anda simpan akan membuat nilai paket lebih kecil daripada jumlah yang sudah ditagihkan ke klien.", "The change you are saving would make the package worth less than what has already been billed to the client."],
          action: ["Hapus atau perbaiki dulu invoice terminnya selama belum ada pembayaran, baru turunkan nilai BoQ-nya.", "Delete or correct the installment invoices first while they still have no payments, and only then reduce the BoQ value."],
        },
        {
          message: ["Perubahan status Quotation tidak sesuai urutan workflow.", "That quotation status change does not follow the workflow."],
          meaning: ["Anda mencoba mengaktifkan kembali penawaran yang sudah Batal, Ditolak, atau Digantikan. Ketiganya adalah status akhir.", "You are trying to reactivate a quotation that is already Void, Rejected, or Superseded. All three are terminal."],
          action: ["Buat penawaran baru untuk pekerjaan itu. Penawaran lama tetap tersimpan sebagai riwayat dan tidak dapat dikembalikan menjadi Draft atau Terkirim.", "Raise a new quotation for that work. The old one stays as history and cannot be returned to Draft or Sent."],
        },
        {
          message: ["Proyek ini sudah memiliki riwayat kas yang tercatat sehingga tidak dapat dihapus.", "This project already has recorded cash, so it cannot be deleted."],
          meaning: ["Ada pembayaran, penyelesaian, setoran pajak, atau transaksi Pembukuan yang melekat pada proyek ini.", "A payment, a settlement, a tax settlement, or a Finance transaction is attached to this project."],
          action: ["Jangan hapus proyeknya. Tutup atau arsipkan: ubah statusnya menjadi Selesai dan biarkan dokumen serta pembukuannya utuh. Penghapusan hanya tersedia untuk proyek yang belum pernah menyentuh uang.", "Do not delete the project. Close or archive it: set its status to Completed and leave its documents and books intact. Deletion is only available for a project that has never touched money."],
        },
        {
          message: ["Nominal melebihi nilai yang sudah berhak dibayar. Verifikasi progres atau penerimaan barang terlebih dahulu.", "The amount exceeds what has been earned; record progress verification or a goods receipt first."],
          meaning: ["Setelah DP, termin berikutnya baru boleh dibayar kalau pekerjaannya sudah dibuktikan.", "After the down payment, later terms are only payable once the work has been evidenced."],
          action: ["Untuk SPK, minta Admin, Project Manager, atau Engineer menekan Verifikasi. Untuk PO, minta mereka menekan Terima barang dan mengisi nomor surat jalan. Setelah itu ulangi pencatatan pembayaran.", "For a Work Order, ask an Admin, Project Manager, or Engineer to press Verify. For a PO, ask them to press Receive and enter the delivery note number. Then record the payment again."],
        },
        {
          message: ["Verifikasi progres wajib dilakukan Admin, Project Manager, atau Engineer.", "Progress verification must be done by an Admin, Project Manager, or Engineer."],
          meaning: ["Akun Anda berperan Finance, yang memang hanya mencatat pembayaran, bukan membuktikan pekerjaan.", "Your account has the Finance role, which records payments but does not evidence work."],
          action: ["Minta rekan berperan Admin, Project Manager, atau Engineer melakukannya. Engineer tidak perlu izin Kelola untuk ini — cukup izin Lihat pada Procurement & Vendor dan terdaftar sebagai anggota proyeknya. Bila Engineer tetap ditolak, periksa keanggotaan proyeknya di Manajemen Proyek.", "Ask a colleague with the Admin, Project Manager, or Engineer role to do it. An Engineer does not need Manage for this — View on Procurement & Vendors plus membership of the project is enough. If an Engineer is still refused, check their project membership under Project Management."],
        },
        {
          message: ["Finance tidak boleh menyetujui draft yang dibuat atau diajukannya sendiri.", "Finance may not approve a draft it created or submitted itself."],
          meaning: ["Pembuat dan penyetuju dokumen harus orang yang berbeda.", "The person who submits a document and the person who approves it must be different."],
          action: ["Minta Admin atau pengguna Finance lain menyetujui dokumen tersebut. Admin yang terpaksa menyetujui pengajuannya sendiri wajib menulis alasan.", "Ask an Admin or another Finance user to approve it. An Admin who has to approve their own submission must write a reason."],
        },
        {
          message: ["Finance tidak boleh menyetujui belanja yang dibuat, diajukan, atau ditalanginya sendiri.", "Finance may not approve an expense it created, submitted, or paid for itself."],
          meaning: ["Aturan yang sama berlaku pada Belanja Proyek: Finance hanya menyetujui belanja orang lain.", "The same rule applies to Project Expenses: Finance only approves other people's spending."],
          action: ["Minta Admin atau pengguna Finance lain memverifikasi pengajuan tersebut. Admin yang terpaksa menyetujui pengajuannya sendiri wajib menulis alasan, dan alasan itu tersimpan di audit log.", "Ask an Admin or another Finance user to verify that submission. An Admin who has to approve their own submission must write a reason, and that reason is stored in the audit log."],
        },
        {
          message: ["SPK/PO hanya dapat memakai item dari Quotation yang sudah diterima beserta bukti persetujuannya.", "Work Orders and POs may only use items from an accepted quotation together with its proof of approval."],
          meaning: ["Dokumen vendor selalu bersumber dari pekerjaan yang sudah disetujui klien.", "Vendor documents always originate from work the client has already approved."],
          action: ["Selesaikan dulu Terima klien pada penawaran atau addendum yang bersangkutan, lengkap dengan tanggal dan berkas bukti persetujuan.", "Finish Client accept on the relevant quotation or addendum first, including the date and the proof file."],
        },
        {
          message: ["SPK memerlukan vendor bertipe Jasa atau Hybrid. / PO memerlukan vendor bertipe Supplier atau Hybrid.", "An SPK requires a Jasa or Hybrid vendor. / A PO requires a Supplier or Hybrid vendor."],
          meaning: ["Tipe vendor yang dipilih tidak cocok dengan jenis dokumen.", "The selected vendor type does not match the document type."],
          action: ["Pilih vendor lain yang tipenya sesuai, atau ubah tipe vendor tersebut di master vendor bila memang ia mengerjakan keduanya.", "Choose another vendor of the right type, or change that vendor's type in the vendor master if it genuinely does both."],
        },
        {
          message: ["Selesaikan checklist validasi Perangkat dan Material sebelum BAST diterbitkan.", "Complete the Device and Material validation before issuing the handover certificate."],
          meaning: ["BAST hanya boleh terbit setelah pemeriksaan lapangan selesai.", "A handover certificate may only be issued after the site inspection is finished."],
          action: ["Buka Validasi Perangkat pada paket dan siklus yang sama, centang seluruh item, lalu tekan Selesaikan validasi.", "Open Device Validation for the same package and cycle, tick every item, then press Complete validation."],
        },
        {
          message: ["Centang seluruh Perangkat dan Material sebelum validasi diselesaikan.", "Check every Device and Material before completing validation."],
          meaning: ["Masih ada item pada daftar pemeriksaan yang belum dicentang.", "Some items on the checklist are still unticked."],
          action: ["Telusuri daftar dari atas ke bawah. Item yang bermasalah tetap harus diperiksa; tulis temuannya pada kolom catatan agar terekam.", "Work down the list from top to bottom. Items with problems still have to be inspected; record the finding in the notes column so it is on file."],
        },
        {
          message: ["Tanda tangan klien dan PerumNet wajib lengkap sebelum finalisasi.", "Client and PerumNet signatures are required before finalization."],
          meaning: ["Salah satu kolom tanda tangan pada BAST masih kosong.", "One of the signature panels on the handover certificate is still empty."],
          action: ["Minta perwakilan klien menandatangani pada kolom Tanda tangan klien dan wakil PerumNet pada kolom Tanda tangan PerumNet, lalu ulangi finalisasi.", "Ask the client's representative to sign in the Client signature panel and the PerumNet representative to sign in the PerumNet panel, then finalize again."],
        },
        {
          message: ["Aktifkan dan unggah cap perusahaan sebelum finalisasi BAST.", "Enable and upload the company seal before finalizing the handover certificate."],
          meaning: ["Cap perusahaan belum diatur, padahal cap itulah yang menandai dokumen final.", "The company seal has not been configured, and it is the seal that marks a document as final."],
          action: ["Minta Admin membuka Pengaturan cap di BAST Digital, mengunggah gambar cap (PNG, JPG, atau WebP maksimal 2 MB), mengisi nama dan jabatan penanda tangan, lalu mencentang Aktifkan cap saat finalisasi.", "Ask an Admin to open Seal settings in Digital Handover, upload the seal image (PNG, JPG, or WebP up to 2 MB), fill in the signer's name and title, then tick Enable seal during finalization."],
        },
        {
          message: ["BAST yang sudah difinalisasi atau dicabut tidak dapat diedit. Buat revisi baru.", "A finalized or revoked handover certificate cannot be edited. Create a new revision."],
          meaning: ["Dokumen final memang bersifat tetap; itulah gunanya cap dan QR keaslian.", "A final document is immutable by design; that is what the seal and authenticity QR are for."],
          action: ["Minta Admin mencabut BAST tersebut dengan alasan tertulis, lalu buat BAST baru untuk paket dan siklus yang sama.", "Ask an Admin to revoke that certificate with a written reason, then create a new certificate for the same package and cycle."],
        },
        {
          message: ["Belum ada uang muka aktif untuk proyek ini. Cairkan uang muka melalui menu Uang Muka terlebih dahulu.", "This project has no active advance yet. Disburse an advance from the Advance menu first."],
          meaning: ["Anda memilih sumber dana Uang muka proyek padahal proyek ini belum punya saldo uang muka yang belum habis dipakai.", "You chose Project advance as the funding source, but this project has no unspent advance balance."],
          action: ["Minta Admin atau Finance menekan tombol Uang muka dan mencairkan uang mukanya lebih dulu. Bila belanja ini memang bukan dari uang muka, pilih Rekening perusahaan atau Uang pribadi pegawai.", "Ask an Admin or Finance user to press the Advance button and disburse the advance first. If this purchase was not funded by an advance, choose Company account or Employee paid instead."],
        },
        {
          message: ["Pemilik dana pribadi harus pengaju sendiri atau anggota proyek yang aktif.", "The personal funds owner must be the submitter or an active project member."],
          meaning: ["Orang yang Anda pilih pada Dana pribadi milik bukan anggota proyek ini, atau akunnya sudah nonaktif.", "The person you chose in Personal funds owner is not a member of this project, or their account is inactive."],
          action: ["Minta Admin menambahkan orang tersebut sebagai anggota proyek, atau pilih orang lain yang memang menalangi belanja ini.", "Ask an Admin to add that person as a project member, or choose the person who actually fronted the money."],
        },
        {
          message: ["Pilih rekening perusahaan untuk belanja yang dibayar lewat transfer bank.", "Select an active company account for a purchase paid by bank transfer."],
          meaning: ["Metode pembayaran Transfer Bank memerlukan rekening perusahaan yang jelas agar mutasi banknya dapat dicocokkan nanti.", "The Bank transfer method needs a named company account so the bank entry can be matched later."],
          action: ["Pilih rekening perusahaan yang aktif dari daftar. Bila rekeningnya belum ada, minta Admin menambahkannya di Pembukuan.", "Choose an active company account from the list. If the account does not exist yet, ask an Admin to add it in Finance."],
        },
        {
          message: ["Unggah minimal satu nota atau invoice sebelum mengajukan.", "Upload at least one receipt or invoice before submitting."],
          meaning: ["Belanja tidak dapat dikirim ke Finance tanpa bukti.", "An expense cannot be sent to Finance without evidence."],
          action: ["Lampirkan foto atau PDF nota, maksimal 10 MB per berkas dan paling banyak lima berkas, lalu tekan Kirim ke Finance.", "Attach a photo or PDF of the receipt, up to 10 MB per file and at most five files, then press Send to Finance."],
        },
        {
          message: ["Ditemukan kemungkinan pencatatan ganda.", "A possible duplicate record was found."],
          meaning: ["Ada nota atau pembayaran vendor lain dengan tanggal, toko, dan nominal yang mirip.", "Another receipt or vendor payment has a similar date, merchant, and amount."],
          action: ["Periksa nomor dokumen yang disebut pada peringatan. Bila memang belanja yang berbeda, kirim ulang dan setujui peringatannya. Bila ternyata sama, batalkan pengajuan.", "Check the document number quoted in the warning. If it really is a different purchase, submit again and confirm the warning. If it is the same one, cancel the submission."],
        },
        {
          message: ["Lepaskan rekonsiliasi bank sebelum melakukan void.", "Detach the bank reconciliation before voiding."],
          meaning: ["Transaksi ini sudah dicocokkan dengan mutasi rekening.", "This transaction is already matched to a bank statement entry."],
          action: ["Buka Pembukuan, cari mutasi yang cocok dengan transaksi tersebut, lepaskan pencocokannya, lalu ulangi pembatalan.", "Open Finance, find the statement entry matched to it, unmatch it, then void again."],
        },
        {
          message: ["Periode pada PDF tidak sesuai. / Nomor rekening di PDF tidak sesuai dengan rekening yang dipilih.", "The statement period or account number in the PDF does not match the one selected."],
          meaning: ["Berkas mutasi tidak cocok dengan bulan atau rekening yang Anda pilih.", "The uploaded file does not belong to the month or the bank account you selected."],
          action: ["Pastikan bulan dan rekening yang dipilih sama dengan isi berkas. Gunakan e-statement asli dengan teks yang dapat diseleksi, bukan hasil scan atau tangkapan layar.", "Make sure the selected month and account match the file. Use the original e-statement with selectable text, not a scan or a screenshot."],
        },
        {
          message: ["Laba belum aman dibagikan setelah memperhitungkan komitmen vendor yang belum dibayar.", "Profit is not safe to distribute once unpaid vendor commitments are taken into account."],
          meaning: ["Setelah dikurangi kewajiban yang belum dibayar, tidak ada laba yang aman untuk dibagi.", "After deducting outstanding obligations there is no profit left to share."],
          action: ["Selesaikan pembayaran vendor, utang pajak, dan reimbursement yang tertunda, atau turunkan persentase pembagiannya.", "Settle the outstanding vendor payments, tax payables, and reimbursements, or lower the share percentages."],
        },
        {
          message: ["Kategori sudah memiliki item. Nonaktifkan kategori agar histori tetap aman.", "The category already has items; deactivate it instead so the history stays intact."],
          meaning: ["Kategori masih dipakai item lain, jadi tidak boleh dihapus supaya data lama tidak rusak.", "The category is still used by other items, so deleting it would damage older records."],
          action: ["Ubah status kategori menjadi Nonaktif. Kategori nonaktif tidak muncul lagi saat menambah item baru, tetapi dokumen lama tetap terbaca utuh. Aturan yang sama berlaku untuk merek dan item.", "Set the category to Inactive. An inactive category no longer appears when adding new items, but existing documents remain fully readable. The same rule applies to brands and items."],
        },
        {
          message: ["Batas 20 analisis AI per pengguna per hari telah tercapai.", "The limit of 20 AI analyses per user per day has been reached."],
          meaning: ["Kuota harian AI Anda habis. Pesan sejenis, Maksimal dua analisis AI dapat berjalan bersamaan, berarti masih ada analisis yang belum selesai.", "Your daily AI quota is used up. A related message, at most two AI analyses can run at the same time, means one is still finishing."],
          action: ["Tunggu analisis yang berjalan selesai, coba lagi besok, atau minta rekan berperan Admin atau Finance menjalankannya. Menambah item secara manual selalu bisa dilakukan.", "Wait for the running analysis to finish, try again tomorrow, or ask an Admin or Finance colleague to run it. Adding items manually always works."],
        },
        {
          message: ["Rekomendasi lebih dari tujuh hari. Refresh analisis atau isi alasan override.", "The recommendation is older than seven days. Refresh the analysis or provide an override reason."],
          meaning: ["Draf AI sudah terlalu lama sehingga harganya mungkin tidak berlaku lagi.", "The AI draft is old enough that its prices may no longer hold."],
          action: ["Jalankan analisis ulang agar datanya segar, atau isi alasan minimal lima karakter bila harga lama masih relevan.", "Run the analysis again for fresh data, or enter a reason of at least five characters if the old pricing is still valid."],
        },
        {
          message: ["Silakan masuk untuk melanjutkan. / Peran Anda tidak memiliki akses ke fitur ini.", "Your eight-hour session has expired. / Your account is not authorized to perform this action."],
          meaning: ["Pesan pertama berarti sesi Anda sudah berakhir. Pesan kedua berarti hak akses menu Anda belum mencukupi.", "The first message means your session has ended. The second means your menu permissions are not sufficient."],
          action: ["Masuk kembali untuk pesan pertama. Untuk pesan kedua, minta Admin memeriksa hak akses akun Anda di Pengguna & Akses.", "Sign in again for the first message. For the second, ask an Admin to review your permissions in Users & Access."],
        },
        {
          message: ["Terlalu banyak percobaan. Tunggu beberapa menit sebelum mencoba lagi.", "Too many attempts. Wait a few minutes before trying again."],
          meaning: ["Terlalu banyak percobaan masuk atau permintaan pemulihan yang gagal dalam waktu singkat, entah dari perangkat Anda atau terhadap alamat email Anda. Penahanan ini melindungi akun dari penebakan kata sandi.", "Too many failed sign-in attempts or recovery requests in a short time, either from your device or against your email address. The hold protects the account from password guessing."],
          action: ["Tunggu beberapa menit lalu coba lagi; penahanan berakhir dengan sendirinya dan tidak ada akun yang terkunci permanen. Bila Anda tidak merasa mencoba masuk berkali-kali, segera ganti kata sandi setelah bisa masuk kembali dan beri tahu Admin.", "Wait a few minutes and try again; the hold expires on its own and no account is locked permanently. If those attempts were not yours, change your password as soon as you can sign in again and tell your Admin."],
        },
        {
          message: ["Tautan konfirmasi email tidak valid atau sudah kedaluwarsa.", "This email confirmation link is invalid or has already expired."],
          meaning: ["Tautan konfirmasi penggantian alamat email hanya berlaku 60 menit dan hanya sekali pakai. Tautan juga hangus bila ada permintaan penggantian yang lebih baru atau bila kata sandi akun telah diatur ulang.", "An email change confirmation link is valid for 60 minutes and only once. It also lapses if a newer change was requested or if the account password was reset."],
          action: ["Buka Profil Saya dan ajukan penggantian alamat email sekali lagi agar tautan baru dikirim ke alamat yang dituju.", "Open My Profile and request the email address change again so a fresh link is sent to the intended address."],
        },
        {
          message: ["Peran Anda tidak memiliki akses ke template surat Quotation / Invoice / SPK-PO.", "Your role has no access to Quotation / Invoice / SPK-PO letter templates."],
          meaning: ["Izin template mengikuti jenis dokumennya: SPK dan PO ikut Procurement & Vendor, Quotation dan Invoice ikut Quotation & Invoice. Template yang boleh Anda lihat tetap muncul; yang di luar izin disaring diam-diam, bukan menolak seluruh daftar.", "Template permissions follow the document type: SPK and PO follow Procurement & Vendors, quotations and invoices follow Quotations & Invoices. Templates you may see still appear; the rest are filtered out rather than refusing the whole list."],
          action: ["Minta Admin membuka Pengguna & Akses dan menyetel modul yang sesuai ke Kelola. Kalau Anda hanya menagih klien, izin Quotation & Invoice sudah cukup — izin Procurement tidak lagi diperlukan.", "Ask an Admin to open Users & Access and set the matching module to Manage. If you only bill clients, Quotations & Invoices is enough — Procurement rights are no longer required."],
        },
        {
          message: ["Template ini bukan untuk Quotation. / bukan untuk Invoice. / bukan untuk SPK. / bukan untuk BAST.", "This template is not for quotations. / not for invoices. / not for work orders. / not for handover certificates."],
          meaning: ["Template surat terikat pada satu jenis dokumen, karena penandanya berbeda per jenis. Template Invoice mengenal jatuh tempo dan sisa tagihan; template SPK mengenal vendor dan tanggal mulai. Menukarnya akan menghasilkan surat dengan penanda yang tidak pernah terisi.", "A letter template belongs to one document type, because the placeholders differ per type. An invoice template knows about due dates and outstanding balances; a work order template knows about vendors and start dates. Swapping them would produce a letter with placeholders that never fill in."],
          action: ["Pesannya menyebut jenis template yang sebenarnya. Buka Procurement & Vendor, tab Template surat, pilih jenis dokumen yang benar, lalu pilih atau buat template di sana.", "The message states what type the template actually is. Open Procurement & Vendors, the Letter templates tab, choose the correct document type, and pick or create a template there."],
        },
        {
          message: ["Proyek ... belum punya alamat email klien. Isi lebih dulu di Manajemen Proyek.", "The named project has no client email address yet. Fill it in under Project Management first."],
          meaning: ["Quotation, Invoice, dan BAST dikirim ke alamat email klien yang tersimpan pada proyeknya, bukan yang diketik saat mengirim. Kolom itu baru ada sejak Agustus 2026, jadi proyek yang dibuat sebelumnya belum mengisinya.", "Quotations, invoices, and handover certificates go to the client email address stored on the project, not one typed at send time. The field is new as of August 2026, so projects created before that do not have it."],
          action: ["Buka proyeknya di Manajemen Proyek, isi alamat email klien beserta nama PIC-nya, lalu ulangi pengiriman. Pesan sejenis tentang alamat tidak valid berarti isinya bukan alamat email yang benar.", "Open the project under Project Management, fill in the client email address and the contact name, then send again. A related message about an invalid address means what is stored is not a well-formed email address."],
        },
        {
          message: ["BAST ini belum difinalisasi. Lengkapi tanda tangan lalu finalisasi lebih dulu.", "This handover certificate has not been finalised yet. Complete the signatures and finalise it first."],
          meaning: ["Surat BAST adalah bukti bahwa dokumennya sudah sah, jadi hanya dokumen yang sudah sah yang bisa dikirim. Selama masih Draft isinya belum tentu sama dengan yang akhirnya berlaku, dan surat yang sudah masuk kotak masuk klien tidak dapat ditarik kembali.", "A handover letter is proof that the document is valid, so only a valid document may be sent. While it is still a draft its contents may yet change, and a letter already in the client's inbox cannot be recalled."],
          action: ["Minta perwakilan klien dan wakil PerumNet menandatangani di layar, tekan Finalkan & unduh PDF, lalu kirim. Tombol kirimnya memang baru tersedia sesudah finalisasi.", "Have the client's and PerumNet's representatives sign on screen, press Finalize & download PDF, then send. The send button only becomes available after finalisation."],
        },
        {
          message: ["BAST ini sudah dicabut. Kirim revisi terbarunya.", "This handover certificate has been revoked. Send its latest revision instead."],
          meaning: ["Dokumen yang dicabut tidak lagi berlaku, dan halaman verifikasinya akan menyatakan demikian kepada siapa pun yang memeriksanya. Mengirimkannya hanya akan membingungkan penerimanya.", "A revoked document is no longer valid, and its verification page says so to anyone who checks. Sending it would only confuse the recipient."],
          action: ["Buka BAST Digital untuk paket dan siklus yang sama, cari revisi terbaru yang sudah final, lalu kirim yang itu.", "Open Digital Handover for the same package and cycle, find the latest finalised revision, and send that one instead."],
        },
        {
          message: ["Sidik arsip BAST tidak cocok dengan catatannya. Pengiriman dibatalkan.", "The handover archive's fingerprint does not match its record. The delivery was cancelled."],
          meaning: ["Berkas PDF yang tersimpan tidak lagi sama dengan sidik SHA-256 yang dicatat saat finalisasi. Halaman verifikasi publik akan menyatakan dokumen itu tidak sah, jadi mengirimkannya hanya memindahkan kegagalan ke tangan klien.", "The stored PDF no longer matches the SHA-256 fingerprint recorded at finalisation. The public verification page would declare the document invalid, so sending it would merely hand the failure to the client."],
          action: ["Ini bukan kesalahan pengguna — hubungi Admin. Arsipnya perlu diperiksa lebih dulu; bila memang rusak, BAST-nya dicabut dan diterbitkan ulang sebagai revisi berikutnya.", "This is not a user error — contact an Admin. The archive has to be examined first; if it is genuinely damaged, the certificate is revoked and re-issued as the next revision."],
        },
        {
          message: ["Vendor ... belum punya alamat email. Isi lebih dulu di Procurement & Vendor — yang boleh mengubahnya Admin atau Finance.", "The named vendor has no email address. Fill it in under Procurement & Vendors — only an Admin or Finance user may change it."],
          meaning: ["SPK dan PO dikirim ke alamat email pada master vendor. Pesannya menyebut siapa yang boleh membetulkannya karena yang mentok di sini bisa jadi Project Manager, yang memang tidak boleh mengubah data vendor.", "Work orders and POs go to the address on the vendor master. The message names who may fix it because whoever hits this may well be a Project Manager, who is not allowed to change vendor records."],
          action: ["Minta Admin atau Finance membuka master vendor dan mengisi alamat emailnya. Tidak ada yang tertulis dan tidak ada surat yang terlanjur keluar saat pesan ini muncul.", "Ask an Admin or Finance user to open the vendor master and fill in the email address. Nothing is recorded and no letter leaves when this message appears."],
        },
        {
          message: ["Hanya dokumen yang sudah Disetujui yang dapat dikirim ke vendor.", "Only approved documents may be sent to a vendor."],
          meaning: ["SPK atau PO ini masih Draft atau baru Diajukan. Mengirim surat resmi atas dokumen yang belum disetujui berarti mengikat perusahaan pada komitmen yang belum diputuskan.", "This SPK or PO is still a draft or merely submitted. Sending an official letter for an unapproved document would bind the company to a commitment nobody has decided on."],
          action: ["Selesaikan dulu Ajukan lalu Setujui. Aturan yang sama berlaku untuk pratinjau: pratinjau bukan jalan memutar, dan ditolak dengan alasan yang persis sama.", "Complete Submit and then Approve first. The same rule applies to the preview: it is not a way around this and is refused for exactly the same reason."],
        },
        {
          message: ["Pilih template surat lebih dulu.", "Choose a letter template first."],
          meaning: ["Tidak ada template yang dipilih, atau belum ada satu pun template untuk jenis dokumen ini.", "No template was selected, or none exists yet for this document type."],
          action: ["Buka Procurement & Vendor, tab Template surat, dan buat satu template untuk jenis dokumen itu. Satu template bisa dipakai berulang kali; penandanya terisi sendiri dari setiap dokumen.", "Open Procurement & Vendors, the Letter templates tab, and create one template for that document type. A single template is reused; its placeholders fill themselves in from each document."],
        },
        {
          message: ["Seluruh lampiran berjumlah sekian MB, melebihi batas 10 MB per email.", "The message states the total attachment size and that it exceeds the 10 MB limit per email."],
          meaning: ["Batas 10 MB menghitung dokumen resminya sekaligus, bukan hanya berkas yang Anda tambahkan. Batas itu bukan angka sembarangan: banyak gateway email perusahaan membuang lampiran di atasnya tanpa memberi tahu siapa pun, sehingga surat tampak Terkirim padahal lampirannya dicopot di tengah jalan.", "The 10 MB limit counts the official document too, not only the files you added. The figure is not arbitrary: many corporate email gateways silently drop attachments above it, so a letter looks Sent while its attachment was stripped along the way."],
          action: ["Kurangi atau perkecil lampiran tambahan. Pesan sejenis menyebut satu berkas melebihi 10 MB, atau maksimal lima lampiran tambahan per email. Untuk berkas besar, kirim tautan unduhan di isi suratnya.", "Remove or shrink the extra attachments. Related messages name a single file above 10 MB, or the maximum of five extra attachments per email. For large files, put a download link in the body of the letter instead."],
        },
        {
          message: ["Status prospek tidak bisa berpindah dari … ke ….", "The prospect status cannot move from … to …."],
          meaning: ["Perpindahan status mengikuti tabel di bab Calon Klien. Yang di luar tabel — Lost langsung ke Won, atau mundur dua langkah — ditolak.", "Status moves follow the table in the Prospects chapter. Anything outside it — Lost straight to Won, or two steps back — is refused."],
          action: ["Pindah selangkah demi selangkah. Prospek Lost dibuka kembali ke New lebih dulu; Won hanya dicapai dari Proposal atau lewat Jadikan proyek.", "Move one step at a time. Reopen a Lost prospect to New first; Won is reached only from Proposal or through Convert to project."],
        },
        {
          message: ["Prospek ini sudah menjadi proyek PN-….", "This prospect has already become project PN-…."],
          meaning: ["Satu prospek paling banyak satu proyek, dan pesannya menyebut kode proyek yang sudah ada.", "One prospect makes at most one project, and the message names the project that already exists."],
          action: ["Buka proyek yang disebut. Kalau memang ada pekerjaan kedua untuk klien yang sama, buat proyek baru dari Manajemen Proyek atau paket komersial baru di proyek itu.", "Open the named project. If there genuinely is a second job for the same client, create a new project from Project Management or a new commercial package inside that project."],
        },
        {
          message: ["Prospek berstatus Lost tidak dapat dijadikan proyek. / Prospek ini minta berhenti dihubungi.", "A Lost prospect cannot be converted. / This prospect asked not to be contacted."],
          meaning: ["Menjadikan klien tanpa membuka kembali statusnya berarti melewati catatan penolakannya.", "Making them a client without reopening the status would skip over the record of their refusal."],
          action: ["Bila mereka menghubungi lagi, ubah statusnya ke New, lalu lanjutkan seperti biasa. Prospek yang minta berhenti dihubungi tidak dapat dijadikan proyek lewat tombol ini.", "If they got back in touch, set the status to New and continue as usual. A prospect who asked not to be contacted cannot be converted through this button."],
        },
        {
          message: ["Pilih termin yang dibayar.", "Choose the term being paid."],
          meaning: ["Setiap pembayaran vendor menempel pada satu termin; tanpa itu status termin tidak pernah bergerak.", "Every vendor payment belongs to one term; without it the term statuses never move."],
          action: ["Pilih termin pada dialog pembayaran — DP, progres, atau pelunasan — lalu ulangi.", "Pick the term in the payment dialog — advance, progress, or final — then try again."],
        },
        {
          message: ["Termin … baru berhak dibayar sekian (sudah dibayar sekian). Verifikasi progres termin ini lebih dulu.", "Term … is only payable up to so much (so much already paid). Verify this term's progress first."],
          meaning: ["Bukti diperiksa per termin. Termin yang belum diverifikasi tidak bisa dibayar berkat bukti termin lain. Angkanya sudah termasuk pajak.", "Evidence is checked per term. An unverified term cannot be paid on the strength of another term's evidence. The figures include tax."],
          action: ["Catat verifikasi untuk termin itu, atau bayar termin yang memang sudah berhak.", "Record a verification for that term, or pay the term that is actually due."],
        },
        {
          message: ["Kas yang dibayarkan harus lebih dari nol.", "The cash paid must be more than zero."],
          meaning: ["Pembayaran yang seluruhnya pajak potong tidak dapat dicatat; tarif potongan yang ada tidak pernah memakan seluruh pembayaran.", "A payment that is entirely withholding cannot be recorded; no withholding rate in use consumes a whole payment."],
          action: ["Periksa nominal gross, kas, dan potongannya — hampir pasti tertukar.", "Check the gross, cash, and withholding figures — they are almost certainly swapped."],
        },
        {
          message: ["Pajak potong hanya boleh dibukukan sebagai Payable atau Receivable.", "A withholding tax may only be booked as Payable or Receivable."],
          meaning: ["Pajak yang dipotong adalah uang yang tertahan: utang kita ke negara (vendor) atau piutang kita (klien). Dibukukan sebagai biaya atau terpulihkan, uang itu hilang dari semua daftar kewajiban.", "Withheld tax is money held back: our payable to the state (vendor) or our receivable (client). Booked as an expense or as recoverable, that money vanishes from every obligation list."],
          action: ["Ubah perlakuan akuntansi aturan itu ke Payable (kita memotong) atau Receivable (klien memotong).", "Change the rule's accounting treatment to Payable (we withhold) or Receivable (the client withholds)."],
        },
        {
          message: ["Laba aman dibagikan saat ini sekian, sedangkan yang sudah dikunci untuk alokasi lain sekian. Alokasi ini tidak lagi tertampung.", "Today's distributable profit is so much, while so much is already locked for other allocations. This allocation no longer fits."],
          meaning: ["Nominal yang sudah disetujui sebelumnya ditambah alokasi ini melampaui laba aman dibagikan saat ini — biasanya karena ada belanja atau komitmen baru setelah alokasi pertama dikunci.", "Amounts approved earlier plus this allocation exceed today's distributable profit — usually because a new expense or commitment landed after the first allocation locked."],
          action: ["Tunggu kas masuk berikutnya, kecilkan persentasenya, atau batalkan alokasi yang sudah disetujui bila memang keliru.", "Wait for the next cash in, lower the percentage, or void an approved allocation if it was wrong."],
        },
        {
          message: ["Tanggal transaksi berselisih sekian hari dari mutasi; batasnya 14 hari.", "The transaction date is so many days from the statement line; the limit is 14 days."],
          meaning: ["Pencocokan manual memakai jendela yang sama dengan pencocokan otomatis. Mutasi dan transaksi yang terpaut berminggu-minggu hampir pasti bukan pasangan.", "Manual matching uses the same window as automatic matching. A statement line and a transaction weeks apart are almost certainly not a pair."],
          action: ["Cari transaksi yang tanggalnya dekat. Kalau memang tidak ada, biarkan mutasinya Imported — ia tidak dihitung kas — dan periksa apakah pembayarannya memang belum dicatat.", "Look for a transaction with a nearby date. If there is none, leave the line Imported — it does not count as cash — and check whether the payment was ever recorded."],
        },
        {
          message: ["Siklus serah terima harus bilangan bulat antara 1 dan 100.", "The handover cycle must be a whole number between 1 and 100."],
          meaning: ["Alamat layar validasi memuat siklus yang bukan angka.", "The validation screen address carries a cycle that is not a number."],
          action: ["Buka kembali Validasi Perangkat dari menu dan pilih siklusnya di layar.", "Reopen Device Validation from the menu and choose the cycle on screen."],
        },
        {
          message: ["Total Invoice melebihi nilai Quotation. Sisa yang dapat ditagihkan adalah ….", "The invoice total exceeds the quotation value. The remaining billable amount is …."],
          meaning: ["Batas ini dihitung per PAKET: jumlah invoice paket ini tidak boleh melampaui kontrak paket ini. Invoice paket lain tidak ikut dihitung.", "This cap is computed per PACKAGE: this package's invoices may not exceed this package's contract. Other packages' invoices are not counted."],
          action: ["Tagihkan sisa yang disebutkan, atau periksa apakah Anda sedang berada di paket yang benar.", "Bill the remaining amount named, or check that you are on the right package."],
        },
      ],
    },
  ],
};

export const chapterAppendix: Chapter = {
  id: "appendix",
  title: ["Lampiran: keamanan, mode demo, arsip data, dan cap digital", "Appendix: security, demo mode, data archives, and the digital seal"],
  blocks: [
    {
      kind: "heading",
      text: ["Keamanan akun dan sesi", "Account and session security"],
    },
    {
      kind: "bullets",
      items: [
        [
          "Sesi standar berlaku 8 jam. Bila Ingat Saya dicentang, sesi perangkat tersebut berlaku sampai 30 hari. Gunakan Ingat Saya hanya pada perangkat pribadi.",
          "A standard session lasts 8 hours. When Remember Me is ticked, that device's session lasts up to 30 days. Use Remember Me only on a private device.",
        ],
        [
          "Kata sandi disimpan dalam bentuk teracak searah, tidak pernah sebagai teks biasa. Tidak ada seorang pun, termasuk Admin, yang dapat membaca kata sandi orang lain.",
          "Passwords are stored in a one-way scrambled form, never as plain text. Nobody, not even an Admin, can read anyone else's password.",
        ],
        [
          "Kata sandi baru minimal 10 karakter. Mengganti kata sandi sendiri memerlukan kata sandi lama.",
          "A new password must be at least 10 characters. Changing your own password requires the current password.",
        ],
        [
          "Mengganti kata sandi sendiri langsung mengakhiri sesi Anda di seluruh perangkat lain; hanya perangkat yang sedang Anda pakai tetap masuk. Inilah langkah pertama bila Anda menduga akun Anda dipakai orang lain.",
          "Changing your own password immediately ends your sessions on every other device; only the device you are using stays signed in. This is the first step to take if you suspect someone else is using your account.",
        ],
        [
          "Percobaan masuk yang gagal berulang kali ditahan beberapa menit, dan jedanya memanjang selama kegagalan berlanjut. Penahanan dihitung terhadap perangkat pemanggil sekaligus alamat email yang dicoba, sehingga daftar kata sandi tidak dapat dijalankan sampai habis. Penahanan selalu berakhir dengan sendirinya; tidak ada akun yang terkunci permanen.",
          "Repeated failed sign-in attempts are held off for a few minutes, and the wait grows while the failures continue. The hold is counted against both the calling device and the email address being tried, so a password list cannot be run to the end. A hold always expires on its own; no account is ever locked permanently.",
        ],
        [
          "Tautan atur ulang kata sandi hanya berlaku 30 menit sejak dikirim.",
          "A password reset link is only valid for 30 minutes after it is sent.",
        ],
        [
          "Isi pesan email tidak disimpan selamanya. Begitu sebuah email selesai — terkirim, dilewati, atau habis jatah percobaan ulangnya — badan pesannya dihapus dan yang tersisa hanya penerima, subjek, status, serta pesan kesalahannya. Karena itulah email yang sudah habis percobaannya tidak dapat dikirim ulang: ulangi tindakan aslinya agar pesan baru dibuat. Baris yang sudah selesai pun dibuang seluruhnya setelah 180 hari.",
          "Message bodies are not kept forever. As soon as an email reaches a final state — sent, skipped, or out of retry attempts — its body is discarded and only the recipient, subject, status, and error message remain. That is why an email that ran out of attempts cannot be resent: repeat the original action so a fresh message is generated. Finished rows are dropped entirely after 180 days.",
        ],
        [
          "Mengganti alamat email sendiri memerlukan konfirmasi dari alamat baru. Akun tetap memakai alamat lama sampai tautan konfirmasi dibuka, tautan itu berlaku 60 menit, dan alamat lama selalu diberi tahu bahwa ada permintaan penggantian. Begitu alamat berganti, seluruh sesi akun tersebut berakhir dan tautan pemulihan lama berhenti berlaku.",
          "Changing your own email address requires confirmation from the new address. The account keeps its old address until the confirmation link is opened, that link is valid for 60 minutes, and the old address is always told that a change was requested. Once the address changes, every session on that account ends and older recovery links stop working.",
        ],
        [
          "Bila Admin mengganti kata sandi seseorang, mengganti alamat email orang lain, atau menonaktifkan akunnya, seluruh sesi aktif orang tersebut langsung berakhir. Penggantian alamat email oleh Admin juga dikirimkan pemberitahuannya ke alamat lama.",
          "If an Admin changes someone's password, changes another person's email address, or deactivates their account, all of that person's active sessions end immediately. An Admin's email address change is also announced to the old address.",
        ],
        [
          "Nomor rekening perusahaan hanya ditampilkan sebagian, dan saldo serta mutasi hanya dapat dilihat Admin dan Finance.",
          "Company account numbers are only shown partially, and balances and statement entries are visible only to Admin and Finance.",
        ],
        [
          "Selalu tekan Keluar saat meninggalkan perangkat bersama. Satu akun untuk satu orang; jangan pernah dibagi.",
          "Always press Sign out when leaving a shared device. One account per person; never share one.",
        ],
      ],
    },
    {
      kind: "heading",
      text: ["Mode demo", "Demo mode"],
    },
    {
      kind: "para",
      text: [
        "Sebagian pemasangan dijalankan sebagai workspace demo untuk pelatihan dan peragaan. Mode demo memakai basis data yang benar-benar terpisah dari data produksi, dan aplikasi menolak berjalan bila keduanya diarahkan ke basis data yang sama. Email keluar tidak dikirim ke penerima: yang tercatat hanya jejak pengirimannya — penerima, subjek, status, dan alasannya — sedangkan isi pesannya tidak pernah disimpan sama sekali, sehingga tautan pemulihan kata sandi hasil latihan tidak pernah tertinggal di disk. Halaman masuk dan bagian atas aplikasi menampilkan pemberitahuan bahwa workspace ini terisolasi.",
        "Some installations run as a demo workspace for training and demonstrations. Demo mode uses a database that is genuinely separate from production data, and the application refuses to start if both are pointed at the same database. Outgoing email is not delivered to recipients: only the delivery trail is recorded — recipient, subject, status, and reason — while the message body is never stored at all, so a password recovery link produced during practice never lands on disk. The sign-in page and the top of the application show a notice that the workspace is isolated.",
      ],
    },
    {
      kind: "bullets",
      items: [
        [
          "Data yang Anda buat di mode demo tidak pernah muncul di aplikasi produksi, dan sebaliknya.",
          "Data you create in demo mode never appears in the production application, and vice versa.",
        ],
        [
          "Gunakan mode demo untuk melatih staf baru menjalankan seluruh rantai kerja, dari BoQ sampai BAST, tanpa risiko.",
          "Use demo mode to train new staff through the whole chain of work, from BoQ to handover certificate, without risk.",
        ],
        [
          "Jangan menyimpan dokumen atau bukti yang sesungguhnya di mode demo; anggap isinya dapat dihapus kapan saja.",
          "Do not store genuine documents or evidence in demo mode; treat its contents as removable at any time.",
        ],
      ],
    },
    {
      kind: "heading",
      text: ["Jejak data, arsip dokumen, dan cadangan", "Data trail, document archives, and backups"],
    },
    {
      kind: "bullets",
      items: [
        [
          "Pembatalan tidak pernah menghapus data. Void membuat catatan pembalik, sehingga transaksi asli dan pembatalannya sama-sama terlihat.",
          "A cancellation never deletes data. A void posts a reversing entry, so both the original transaction and its cancellation remain visible.",
        ],
        [
          "Catatan pembalik itu hanya membatalkan, bukan menambah uang baru. Karena itu laporan mengurangkannya dari sisi yang dibatalkan, bukan menambahkannya ke sisi sebaliknya: setelah pembayaran vendor Rp 2.000.000 di-void, Kas masuk, Kas keluar, grafik bulanan, dan laba proyek semuanya kembali persis seperti sebelum pembayaran itu dicatat. Kedua barisnya tetap terlihat di Buku Kas.",
          "A reversing entry only undoes; it is not new money. Reports therefore subtract it from the side it cancels rather than adding it to the opposite one: after a Rp 2,000,000 vendor payment is voided, Cash in, Cash out, the monthly chart, and project profit all return to exactly what they were before the payment was recorded. Both rows stay visible in the cash ledger.",
        ],
        [
          "Setiap dokumen menyimpan siapa yang membuatnya, siapa yang mengajukan, siapa yang menyetujui, dan kapan. Riwayat ini tidak dapat diubah oleh pengguna.",
          "Every document records who created it, who submitted it, who approved it, and when. This history cannot be altered by users.",
        ],
        [
          "Bukti yang diunggah (nota, bukti transfer, bukti persetujuan klien, bukti setor pajak) tersimpan menempel pada dokumennya dan ikut terkunci saat dokumen dikunci.", 
          "Uploaded evidence (receipts, transfer proofs, client acceptance proofs, tax payment receipts) is stored attached to its document and locks together with it.",
        ],
        [
          "BAST final disimpan sebagai berkas PDF utuh beserta sidik jari digitalnya. Unduhan berikutnya mengambil berkas arsip itu, bukan hasil cetak ulang, sehingga isinya dijamin sama persis dengan yang ditandatangani.",
          "A final handover certificate is stored as a complete PDF file together with its digital fingerprint. Later downloads serve that archived file, never a fresh re-print, so its contents are guaranteed identical to what was signed.",
        ],
        [
          "Ekspor bulanan dari Pembukuan, PDF untuk arsip yang dibaca manusia dan CSV untuk pemeriksaan angka, sebaiknya disimpan di luar aplikasi sebagai catatan akhir periode.",
          "The monthly exports from Finance, the PDF as the human-readable archive and the CSV for checking figures, should be kept outside the application as the end-of-period record.",
        ],
        [
          "Pencadangan basis data server bukan fitur di dalam aplikasi, melainkan tanggung jawab administrator sistem yang mengelola servernya. Pastikan jadwal cadangan sudah disepakati sebelum aplikasi dipakai untuk data sungguhan.",
          "Backing up the server database is not a feature inside the application; it is the responsibility of the system administrator who runs the server. Make sure a backup schedule is agreed before the application is used for real data.",
        ],
      ],
    },
    {
      kind: "heading",
      text: ["Batas ukuran dan format berkas", "File size and format limits"],
    },
    {
      kind: "table",
      widths: [72, 46, 60],
      head: [
        ["Berkas", "File"],
        ["Format", "Formats"],
        ["Batas", "Limit"],
      ],
      rows: [
        [
          ["Foto profil", "Profile photo"],
          ["JPG, PNG, WebP", "JPG, PNG, WebP"],
          ["3 MB", "3 MB"],
        ],
        [
          ["Gambar cap perusahaan", "Company seal image"],
          ["PNG, JPG, WebP", "PNG, JPG, WebP"],
          ["2 MB dan maksimal 4096 x 4096 piksel", "2 MB and at most 4096 x 4096 pixels"],
        ],
        [
          ["Nota dan bukti belanja proyek", "Project expense receipts and evidence"],
          ["JPG, PNG, WebP, PDF", "JPG, PNG, WebP, PDF"],
          ["10 MB per berkas, maksimal lima berkas per pengajuan", "10 MB per file, at most five files per submission"],
        ],
        [
          ["Bukti persetujuan klien, bukti pembayaran, bukti setor pajak", "Client acceptance proof, payment proof, tax payment receipt"],
          ["PDF, PNG, JPG, WebP", "PDF, PNG, JPG, WebP"],
          ["sekitar 6 MB", "about 6 MB"],
        ],
        [
          ["Mutasi rekening", "Bank statement"],
          ["PDF asli dengan teks yang dapat diseleksi, atau CSV", "Original PDF with selectable text, or CSV"],
          ["PDF 5 MB, CSV 2 MB, maksimal 5.000 baris per berkas", "PDF 5 MB, CSV 2 MB, at most 5,000 lines per file"],
        ],
        [
          ["Foto atau datasheet untuk AI katalog", "Photo or datasheet for the catalog AI"],
          ["PNG, JPG, WebP, PDF", "PNG, JPG, WebP, PDF"],
          ["sekitar 9,5 MB", "about 9.5 MB"],
        ],
      ],
    },
    {
      kind: "heading",
      text: ["Catatan hukum tentang cap digital BAST", "Legal note on the handover certificate's digital seal"],
    },
    {
      kind: "para",
      text: [
        "Saat sebuah BAST difinalisasi, aplikasi membubuhkan cap perusahaan pada PDF-nya, menyimpan berkas itu apa adanya, menghitung sidik jari digital SHA-256 atas isinya, dan menempelkan kode QR yang mengarah ke halaman pemeriksaan keaslian. Siapa pun yang memindai QR tersebut dapat melihat apakah dokumen itu benar terbit dari aplikasi ini, apakah masih berlaku atau sudah dicabut, dan apakah isinya masih sama dengan yang tersimpan.",
        "When a handover certificate is finalized, the application applies the company seal to its PDF, stores that file as it is, computes a SHA-256 digital fingerprint of its contents, and attaches a QR code pointing to an authenticity check page. Anyone who scans that QR code can see whether the document really came from this application, whether it is still valid or has been revoked, and whether its contents still match what is stored.",
      ],
    },
    {
      kind: "note",
      title: ["Yang perlu dipahami semua pihak", "What everyone should understand"],
      text: [
        "Mekanisme ini adalah segel internal PerumNet yang membuat perubahan dokumen mudah terdeteksi. Ini bukan Tanda Tangan Elektronik Tersertifikasi, dan PerumNet bukan Penyelenggara Sertifikasi Elektronik (PSrE). Tanda tangan yang dibubuhkan di layar adalah gambar tanda tangan yang menyatakan persetujuan para pihak, bukan sertifikat digital yang diterbitkan lembaga tersertifikasi. Bila sebuah dokumen menuntut tanda tangan elektronik tersertifikasi menurut ketentuan hukum atau permintaan klien, gunakan penyedia PSrE terdaftar di luar aplikasi ini dan lampirkan hasilnya sebagai dokumen pendamping.",
        "This mechanism is PerumNet's own internal seal, designed to make changes to a document easy to detect. It is not a Certified Electronic Signature, and PerumNet is not a certified electronic certification provider (PSrE). The signatures captured on screen are signature images expressing the parties' agreement, not digital certificates issued by a certified authority. If a document legally requires a certified electronic signature, or the client asks for one, use a registered PSrE provider outside this application and attach the result as a companion document.",
      ],
    },
    {
      kind: "heading",
      text: ["Bila panduan ini terasa tidak cocok dengan aplikasi", "If this manual no longer matches the application"],
    },
    {
      kind: "para",
      text: [
        "Panduan ini dihasilkan langsung oleh aplikasi pada saat Anda mengunduhnya, sehingga isinya mengikuti versi yang sedang berjalan. Bila ada langkah yang tidak lagi cocok dengan layar, unduh ulang panduan dari Pusat Bantuan untuk mendapatkan versi terbaru, dan laporkan perbedaannya ke it@perumnet.id. Pusat Bantuan di dalam aplikasi memuat ringkasan yang sama dalam bentuk yang dapat dicari.",
        "This manual is produced by the application itself at the moment you download it, so its contents follow the version currently running. If a step no longer matches the screen, download the manual again from the Help Center for the latest version, and report the difference to it@perumnet.id. The in-app Help Center carries the same material in a searchable quick-reference form.",
      ],
    },
  ],
};

export const guideChapters: Chapter[] = [
  chapterRoles,
  chapterFlow,
  chapterStart,
  chapterQuotation,
  chapterInstallment,
  chapterInvoicePayment,
  chapterAddendum,
  chapterProcurement,
  chapterDocumentEmail,
  chapterHandover,
  chapterExpenses,
  chapterBank,
  chapterTax,
  chapterProfit,
  chapterCatalog,
  chapterProspects,
  chapterAccess,
  chapterExample,
  chapterGlossary,
  chapterMessages,
  chapterAppendix,
];
