import "server-only";

import { hash } from "bcryptjs";
import type { DatabaseClient, DatabaseStatement } from "./client";

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Project Manager', 'Engineer', 'Finance')),
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  last_active_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Aktif', 'Selesai', 'Draft')),
  start_date TEXT,
  target_date TEXT,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  manager_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id);

CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'Belum Mulai' CHECK (status IN ('Selesai', 'Berjalan', 'Belum Mulai')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON project_tasks(project_id);

CREATE TABLE IF NOT EXISTS project_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_url TEXT,
  content_base64 TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploader_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx ON project_documents(project_id);

CREATE TABLE IF NOT EXISTS boqs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Draft',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boq_items (
  id TEXT PRIMARY KEY,
  boq_id TEXT NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('Perangkat', 'Material', 'Jasa', 'Mobilitas')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price INTEGER NOT NULL CHECK (selling_price >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boq_items_boq_idx ON boq_items(boq_id);

CREATE TABLE IF NOT EXISTS boq_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boq_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES boq_templates(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit TEXT NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0,
  selling_price INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS boq_template_items_template_idx ON boq_template_items(template_id);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Draft',
  issued_at TEXT NOT NULL,
  valid_until TEXT,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'Belum Lunas' CHECK (status IN ('Lunas', 'Belum Lunas')),
  paid_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_project_idx ON invoices(project_id);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  contact TEXT NOT NULL,
  email TEXT,
  address TEXT,
  rate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spks (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Dikirim', 'Dikerjakan', 'Selesai')),
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spks_project_idx ON spks(project_id);

CREATE TABLE IF NOT EXISTS basts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  completion_date TEXT NOT NULL,
  notes TEXT NOT NULL,
  installed_items_json TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_role TEXT NOT NULL,
  client_signature TEXT,
  engineer_name TEXT NOT NULL,
  engineer_signature TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Final')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS basts_project_idx ON basts(project_id);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Pemasukan', 'Pengeluaran')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL,
  reference_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_project_idx ON transactions(project_id);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
`;

const now = "2026-07-18T06:00:00.000Z";

function statement(sql: string, args: unknown[] = []): DatabaseStatement {
  return { sql, args };
}

export async function initializeDatabase(client: DatabaseClient) {
  await client.executeMultiple(schemaSql);

  const existing = await client.execute("SELECT id FROM users LIMIT 1");
  if (existing.rows.length) return;

  const production = process.env.NODE_ENV === "production";
  const bootstrapPassword = process.env.SEED_ADMIN_PASSWORD ?? (production ? "" : "perumnet123");
  if (!bootstrapPassword) {
    throw new Error(
      "Database masih kosong. Isi SEED_ADMIN_PASSWORD sekali untuk membuat akun administrator pertama.",
    );
  }
  if (production && bootstrapPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD production harus memiliki minimal 12 karakter.");
  }
  const passwordHash = await hash(bootstrapPassword, 12);

  const userRows = [
    ["user-1", "Dewa Mahardika", "admin@perumnet.id", "Admin", "Aktif"],
    ["user-2", "Ayu Pramesti", "ayu@perumnet.id", "Project Manager", production ? "Nonaktif" : "Aktif"],
    ["user-3", "Agus Suardana", "agus@perumnet.id", "Engineer", production ? "Nonaktif" : "Aktif"],
    ["user-4", "Kadek Putra", "kadek@perumnet.id", "Engineer", production ? "Nonaktif" : "Aktif"],
    ["user-5", "Luh Sri Wahyuni", "sri@perumnet.id", "Finance", production ? "Nonaktif" : "Aktif"],
    ["user-6", "Gede Arimbawa", "gede@perumnet.id", "Engineer", "Nonaktif"],
  ];

  const projectRows = [
    ["project-1", "PN-2607-014", "Implementasi WiFi Resort Ubud", "Bali Serenity Resort", "Ubud, Gianyar", "Aktif", "2026-07-08", "2026-08-02", 187450000, "user-1"],
    ["project-2", "PN-2607-012", "CCTV & Network Warehouse", "PT Karya Logistik Bali", "Ketewel, Gianyar", "Aktif", "2026-07-03", "2026-07-28", 96800000, "user-2"],
    ["project-3", "PN-2606-009", "Managed Service Kantor Cabang", "Koperasi Dharma Bali", "Denpasar", "Aktif", "2026-06-25", "2026-08-18", 62500000, "user-1"],
    ["project-4", "PN-2605-006", "Fiber Optic Villa Complex", "Taman Surya Hospitality", "Canggu, Badung", "Selesai", "2026-05-11", "2026-06-06", 143200000, "user-2"],
    ["project-5", "PN-2607-015", "Audit Infrastruktur Sekolah", "Yayasan Pelita Bangsa", "Klungkung", "Draft", "2026-07-22", "2026-07-30", 28750000, "user-1"],
  ];

  const tasks = [
    ["task-1", "Site survey & mapping area", "user-2", "Ayu Pramesti", "2026-07-08", "2026-07-10", "Selesai"],
    ["task-2", "Penarikan kabel backbone", "user-3", "Agus Suardana", "2026-07-10", "2026-07-16", "Selesai"],
    ["task-3", "Terminasi & labeling kabel", "user-4", "Kadek Putra", "2026-07-15", "2026-07-20", "Berjalan"],
    ["task-4", "Instalasi access point", "user-3", "Agus Suardana", "2026-07-18", "2026-07-24", "Berjalan"],
    ["task-5", "Konfigurasi controller & SSID", "user-2", "Ayu Pramesti", "2026-07-23", "2026-07-27", "Belum Mulai"],
    ["task-6", "Testing, dokumentasi & BAST", "user-1", "Dewa Mahardika", "2026-07-28", "2026-08-02", "Belum Mulai"],
  ];

  const boqRows = [
    ["boq-1", "Perangkat", "Access Point WiFi 6 Indoor", 12, "unit", 2450000, 3150000],
    ["boq-2", "Perangkat", "Managed PoE Switch 24 Port", 2, "unit", 7250000, 9250000],
    ["boq-3", "Material", "Kabel UTP Cat6 Outdoor", 8, "box", 1650000, 2100000],
    ["boq-4", "Jasa", "Instalasi, konfigurasi & testing", 1, "paket", 9500000, 15000000],
    ["boq-5", "Mobilitas", "Transportasi & akomodasi tim", 1, "paket", 3750000, 5000000],
  ];

  const vendorRows = [
    ["vendor-1", "CV Bali Network Solution", "Teknisi Jaringan", "0812 3800 2241", 850000, "Aktif"],
    ["vendor-2", "Surya Fiber Team", "Splicing Fiber Optic", "0878 6112 9390", 1250000, "Aktif"],
    ["vendor-3", "Ganesha CCTV Service", "Instalasi CCTV", "0852 3798 2044", 950000, "Aktif"],
    ["vendor-4", "UD Sinar Data", "Supplier Perangkat", "0361 902 881", 0, "Nonaktif"],
  ];

  const statements: DatabaseStatement[] = [];

  for (const [id, name, email, role, status] of userRows) {
    statements.push(statement(
      "INSERT INTO users (id,name,email,password_hash,role,status,last_active_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, name, email, passwordHash, role, status, now, now, now],
    ));
  }

  for (const [id, code, name, clientName, location, status, startDate, targetDate, value, managerId] of projectRows) {
    statements.push(statement(
      "INSERT INTO projects (id,code,name,client,location,status,start_date,target_date,value,manager_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, code, name, clientName, location, status, startDate, targetDate, value, managerId, "user-1", now, now],
    ));
  }

  const memberRows = [
    ["project-1", "user-1"], ["project-1", "user-2"], ["project-1", "user-3"], ["project-1", "user-4"],
    ["project-2", "user-2"], ["project-2", "user-3"], ["project-2", "user-6"],
    ["project-3", "user-1"], ["project-3", "user-4"],
    ["project-4", "user-2"], ["project-4", "user-3"], ["project-4", "user-6"],
    ["project-5", "user-1"],
  ];
  for (const [projectId, userId] of memberRows) {
    statements.push(statement(
      "INSERT INTO project_members (project_id,user_id,created_at) VALUES (?,?,?)",
      [projectId, userId, now],
    ));
  }

  tasks.forEach((row, index) => {
    statements.push(statement(
      "INSERT INTO project_tasks (id,project_id,name,owner_id,owner_name,start_date,end_date,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [row[0], "project-1", ...row.slice(1), index, now, now],
    ));
  });

  statements.push(
    statement("INSERT INTO boqs (id,project_id,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)", ["boq-main-1", "project-1", "Draft", "", now, now]),
  );
  boqRows.forEach((row, index) => {
    statements.push(statement(
      "INSERT INTO boq_items (id,boq_id,category,description,quantity,unit,cost_price,selling_price,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [row[0], "boq-main-1", ...row.slice(1), index, now, now],
    ));
  });

  const invoices = [
    ["inv-1", "INV/PN/VII/2026/031", "DP 50%", "2026-07-08", "2026-07-12", 93725000, "Lunas", "2026-07-10"],
    ["inv-2", "INV/PN/VII/2026/044", "Pelunasan 50%", "2026-07-18", "2026-08-02", 93725000, "Belum Lunas", null],
  ];
  for (const row of invoices) {
    statements.push(statement(
      "INSERT INTO invoices (id,project_id,number,type,issue_date,due_date,amount,status,paid_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [row[0], "project-1", ...row.slice(1), now, now],
    ));
  }

  for (const row of vendorRows) {
    statements.push(statement(
      "INSERT INTO vendors (id,name,category,contact,rate,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [...row, now, now],
    ));
  }

  const spkRows = [
    ["spk-1", "SPK/PN/VII/2026/018", "vendor-1", "project-1", "Penarikan dan terminasi kabel UTP lantai 1–3", 12500000, "Dikerjakan"],
    ["spk-2", "SPK/PN/VII/2026/021", "vendor-2", "project-2", "Splicing backbone fiber dan OTDR test", 7800000, "Dikirim"],
    ["spk-3", "SPK/PN/VI/2026/014", "vendor-3", "project-4", "Instalasi CCTV area entrance dan parkir", 9250000, "Selesai"],
  ];
  for (const row of spkRows) {
    statements.push(statement(
      "INSERT INTO spks (id,number,vendor_id,project_id,scope,cost,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [...row, now, now],
    ));
  }

  const transactionRows = [
    ["trx-1", "project-1", "2026-07-18", "Pengeluaran", "Pembelian access point tahap 2", 29400000, "Material"],
    ["trx-2", "project-2", "2026-07-15", "Pemasukan", "Pembayaran invoice DP 30%", 29040000, "Invoice"],
    ["trx-3", "project-1", "2026-07-10", "Pemasukan", "Pembayaran invoice DP 50%", 93725000, "Invoice"],
    ["trx-4", "project-1", "2026-07-09", "Pengeluaran", "Termin awal teknisi jaringan", 6250000, "SPK"],
    ["trx-5", "project-2", "2026-07-04", "Pengeluaran", "Pembelian kamera dan NVR", 41750000, "Material"],
  ];
  for (const row of transactionRows) {
    statements.push(statement(
      "INSERT INTO transactions (id,project_id,date,type,description,amount,source,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [...row, "user-1", now, now],
    ));
  }

  await client.batch(statements, "write");
}
