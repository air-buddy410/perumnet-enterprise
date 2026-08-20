// Status pengiriman email, dipakai SELURUH fitur yang mengirim surat keluar —
// outreach prospek maupun pengiriman dokumen — dan dipakai server maupun layar.
//
// Daftarnya pernah hidup dua kali (router dan layar) tanpa keduanya tahu.
// Akibatnya tidak berbunyi: penyaring status diam-diam mengabaikan nilai yang
// tidak dikenalnya, jadi filternya terlihat bekerja tapi tidak mempersempit apa
// pun. Sekali lagi berlipat, sekali lagi kesalahan yang sama.

export const emailDeliveryStatuses = [
  "Queued",
  "Sent",
  "Failed",
  "Skipped",
] as const;
export type EmailDeliveryRecordStatus = (typeof emailDeliveryStatuses)[number];

export const emailDeliveryStatusLabels: Record<
  EmailDeliveryRecordStatus,
  { id: string; en: string }
> = {
  // "Masih diproses", bukan "Menunggu": baris ini juga menampung kegagalan yang
  // masih punya sisa percobaan, dan menyebutnya menunggu membuat orang mengira
  // tidak ada yang pernah salah.
  Queued: { id: "Masih diproses", en: "In progress" },
  Sent: { id: "Terkirim", en: "Sent" },
  Failed: { id: "Gagal", en: "Failed" },
  Skipped: { id: "Tidak dikirim", en: "Not sent" },
};
