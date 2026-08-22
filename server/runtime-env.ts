/**
 * Reads `NODE_ENV` as it actually is in the running process.
 *
 * Next.js replaces the literal member expression `process.env.NODE_ENV` with a
 * constant while it compiles: `"development"` under `next dev`, `"production"`
 * under `next build`. So a guard written as `process.env.NODE_ENV !==
 * "production"` is not a guard at all inside a dev-mode process — it stays
 * `true` no matter what the operator exported before starting the server. That
 * was measured on this codebase: `NODE_ENV=production next dev` still handed a
 * password-reset token back over HTTP.
 *
 * The rewrite covers `process.env.NODE_ENV` and `process.env["NODE_ENV"]`
 * alike — both were measured returning "development" inside a server started
 * with NODE_ENV=production — but it does not follow the access through
 * `globalThis`, which is why the lookup is written the long way round.
 *
 * Anything that must refuse in production should ask here. Anything that only
 * changes logging or formatting should keep using the plain expression, which
 * is cheaper and correct for that purpose.
 *
 * Deliberately not `server-only`: it is one property read with no request,
 * secret or database access, and the regression test imports it directly.
 */
export function runtimeNodeEnv() {
  const environment = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return environment?.NODE_ENV ?? "";
}

export function isProductionRuntime() {
  return runtimeNodeEnv() === "production";
}

/**
 * Menolak menjalankan bangunan demo sebagai produksi, atau sebaliknya.
 *
 * `NEXT_PUBLIC_DEMO_MODE` DIINLINE Next saat build — nilainya menyatakan
 * "bangunan ini dibuat untuk lingkungan yang mana". `APP_MODE` dibaca saat
 * proses berjalan. Selama keduanya sepakat, tidak ada yang perlu diperiksa.
 *
 * Yang terjadi 22 Agustus 2026: perintah deploy menjalankan
 * `set -a; . ./.env.production` untuk KEDUA lingkungan di dalam satu shell,
 * lalu menyalakan pm2 dari shell yang sama. Variabel produksi menang, dan pm2
 * meneruskannya ke keempat proses. Proses demo naik dengan `APP_MODE` produksi,
 * jadi `createDatabaseState` memilih `DATABASE_URL` — situs demo memegang
 * BASIS DATA PRODUKSI.
 *
 * Tidak ada satu pun penjaga yang berbunyi. Penjaga yang sudah ada hanya
 * membandingkan DEMO_DATABASE_URL dengan DATABASE_URL, dan pertanyaan itu tidak
 * pernah ditanyakan karena aplikasinya sudah tidak merasa dirinya demo lagi.
 * Yang menahannya justru kebetulan: `APP_URL` ikut tertimpa, sehingga login
 * ditolak karena origin — dan pemilik melaporkannya sebagai bug login.
 *
 * Aplikasi tidak bisa menebak dirinya "seharusnya" demo, tetapi BANGUNANNYA
 * tahu. Ketidakcocokan keduanya berarti env bocor lintas lingkungan, dan satu
 * arah dari ketidakcocokan itu berarti data produksi sedang terbuka lewat pintu
 * yang mengaku demo. Lebih baik mati dengan berisik.
 *
 * Hanya berlaku di runtime produksi: `next dev` di laptop memang berjalan tanpa
 * APP_MODE dan tanpa bangunan demo.
 */
export function assertModeSesuaiBangunan(opts: {
  /** Nilai `NEXT_PUBLIC_DEMO_MODE` yang tertanam saat build. */
  buildDemo: boolean;
  /** `APP_MODE` yang dibaca saat proses berjalan. */
  appMode: string | undefined;
  isProduction: boolean;
}) {
  if (!opts.isProduction) return;
  const runtimeDemo = opts.appMode === "demo";
  if (opts.buildDemo === runtimeDemo) return;
  throw new Error(
    opts.buildDemo
      ? "Bangunan demo dijalankan tanpa APP_MODE=demo. Aplikasi ini akan memakai DATABASE_URL produksi. Hampir selalu ini berarti env produksi bocor ke proses demo — periksa perintah pm2 start, dan jangan pernah `source` dua berkas .env di shell yang sama."
      : "Bangunan produksi dijalankan dengan APP_MODE=demo. Layarnya tidak akan menandai dirinya sebagai demo, sehingga data demo bisa dikira data sungguhan.",
  );
}
