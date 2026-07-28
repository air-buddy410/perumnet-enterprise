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

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  job_title TEXT,
  bio TEXT,
  address TEXT,
  birth_date TEXT,
  avatar_mime_type TEXT,
  avatar_storage_url TEXT,
  avatar_content_base64 TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'id' CHECK (preferred_language IN ('id', 'en')),
  email_notifications INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_deliveries_user_idx ON email_deliveries(user_id,created_at);
CREATE INDEX IF NOT EXISTS email_deliveries_status_idx ON email_deliveries(status,created_at);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS standalone_boqs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS standalone_boqs_created_by_idx
  ON standalone_boqs(created_by,created_at);

CREATE TABLE IF NOT EXISTS standalone_boq_items (
  id TEXT PRIMARY KEY,
  standalone_boq_id TEXT NOT NULL REFERENCES standalone_boqs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS standalone_boq_items_boq_idx
  ON standalone_boq_items(standalone_boq_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS quotations_project_unique ON quotations(project_id);

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
  payment_status TEXT NOT NULL DEFAULT 'Belum Dibayar' CHECK (payment_status IN ('Belum Dibayar', 'Dibayar')),
  paid_date TEXT,
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
  engineer_role TEXT NOT NULL DEFAULT 'Project Manager',
  engineer_signature TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Final')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS basts_project_idx ON basts(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS basts_project_unique ON basts(project_id);

CREATE TABLE IF NOT EXISTS project_validations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed')),
  notes TEXT,
  validated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS project_validations_project_unique ON project_validations(project_id);

CREATE TABLE IF NOT EXISTS project_validation_items (
  id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL REFERENCES project_validations(id) ON DELETE CASCADE,
  boq_item_id TEXT REFERENCES boq_items(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('Perangkat', 'Material')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_validation_items_validation_idx ON project_validation_items(validation_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_validation_items_boq_unique ON project_validation_items(validation_id,boq_item_id);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  external_account_id TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  opening_balance INTEGER NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  current_balance INTEGER NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  sync_mode TEXT NOT NULL DEFAULT 'Manual' CHECK (sync_mode IN ('Manual', 'API')),
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  last_synced_at TEXT,
  balance_updated_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bank_accounts_status_idx ON bank_accounts(status,bank_name);

CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  statement_month TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bank_statement_imports_account_idx
  ON bank_statement_imports(bank_account_id,created_at);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Pemasukan', 'Pengeluaran')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL,
  reference_id TEXT,
  category TEXT NOT NULL DEFAULT 'Lainnya',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_project_idx ON transactions(project_id);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_source_reference_unique
  ON transactions(source, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_profit_shares (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  percentage_bps INTEGER NOT NULL CHECK (percentage_bps > 0 AND percentage_bps <= 10000),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Approved', 'Paid', 'Void')),
  notes TEXT,
  paid_date TEXT,
  transaction_id TEXT UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_profit_shares_project_idx
  ON project_profit_shares(project_id,status);

CREATE TABLE IF NOT EXISTS bank_statement_entries (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  import_id TEXT REFERENCES bank_statement_imports(id) ON DELETE SET NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Pemasukan', 'Pengeluaran')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  running_balance INTEGER,
  reference TEXT,
  fingerprint TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'Imported'
    CHECK (reconciliation_status IN ('Matched', 'Imported', 'Excluded')),
  source TEXT NOT NULL CHECK (source IN ('Manual Upload', 'API')),
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_entries_fingerprint_unique
  ON bank_statement_entries(bank_account_id,fingerprint);
CREATE INDEX IF NOT EXISTS bank_statement_entries_account_date_idx
  ON bank_statement_entries(bank_account_id,date);
CREATE INDEX IF NOT EXISTS bank_statement_entries_transaction_idx
  ON bank_statement_entries(transaction_id);

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

CREATE TABLE IF NOT EXISTS cms_site_texts (
  id TEXT PRIMARY KEY,
  page_key TEXT NOT NULL,
  content_key TEXT NOT NULL,
  value_content TEXT NOT NULL,
  value_content_en TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_site_texts_key_unique
  ON cms_site_texts(page_key, content_key);

CREATE TABLE IF NOT EXISTS cms_services (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL,
  summary_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  description_en TEXT NOT NULL DEFAULT '',
  features_json TEXT NOT NULL DEFAULT '[]',
  features_json_en TEXT NOT NULL DEFAULT '[]',
  icon TEXT NOT NULL DEFAULT 'wifi',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_portfolios (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  description_en TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  image_storage_url TEXT,
  image_mime_type TEXT,
  location TEXT,
  location_en TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_testimonials (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  company_name TEXT,
  review TEXT NOT NULL,
  review_en TEXT NOT NULL DEFAULT '',
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  excerpt_en TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  content_en TEXT NOT NULL DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  show_in_navigation INTEGER NOT NULL DEFAULT 1 CHECK (show_in_navigation IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_site_settings (
  id TEXT PRIMARY KEY,
  key_name TEXT NOT NULL UNIQUE,
  value_content TEXT NOT NULL,
  value_content_en TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_faqs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  question_en TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL,
  answer_en TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_type TEXT NOT NULL DEFAULT 'partner'
    CHECK (organization_type IN ('partner', 'client')),
  category TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  logo_storage_url TEXT,
  logo_mime_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const now = "2026-07-18T06:00:00.000Z";

function statement(sql: string, args: unknown[] = []): DatabaseStatement {
  return { sql, args };
}

async function ensureCmsSeed(client: DatabaseClient) {
  const existing = await client.execute("SELECT id FROM cms_site_settings LIMIT 1");
  if (existing.rows.length) return;

  const timestamp = new Date().toISOString();
  const statements: DatabaseStatement[] = [];
  const settings = [
    ["company_name", "PerumNet Enterprise"],
    ["company_tagline", "Konsultan IT untuk operasional yang lebih andal"],
    ["whatsapp_number", "085155026889"],
    ["email", "it@perumnet.id"],
    ["phone", "0851 5502 6889"],
    ["address", "BTN Kecicang Indah Blok A5, Bungaya Kangin, Karangasem, Bali 80813"],
    ["instagram_url", "https://www.instagram.com/perum_net"],
    ["linkedin_url", ""],
    ["website_url", "https://www.perumnet.id/"],
    ["dark_font_color", "#FFFFFF"],
    ["cta_text", "Konsultasikan Kebutuhan Anda"],
    ["business_hours", "Senin–Minggu · 24/7 support"],
  ];
  for (const [key, value] of settings) {
    statements.push(statement(
      "INSERT INTO cms_site_settings (id,key_name,value_content,updated_at) VALUES (?,?,?,?)",
      [`cms-setting-${key}`, key, value, timestamp],
    ));
  }

  const texts = [
    ["home", "hero_eyebrow", "SOLUSI IT TERINTEGRASI · BALI"],
    ["home", "hero_title", "Infrastruktur IT yang bekerja tanpa hambatan."],
    ["home", "hero_description", "PerumNet Enterprise merancang, memasang, dan merawat jaringan WiFi, CCTV, Smart Home Device, serta IP PABX agar bisnis Anda selalu terhubung, aman, dan siap bertumbuh."],
    ["home", "about_eyebrow", "PARTNER TEKNOLOGI ANDA"],
    ["home", "about_title", "Satu tim untuk seluruh kebutuhan infrastruktur."],
    ["home", "about_description", "Kami menggabungkan konsultasi, instalasi, dokumentasi, dan dukungan berkelanjutan dalam satu layanan yang mudah dipantau."],
    ["home", "services_title", "Solusi yang dibangun untuk kebutuhan nyata."],
    ["home", "services_description", "Dari koneksi tamu hingga keamanan area dan komunikasi internal, setiap sistem dirancang untuk stabil sejak hari pertama."],
    ["home", "portfolio_title", "Pekerjaan rapi. Hasil yang terukur."],
    ["home", "testimonials_title", "Dipercaya untuk menjaga operasional tetap berjalan."],
    ["home", "closing_title", "Mulai dari survei lokasi, kami bantu sampai sistem siap digunakan."],
    ["services", "page_title", "Infrastruktur yang siap mengikuti ritme bisnis Anda."],
    ["services", "page_description", "Layanan konsultasi, instalasi, integrasi, dan pemeliharaan untuk jaringan WiFi, CCTV, Smart Home Device, dan IP PABX."],
    ["portfolio", "page_title", "Pilihan proyek yang kami selesaikan bersama klien."],
    ["portfolio", "page_description", "Setiap proyek dimulai dari kebutuhan lapangan dan ditutup dengan dokumentasi yang jelas."],
    ["testimonials", "page_title", "Cerita dari bisnis yang bertumbuh bersama sistem yang lebih baik."],
    ["testimonials", "page_description", "Ulasan klien tentang proses kerja, respons tim, dan hasil implementasi PerumNet Enterprise."],
    ["contact", "page_title", "Mari bicarakan kebutuhan IT Anda."],
    ["contact", "page_description", "Ceritakan lokasi, tantangan, dan target Anda. Tim kami akan membantu menentukan langkah pertama yang paling tepat."],
  ];
  texts.forEach(([pageKey, contentKey, value], index) => {
    statements.push(statement(
      "INSERT INTO cms_site_texts (id,page_key,content_key,value_content,updated_at) VALUES (?,?,?,?,?)",
      [`cms-text-${index + 1}`, pageKey, contentKey, value, timestamp],
    ));
  });

  const services = [
    ["cms-service-wifi", "managed-wifi", "Managed WiFi", "WiFi stabil, aman, dan mudah dikelola untuk kantor, hotel, sekolah, dan area publik.", "Kami merancang cakupan, kapasitas, segmentasi jaringan, dan monitoring agar setiap pengguna mendapat pengalaman koneksi yang konsisten.", "[\"Site survey & heatmap\",\"Managed access point\",\"Guest WiFi & captive portal\",\"Monitoring dan dukungan\"]", "wifi", 1],
    ["cms-service-cctv", "cctv", "CCTV & Surveillance", "Sistem pengawasan yang memberi visibilitas jelas dari lokasi maupun jarak jauh.", "Mulai dari penempatan kamera hingga retensi rekaman dan akses mobile, sistem CCTV disusun sesuai risiko dan alur aktivitas lokasi.", "[\"IP camera & NVR\",\"Remote monitoring\",\"Smart detection\",\"Preventive maintenance\"]", "camera", 2],
    ["cms-service-pabx", "ip-pabx", "IP PABX", "Komunikasi internal yang profesional, fleksibel, dan siap berkembang bersama tim.", "Kami mengintegrasikan extension, IVR, call routing, dan perangkat IP phone agar komunikasi pelanggan dan tim berjalan lebih efisien.", "[\"Extension planning\",\"IVR & call routing\",\"IP phone provisioning\",\"Call recording option\"]", "phone", 3],
    ["cms-service-smart-home", "smart-home-device", "Smart Home Device", "Kontrol perangkat, keamanan, dan otomasi ruang yang praktis dari satu sistem.", "Kami mengintegrasikan perangkat smart home sesuai kebutuhan rumah, villa, maupun area komersial agar pencahayaan, akses, sensor, dan perangkat terpilih dapat dipantau serta dikendalikan dengan mudah.", "[\"Smart lighting & switch\",\"Sensor pintu dan gerak\",\"Kontrol perangkat terpusat\",\"Konfigurasi dan dukungan\"]", "home", 4],
  ];
  for (const row of services) {
    statements.push(statement(
      "INSERT INTO cms_services (id,slug,title,summary,description,features_json,icon,sort_order,is_published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)",
      [...row, timestamp, timestamp],
    ));
  }

  const portfolios = [
    ["cms-portfolio-wifi", "Managed WiFi Hospitality", "Penataan ulang jaringan dan access point untuk koneksi tamu yang konsisten di seluruh area properti.", "/portfolio/network-rack.jpg", "Ubud, Gianyar", "2026-05-28", 1],
    ["cms-portfolio-cctv", "CCTV Area Komersial", "Implementasi kamera IP, NVR, dan akses monitoring untuk area operasional dan parkir.", "/portfolio/cctv.jpg", "Denpasar, Bali", "2026-04-16", 2],
    ["cms-portfolio-pabx", "IP PABX Kantor Cabang", "Sistem extension dan call routing yang menyatukan komunikasi antar divisi dan kantor cabang.", "/portfolio/ip-phone.jpg", "Karangasem, Bali", "2026-03-11", 3],
  ];
  for (const row of portfolios) {
    statements.push(statement(
      "INSERT INTO cms_portfolios (id,title,description,image_url,location,completed_at,sort_order,is_published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
      [...row, timestamp, timestamp],
    ));
  }

  const testimonials = [
    ["cms-testimonial-1", "Made Wirawan", "Bali Serenity Hospitality", "Tim PerumNet memahami kebutuhan operasional kami, bekerja rapi, dan responsif bahkan setelah instalasi selesai.", 1],
    ["cms-testimonial-2", "Ayu Lestari", "Koperasi Dharma Bali", "Monitoring jaringan kini jauh lebih mudah. Dokumentasi lengkap dan tim kami mendapat penjelasan yang mudah dipahami.", 2],
    ["cms-testimonial-3", "Gede Pranata", "Aruna Workspace", "Proses survei sampai serah terima jelas. Sistem CCTV dan WiFi berjalan stabil sesuai kebutuhan area kami.", 3],
  ];
  for (const row of testimonials) {
    statements.push(statement(
      "INSERT INTO cms_testimonials (id,client_name,company_name,review,is_visible,sort_order,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)",
      [...row, timestamp, timestamp],
    ));
  }

  const pages = [
    ["cms-page-about", "Tentang Kami", "tentang-kami", "Mengenal PerumNet Enterprise dan cara kami bekerja.", "PerumNet Enterprise adalah konsultan IT berbasis di Bali yang membantu bisnis merancang, memasang, dan menjaga infrastruktur teknologi agar selalu siap digunakan.\n\nKami percaya pekerjaan teknis yang baik harus terasa sederhana bagi pengguna: kebutuhan dipetakan dengan jelas, instalasi terdokumentasi, dan dukungan mudah dihubungi saat diperlukan.", 1, 5],
    ["cms-page-careers", "Karier", "karier", "Bergabung dengan tim teknis PerumNet Enterprise.", "Kami selalu terbuka untuk bertemu talenta yang menyukai pekerjaan lapangan, teknologi jaringan, dan pelayanan yang rapi.", 0, 6],
  ];
  for (const row of pages) {
    statements.push(statement(
      "INSERT INTO cms_pages (id,title,slug,excerpt,content,is_published,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [...row, timestamp, timestamp],
    ));
  }

  await client.batch(statements, "write");
}

async function ensureCmsEnhancements(client: DatabaseClient) {
  const timestamp = new Date().toISOString();
  await client.batch([
    statement(
      "INSERT INTO cms_site_settings (id,key_name,value_content,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
      ["cms-setting-website_url", "website_url", "https://www.perumnet.id/", timestamp],
    ),
    statement(
      "INSERT INTO cms_site_settings (id,key_name,value_content,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
      ["cms-setting-dark_font_color", "dark_font_color", "#FFFFFF", timestamp],
    ),
    statement(
      "INSERT INTO cms_services (id,slug,title,summary,description,features_json,icon,sort_order,is_published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING",
      [
        "cms-service-smart-home",
        "smart-home-device",
        "Smart Home Device",
        "Kontrol perangkat, keamanan, dan otomasi ruang yang praktis dari satu sistem.",
        "Kami mengintegrasikan perangkat smart home sesuai kebutuhan rumah, villa, maupun area komersial agar pencahayaan, akses, sensor, dan perangkat terpilih dapat dipantau serta dikendalikan dengan mudah.",
        "[\"Smart lighting & switch\",\"Sensor pintu dan gerak\",\"Kontrol perangkat terpusat\",\"Konfigurasi dan dukungan\"]",
        "home",
        4,
        timestamp,
        timestamp,
      ],
    ),
    statement(
      "UPDATE cms_site_texts SET value_content=?,updated_at=? WHERE page_key=? AND content_key=? AND value_content=?",
      [
        "PerumNet Enterprise merancang, memasang, dan merawat jaringan WiFi, CCTV, Smart Home Device, serta IP PABX agar bisnis Anda selalu terhubung, aman, dan siap bertumbuh.",
        timestamp,
        "home",
        "hero_description",
        "PerumNet Enterprise merancang, memasang, dan merawat jaringan WiFi, CCTV, serta IP PABX agar bisnis Anda selalu terhubung, aman, dan siap bertumbuh.",
      ],
    ),
    statement(
      "UPDATE cms_site_texts SET value_content=?,updated_at=? WHERE page_key=? AND content_key=? AND value_content=?",
      [
        "Layanan konsultasi, instalasi, integrasi, dan pemeliharaan untuk jaringan WiFi, CCTV, Smart Home Device, dan IP PABX.",
        timestamp,
        "services",
        "page_description",
        "Layanan konsultasi, instalasi, integrasi, dan pemeliharaan untuk jaringan WiFi, CCTV, dan IP PABX.",
      ],
    ),
  ], "write");
}

async function ensureColumn(
  client: DatabaseClient,
  table: string,
  column: string,
  definition: string,
) {
  try {
    await client.execute(`SELECT ${column} FROM ${table} LIMIT 1`);
  } catch {
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      await client.execute(`SELECT ${column} FROM ${table} LIMIT 1`);
    }
  }
}

async function ensureCmsBilingualSchema(client: DatabaseClient) {
  const columns: Array<[string, string, string]> = [
    ["cms_site_texts", "value_content_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_site_settings", "value_content_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_services", "title_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_services", "summary_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_services", "description_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_services", "features_json_en", "TEXT NOT NULL DEFAULT '[]'"],
    ["cms_portfolios", "title_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_portfolios", "description_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_portfolios", "location_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_testimonials", "review_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_pages", "title_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_pages", "excerpt_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_pages", "content_en", "TEXT NOT NULL DEFAULT ''"],
    ["cms_pages", "show_in_navigation", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [table, column, definition] of columns) {
    await ensureColumn(client, table, column, definition);
  }
}

async function ensureCmsLandingFeatures(client: DatabaseClient) {
  const timestamp = new Date().toISOString();
  const statements: DatabaseStatement[] = [
    statement(
      `INSERT INTO cms_services
        (id,slug,title,title_en,summary,summary_en,description,description_en,features_json,features_json_en,icon,sort_order,is_published,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING`,
      [
        "cms-service-labs",
        "perumnet-labs",
        "PerumNet Labs",
        "PerumNet Labs",
        "Software bisnis, web, dan sistem internal yang dibangun mengikuti alur kerja perusahaan Anda.",
        "Business software, websites, and internal systems built around the way your company works.",
        "PerumNet Labs adalah lini software house kami untuk merancang aplikasi web, dashboard operasional, otomasi proses, integrasi API, dan produk digital yang aman serta mudah dikembangkan.",
        "PerumNet Labs is our software house for secure, scalable web applications, operational dashboards, process automation, API integrations, and digital products.",
        JSON.stringify(["Web app & dashboard", "Business process automation", "API & system integration", "Maintenance & continuous improvement"]),
        JSON.stringify(["Web apps & dashboards", "Business process automation", "API & system integrations", "Maintenance & continuous improvement"]),
        "terminal",
        5,
        timestamp,
        timestamp,
      ],
    ),
  ];

  const englishTexts: Array<[string, string]> = [
    ["home.hero_eyebrow", "INTEGRATED IT SOLUTIONS · BALI"],
    ["home.hero_title", "IT infrastructure that works without interruption."],
    ["home.hero_description", "PerumNet Enterprise designs, installs, and maintains WiFi, CCTV, Smart Home, IP PABX, and business software so your operations stay connected, secure, and ready to grow."],
    ["home.about_eyebrow", "YOUR TECHNOLOGY PARTNER"],
    ["home.about_title", "One team for every infrastructure need."],
    ["home.about_description", "We combine consulting, installation, documentation, and ongoing support in one transparent service."],
    ["home.services_title", "Solutions built for real operational needs."],
    ["home.services_description", "From guest connectivity to site security, communications, and software, every system is designed to stay reliable from day one."],
    ["home.portfolio_title", "Structured delivery. Measurable outcomes."],
    ["home.testimonials_title", "Trusted to keep operations running."],
    ["home.closing_title", "From the first site survey to a system ready for daily use."],
    ["services.page_title", "Infrastructure ready to keep pace with your business."],
    ["services.page_description", "Consulting, installation, integration, and maintenance for WiFi, CCTV, Smart Home, IP PABX, and business software."],
    ["portfolio.page_title", "Selected projects delivered together with our clients."],
    ["portfolio.page_description", "Every project starts from real field requirements and closes with clear documentation."],
    ["testimonials.page_title", "Stories from businesses growing with better systems."],
    ["testimonials.page_description", "Client perspectives on our process, responsiveness, and implementation outcomes."],
    ["contact.page_title", "Let us discuss your IT requirements."],
    ["contact.page_description", "Tell us about your location, challenges, and target. Our team will recommend a practical first step."],
  ];
  for (const [key, value] of englishTexts) {
    const [pageKey, contentKey] = key.split(".");
    statements.push(statement(
      "UPDATE cms_site_texts SET value_content_en=?,updated_at=? WHERE page_key=? AND content_key=? AND value_content_en=''",
      [value, timestamp, pageKey, contentKey],
    ));
  }

  const serviceTranslations: Array<[string, string, string, string, string[]]> = [
    ["managed-wifi", "Managed WiFi", "Reliable, secure, and manageable WiFi for offices, hotels, schools, and public venues.", "We design coverage, capacity, network segmentation, and monitoring so every user receives a consistent connection.", ["Site survey & heatmap", "Managed access points", "Guest WiFi & captive portal", "Monitoring and support"]],
    ["cctv", "CCTV & Surveillance", "A surveillance system that provides clear visibility on-site and remotely.", "From camera placement to recording retention and mobile access, each system is arranged around your site risk and activities.", ["IP cameras & NVR", "Remote monitoring", "Smart detection", "Preventive maintenance"]],
    ["ip-pabx", "IP PABX", "Professional internal communication that can grow with your team.", "We integrate extensions, IVR, call routing, and IP phones to streamline customer and internal communications.", ["Extension planning", "IVR & call routing", "IP phone provisioning", "Call recording option"]],
    ["smart-home-device", "Smart Home Devices", "Practical control of devices, security, and room automation from one system.", "We integrate smart-home devices for homes, villas, and commercial spaces so lighting, access, sensors, and selected devices remain easy to monitor and control.", ["Smart lighting & switches", "Door and motion sensors", "Centralized device control", "Configuration and support"]],
  ];
  for (const [slug, title, summary, description, features] of serviceTranslations) {
    statements.push(statement(
      "UPDATE cms_services SET title_en=?,summary_en=?,description_en=?,features_json_en=?,updated_at=? WHERE slug=? AND title_en=''",
      [title, summary, description, JSON.stringify(features), timestamp, slug],
    ));
  }

  const portfolioTranslations: Array<[string, string, string, string]> = [
    ["cms-portfolio-wifi", "Managed WiFi for Hospitality", "Network and access-point redesign for consistent guest connectivity throughout the property.", "Ubud, Gianyar"],
    ["cms-portfolio-cctv", "CCTV for a Commercial Site", "IP cameras, NVR, and monitoring access for operational and parking areas.", "Denpasar, Bali"],
    ["cms-portfolio-pabx", "IP PABX for a Branch Office", "Extensions and call routing that connect communications across departments and branch offices.", "Karangasem, Bali"],
  ];
  for (const [id, titleEn, descriptionEn, locationEn] of portfolioTranslations) {
    statements.push(statement(
      "UPDATE cms_portfolios SET title_en=?,description_en=?,location_en=?,updated_at=? WHERE id=? AND title_en=''",
      [titleEn, descriptionEn, locationEn, timestamp, id],
    ));
  }

  const testimonialTranslations: Array<[string, string]> = [
    ["cms-testimonial-1", "The PerumNet team understood our operational requirements, delivered a well-organized installation, and remained responsive after handover."],
    ["cms-testimonial-2", "Network monitoring is much easier now. The documentation is complete and our team received clear, practical guidance."],
    ["cms-testimonial-3", "The process from survey to handover was clear. Our CCTV and WiFi systems remain stable and match the needs of the site."],
  ];
  for (const [id, reviewEn] of testimonialTranslations) {
    statements.push(statement(
      "UPDATE cms_testimonials SET review_en=?,updated_at=? WHERE id=? AND review_en=''",
      [reviewEn, timestamp, id],
    ));
  }

  const dynamicPageTranslations: Array<[string, string, string, string]> = [
    [
      "cms-page-about",
      "About Us",
      "Learn about PerumNet Enterprise and how we work.",
      "PerumNet Enterprise is a Bali-based IT consulting company that helps businesses design, install, and maintain technology infrastructure that is always ready for daily operations.\n\nWe believe good technical delivery should feel simple to users: requirements are mapped clearly, installations are documented, and support remains easy to reach when needed.",
    ],
    [
      "cms-page-careers",
      "Careers",
      "Join the PerumNet Enterprise technical team.",
      "We are always open to meeting people who enjoy field work, network technology, software development, and well-organized customer service.",
    ],
  ];
  for (const [id, titleEn, excerptEn, contentEn] of dynamicPageTranslations) {
    statements.push(statement(
      "UPDATE cms_pages SET title_en=?,excerpt_en=?,content_en=?,updated_at=? WHERE id=? AND title_en=''",
      [titleEn, excerptEn, contentEn, timestamp, id],
    ));
  }

  const faqs: Array<[string, string, string, string]> = [
    ["Layanan apa saja yang ditangani PerumNet Enterprise?", "Kami menangani Managed WiFi, CCTV, IP PABX, Smart Home Device, pengembangan software melalui PerumNet Labs, serta integrasi dan dukungan sistem sesuai kebutuhan lokasi.", "What services does PerumNet Enterprise provide?", "We provide Managed WiFi, CCTV, IP PABX, Smart Home solutions, software development through PerumNet Labs, system integrations, and ongoing support."],
    ["Apakah konsultasi awal dan survei lokasi berbayar?", "Konsultasi awal tidak dipungut biaya. Kebutuhan survei dan biaya kunjungan—bila ada—akan dijelaskan terlebih dahulu sesuai lokasi serta ruang lingkup proyek.", "Are the initial consultation and site survey paid?", "The initial consultation is free. Any site-survey or travel fee will be confirmed in advance based on the location and project scope."],
    ["Apakah PerumNet Enterprise menyediakan dukungan setelah instalasi?", "Ya. Setiap pekerjaan ditutup dengan pengujian dan dokumentasi. Pilihan garansi, pemeliharaan, serta dukungan berkala disesuaikan dengan proposal atau kontrak layanan.", "Do you provide support after installation?", "Yes. Every delivery includes testing and documentation. Warranty, maintenance, and ongoing support options follow the approved proposal or service contract."],
    ["Bisakah sistem lama diintegrasikan atau ditingkatkan?", "Bisa. Tim kami akan mengaudit kondisi perangkat, jaringan, dan aplikasi yang sudah ada untuk menentukan bagian yang dapat dipertahankan, ditingkatkan, atau perlu diganti.", "Can you integrate or upgrade an existing system?", "Yes. We audit existing devices, networks, and applications to determine what can be retained, upgraded, or should be replaced."],
    ["Bagaimana memulai proyek bersama PerumNet Enterprise?", "Hubungi kami melalui WhatsApp atau email, ceritakan kebutuhan dan lokasi, lalu tim kami akan menyusun langkah awal berupa diskusi, survei bila diperlukan, serta rekomendasi solusi.", "How do I start a project with PerumNet Enterprise?", "Contact us through WhatsApp or email, share your needs and location, and our team will arrange an initial discussion, a site survey when needed, and a solution recommendation."],
  ];
  faqs.forEach((faq, index) => statements.push(statement(
    `INSERT INTO cms_faqs
      (id,question,answer,question_en,answer_en,sort_order,is_visible,created_at,updated_at)
     VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING`,
    [`cms-faq-${index + 1}`, faq[0], faq[1], faq[2], faq[3], index + 1, timestamp, timestamp],
  )));

  const partners: Array<[string, string, string, string, string, number]> = [
    ["cms-partner-iconplus", "ICON+", "partner", "Partner Infrastruktur", "/partners/iconplus.jpeg", 1],
    ["cms-partner-alus", "AlusNet", "partner", "Partner Teknologi", "/partners/alusnet.jpeg", 2],
    ["cms-partner-fiberstar", "FiberStar", "partner", "Partner Fiber Optik", "/partners/fiberstar.jpeg", 3],
    ["cms-client-workspace", "Akata Konstruksi", "client", "Konstruksi & Properti", "/partners/akata-konstruksi.png", 4],
    ["cms-client-property", "Arbit", "client", "Bisnis Lokal", "/partners/arbit.png", 5],
    ["cms-client-education", "Quenzo", "client", "Retail & Commercial", "/partners/quenzo.png", 6],
    ["cms-client-retail", "Paborito Coffee", "client", "Food & Beverage", "/partners/paborito-coffee.jpeg", 7],
    ["cms-client-hospitality", "Rossa Garden", "client", "Hospitality", "/partners/rossa-garden.jpeg", 8],
  ];
  for (const [id, name, type, category, logoUrl, sortOrder] of partners) {
    statements.push(statement(
      `INSERT INTO cms_partners
        (id,name,organization_type,category,website_url,logo_url,sort_order,is_visible,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING`,
      [id, name, type, category, "", logoUrl, sortOrder, timestamp, timestamp],
    ));
  }

  const legacyPartnerReplacements: Array<[string, string, string, string, string, string, number]> = [
    ["cms-partner-alus", "PT Adi Solusindo Teknologi (ALUS)", "AlusNet", "partner", "Partner Teknologi", "/partners/alusnet.jpeg", 2],
    ["cms-client-workspace", "Office & Workspace", "Akata Konstruksi", "client", "Konstruksi & Properti", "/partners/akata-konstruksi.png", 4],
    ["cms-client-property", "Property & Residential", "Arbit", "client", "Bisnis Lokal", "/partners/arbit.png", 5],
    ["cms-client-education", "Education & Public Space", "Quenzo", "client", "Retail & Commercial", "/partners/quenzo.png", 6],
    ["cms-client-retail", "Retail & Commercial", "Paborito Coffee", "client", "Food & Beverage", "/partners/paborito-coffee.jpeg", 7],
    ["cms-client-hospitality", "Hospitality & Villa", "Rossa Garden", "client", "Hospitality", "/partners/rossa-garden.jpeg", 8],
  ];
  for (const [id, oldName, name, type, category, logoUrl, sortOrder] of legacyPartnerReplacements) {
    statements.push(statement(
      `UPDATE cms_partners
       SET name=?,organization_type=?,category=?,logo_url=?,sort_order=?,updated_at=?
       WHERE id=? AND name=? AND logo_storage_url IS NULL AND logo_url=''`,
      [name, type, category, logoUrl, sortOrder, timestamp, id, oldName],
    ));
  }

  const pages: Array<[string, string, string, string, string, string, string]> = [
    [
      "cms-page-terms",
      "Syarat dan Ketentuan",
      "Terms and Conditions",
      "syarat-ketentuan",
      "Ketentuan penggunaan layanan dan kerja sama dengan PerumNet Enterprise.",
      "Terms governing the use of PerumNet Enterprise services and project engagements.",
      "Dokumen ini mengatur penggunaan situs dan layanan PerumNet Enterprise. Ruang lingkup pekerjaan, jadwal, biaya, metode pembayaran, garansi, dan dukungan mengikuti proposal, BOQ, SPK, atau perjanjian tertulis yang disetujui para pihak.\n\nKlien bertanggung jawab memberikan informasi lokasi, akses kerja, persetujuan teknis, dan pembayaran sesuai jadwal. Perubahan ruang lingkup harus disepakati tertulis dan dapat memengaruhi biaya maupun waktu pelaksanaan.\n\nHak atas perangkat lunak, desain, dokumentasi, konfigurasi, atau materi lain mengikuti ketentuan pada dokumen proyek. Informasi bisnis dan akses sistem diperlakukan sebagai informasi rahasia sesuai kebutuhan pelaksanaan.\n\nPerumNet Enterprise menerapkan upaya profesional untuk menjaga mutu pekerjaan. Batas tanggung jawab, keadaan kahar, penghentian pekerjaan, serta penyelesaian perselisihan mengikuti perjanjian yang berlaku dan hukum Republik Indonesia.\n\nPertanyaan dapat dikirim ke it@perumnet.id.",
    ],
    [
      "cms-page-privacy",
      "Kebijakan Privasi",
      "Privacy Policy",
      "kebijakan-privasi",
      "Cara PerumNet Enterprise mengelola informasi pengunjung dan klien.",
      "How PerumNet Enterprise manages visitor and client information.",
      "PerumNet Enterprise dapat mengumpulkan informasi yang Anda kirimkan melalui formulir, WhatsApp, email, konsultasi, atau pelaksanaan proyek; termasuk nama, perusahaan, informasi kontak, lokasi, dan kebutuhan teknis.\n\nInformasi digunakan untuk menjawab permintaan, menyiapkan proposal, melaksanakan dan mendukung layanan, menjaga keamanan sistem, memenuhi kewajiban administrasi, serta meningkatkan kualitas layanan.\n\nAkses informasi dibatasi sesuai kebutuhan kerja dan dapat dibagikan kepada mitra pelaksana atau penyedia teknologi hanya sejauh diperlukan. Kami tidak menjual data pribadi.\n\nSitus dapat memproses data teknis dasar seperti alamat IP, jenis perangkat, log keamanan, dan cookie esensial. Data disimpan selama diperlukan untuk tujuan layanan, keamanan, kewajiban hukum, atau penyelesaian sengketa.\n\nAnda dapat meminta akses, koreksi, atau penghapusan data yang memenuhi ketentuan melalui it@perumnet.id. Kebijakan ini dapat diperbarui ketika layanan atau ketentuan hukum berubah.",
    ],
  ];
  for (const [id, title, titleEn, slug, excerpt, excerptEn, content] of pages) {
    const contentEn = slug === "syarat-ketentuan"
      ? "These terms govern the use of the PerumNet Enterprise website and services. Project scope, schedule, fees, payment terms, warranty, and support are defined by the approved proposal, BOQ, work order, or written agreement.\n\nClients are responsible for providing accurate site information, work access, technical approvals, and payments on schedule. Scope changes must be agreed in writing and may affect delivery time and cost.\n\nOwnership of software, designs, documentation, configurations, and other deliverables follows the relevant project agreement. Business information and system credentials are treated as confidential as required for delivery.\n\nPerumNet Enterprise applies professional care to every engagement. Liability limits, force majeure, termination, and dispute resolution follow the applicable agreement and the laws of the Republic of Indonesia.\n\nQuestions can be sent to it@perumnet.id."
      : "PerumNet Enterprise may collect information you provide through forms, WhatsApp, email, consultations, or project delivery, including names, company details, contact information, locations, and technical requirements.\n\nWe use this information to respond to enquiries, prepare proposals, deliver and support services, protect systems, fulfil administrative obligations, and improve service quality.\n\nAccess is restricted to people who need it for their work. Information may be shared with delivery partners or technology providers only when necessary. We do not sell personal data.\n\nThe website may process basic technical data such as IP addresses, device types, security logs, and essential cookies. Data is retained only as required for services, security, legal obligations, or dispute handling.\n\nYou may request access, correction, or eligible deletion by contacting it@perumnet.id. This policy may be updated as services or legal requirements change.";
    statements.push(statement(
      `INSERT INTO cms_pages
        (id,title,title_en,slug,excerpt,excerpt_en,content,content_en,is_published,show_in_navigation,sort_order,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,1,0,?,?,?) ON CONFLICT DO NOTHING`,
      [id, title, titleEn, slug, excerpt, excerptEn, content, contentEn, slug === "syarat-ketentuan" ? 90 : 91, timestamp, timestamp],
    ));
  }

  const settingTranslations: Array<[string, string]> = [
    ["company_tagline", "IT consulting for more reliable operations"],
    ["cta_text", "Discuss Your Requirements"],
    ["business_hours", "Monday–Sunday · 24/7 support"],
  ];
  for (const [key, value] of settingTranslations) {
    statements.push(statement(
      "UPDATE cms_site_settings SET value_content_en=?,updated_at=? WHERE key_name=? AND value_content_en=''",
      [value, timestamp, key],
    ));
  }

  await client.batch(statements, "write");
}

async function ensureBastEngineerRoleColumn(client: DatabaseClient) {
  try {
    await client.execute("SELECT engineer_role FROM basts LIMIT 1");
  } catch {
    try {
      await client.execute(
        "ALTER TABLE basts ADD COLUMN engineer_role TEXT NOT NULL DEFAULT 'Project Manager'",
      );
    } catch {
      // A concurrent initializer may have completed the same migration first.
      await client.execute("SELECT engineer_role FROM basts LIMIT 1");
    }
  }
}

async function ensureTransactionCategoryColumn(client: DatabaseClient) {
  try {
    await client.execute("SELECT category FROM transactions LIMIT 1");
  } catch {
    try {
      await client.execute(
        "ALTER TABLE transactions ADD COLUMN category TEXT NOT NULL DEFAULT 'Lainnya'",
      );
      await client.execute(`
        UPDATE transactions
        SET category = CASE
          WHEN source='Invoice' THEN 'Penjualan'
          WHEN source='SPK' THEN 'Vendor'
          WHEN source IN ('Material','Perangkat') THEN 'Vendor'
          WHEN source='Operasional' THEN 'Operasional'
          ELSE 'Lainnya'
        END
      `);
    } catch {
      // A concurrent initializer may have completed the same migration first.
      await client.execute("SELECT category FROM transactions LIMIT 1");
    }
  }
}

async function ensureSpkPaymentColumns(client: DatabaseClient) {
  try {
    await client.execute("SELECT payment_status FROM spks LIMIT 1");
  } catch {
    try {
      await client.execute(
        "ALTER TABLE spks ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Belum Dibayar'",
      );
    } catch {
      await client.execute("SELECT payment_status FROM spks LIMIT 1");
    }
  }
  try {
    await client.execute("SELECT paid_date FROM spks LIMIT 1");
  } catch {
    try {
      await client.execute("ALTER TABLE spks ADD COLUMN paid_date TEXT");
    } catch {
      await client.execute("SELECT paid_date FROM spks LIMIT 1");
    }
  }
  await client.execute(`
    UPDATE spks
    SET payment_status='Dibayar',
      paid_date=COALESCE(
        paid_date,
        (SELECT date FROM transactions
          WHERE transactions.source='SPK'
            AND transactions.reference_id=spks.id
          LIMIT 1)
      )
    WHERE EXISTS (
      SELECT 1 FROM transactions
      WHERE transactions.source='SPK'
        AND transactions.reference_id=spks.id
    )
  `);
}

export async function initializeDatabase(client: DatabaseClient) {
  await client.executeMultiple(schemaSql);
  await ensureCmsBilingualSchema(client);
  await ensureBastEngineerRoleColumn(client);
  await ensureTransactionCategoryColumn(client);
  await ensureSpkPaymentColumns(client);
  await ensureCmsSeed(client);
  await ensureCmsEnhancements(client);
  await ensureCmsLandingFeatures(client);

  const existing = await client.execute("SELECT id FROM users LIMIT 1");
  if (existing.rows.length) return;

  const production = process.env.NODE_ENV === "production";
  const demoMode = process.env.APP_MODE === "demo";
  const bootstrapPassword = demoMode
    ? process.env.DEMO_ACCOUNT_PASSWORD ?? (production ? "" : "perumnet123")
    : process.env.SEED_ADMIN_PASSWORD ?? (production ? "" : "perumnet123");
  if (!bootstrapPassword) {
    throw new Error(
      demoMode
        ? "Database demo masih kosong. Isi DEMO_ACCOUNT_PASSWORD untuk membuat akun demo."
        : "Database masih kosong. Isi SEED_ADMIN_PASSWORD sekali untuk membuat akun administrator pertama.",
    );
  }
  if (production && bootstrapPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD production harus memiliki minimal 12 karakter.");
  }
  const passwordHash = await hash(bootstrapPassword, 12);

  const userRows = [
    [
      "user-1",
      demoMode ? "Demo Administrator" : "Dewa Mahardika",
      demoMode ? "demo@perumnet.id" : "admin@perumnet.id",
      "Admin",
      "Aktif",
    ],
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
