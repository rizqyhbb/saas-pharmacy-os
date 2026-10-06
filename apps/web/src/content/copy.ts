/**
 * All visible text, in Indonesian (primary, D4) and English. The Indonesian
 * object defines the shape; English must match it.
 *
 * Copy rules for this page: no regulatory or compliance claims (CLAUDE.md
 * "Regulatory claims need a date and a source"), no invented customers or
 * metrics, and say plainly what is still being built.
 */

export const PRODUCT_NAME = "Apotek OS";

// TODO(owner): replace with the real pilot contact (email, WhatsApp or form URL).
export const PILOT_CONTACT_HREF = "mailto:pilot@example.com?subject=Apotek%20pilot";

const id = {
  lang: "id",
  meta: {
    title: `${PRODUCT_NAME}: sistem apotek dengan kasir yang tetap cepat`,
    description:
      "Batch, kedaluwarsa, dan stok tercatat di setiap penjualan, bahkan saat internet putus. Sedang dibangun bersama apotek pilot.",
  },
  nav: {
    demo: "Demo",
    features: "Fitur",
    roadmap: "Peta jalan",
    pilot: "Jadi apotek pilot",
    switchHref: "/en",
    switchShort: "EN",
    switchLabel: "Read in English",
    home: `${PRODUCT_NAME}, ke awal halaman`,
  },
  hero: {
    title: "Setiap obat terlacak, dari pemasok sampai pasien.",
    sub: "Sistem apotek dengan kasir yang tetap cepat. Batch, kedaluwarsa, dan stok tercatat di setiap penjualan, bahkan saat internet putus.",
    primary: "Coba demo",
    secondary: "Jadi apotek pilot",
    photoAlt: "Apoteker berjas putih mengambil kotak obat dari rak apotek",
  },
  stockPreview: {
    title: "Kartu stok",
    product: "Paracetamol 500 mg",
    sellable: "Bisa dijual",
    expiresIn: "{n} hari lagi",
    expiredAgo: "lewat {n} hari",
    next: "Dijual berikutnya",
    blocked: "Diblokir",
    caption: "Data contoh. Stok disimpan per tablet, ditampilkan per box, strip, dan tablet.",
  },
  problem: {
    title: "Apotek bukan toko biasa.",
    ladderLabel: "Satuan bertingkat: 1 box berisi 10 strip, 1 strip berisi 10 tablet. 1 box sama dengan 100 tablet.",
    contains: "isi {n} {unit}",
    tablets: "{n} tablet",
    body: "Obat dibeli per box, dijual per strip, kadang per tablet. Setiap batch punya tanggal kedaluwarsa dan harga modal sendiri.",
    points: [
      { title: "Satu produk, banyak batch", body: "Paracetamol di rak yang sama bisa berasal dari tiga pengiriman dengan kedaluwarsa berbeda." },
      { title: "Kedaluwarsa tidak menunggu", body: "Batch yang tidak terjual duluan berakhir jadi kerugian, atau lebih buruk, terjual." },
      { title: "Resep butuh apoteker", body: "Obat wajib resep bukan barang yang cukup dipindai di kasir. Ada keputusan yang harus tercatat." },
    ],
  },
  demo: {
    eyebrow: "Demo interaktif",
    title: "Coba kasirnya. Lihat apa yang tercatat.",
    sub: "Ikuti tur singkat atau klik sendiri. Logikanya sama dengan produk aslinya, datanya hanya contoh.",
    loading: "Menyiapkan kasir demo",
  },
  demoUi: {
    tourTitle: "Tur singkat",
    stepOf: "Langkah {n} dari {total}",
    doIt: "Lakukan untuk saya",
    next: "Lanjut",
    restart: "Ulangi demo",
    doneTitle: "Itu intinya.",
    doneBody: "Sekarang coba sendiri: ganti satuan, habiskan stok, atau jual beberapa transaksi saat offline.",
    steps: [
      {
        title: "Jual 2 strip paracetamol",
        body: "Pilih satuan strip, lalu tambah dua kali. Sistem menyimpan semuanya dalam satuan dasar: 2 strip sama dengan 20 tablet.",
      },
      {
        title: "Lihat batch yang dipilih",
        body: "PCT-24A11 masih berisi 30 tablet tapi sudah kedaluwarsa, jadi dilewati. Sistem mengambil 14 dari batch yang paling cepat kedaluwarsa, sisanya dari batch berikutnya.",
      },
      {
        title: "Bayar",
        body: "Satu transaksi, dua catatan stok. Buka buku besar: setiap baris menyebut batch, jumlah, dan nomor transaksinya.",
      },
      {
        title: "Coba jual amoxicillin",
        body: "Produk ini ditandai wajib resep oleh apotek, jadi kasir tidak bisa menjualnya. Alur resep dengan persetujuan apoteker menyusul di versi berikutnya.",
      },
      {
        title: "Putus koneksi, tetap jualan",
        body: "Matikan koneksi, lalu jual 1 strip vitamin C. Transaksi tersimpan di perangkat dan stok di layar langsung berkurang.",
      },
      {
        title: "Sambung lagi",
        body: "Saat online, transaksi dikirim ke server. Demo ini sengaja mengirimnya dua kali, dan server hanya mencatatnya sekali.",
      },
    ],
    counter: {
      title: "Kasir",
      connection: "Koneksi",
      online: "Online",
      offline: "Offline",
      products: "Produk",
      rxBadge: "Wajib resep",
      unitLabel: "Satuan untuk {product}",
      add: "Tambah",
      cart: "Keranjang",
      emptyCart: "Keranjang kosong. Tambahkan produk dari daftar.",
      fefoTitle: "Batch yang akan dipakai",
      takeFrom: "{qty} tablet dari {batch}",
      baseEq: "{qty} tablet",
      total: "Total",
      pay: "Bayar",
      payOffline: "Simpan transaksi",
      decrease: "Kurangi {item}",
      increase: "Tambah {item}",
      sellable: "{qty} tablet bisa dijual",
      skipped: "{qty} tablet kedaluwarsa, dilewati",
    },
    notices: {
      RX_BLOCKED: "{product} wajib resep. Tidak bisa dijual lewat kasir biasa.",
      INSUFFICIENT: "Stok {product} tidak cukup, kurang {qty} tablet.",
      SOLD: "{sale} tercatat. Total {total}.",
      QUEUED: "{sale} disimpan di perangkat dan akan dikirim saat online.",
      SYNCED: "{n} transaksi terkirim ke server.",
      dismiss: "Tutup pesan",
    },
    panels: {
      stock: "Kartu stok",
      ledger: "Buku besar",
      sync: "Sinkronisasi",
      batch: "Batch",
      expiry: "Kedaluwarsa",
      onHand: "Stok",
      bands: { EXPIRED: "Kedaluwarsa", NEAR: "Segera kedaluwarsa", OK: "Aman" },
      next: "Dijual berikutnya",
      daysLeft: "{n} hari lagi",
      daysAgo: "lewat {n} hari",
      ledgerNote: "Catatan hanya bisa ditambah, tidak pernah diedit. Koreksi masuk sebagai baris baru.",
      pending: "Menunggu sinkron",
      events: { OPENING_BALANCE: "Saldo awal", SALE: "Penjualan" } as Record<string, string>,
      attempt: "Kiriman ke-{n}",
      outcomes: { ACCEPTED: "Diterima", DUPLICATE_IGNORED: "Duplikat, diabaikan", CONFLICT: "Konflik stok, perlu dicek" },
      syncEmpty: "Belum ada transaksi offline. Matikan koneksi di kasir untuk mencoba.",
      sample: "Data contoh",
    },
  },
  features: {
    title: "Pekerjaan yang diambil alih sistem, supaya staf tidak perlu menghafal.",
    photoAlt: "Deretan botol obat di rak apotek, masing-masing dengan label rak",
    fefoLabel: "Urutan batch paracetamol, data contoh",
    fefoTags: { skipped: "Dilewati", first: "Keluar duluan", later: "Berikutnya" },
    unitsCaption: "Contoh: stok paracetamol yang bisa dijual, {qty} tablet.",
    ledgerCaption: "Contoh: catatan dari penjualan 2 strip paracetamol.",
    items: [
      {
        title: "Batch yang paling cepat kedaluwarsa keluar duluan.",
        body: "Kasir cukup memindai produk, sistem memilih batch. Batch kedaluwarsa, dikarantina, atau ditarik tidak bisa terjual.",
      },
      {
        title: "Beli per box, jual per strip.",
        body: "Konversi satuan selalu pasti, tanpa pembulatan diam-diam. Sisa strip yang sudah dibuka tetap terhitung.",
      },
      {
        title: "Stok tidak pernah diedit langsung.",
        body: "Setiap perubahan adalah catatan baru dengan alasan, pelaku, dan dokumen asalnya. Selisih stok bisa ditelusuri sampai sumbernya.",
      },
      {
        title: "Internet putus, kasir jalan terus.",
        body: "Transaksi disimpan di perangkat lalu dikirim saat koneksi kembali. Tidak hilang, tidak tercatat dua kali.",
      },
      {
        title: "Barang masuk lengkap dengan batch.",
        body: "Penerimaan tanpa nomor batch dan tanggal kedaluwarsa tidak bisa disimpan. PO, penerimaan, dan faktur pemasok dicocokkan.",
      },
    ],
  },
  principles: {
    title: "Sistem mencatat. Apoteker yang memutuskan.",
    items: [
      {
        title: "Tidak ada keputusan klinis otomatis.",
        body: "Sistem menampilkan daftar periksa dan mencatat siapa yang menyetujui. Persetujuan dan penggantian obat selalu atas nama apoteker.",
      },
      {
        title: "Data pasien dipisah dari data pelanggan.",
        body: "Akses lebih ketat, setiap pembacaan tercatat, dan tidak pernah masuk log, ekspor analitik, atau data demo.",
      },
      {
        title: "Hak akses diperiksa di server.",
        body: "Menyembunyikan tombol bukan izin. Setiap aksi penting diperiksa ulang sesuai peran pengguna.",
      },
      {
        title: "Tidak ada klaim kepatuhan tanpa validasi.",
        body: "Fitur pelaporan diuji bersama APJ berlisensi sebelum kami menyebutnya sesuai aturan.",
      },
    ],
  },
  roadmap: {
    title: "Dibangun bertahap, bersama apotek sungguhan.",
    stages: [
      {
        label: "Sedang dibangun",
        title: "Inti operasional",
        items: [
          "Produk, satuan bertingkat, batch, dan buku besar stok",
          "Kasir obat bebas, pembayaran, struk, dan shift kasir",
          "Pembelian, penerimaan barang, dan utang pemasok",
          "Dasbor pemilik dan stock opname",
        ],
      },
      {
        label: "Berikutnya",
        title: "Resep dan racikan",
        items: [
          "Antrean resep dengan persetujuan apoteker",
          "Penyiapan, pemeriksaan akhir, dan etiket",
          "Racikan dengan tuslah dan embalase",
        ],
      },
      {
        label: "Setelahnya",
        title: "Kontrol dan integrasi",
        items: [
          "Banyak cabang dan transfer stok",
          "Retur, karantina, dan penarikan batch",
          "Buku besar obat narkotika dan psikotropika, dengan ekspor laporan",
          "Integrasi SATUSEHAT",
        ],
      },
    ],
  },
  pilot: {
    eyebrow: "Program pilot",
    title: "Kami mencari satu apotek pilot.",
    body: "Apotek mandiri dengan APJ yang mau memberi masukan setiap minggu. Gratis selama masa pilot.",
    getTitle: "Yang Anda dapat",
    get: [
      "Dipakai gratis selama masa pilot",
      "Impor katalog dan stok awal dibantu",
      "Fitur dibentuk dari alur kerja apotek Anda",
    ],
    askTitle: "Yang kami minta",
    ask: [
      "Satu sesi masukan setiap minggu",
      "APJ yang bersedia meninjau alur resep",
      "Terus terang kalau ada yang tidak berguna",
    ],
    cta: "Jadi apotek pilot",
    photoAlt: "Apoteker menjelaskan botol obat kepada pelanggan lansia di meja apotek",
  },
  footer: {
    tagline: "Sistem apotek untuk Indonesia.",
    rights: `© 2026 ${PRODUCT_NAME}`,
  },
};

export type Copy = typeof id;

const en: Copy = {
  lang: "en",
  meta: {
    title: `${PRODUCT_NAME}: pharmacy software with a counter that stays fast`,
    description:
      "Batch, expiry and stock recorded on every sale, even when the internet drops. Being built with a pilot pharmacy.",
  },
  nav: {
    demo: "Demo",
    features: "Features",
    roadmap: "Roadmap",
    pilot: "Become a pilot",
    switchHref: "/",
    switchShort: "ID",
    switchLabel: "Baca dalam Bahasa Indonesia",
    home: `${PRODUCT_NAME}, back to top`,
  },
  hero: {
    title: "Every medicine traceable, from supplier to patient.",
    sub: "Pharmacy software with a counter that stays fast. Batch, expiry and stock are recorded on every sale, even offline.",
    primary: "Try the demo",
    secondary: "Become a pilot",
    photoAlt: "A pharmacist in a white coat taking a box of medicine from a shelf",
  },
  stockPreview: {
    title: "Stock card",
    product: "Paracetamol 500 mg",
    sellable: "Sellable",
    expiresIn: "in {n} days",
    expiredAgo: "{n} days ago",
    next: "Sells next",
    blocked: "Blocked",
    caption: "Sample data. Stock is kept per tablet, shown per box, strip and tablet.",
  },
  problem: {
    title: "A pharmacy is not a normal shop.",
    ladderLabel: "Unit ladder: 1 box holds 10 strips, 1 strip holds 10 tablets. 1 box equals 100 tablets.",
    contains: "holds {n} {unit}",
    tablets: "{n} tablets",
    body: "Medicine is bought by the box, sold by the strip, sometimes by the tablet. Every batch has its own expiry date and cost.",
    points: [
      { title: "One product, many batches", body: "The paracetamol on one shelf can come from three deliveries with different expiry dates." },
      { title: "Expiry does not wait", body: "A batch that isn't sold first ends up as a loss, or worse, gets sold." },
      { title: "Prescriptions need a pharmacist", body: "A prescription-only medicine is not something you just scan at the till. A decision has to be recorded." },
    ],
  },
  demo: {
    eyebrow: "Interactive demo",
    title: "Try the counter. See what gets recorded.",
    sub: "Follow the short tour or click around. Same logic as the real product, sample data only.",
    loading: "Setting up the demo counter",
  },
  demoUi: {
    tourTitle: "Short tour",
    stepOf: "Step {n} of {total}",
    doIt: "Do it for me",
    next: "Next",
    restart: "Restart demo",
    doneTitle: "That's the core of it.",
    doneBody: "Now try it yourself: switch units, run a product out of stock, or ring up several sales offline.",
    steps: [
      {
        title: "Sell 2 strips of paracetamol",
        body: "Pick the strip unit and add it twice. Everything is stored in the base unit: 2 strips equal 20 tablets.",
      },
      {
        title: "See which batches it picked",
        body: "PCT-24A11 still holds 30 tablets but has expired, so it is skipped. The system takes 14 from the batch expiring soonest and the rest from the next one.",
      },
      {
        title: "Take payment",
        body: "One sale, two stock records. Open the ledger: each row names the batch, the quantity and the sale number.",
      },
      {
        title: "Try selling amoxicillin",
        body: "The pharmacy has marked this product prescription-only, so the counter can't sell it. The prescription flow with pharmacist approval comes in the next version.",
      },
      {
        title: "Go offline, keep selling",
        body: "Switch the connection off, then sell 1 strip of vitamin C. The sale is saved on the device and the stock on screen drops right away.",
      },
      {
        title: "Reconnect",
        body: "Once online, the sale is sent to the server. This demo deliberately sends it twice, and the server records it once.",
      },
    ],
    counter: {
      title: "Counter",
      connection: "Connection",
      online: "Online",
      offline: "Offline",
      products: "Products",
      rxBadge: "Prescription only",
      unitLabel: "Unit for {product}",
      add: "Add",
      cart: "Cart",
      emptyCart: "The cart is empty. Add a product from the list.",
      fefoTitle: "Batches it will use",
      takeFrom: "{qty} tablets from {batch}",
      baseEq: "{qty} tablets",
      total: "Total",
      pay: "Take payment",
      payOffline: "Save sale",
      decrease: "Remove one {item}",
      increase: "Add one {item}",
      sellable: "{qty} tablets sellable",
      skipped: "{qty} tablets expired, skipped",
    },
    notices: {
      RX_BLOCKED: "{product} is prescription-only. It can't be sold at the regular counter.",
      INSUFFICIENT: "Not enough {product} in stock, {qty} tablets short.",
      SOLD: "{sale} recorded. Total {total}.",
      QUEUED: "{sale} saved on this device. It will be sent once you're online.",
      SYNCED: "{n} sales sent to the server.",
      dismiss: "Dismiss message",
    },
    panels: {
      stock: "Stock card",
      ledger: "Ledger",
      sync: "Sync",
      batch: "Batch",
      expiry: "Expiry",
      onHand: "On hand",
      bands: { EXPIRED: "Expired", NEAR: "Expiring soon", OK: "OK" },
      next: "Sells next",
      daysLeft: "in {n} days",
      daysAgo: "{n} days ago",
      ledgerNote: "Rows can only be added, never edited. Corrections arrive as new rows.",
      pending: "Waiting to sync",
      events: { OPENING_BALANCE: "Opening balance", SALE: "Sale" },
      attempt: "Send #{n}",
      outcomes: { ACCEPTED: "Accepted", DUPLICATE_IGNORED: "Duplicate, ignored", CONFLICT: "Stock conflict, needs review" },
      syncEmpty: "No offline sales yet. Switch the connection off at the counter to try it.",
      sample: "Sample data",
    },
  },
  features: {
    title: "The work the system takes over, so staff don't have to memorise it.",
    photoAlt: "Rows of medicine bottles on a pharmacy shelf, each with a shelf label",
    fefoLabel: "Paracetamol batch order, sample data",
    fefoTags: { skipped: "Skipped", first: "Goes out first", later: "After that" },
    unitsCaption: "Example: sellable paracetamol stock, {qty} tablets.",
    ledgerCaption: "Example: the records from selling 2 strips of paracetamol.",
    items: [
      {
        title: "The batch expiring soonest goes out first.",
        body: "The cashier scans the product and the system picks the batch. Expired, quarantined or recalled batches can't be sold.",
      },
      {
        title: "Buy by the box, sell by the strip.",
        body: "Unit conversion is always exact, with no silent rounding. An opened strip's remainder is still counted.",
      },
      {
        title: "Stock is never edited directly.",
        body: "Every change is a new record with a reason, a person and the document behind it. Any difference can be traced to its source.",
      },
      {
        title: "The internet drops, the counter keeps going.",
        body: "Sales are saved on the device and sent when the connection returns. Never lost, never recorded twice.",
      },
      {
        title: "Goods arrive with their batch.",
        body: "A receipt without batch number and expiry date can't be saved. Purchase order, receipt and supplier invoice are matched.",
      },
    ],
  },
  principles: {
    title: "The system records. The pharmacist decides.",
    items: [
      {
        title: "No automatic clinical decisions.",
        body: "The system shows checklists and records who approved. Approvals and substitutions are always in a pharmacist's name.",
      },
      {
        title: "Patient data is kept apart from customer data.",
        body: "Stricter access, every read is logged, and it never appears in logs, analytics exports or demo data.",
      },
      {
        title: "Permissions are checked on the server.",
        body: "Hiding a button is not a permission. Every important action is re-checked against the user's role.",
      },
      {
        title: "No compliance claims without validation.",
        body: "Reporting features are tested with a licensed pharmacist in charge (APJ) before we call them compliant.",
      },
    ],
  },
  roadmap: {
    title: "Built in stages, with a real pharmacy.",
    stages: [
      {
        label: "In progress",
        title: "Operational core",
        items: [
          "Products, unit ladders, batches and the stock ledger",
          "Over-the-counter checkout, payment, receipts and cashier shifts",
          "Purchasing, goods receipt and supplier payables",
          "Owner dashboard and stock counts",
        ],
      },
      {
        label: "Next",
        title: "Prescriptions and compounding",
        items: [
          "Prescription queue with pharmacist approval",
          "Picking, final check and dispensing labels",
          "Compounding with compounding and packaging fees",
        ],
      },
      {
        label: "Later",
        title: "Control and integrations",
        items: [
          "Multiple branches and stock transfers",
          "Returns, quarantine and batch recalls",
          "Narcotic and psychotropic ledger, with report export",
          "SATUSEHAT integration",
        ],
      },
    ],
  },
  pilot: {
    eyebrow: "Pilot programme",
    title: "We're looking for one pilot pharmacy.",
    body: "An independent pharmacy whose pharmacist in charge will give feedback every week. Free during the pilot.",
    getTitle: "What you get",
    get: [
      "Free use for the length of the pilot",
      "Help importing your catalogue and opening stock",
      "Features shaped around how your pharmacy works",
    ],
    askTitle: "What we ask",
    ask: [
      "One feedback session every week",
      "A pharmacist willing to review the prescription flow",
      "Honesty when something isn't useful",
    ],
    cta: "Become a pilot",
    photoAlt: "A pharmacist explaining a medicine bottle to an older customer at the counter",
  },
  footer: {
    tagline: "Pharmacy software for Indonesia.",
    rights: `© 2026 ${PRODUCT_NAME}`,
  },
};

export const COPY = { id, en } as const;
export type Lang = keyof typeof COPY;

/** Fills `{name}` placeholders. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}
