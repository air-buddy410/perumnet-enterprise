// Template PM2 untuk VPS. Disamakan dengan keadaan sebenarnya di server pada
// 2026-08-21 — sebelum itu berkas ini menyebut `/var/www/perumnet-enterprise`
// dengan satu app bernama `perumnet-enterprise`, dan tidak ada satu pun yang
// benar: tidak ada folder itu, tidak ada app dengan nama itu, dan pasangan
// demo-nya tidak pernah disebut sama sekali.
//
// Bentuk yang benar: rilis diletakkan per-commit, dan DUA lingkungan berjalan
// berdampingan di mesin yang sama.
//
//   ~/releases/perumnet-enterprise/<commit>              → DEMO      port 3101
//   ~/releases/perumnet-enterprise-production/<commit>   → PRODUKSI  port 3100
//
// Keduanya memakai nama berkas env yang sama, `.env.production`; yang
// membedakan demo dari produksi ada DI DALAM berkas itu (APP_MODE), bukan di
// sini. Jadi jangan menyimpulkan lingkungan dari nama berkasnya.
//
// Pemakaian — RELEASE wajib diisi commit yang sedang dinaikkan:
//
//   RELEASE=2fe93bb pm2 start deploy/ecosystem.config.cjs --only perumnet-enterprise-admin
//   RELEASE=2fe93bb pm2 start deploy/ecosystem.config.cjs --only perumnet-enterprise-demo
//
// JANGAN menyalakan pm2 dari shell yang pernah menjalankan
// `set -a; . ./.env.production`.
//
// Berkas ini sengaja TIDAK menyetel APP_URL, APP_MODE, atau DATABASE_URL:
// masing-masing app membacanya sendiri dari `.env.production` di `cwd`-nya.
// Tetapi variabel yang sudah ada di lingkungan MENANG atas berkas .env, dan pm2
// meneruskan seluruh lingkungan shell pemanggil ke keempat proses.
//
// 22 Agustus 2026 satu perintah deploy membangun kedua lingkungan dengan
// `set -a; . ./.env.production` di dalam SATU shell, lalu menyalakan pm2 dari
// shell itu juga. Nilai produksi menang, dan proses DEMO naik dengan APP_MODE
// serta DATABASE_URL produksi — situs demo memegang basis data produksi.
// Yang menahannya cuma kebetulan: APP_URL ikut tertimpa sehingga login ditolak
// karena origin, dan gejalanya terbaca sebagai "tidak bisa login".
//
// Bangun di dalam SUBSHELL, satu per lingkungan, supaya env-nya tidak pernah
// bocor keluar:
//
//   ( cd $DEMO && set -a; . ./.env.production; set +a; npm run build )
//   ( cd $PRODUKSI && set -a; . ./.env.production; set +a; npm run build )
//
// lalu salakan pm2 dari shell yang bersih. `assertModeSesuaiBangunan`
// (server/runtime-env.ts) sekarang menolak naik kalau ini terulang.

const RELEASE = process.env.RELEASE;
if (!RELEASE) {
  throw new Error(
    "RELEASE belum diisi. Contoh: RELEASE=2fe93bb pm2 start deploy/ecosystem.config.cjs",
  );
}

const RUMAH = process.env.HOME || "/home/perumnet";
const produksi = `${RUMAH}/releases/perumnet-enterprise-production/${RELEASE}`;
const demo = `${RUMAH}/releases/perumnet-enterprise/${RELEASE}`;

/** Worker email membaca kredensialnya sendiri dari berkas, bukan dari pm2. */
function pekerjaEmail(nama, cwd) {
  return {
    name: nama,
    cwd,
    script: "scripts/email-worker.mjs",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    restart_delay: 5000,
    // 300M, bukan 180M: worker yang sedang jalan duduk di 84–90 MB setelah
    // 24 jam. Batas 180M belum pernah dipakai sungguhan dan sisanya terlalu
    // tipis untuk pertumbuhan wajar heap Node.
    max_memory_restart: "300M",
    env: { NODE_ENV: "production", EMAIL_ENV_FILE: ".env.production" },
  };
}

function situs(nama, cwd, port) {
  return {
    name: nama,
    cwd,
    script: "node_modules/next/dist/bin/next",
    args: `start -H 127.0.0.1 -p ${port}`,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: "700M",
    env: { NODE_ENV: "production" },
  };
}

module.exports = {
  apps: [
    // Nama app produksi memang `-admin`, bukan `-production`. Berbeda dari
    // nama folder rilisnya, dan itu memang begitu di server.
    situs("perumnet-enterprise-admin", produksi, 3100),
    pekerjaEmail("perumnet-enterprise-email-worker", produksi),
    situs("perumnet-enterprise-demo", demo, 3101),
    pekerjaEmail("perumnet-enterprise-demo-email-worker", demo),
  ],
};
