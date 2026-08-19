import tls from "node:tls";

// ── Verifikasi kredensial ke mailserver mailcow ─────────────────
//
// Dipindahkan dari PerumNet CRM (`crm/src/lib/mail-auth.ts`, Fase 53) lewat
// monitoring-noc, supaya semua aplikasi memakai satu pintu masuk yang sama: password EMAIL orang
// itu. Perilakunya sengaja dibuat identik — kalau salah satu aturan di bawah
// berubah di sini tapi tidak di CRM, dua aplikasi jadi punya definisi "boleh
// masuk" yang berbeda, dan itu jenis perbedaan yang tidak terlihat sampai
// terlambat.
//
// API mailcow TIDAK bisa dipakai untuk ini — ia API admin berkunci API key,
// untuk mengelola mailbox. Memverifikasi password pengguna bukan tugasnya.
// Jadi jalurnya IMAP: coba masuk sebagai orang tersebut. Kalau server
// menerima, passwordnya benar.
//
// Empat hal yang dijaga ketat di berkas ini, dan semuanya karena password
// yang lewat sini adalah password EMAIL — saluran reset untuk segalanya:
//
//   1. Password tidak pernah masuk log, pesan galat, maupun basis data.
//   2. Sambungan WAJIB TLS dengan sertifikat diperiksa. Tidak ada opsi
//      mematikannya, karena password polos melintas di sambungan ini.
//   3. CR/LF pada kredensial DITOLAK sebelum terkirim — tanpa itu, sebuah
//      "password" bisa menyisipkan perintah IMAP-nya sendiri.
//   4. Gagal menghubungi mailserver TIDAK PERNAH berarti lolos. Tidak ada
//      jalan mundur diam-diam ke hash lokal.

export class MailAuthError extends Error {}

/** Hasil pemeriksaan, dibedakan supaya pesannya ke pengguna tidak menyesatkan. */
export type MailAuthResult =
  /** Server menerima kredensialnya. */
  | { ok: true }
  /** Server menolak — password memang salah. */
  | { ok: false; reason: "REJECTED" }
  /** Servernya tidak terjawab. BUKAN berarti passwordnya salah. */
  | { ok: false; reason: "UNREACHABLE"; detail: string };

export const IMAP_PORT = 993;
export const IMAP_TIMEOUT_MS = 10_000;

/** Mode autentikasi yang benar-benar aktif, bukan yang dicita-citakan. */
export type AuthProviderMode = "LOCAL" | "MAILSERVER";

/**
 * Saklar sumber identitas, sengaja dibentuk sama seperti CRM.
 *
 * `LOCAL` = password diperiksa terhadap hash Better Auth (keadaan sebelum
 * integrasi). `MAILSERVER` = password diperiksa ke mailcow lewat IMAP.
 * Nilai lain diperlakukan sebagai LOCAL — salah ketik pada variabel
 * lingkungan tidak boleh diam-diam mengubah cara orang masuk.
 */
export function authProviderMode(): AuthProviderMode {
  const raw = (process.env.AUTH_PROVIDER ?? "LOCAL").trim().toUpperCase();
  return raw === "MAILSERVER" ? "MAILSERVER" : "LOCAL";
}

/**
 * Nama host IMAP dari `MAILSERVER_URL`.
 *
 * Satu variabel untuk satu mailserver — bentuknya sama dengan `baseUrl`
 * integrasi mailcow di CRM (`https://mail.contoh.id`), supaya tidak ada dua
 * alamat mailserver yang bisa berbeda diam-diam antar aplikasi.
 */
export function imapHostFrom(baseUrl: string): string {
  const trimmed = (baseUrl ?? "").trim();
  if (!trimmed) throw new MailAuthError("Alamat mailserver belum diisi.");
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
      .hostname;
  } catch {
    throw new MailAuthError(`Alamat mailserver tidak terbaca: ${trimmed}`);
  }
}

/** Host mailserver dari lingkungan, atau null bila belum disetel. */
export function mailserverHost(): string | null {
  const raw = process.env.MAILSERVER_URL?.trim();
  if (!raw) return null;
  try {
    return imapHostFrom(raw);
  } catch {
    return null;
  }
}

/**
 * Menolak kredensial yang bisa menyuntik perintah IMAP.
 *
 * Perintah IMAP dipisahkan CRLF. Sebuah "password" berisi baris baru dapat
 * mengakhiri perintah LOGIN lalu menuliskan perintahnya sendiri. Ditolak di
 * sini, sebelum satu byte pun terkirim — bukan disaring, karena password sah
 * memang tidak pernah memuat baris baru.
 */
export function credentialRejection(value: string): string | null {
  if (/[\r\n\0]/.test(value))
    return "Kredensial memuat karakter yang tidak diizinkan.";
  if (!value.length) return "Kredensial kosong.";
  if (value.length > 512) return "Kredensial terlalu panjang.";
  return null;
}

/** Mengutip untuk IMAP: hanya `\` dan `"` yang perlu didahului garis miring. */
export function quoteImap(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Apakah balasan server menandakan perintah berhasil? */
export function isTaggedOk(line: string, tag: string): boolean | null {
  const re = new RegExp(`^${tag} (OK|NO|BAD)\\b`, "im");
  const m = re.exec(line);
  if (!m) return null;
  return m[1].toUpperCase() === "OK";
}

/** Disuntik pada tes supaya seluruh aturan di atas teruji tanpa mailserver. */
export type ImapProbe = (
  host: string,
  email: string,
  password: string,
) => Promise<MailAuthResult>;

/**
 * Mencoba LOGIN ke IMAPS.
 *
 * Sengaja hanya LOGIN lalu LOGOUT — tidak membuka kotak surat, tidak membaca
 * apa pun. Yang dibutuhkan cuma jawaban server atas satu pertanyaan: benar
 * atau tidak.
 */
export async function probeImapLogin(
  host: string,
  email: string,
  password: string,
): Promise<MailAuthResult> {
  for (const v of [email, password]) {
    const bad = credentialRejection(v);
    // Pesannya sengaja tidak menyebut nilai apa pun.
    if (bad) return { ok: false, reason: "REJECTED" };
  }

  return new Promise<MailAuthResult>((resolve) => {
    let selesai = false;
    const beres = (r: MailAuthResult) => {
      if (selesai) return;
      selesai = true;
      try {
        socket.end();
      } catch {
        /* sambungan sudah tertutup */
      }
      resolve(r);
    };

    // rejectUnauthorized dibiarkan pada nilai bawaannya (true) DENGAN SENGAJA.
    // Password polos melintas di sambungan ini; sertifikat yang tidak
    // diperiksa berarti siapa pun di tengah jalan bisa memanennya.
    const socket = tls.connect({ host, port: IMAP_PORT, servername: host });
    socket.setEncoding("utf8");
    socket.setTimeout(IMAP_TIMEOUT_MS);

    let buffer = "";
    let dikirim = false;
    const TAG = "a1";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (!dikirim && /^\* OK/im.test(buffer)) {
        dikirim = true;
        buffer = "";
        socket.write(
          `${TAG} LOGIN ${quoteImap(email)} ${quoteImap(password)}\r\n`,
        );
        return;
      }
      if (dikirim) {
        const hasil = isTaggedOk(buffer, TAG);
        if (hasil === true) beres({ ok: true });
        else if (hasil === false) beres({ ok: false, reason: "REJECTED" });
      }
    });
    socket.on("timeout", () =>
      beres({
        ok: false,
        reason: "UNREACHABLE",
        detail: "Mailserver tidak menjawab tepat waktu.",
      }),
    );
    socket.on("error", (e) =>
      beres({
        ok: false,
        reason: "UNREACHABLE",
        detail: (e as Error).message,
      }),
    );
    socket.on("close", () =>
      beres({
        ok: false,
        reason: "UNREACHABLE",
        detail: "Sambungan ke mailserver terputus.",
      }),
    );
  });
}

/**
 * Memeriksa password email seseorang ke mailserver yang dikonfigurasi.
 *
 * Mengembalikan UNREACHABLE — bukan REJECTED — bila konfigurasinya belum ada.
 * Bedanya penting: yang satu berarti "passwordmu salah", yang satu berarti
 * "kami yang belum siap", dan menyamakannya membuat orang mereset password
 * email yang sebenarnya tidak bermasalah.
 */
export async function verifyMailserverPassword(
  email: string,
  password: string,
  probe: ImapProbe = probeImapLogin,
): Promise<MailAuthResult> {
  const host = mailserverHost();
  if (!host) {
    return {
      ok: false,
      reason: "UNREACHABLE",
      detail: "MAILSERVER_URL belum disetel.",
    };
  }
  if (!email) {
    return {
      ok: false,
      reason: "UNREACHABLE",
      detail: "Akun ini belum punya alamat email.",
    };
  }
  try {
    return await probe(host, email, password);
  } catch (e) {
    // Password TIDAK PERNAH ikut ke pesan galat.
    return { ok: false, reason: "UNREACHABLE", detail: (e as Error).message };
  }
}
