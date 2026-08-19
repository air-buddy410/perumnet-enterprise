// Penjagaan verifikasi kredensial ke mailserver (integrasi mailcow).
//
// Aturannya sengaja identik dengan CRM dan monitoring-noc: kalau salah satu
// berubah di satu aplikasi tapi tidak di yang lain, dua aplikasi jadi punya
// definisi "boleh masuk" yang berbeda — dan itu jenis perbedaan yang tidak
// terlihat sampai terlambat.
//
// Semuanya fungsi murni: tidak menyentuh jaringan, tidak butuh mailserver,
// tidak menyalakan server Next.

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

const {
  authProviderMode,
  credentialRejection,
  imapHostFrom,
  isTaggedOk,
  mailserverHost,
  quoteImap,
  verifyMailserverPassword,
} = await import("../server/mail-auth.ts");

const envAsli = { ...process.env };
afterEach(() => {
  process.env = { ...envAsli };
});

describe("credentialRejection", () => {
  test("menolak baris baru — bisa menyisipkan perintah IMAP sendiri", () => {
    assert.notEqual(credentialRejection("rahasia\r\na2 LOGOUT"), null);
    assert.notEqual(credentialRejection("rahasia\npalsu"), null);
    assert.notEqual(credentialRejection("rahasia\0"), null);
  });

  test("menolak kosong dan yang kepanjangan", () => {
    assert.notEqual(credentialRejection(""), null);
    assert.notEqual(credentialRejection("x".repeat(513)), null);
  });

  test("meloloskan password wajar, termasuk yang bersimbol", () => {
    assert.equal(credentialRejection('P@ssw0rd "kutip" \\ backslash'), null);
  });
});

describe("quoteImap & isTaggedOk", () => {
  test("mendahului backslash dan tanda kutip", () => {
    assert.equal(quoteImap('a"b\\c'), '"a\\"b\\\\c"');
  });

  test("membaca OK / NO / BAD untuk tag yang cocok", () => {
    assert.equal(isTaggedOk("a1 OK LOGIN completed", "a1"), true);
    assert.equal(isTaggedOk("a1 NO LOGIN failed", "a1"), false);
    assert.equal(isTaggedOk("* OK menunggu", "a1"), null);
  });
});

describe("imapHostFrom", () => {
  test("mengambil nama host, dengan atau tanpa skema", () => {
    assert.equal(imapHostFrom("https://mail.perumnet.id"), "mail.perumnet.id");
    assert.equal(imapHostFrom("mail.perumnet.id"), "mail.perumnet.id");
    assert.equal(
      imapHostFrom("https://mail.perumnet.id/api/v1/"),
      "mail.perumnet.id",
    );
  });

  test("melempar bila kosong", () => {
    assert.throws(() => imapHostFrom(""));
  });
});

describe("authProviderMode", () => {
  test("bawaannya LOCAL", () => {
    delete process.env.AUTH_PROVIDER;
    assert.equal(authProviderMode(), "LOCAL");
  });

  test("MAILSERVER bila disetel, tidak peka huruf", () => {
    process.env.AUTH_PROVIDER = "mailserver";
    assert.equal(authProviderMode(), "MAILSERVER");
  });

  test("salah ketik jatuh ke LOCAL, bukan diam-diam mengubah cara masuk", () => {
    process.env.AUTH_PROVIDER = "MAILSERVR";
    assert.equal(authProviderMode(), "LOCAL");
  });
});

describe("mailserverHost", () => {
  test("null bila MAILSERVER_URL kosong atau tidak terbaca", () => {
    delete process.env.MAILSERVER_URL;
    assert.equal(mailserverHost(), null);
    process.env.MAILSERVER_URL = "   ";
    assert.equal(mailserverHost(), null);
  });
});

describe("verifyMailserverPassword", () => {
  test("konfigurasi belum ada → UNREACHABLE, BUKAN REJECTED", async () => {
    delete process.env.MAILSERVER_URL;
    const hasil = await verifyMailserverPassword("a@perumnet.id", "rahasia");
    // Bedanya penting: REJECTED berarti "passwordmu salah" dan membuat orang
    // mereset password email yang sebenarnya baik-baik saja.
    assert.deepEqual(hasil, {
      ok: false,
      reason: "UNREACHABLE",
      detail: "MAILSERVER_URL belum disetel.",
    });
  });

  test("meneruskan host hasil parsing ke probe", async () => {
    process.env.MAILSERVER_URL = "https://mail.perumnet.id/apapun";
    let dilihat = "";
    const hasil = await verifyMailserverPassword(
      "a@perumnet.id",
      "rahasia",
      async (host) => {
        dilihat = host;
        return { ok: true };
      },
    );
    assert.equal(dilihat, "mail.perumnet.id");
    assert.equal(hasil.ok, true);
  });

  test("probe melempar → UNREACHABLE, password tidak ikut ke pesan galat", async () => {
    process.env.MAILSERVER_URL = "https://mail.perumnet.id";
    const hasil = await verifyMailserverPassword(
      "a@perumnet.id",
      "password-super-rahasia",
      async () => {
        throw new Error("koneksi ditolak");
      },
    );
    assert.deepEqual(hasil, {
      ok: false,
      reason: "UNREACHABLE",
      detail: "koneksi ditolak",
    });
    assert.ok(!JSON.stringify(hasil).includes("password-super-rahasia"));
  });
});
