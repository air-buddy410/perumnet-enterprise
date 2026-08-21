import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../db/client";
import { claimSequence } from "../db/counters";

/**
 * Lapisan terbawah pembuatan proyek, dipakai oleh DUA pintu: `POST
 * /api/projects` dan konversi calon klien (`POST /api/cms/prospects/:id/convert`).
 *
 * Hanya penomoran dan INSERT yang ada di sini. Validasi masukan, pemeriksaan
 * manajer, audit, notifikasi, dan geocoding tetap milik masing-masing pemanggil
 * — yang dijaga di sini cuma satu: tidak ada dua INSERT `projects` yang bisa
 * menyimpang diam-diam (kolom baru di satu pintu, lupa di pintu lain).
 */

export interface ProjectRecordInput {
  name: string;
  client: string;
  clientEmail?: string | null;
  clientContactName?: string | null;
  location: string;
  status: "Aktif" | "Selesai" | "Draft";
  startDate?: string | null;
  targetDate?: string | null;
  value: number;
  managerId: string;
  createdBy: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinateSource?: "manual" | null;
  prospectId?: string | null;
}

/** `PN-YYMM-NNN`; urutannya atomik dan tidak dipakai ulang setelah hapus. */
export async function nextProjectCode(client: DatabaseClient) {
  const sequence = await claimSequence(
    client,
    "projects",
    "SELECT code AS value FROM projects",
  );
  const now = new Date();
  return `PN-${now.getUTCFullYear().toString().slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(sequence).padStart(3, "0")}`;
}

export async function insertProjectRecord(
  client: DatabaseClient,
  input: ProjectRecordInput,
) {
  const id = randomUUID();
  const code = await nextProjectCode(client);
  const timestamp = new Date().toISOString();
  await client.batch(
    [
      {
        sql: `INSERT INTO projects
          (id,code,name,client,client_email,client_contact_name,location,status,
           start_date,target_date,value,manager_id,created_by,latitude,longitude,
           coordinate_source,prospect_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          id,
          code,
          input.name,
          input.client,
          input.clientEmail || null,
          input.clientContactName || null,
          input.location,
          input.status,
          input.startDate ?? null,
          input.targetDate ?? null,
          input.value,
          input.managerId,
          input.createdBy,
          input.latitude ?? null,
          input.longitude ?? null,
          input.coordinateSource ?? null,
          input.prospectId ?? null,
          timestamp,
          timestamp,
        ],
      },
      // Manajer dan pembuat otomatis jadi anggota — tanpa ini keduanya tidak
      // bisa membuka proyek yang baru saja mereka buat.
      {
        sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
        args: [id, input.managerId, timestamp],
      },
      {
        sql: "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT (project_id,user_id) DO NOTHING",
        args: [id, input.createdBy, timestamp],
      },
    ],
    "write",
  );
  return { id, code, createdAt: timestamp };
}
