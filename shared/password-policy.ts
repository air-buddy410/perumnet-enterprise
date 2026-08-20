// Aturan kata sandi yang dipakai server DAN layar.
//
// Di mode MAILSERVER, kata sandi yang diganti orang lewat Pengaturan adalah
// kata sandi MAILBOX-nya di mailcow — bukan kolom di database ini. Artinya ada
// dua pihak yang berhak menolak: aplikasi ini, dan mailcow.
//
// Kalau aplikasi lebih longgar daripada mailcow, penolakannya datang TERLAMBAT:
// kata sandi lama sudah terlanjur diverifikasi ke mailserver, orangnya sudah
// mengetik dua kali, lalu yang muncul adalah galat dari mailcow yang tidak
// menjelaskan syarat mana yang tidak terpenuhi. Karena itu syarat mailcow
// ditarik ke sini dan diperiksa lebih dulu.
//
// Hari ini mailcow di PerumNet hanya menuntut 6 karakter tanpa syarat lain,
// jadi lantai aplikasi (10) yang menang. Itu bisa berubah kapan saja dari
// antarmuka mailcow tanpa ada yang menyentuh kode ini — dan justru itu
// alasannya dibaca, bukan disalin sebagai angka mati.

/**
 * Lantai milik aplikasi ini, terlepas dari apa kata mailcow.
 *
 * Sengaja lebih tinggi dari bawaan mailcow. Menurunkannya agar "sesuai
 * mailcow" berarti melemahkan setiap akun demi keseragaman dengan nilai yang
 * kebetulan rendah.
 */
export const APP_PASSWORD_MIN_LENGTH = 10;

/** Batas atas; bcrypt hanya membaca 72 byte pertama, tapi input tetap dibatasi. */
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordPolicy {
  minLength: number;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  requireMixedCase: boolean;
  requireLetters: boolean;
  /** Dari mana syaratnya berasal — dipakai layar untuk menjelaskan. */
  source: "app" | "mailcow";
}

export const APP_PASSWORD_POLICY: PasswordPolicy = {
  minLength: APP_PASSWORD_MIN_LENGTH,
  requireNumbers: false,
  requireSpecialChars: false,
  requireMixedCase: false,
  requireLetters: false,
  source: "app",
};

/** Bentuk mentah jawaban `GET /api/v1/get/passwordpolicy` milik mailcow. */
export interface MailcowPasswordPolicy {
  length?: unknown;
  chars?: unknown;
  numbers?: unknown;
  special_chars?: unknown;
  lowerupper?: unknown;
}

/** mailcow memulangkan angkanya sebagai STRING ("6", "0"). */
function angka(nilai: unknown): number {
  const n = Number(nilai);
  return Number.isFinite(n) ? n : 0;
}

function menyala(nilai: unknown): boolean {
  return angka(nilai) > 0;
}

/**
 * Gabungan syarat aplikasi dan syarat mailcow — selalu yang LEBIH KETAT.
 *
 * Tidak pernah melonggarkan: mailcow yang menuntut 6 tidak menurunkan lantai
 * aplikasi yang 10, sedangkan mailcow yang menuntut 14 menaikkannya.
 */
export function mergePasswordPolicy(
  mailcow: MailcowPasswordPolicy | null | undefined,
): PasswordPolicy {
  if (!mailcow) return { ...APP_PASSWORD_POLICY };
  return {
    minLength: Math.max(APP_PASSWORD_MIN_LENGTH, angka(mailcow.length)),
    requireNumbers: menyala(mailcow.numbers),
    requireSpecialChars: menyala(mailcow.special_chars),
    requireMixedCase: menyala(mailcow.lowerupper),
    requireLetters: menyala(mailcow.chars),
    source: "mailcow",
  };
}

/**
 * Daftar syarat yang BELUM terpenuhi, dalam bahasa yang bisa dibaca.
 *
 * Memulangkan semuanya sekaligus, bukan yang pertama saja: menyuruh orang
 * menebak satu per satu adalah cara membuat mereka menyerah dan memakai kata
 * sandi seadanya.
 */
export function passwordProblems(
  password: string,
  policy: PasswordPolicy,
  language: "id" | "en" = "id",
): string[] {
  const id = language === "id";
  const masalah: string[] = [];

  if (password.length < policy.minLength) {
    masalah.push(
      id
        ? `minimal ${policy.minLength} karakter`
        : `at least ${policy.minLength} characters`,
    );
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    masalah.push(
      id
        ? `maksimal ${PASSWORD_MAX_LENGTH} karakter`
        : `at most ${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  if (policy.requireLetters && !/[A-Za-z]/.test(password)) {
    masalah.push(id ? "mengandung huruf" : "contains a letter");
  }
  if (policy.requireNumbers && !/[0-9]/.test(password)) {
    masalah.push(id ? "mengandung angka" : "contains a number");
  }
  if (policy.requireMixedCase && !(/[a-z]/.test(password) && /[A-Z]/.test(password))) {
    masalah.push(
      id ? "mengandung huruf besar dan kecil" : "contains upper and lower case",
    );
  }
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(password)) {
    masalah.push(
      id ? "mengandung karakter spesial" : "contains a special character",
    );
  }
  return masalah;
}

/** Kalimat siap tampil: "Kata sandi harus minimal 12 karakter dan mengandung angka." */
export function describePasswordPolicy(
  policy: PasswordPolicy,
  language: "id" | "en" = "id",
): string {
  const id = language === "id";
  const syarat = [
    id ? `minimal ${policy.minLength} karakter` : `at least ${policy.minLength} characters`,
    policy.requireLetters ? (id ? "mengandung huruf" : "contains a letter") : "",
    policy.requireNumbers ? (id ? "mengandung angka" : "contains a number") : "",
    policy.requireMixedCase
      ? id
        ? "mengandung huruf besar dan kecil"
        : "contains upper and lower case"
      : "",
    policy.requireSpecialChars
      ? id
        ? "mengandung karakter spesial"
        : "contains a special character"
      : "",
  ].filter(Boolean);

  const penghubung = id ? " dan " : " and ";
  const daftar =
    syarat.length <= 1
      ? syarat.join("")
      : `${syarat.slice(0, -1).join(", ")}${penghubung}${syarat[syarat.length - 1]}`;
  return id ? `Kata sandi harus ${daftar}.` : `Password must be ${daftar}.`;
}
