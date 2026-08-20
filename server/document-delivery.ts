import "server-only";

import { randomUUID } from "node:crypto";
import { writeAuditLog } from "./audit";
import type { AuthUser } from "./auth";
import {
  assertAttachmentBudget,
  type PreparedAttachment,
} from "./attachments";
import type { DatabaseClient } from "./db/client";
import { renderDokumenLampiran, susunUntukDokumen } from "./document-letter";
import { sendEmailDelivery } from "./email";
import { alamatBalasan, type Penandatangan } from "./letter";
import { storeUploadedFile } from "./storage";
import type { DocumentEmailKind } from "../shared/document-email";

/**
 * Mengirim satu dokumen resmi lewat email, dan mencatatnya.
 *
 * Dipakai SPK/PO hari ini; quotation dan invoice memakai fungsi yang sama nanti.
 * Yang berbeda per jenis dokumen hanya penerima dan placeholder-nya — keduanya
 * disiapkan pemanggil.
 */

export interface KirimDokumenInput {
  kind: DocumentEmailKind;
  documentId: string;
  documentNumber: string;
  projectId: string | null;
  audience: "vendor" | "client";
  vendorId: string | null;
  recipient: string;
  recipientName: string;
  templateId: string | null;
  templateName: string;
  language: "id" | "en";
  subject: string;
  body: string;
  format: "text" | "rich" | "html";
  penandatangan: Penandatangan;
  /** Nilai placeholder, seluruhnya dari baris dokumen. */
  nilai: Record<string, string>;
  /** Lampiran tambahan yang diunggah, sudah lewat pemeriksaan isi berkasnya. */
  tambahan: PreparedAttachment[];
}

/**
 * Menyiapkan surat + lampirannya TANPA mengirim apa pun.
 *
 * Dipakai pratinjau. Fungsi yang sama juga dipakai pengiriman, jadi yang
 * dilihat orang di layar adalah yang benar-benar diterima penerimanya — bukan
 * perkiraan yang kebetulan mirip.
 */
export async function susunKiriman(
  client: DatabaseClient,
  input: Omit<KirimDokumenInput, "tambahan"> & { tambahan?: PreparedAttachment[] },
) {
  const dokumen = await renderDokumenLampiran(
    input.kind,
    input.documentId,
    input.language,
  );
  const lampiran = [dokumen, ...(input.tambahan ?? [])];
  assertAttachmentBudget(lampiran);
  const surat = await susunUntukDokumen(client, input.nilai, {
    subject: input.subject,
    body: input.body,
    format: input.format,
    language: input.language,
    penandatangan: input.penandatangan,
  });
  return { surat, lampiran };
}

export async function kirimDokumen(
  client: DatabaseClient,
  request: Request,
  user: AuthUser,
  input: KirimDokumenInput,
) {
  const { surat, lampiran } = await susunKiriman(client, input);
  const timestamp = new Date().toISOString();
  const deliveryId = randomUUID();

  // Arsip menyimpan byte-nya SEKALI dan memilikinya selamanya. Baris outbox
  // menunjuk ke berkas yang sama dan menandai dirinya bukan pemilik, jadi
  // pembersihan outbox setelah 180 hari membuang penunjuknya saja.
  //
  // Satu pemilik, bukan penghitung rujukan: penghitung rujukan adalah tempat
  // "penunjuk terakhir hilang dan membawa serta arsip pengiriman lain" tinggal.
  const arsip: {
    id: string;
    lampiran: PreparedAttachment;
    storageUrl: string | null;
    contentBase64: string | null;
  }[] = [];
  for (const l of lampiran) {
    const id = `kiriman-${randomUUID()}`;
    const { storageUrl, contentBase64 } = await storeUploadedFile(
      "email-attachments",
      id,
      l.mimeType,
      l.content,
    );
    arsip.push({ id, lampiran: l, storageUrl, contentBase64 });
  }

  const kirim = await sendEmailDelivery(client, {
    recipient: input.recipient,
    eventType: `document_${input.kind}`,
    subject: surat.subject,
    html: surat.html,
    // Vendor dan klien bukan pengguna aplikasi ini, jadi preferensi notifikasi
    // per-pengguna tidak berlaku untuk mereka.
    respectPreference: false,
    replyTo: alamatBalasan(input.penandatangan),
    attachments: arsip.map((a) => ({
      ...a.lampiran,
      tersimpanDiArsip: {
        storageUrl: a.storageUrl,
        contentBase64: a.contentBase64,
      },
    })),
  });

  const status = kirim.status === "pending" ? "Queued" : "Skipped";
  await client.execute({
    sql: `INSERT INTO document_deliveries
      (id,document_kind,document_id,document_number,project_id,audience,vendor_id,
       recipient,recipient_name,template_id,template_name,language,subject,
       body_html,status,scheduled_for,failure_reason,outbox_id,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      deliveryId,
      input.kind,
      input.documentId,
      input.documentNumber,
      input.projectId,
      input.audience,
      input.vendorId,
      input.recipient,
      input.recipientName,
      input.templateId,
      input.templateName,
      input.language,
      surat.subject,
      surat.html,
      status,
      timestamp,
      kirim.error ?? null,
      kirim.id,
      user.id,
      timestamp,
    ],
  });

  for (const [urutan, a] of arsip.entries()) {
    await client.execute({
      sql: `INSERT INTO document_delivery_attachments
        (id,delivery_id,kind,filename,mime_type,byte_size,sha256,storage_url,
         content_base64,sort_order,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        a.id,
        deliveryId,
        a.lampiran.generated ? "document" : "extra",
        a.lampiran.filename,
        a.lampiran.mimeType,
        a.lampiran.byteSize,
        a.lampiran.sha256,
        a.storageUrl,
        a.contentBase64,
        urutan,
        timestamp,
      ],
    });
  }

  await writeAuditLog(
    client,
    request,
    user,
    "send_email",
    `document_${input.kind}`,
    input.documentId,
    {
      penerima: input.recipient,
      lampiran: lampiran.length,
      deliveryId,
    },
  );

  return {
    deliveryId,
    recipient: input.recipient,
    recipientName: input.recipientName,
    status,
    scheduledFor: timestamp,
    attachments: lampiran.map((l) => ({
      filename: l.filename,
      byteSize: l.byteSize,
      generated: l.generated,
    })),
  };
}
