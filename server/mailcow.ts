// Klien mailcow seperlunya: mengganti kata sandi mailbox.
//
// Dipindahkan dari PerumNet CRM (`crm/src/lib/mailcow.ts`) dengan hanya
// membawa satu operasi yang dipakai aplikasi ini. Sengaja tidak membawa
// pengelolaan mailbox — itu tugas CRM, dan API key yang bisa membuat/menghapus
// mailbox tidak perlu ada di dua tempat.

const TIMEOUT_MS = 15_000;

export class MailcowError extends Error {}

export type Fetcher = typeof fetch;

/** Terima "https://mail.perumnet.id" maupun ".../api/v1" — orang menulis keduanya. */
function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

/**
 * Konfigurasi dari env. `MAILSERVER_URL` sengaja dipakai bersama dengan
 * verifikasi IMAP: dua alamat mailserver yang bisa berbeda diam-diam adalah
 * cara yang bagus untuk mengganti kata sandi di server yang salah.
 */
export function mailcowConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (process.env.MAILSERVER_URL ?? "").trim();
  const apiKey = (process.env.MAILCOW_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/** Mendeteksi bentuk `{type:"danger"}` yang dikirim mailcow dengan status 200. */
export function assertNoApiError(body: unknown, path: string): void {
  const entries = Array.isArray(body) ? body : [body];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "type" in entry) {
      const type = String((entry as { type: unknown }).type).toLowerCase();
      if (type === "error" || type === "danger") {
        const msg =
          "msg" in entry
            ? JSON.stringify((entry as { msg: unknown }).msg)
            : "tanpa keterangan";
        throw new MailcowError(`mailcow menolak ${path}: ${msg}`);
      }
    }
  }
}

async function call(
  cfg: { baseUrl: string; apiKey: string },
  path: string,
  init: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  const url = `${apiRoot(cfg.baseUrl)}${path}`;
  let res: Response;
  try {
    res = await fetcher(url, {
      ...init,
      headers: {
        "X-API-Key": cfg.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // URL-nya ikut karena ini pesan untuk operator, bukan untuk pengguna;
    // pemanggil yang memutuskan apa yang sampai ke layar.
    throw new MailcowError(`Tidak bisa menghubungi ${url}: ${msg}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new MailcowError(
      "API key ditolak mailcow (401/403). Periksa nilainya dan izin API-nya di mailcow.",
    );
  }
  if (res.status === 404) {
    throw new MailcowError(
      `Endpoint ${path} tidak ada di server ini (404) — kemungkinan versi mailcow berbeda.`,
    );
  }
  if (!res.ok) {
    throw new MailcowError(`mailcow menjawab HTTP ${res.status} untuk ${path}.`);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Halaman login HTML yang dikembalikan sebagai 200 adalah gejala khas API
    // yang belum diaktifkan — jangan biarkan lolos sebagai "berhasil".
    throw new MailcowError(
      `Jawaban ${path} bukan JSON. Pastikan API mailcow diaktifkan dan MAILSERVER_URL benar.`,
    );
  }

  // mailcow bisa menjawab HTTP 200 dengan isi berupa kesalahan. Ini jebakan
  // klasik: tanpa pemeriksaan ini, "gagal" terlihat seperti "berhasil".
  assertNoApiError(body, path);
  return body;
}

/**
 * Mengganti kata sandi satu mailbox.
 *
 * Pemanggilnya WAJIB sudah memastikan orang tersebut memang pemilik mailbox
 * ini; fungsi ini tidak punya cara mengetahuinya sendiri. Dengan API key
 * read-write, ia bisa mengganti kata sandi mailbox SIAPA PUN.
 */
export async function setMailboxPassword(
  cfg: { baseUrl: string; apiKey: string },
  email: string,
  password: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  await call(
    cfg,
    "/edit/mailbox",
    {
      method: "POST",
      body: JSON.stringify({
        items: [email],
        attr: { password, password2: password },
      }),
    },
    fetcher,
  );
}
