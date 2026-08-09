import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { isProductionRuntime } from "../runtime-env";
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

CREATE TABLE IF NOT EXISTS email_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  requested_by TEXT,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_change_requests_user_idx
  ON email_change_requests(user_id);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope_key TEXT NOT NULL,
  route_key TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, route_key)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_idx
  ON auth_rate_limits(route_key, blocked_until);

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
  sender_profile TEXT NOT NULL DEFAULT 'operational',
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_deliveries_user_idx ON email_deliveries(user_id,created_at);
CREATE INDEX IF NOT EXISTS email_deliveries_status_idx ON email_deliveries(status,created_at);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  sender_profile TEXT NOT NULL DEFAULT 'operational',
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Processing', 'Sent', 'Failed', 'Skipped')),
  provider TEXT,
  provider_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS email_outbox_status_retry_idx
  ON email_outbox(status,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS email_outbox_user_idx
  ON email_outbox(user_id,created_at);

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
  latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  coordinate_source TEXT,
  geocoded_query TEXT,
  geocoded_label TEXT,
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

CREATE TABLE IF NOT EXISTS item_catalog_categories (
  id TEXT PRIMARY KEY,
  boq_role TEXT NOT NULL CHECK (boq_role IN ('Perangkat', 'Material', 'Jasa', 'Mobilitas')),
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  default_margin_1_bps INTEGER NOT NULL DEFAULT 2000 CHECK (default_margin_1_bps >= 0),
  default_margin_2_bps INTEGER NOT NULL DEFAULT 3000 CHECK (default_margin_2_bps >= 0),
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (boq_role, name)
);
CREATE INDEX IF NOT EXISTS item_catalog_categories_sort_idx
  ON item_catalog_categories(boq_role,status,sort_order,name);

CREATE TABLE IF NOT EXISTS item_catalog_brands (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES item_catalog_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (category_id, name)
);
CREATE INDEX IF NOT EXISTS item_catalog_brands_category_idx
  ON item_catalog_brands(category_id,status,sort_order,name);

CREATE TABLE IF NOT EXISTS item_catalog_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES item_catalog_categories(id) ON DELETE RESTRICT,
  brand_id TEXT REFERENCES item_catalog_brands(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  specifications TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'unit',
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  margin_1_bps INTEGER NOT NULL DEFAULT 2000 CHECK (margin_1_bps >= 0),
  margin_2_bps INTEGER NOT NULL DEFAULT 3000 CHECK (margin_2_bps >= 0),
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_catalog_items_filter_idx
  ON item_catalog_items(category_id,brand_id,status,name);

CREATE TABLE IF NOT EXISTS boqs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Draft',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boq_scopes (
  id TEXT PRIMARY KEY,
  boq_id TEXT NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('Original', 'Addendum')),
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Accepted', 'Rejected', 'Void')),
  accepted_at TEXT,
  acceptance_attachment_name TEXT,
  acceptance_attachment_mime_type TEXT,
  acceptance_attachment_content_base64 TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS boq_scopes_boq_idx ON boq_scopes(boq_id,sequence);
CREATE UNIQUE INDEX IF NOT EXISTS boq_scopes_sequence_unique ON boq_scopes(boq_id,sequence);

CREATE TABLE IF NOT EXISTS boq_items (
  id TEXT PRIMARY KEY,
  boq_id TEXT NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
  scope_id TEXT REFERENCES boq_scopes(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('Perangkat', 'Material', 'Jasa', 'Mobilitas')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price INTEGER NOT NULL CHECK (selling_price >= 0),
  catalog_item_id TEXT REFERENCES item_catalog_items(id) ON DELETE RESTRICT,
  catalog_price_tier INTEGER CHECK (catalog_price_tier IN (1,2)),
  catalog_revision INTEGER,
  manual_price_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_price_override IN (0,1)),
  price_override_reason TEXT,
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
  catalog_item_id TEXT REFERENCES item_catalog_items(id) ON DELETE RESTRICT,
  catalog_price_tier INTEGER CHECK (catalog_price_tier IN (1,2)),
  catalog_revision INTEGER,
  manual_price_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_price_override IN (0,1)),
  price_override_reason TEXT,
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
  catalog_item_id TEXT REFERENCES item_catalog_items(id) ON DELETE RESTRICT,
  catalog_price_tier INTEGER CHECK (catalog_price_tier IN (1,2)),
  catalog_revision INTEGER,
  manual_price_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_price_override IN (0,1)),
  price_override_reason TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS standalone_boq_items_boq_idx
  ON standalone_boq_items(standalone_boq_id);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope_id TEXT REFERENCES boq_scopes(id) ON DELETE RESTRICT,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Draft',
  issued_at TEXT NOT NULL,
  valid_until TEXT,
  total INTEGER NOT NULL,
  accepted_at TEXT,
  acceptance_attachment_name TEXT,
  acceptance_attachment_mime_type TEXT,
  acceptance_attachment_content_base64 TEXT,
  tax_enabled INTEGER NOT NULL DEFAULT 0 CHECK (tax_enabled IN (0,1)),
  tax_revision INTEGER NOT NULL DEFAULT 0 CHECK (tax_revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotations_project_idx ON quotations(project_id,created_at);

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

CREATE TABLE IF NOT EXISTS vendor_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL DEFAULT '',
  vendor_type TEXT NOT NULL CHECK (vendor_type IN ('Supplier', 'Jasa', 'Hybrid')),
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vendor_categories_sort_idx ON vendor_categories(status,sort_order,name);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  vendor_type TEXT NOT NULL DEFAULT 'Jasa',
  contact TEXT NOT NULL,
  email TEXT,
  address TEXT,
  rate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Nonaktif')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_category_assignments (
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES vendor_categories(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vendor_id,category_id)
);
CREATE INDEX IF NOT EXISTS vendor_category_assignments_category_idx
  ON vendor_category_assignments(category_id,vendor_id);

CREATE TABLE IF NOT EXISTS spks (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Dikirim', 'Dikerjakan', 'Selesai')),
  document_type TEXT NOT NULL DEFAULT 'SPK',
  workflow_status TEXT NOT NULL DEFAULT 'Draft',
  approval_status TEXT NOT NULL DEFAULT 'Draft',
  quotation_id TEXT REFERENCES quotations(id) ON DELETE RESTRICT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  override_reason TEXT,
  legacy_imported INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Belum Dibayar' CHECK (payment_status IN ('Belum Dibayar', 'Dibayar')),
  paid_date TEXT,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spks_project_idx ON spks(project_id);
CREATE INDEX IF NOT EXISTS spks_vendor_idx ON spks(vendor_id,created_at);

CREATE TABLE IF NOT EXISTS spk_items (
  id TEXT PRIMARY KEY,
  spk_id TEXT NOT NULL REFERENCES spks(id) ON DELETE CASCADE,
  boq_item_id TEXT REFERENCES boq_items(id) ON DELETE RESTRICT,
  quotation_id TEXT REFERENCES quotations(id) ON DELETE RESTRICT,
  description_snapshot TEXT NOT NULL,
  category_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  budget_unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (budget_unit_cost >= 0),
  agreed_unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (agreed_unit_cost >= 0),
  line_total INTEGER NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_item INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spk_items_spk_idx ON spk_items(spk_id,sort_order);
CREATE INDEX IF NOT EXISTS spk_items_boq_item_idx ON spk_items(boq_item_id);
CREATE INDEX IF NOT EXISTS spk_items_quotation_idx ON spk_items(quotation_id);

CREATE TABLE IF NOT EXISTS spk_payment_terms (
  id TEXT PRIMARY KEY,
  spk_id TEXT NOT NULL REFERENCES spks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  term_type TEXT NOT NULL CHECK (term_type IN ('DP', 'Progress', 'Final', 'Custom')),
  percentage_bps INTEGER CHECK (percentage_bps IS NULL OR (percentage_bps > 0 AND percentage_bps <= 10000)),
  planned_amount INTEGER NOT NULL CHECK (planned_amount > 0),
  requires_verification INTEGER NOT NULL DEFAULT 1 CHECK (requires_verification IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spk_payment_terms_spk_idx ON spk_payment_terms(spk_id,sort_order);

CREATE TABLE IF NOT EXISTS spk_verifications (
  id TEXT PRIMARY KEY,
  spk_id TEXT NOT NULL REFERENCES spks(id) ON DELETE CASCADE,
  term_id TEXT REFERENCES spk_payment_terms(id) ON DELETE SET NULL,
  verified_amount INTEGER NOT NULL CHECK (verified_amount > 0),
  progress_percentage INTEGER CHECK (progress_percentage IS NULL OR (progress_percentage >= 0 AND progress_percentage <= 100)),
  notes TEXT,
  attachment_name TEXT,
  attachment_mime_type TEXT,
  attachment_content_base64 TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spk_verifications_spk_idx ON spk_verifications(spk_id,verified_at);
CREATE INDEX IF NOT EXISTS spk_verifications_term_idx ON spk_verifications(term_id);

CREATE TABLE IF NOT EXISTS po_receipts (
  id TEXT PRIMARY KEY,
  spk_id TEXT NOT NULL REFERENCES spks(id) ON DELETE CASCADE,
  receipt_number TEXT,
  received_at TEXT NOT NULL,
  notes TEXT,
  attachment_name TEXT,
  attachment_mime_type TEXT,
  attachment_content_base64 TEXT,
  received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS po_receipts_spk_idx ON po_receipts(spk_id,received_at);

CREATE TABLE IF NOT EXISTS po_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES po_receipts(id) ON DELETE CASCADE,
  spk_item_id TEXT NOT NULL REFERENCES spk_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS po_receipt_items_receipt_idx ON po_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS po_receipt_items_spk_item_idx ON po_receipt_items(spk_item_id);

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
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Final', 'Void')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS basts_project_idx ON basts(project_id);

CREATE TABLE IF NOT EXISTS project_validations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed')),
  notes TEXT,
  validated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_validations_project_idx ON project_validations(project_id);

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
  origin TEXT NOT NULL DEFAULT 'system',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_project_idx ON transactions(project_id);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_source_reference_unique
  ON transactions(source, reference_id)
  WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif','Nonaktif')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_expense_categories_status_idx
  ON project_expense_categories(status,sort_order,name);

CREATE TABLE IF NOT EXISTS project_advances (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  disbursed_date TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  payment_reference TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Settled','Void')),
  transaction_id TEXT UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_advances_project_status_idx
  ON project_advances(project_id,status,disbursed_date);
CREATE INDEX IF NOT EXISTS project_advances_recipient_idx
  ON project_advances(recipient_user_id,status);

CREATE TABLE IF NOT EXISTS project_expenses (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  purchase_date TEXT NOT NULL,
  merchant TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES project_expense_categories(id) ON DELETE RESTRICT,
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  funding_source TEXT NOT NULL CHECK (funding_source IN ('CompanyAccount','ProjectAdvance','EmployeePaid')),
  payment_method TEXT NOT NULL DEFAULT 'Tunai' CHECK (payment_method IN ('Tunai','QRIS','Transfer Bank')),
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  advance_id TEXT REFERENCES project_advances(id) ON DELETE RESTRICT,
  paid_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  item_details_json TEXT NOT NULL DEFAULT '[]',
  workflow_status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (workflow_status IN ('Draft','Submitted','Approved','Rejected','Void')),
  settlement_status TEXT NOT NULL DEFAULT 'Unposted'
    CHECK (settlement_status IN ('Unposted','Posted','AwaitingReimbursement','PartiallyReimbursed','Reimbursed','AdvanceSettled','Void')),
  duplicate_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_acknowledged IN (0,1)),
  review_reason TEXT,
  self_approval_reason TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TEXT,
  voided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_expenses_project_status_idx
  ON project_expenses(project_id,workflow_status,purchase_date);
CREATE INDEX IF NOT EXISTS project_expenses_creator_status_idx
  ON project_expenses(created_by,workflow_status,created_at);
CREATE INDEX IF NOT EXISTS project_expenses_settlement_idx
  ON project_expenses(settlement_status,updated_at);

CREATE TABLE IF NOT EXISTS project_expense_attachments (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES project_expenses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'Receipt' CHECK (kind IN ('Receipt','Invoice','PaymentProof','Other')),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
  sha256 TEXT NOT NULL,
  storage_url TEXT,
  content_base64 TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_expense_attachments_expense_idx
  ON project_expense_attachments(expense_id,created_at);
CREATE INDEX IF NOT EXISTS project_expense_attachments_hash_idx
  ON project_expense_attachments(sha256);

CREATE TABLE IF NOT EXISTS project_expense_settlements (
  id TEXT PRIMARY KEY,
  expense_id TEXT REFERENCES project_expenses(id) ON DELETE RESTRICT,
  advance_id TEXT REFERENCES project_advances(id) ON DELETE RESTRICT,
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('CompanyPayment','AdvanceAllocation','Reimbursement','AdvanceReturn','Reversal')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  settlement_date TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  payment_reference TEXT NOT NULL,
  transaction_id TEXT UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted','Void')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_expense_settlements_expense_idx
  ON project_expense_settlements(expense_id,status,settlement_date);
CREATE INDEX IF NOT EXISTS project_expense_settlements_advance_idx
  ON project_expense_settlements(advance_id,status,settlement_date);

CREATE TABLE IF NOT EXISTS project_expense_events (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES project_expenses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  note TEXT,
  metadata_json TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_expense_events_expense_idx
  ON project_expense_events(expense_id,created_at);

CREATE TABLE IF NOT EXISTS spk_payments (
  id TEXT PRIMARY KEY,
  spk_id TEXT NOT NULL REFERENCES spks(id) ON DELETE CASCADE,
  term_id TEXT REFERENCES spk_payment_terms(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_date TEXT NOT NULL,
  vendor_invoice_number TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  attachment_name TEXT NOT NULL,
  attachment_mime_type TEXT NOT NULL,
  attachment_content_base64 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spk_payments_spk_idx ON spk_payments(spk_id,paid_date);
CREATE INDEX IF NOT EXISTS spk_payments_term_idx ON spk_payments(term_id);
CREATE INDEX IF NOT EXISTS spk_payments_bank_account_idx ON spk_payments(bank_account_id);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  gross_amount INTEGER NOT NULL CHECK (gross_amount > 0),
  cash_amount INTEGER NOT NULL CHECK (cash_amount >= 0),
  withholding_amount INTEGER NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  paid_date TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  attachment_name TEXT,
  attachment_mime_type TEXT,
  attachment_content_base64 TEXT,
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (gross_amount = cash_amount + withholding_amount)
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx
  ON invoice_payments(invoice_id,paid_date);
CREATE INDEX IF NOT EXISTS invoice_payments_bank_account_idx
  ON invoice_payments(bank_account_id);

CREATE TABLE IF NOT EXISTS tax_settings (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_rules (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('Client', 'Vendor', 'Both')),
  effect TEXT NOT NULL CHECK (effect IN ('Add', 'Withhold')),
  rate_bps INTEGER NOT NULL DEFAULT 0
    CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  accounting_treatment TEXT NOT NULL
    CHECK (accounting_treatment IN ('Payable', 'Receivable', 'Recoverable', 'Expense')),
  status TEXT NOT NULL DEFAULT 'Inactive'
    CHECK (status IN ('Active', 'Inactive')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tax_rules_scope_sort_idx
  ON tax_rules(scope,status,sort_order,code);

CREATE TABLE IF NOT EXISTS document_taxes (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('Quotation', 'Invoice', 'SPK', 'PO')),
  document_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  rule_id TEXT REFERENCES tax_rules(id) ON DELETE RESTRICT,
  rule_code TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  rule_name_en TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('Client', 'Vendor', 'Both')),
  effect TEXT NOT NULL CHECK (effect IN ('Add', 'Withhold')),
  accounting_treatment TEXT NOT NULL
    CHECK (accounting_treatment IN ('Payable', 'Receivable', 'Recoverable', 'Expense')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  taxable_base INTEGER NOT NULL CHECK (taxable_base >= 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  locked_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (document_type,document_id,rule_id)
);
CREATE INDEX IF NOT EXISTS document_taxes_document_idx
  ON document_taxes(document_type,document_id);
CREATE INDEX IF NOT EXISTS document_taxes_project_idx
  ON document_taxes(project_id,document_type);

CREATE TABLE IF NOT EXISTS tax_obligations (
  id TEXT PRIMARY KEY,
  document_tax_id TEXT NOT NULL UNIQUE
    REFERENCES document_taxes(id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('Payable', 'Receivable')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  settled_amount INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  status TEXT NOT NULL DEFAULT 'Outstanding'
    CHECK (status IN ('Outstanding', 'Partially Settled', 'Settled', 'Void')),
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tax_obligations_status_idx
  ON tax_obligations(direction,status,due_date);
CREATE INDEX IF NOT EXISTS tax_obligations_project_idx
  ON tax_obligations(project_id,status);

CREATE TABLE IF NOT EXISTS tax_settlements (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES tax_obligations(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  settlement_date TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  attachment_name TEXT,
  attachment_mime_type TEXT,
  attachment_content_base64 TEXT,
  status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tax_settlements_obligation_idx
  ON tax_settlements(obligation_id,settlement_date);
CREATE INDEX IF NOT EXISTS tax_settlements_bank_account_idx
  ON tax_settlements(bank_account_id);

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
  excluded_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS cms_portfolio_media (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES cms_portfolios(id) ON DELETE CASCADE,
  storage_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 19),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cms_portfolio_media_portfolio_order
  ON cms_portfolio_media(portfolio_id, sort_order, created_at);

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

CREATE TABLE IF NOT EXISTS cms_mail_login_configs (
  theme_key TEXT PRIMARY KEY CHECK (theme_key IN ('enterprise', 'perumnet')),
  browser_title TEXT NOT NULL,
  eyebrow TEXT NOT NULL,
  headline TEXT NOT NULL,
  description TEXT NOT NULL,
  card_title TEXT NOT NULL,
  logo_url TEXT NOT NULL DEFAULT '',
  logo_source_storage_url TEXT,
  logo_storage_url TEXT,
  logo_mime_type TEXT,
  favicon_url TEXT NOT NULL DEFAULT '',
  favicon_storage_url TEXT,
  favicon_mime_type TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_mail_login_configs_active_idx
  ON cms_mail_login_configs(is_active);

CREATE TABLE IF NOT EXISTS cms_mail_login_versions (
  id TEXT PRIMARY KEY,
  active_theme TEXT NOT NULL CHECK (active_theme IN ('enterprise', 'perumnet')),
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  deployment_mode TEXT NOT NULL CHECK (deployment_mode IN ('capture', 'ssh')),
  status TEXT NOT NULL CHECK (status IN ('Publishing', 'Deployed', 'Failed', 'Rolled Back')),
  error_message TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  deployed_at TEXT
);
CREATE INDEX IF NOT EXISTS cms_mail_login_versions_created_idx
  ON cms_mail_login_versions(created_at);

CREATE TABLE IF NOT EXISTS cms_leads (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT,
  company_name TEXT,
  job_title TEXT,
  location TEXT NOT NULL,
  service_interest TEXT NOT NULL,
  budget_range TEXT,
  target_start TEXT,
  message TEXT NOT NULL,
  privacy_consent_at TEXT NOT NULL,
  source_path TEXT NOT NULL DEFAULT '/',
  language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en')),
  status TEXT NOT NULL DEFAULT 'New'
    CHECK (status IN ('New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost', 'Spam')),
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  retention_until TEXT NOT NULL,
  retention_extended_at TEXT,
  retention_extended_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  anonymized_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_leads_status_created_idx
  ON cms_leads(status, created_at);
CREATE INDEX IF NOT EXISTS cms_leads_assigned_idx
  ON cms_leads(assigned_to, status);
CREATE INDEX IF NOT EXISTS cms_leads_retention_idx
  ON cms_leads(retention_until, anonymized_at);

CREATE TABLE IF NOT EXISTS cms_lead_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES cms_leads(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'note'
    CHECK (note_type IN ('note', 'status', 'assignment', 'retention', 'privacy')),
  body TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_lead_notes_lead_idx
  ON cms_lead_notes(lead_id, created_at);

CREATE TABLE IF NOT EXISTS public_form_rate_limits (
  fingerprint_hash TEXT NOT NULL,
  route_key TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint_hash, route_key)
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
    ["email", "enterprise@perumnet.id"],
    ["phone", "0851 5502 6889"],
    ["address", "BTN Kecicang Indah Blok A5, Bungaya Kangin, Karangasem, Bali 80813"],
    ["instagram_url", "https://www.instagram.com/perum_net"],
    ["linkedin_url", ""],
    ["website_url", "https://www.perumnet.id/"],
    ["dark_font_color", "#FFFFFF"],
    ["motion_enabled", "true"],
    ["partner_carousel_speed", "28"],
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
    ["cms-service-cctv", "cctv", "CCTV & Surveillance", "Sistem pengawasan yang memberi visibilitas jelas dari lokasi maupun jarak jauh.", "Mulai dari penempatan kamera hingga retensi rekaman dan akses mobile, sistem CCTV disusun sesuai risiko dan alur aktivitas lokasi.", "[\"IP camera & NVR\",\"Remote monitoring\",\"Smart detection\",\"Preventive maintenance\"]", "cctv", 2],
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
    ["cms-portfolio-wifi", "Project Quenzo Beach Resort", "Pengelolaan WiFi dan CCTV untuk konektivitas tamu serta keamanan area resort yang stabil.", "/portfolio/quenzo-beach-resort-2026.png", "Padang Bai, Bali", "2026-05-28", 1],
    ["cms-portfolio-cctv", "Project Sandy House Project", "Pengelolaan WiFi, CCTV, dan Smart House untuk konektivitas, keamanan, serta otomasi rumah yang terintegrasi.", "/portfolio/sandy-house-project-network-rack-2026.png", "Pantai Indah Kapuk, Jakarta", "2026-04-16", 2],
    ["cms-portfolio-pabx", "Project Internal PerumNet", "Implementasi IP PABX untuk komunikasi internal PerumNet yang stabil dan mudah dikelola.", "/portfolio/internal-perumnet-ip-pabx-2026.png", "Karangasem, Bali", "2026-03-11", 3],
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
  await ensureProcurementSchema(client);
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
      "INSERT INTO cms_site_settings (id,key_name,value_content,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
      ["cms-setting-motion-enabled", "motion_enabled", "true", timestamp],
    ),
    statement(
      "INSERT INTO cms_site_settings (id,key_name,value_content,updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",
      ["cms-setting-partner-carousel-speed", "partner_carousel_speed", "28", timestamp],
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

async function dropLegacyConstraint(
  client: DatabaseClient,
  table: string,
  constraint: string,
) {
  try {
    await client.execute(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
  } catch {
    // SQLite/libSQL cannot drop table constraints; fresh databases no longer declare them.
  }
}

async function ensureDocumentCounters(client: DatabaseClient) {
  await client.execute(`CREATE TABLE IF NOT EXISTS document_counters (
    key TEXT PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0
  )`);
}

// Step two of the pattern in server/db/README.md. `schemaSql` covers fresh
// installations; this covers the databases that already exist in demo and
// production, which never re-run a CREATE TABLE they have already skipped in a
// dialect-specific way. Both statements are idempotent.
async function ensureAuthHardeningSchema(client: DatabaseClient) {
  await client.execute(`CREATE TABLE IF NOT EXISTS email_change_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_email TEXT NOT NULL,
    new_email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    requested_by TEXT,
    expires_at TEXT NOT NULL,
    confirmed_at TEXT,
    created_at TEXT NOT NULL
  )`);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS email_change_requests_user_idx ON email_change_requests(user_id)",
  );
  await client.execute(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
    scope_key TEXT NOT NULL,
    route_key TEXT NOT NULL,
    window_started_at TEXT NOT NULL,
    failure_count INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope_key, route_key)
  )`);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_idx ON auth_rate_limits(route_key, blocked_until)",
  );
  // The tables are pure scratch state; drop anything that can no longer matter
  // so neither grows without bound on a long-lived installation.
  const timestamp = new Date().toISOString();
  await client.execute({
    sql: "DELETE FROM email_change_requests WHERE expires_at <= ? OR confirmed_at IS NOT NULL",
    args: [timestamp],
  });
  await client.execute({
    sql: "DELETE FROM auth_rate_limits WHERE updated_at <= ?",
    args: [new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()],
  });
}

async function ensureCommercialPackageSchema(client: DatabaseClient) {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS project_commercial_packages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_commercial_packages_code_unique
      ON project_commercial_packages(project_id,code);
    CREATE INDEX IF NOT EXISTS project_commercial_packages_project_idx
      ON project_commercial_packages(project_id,sort_order);

    CREATE TABLE IF NOT EXISTS quotation_items (
      id TEXT PRIMARY KEY,
      quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
      source_item_id TEXT,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit TEXT NOT NULL,
      cost_price INTEGER NOT NULL DEFAULT 0,
      selling_price INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quotation_items_quotation_idx
      ON quotation_items(quotation_id,sort_order);

    CREATE TABLE IF NOT EXISTS bast_seal_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      signer_name TEXT NOT NULL DEFAULT 'PerumNet Enterprise',
      signer_role TEXT NOT NULL DEFAULT 'Authorized Representative',
      seal_mime_type TEXT,
      seal_content_base64 TEXT,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_ai_runs (
      id TEXT PRIMARY KEY,
      requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'Requested',
      query TEXT NOT NULL,
      source_url TEXT,
      input_mime_type TEXT,
      recommendation_json TEXT,
      model TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      error_message TEXT,
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT,
      rejected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      rejected_at TEXT,
      override_reason TEXT,
      catalog_item_id TEXT REFERENCES item_catalog_items(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS catalog_ai_runs_user_idx
      ON catalog_ai_runs(requested_by,created_at);

    CREATE TABLE IF NOT EXISTS catalog_ai_sources (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES catalog_ai_runs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      accessed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS catalog_ai_sources_run_idx
      ON catalog_ai_sources(run_id);
  `);

  const columns: Array<[string, string, string]> = [
    ["boq_scopes", "package_id", "TEXT REFERENCES project_commercial_packages(id) ON DELETE RESTRICT"],
    ["boq_scopes", "parent_scope_id", "TEXT"],
    ["quotations", "package_id", "TEXT REFERENCES project_commercial_packages(id) ON DELETE RESTRICT"],
    ["quotations", "revision_no", "INTEGER NOT NULL DEFAULT 1"],
    ["quotations", "supersedes_id", "TEXT"],
    ["quotations", "discount_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "discount_type", "TEXT NOT NULL DEFAULT 'Nominal'"],
    ["quotations", "discount_value", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "discount_amount", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "taxable_base", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "tax_additions_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "tax_withholdings_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "rounding_mode", "TEXT NOT NULL DEFAULT 'None'"],
    ["quotations", "rounding_step", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "rounding_adjustment", "INTEGER NOT NULL DEFAULT 0"],
    ["quotations", "rounding_reason", "TEXT"],
    ["quotations", "grand_total", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "package_id", "TEXT REFERENCES project_commercial_packages(id) ON DELETE RESTRICT"],
    ["invoices", "quotation_id", "TEXT REFERENCES quotations(id) ON DELETE RESTRICT"],
    ["invoices", "calculation_mode", "TEXT NOT NULL DEFAULT 'Nominal'"],
    ["invoices", "installment_bps", "INTEGER"],
    ["invoices", "contract_grand_total", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "subtotal_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "discount_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "taxable_base_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "tax_additions_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "tax_withholdings_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["invoices", "rounding_snapshot", "INTEGER NOT NULL DEFAULT 0"],
    ["project_validations", "package_id", "TEXT REFERENCES project_commercial_packages(id) ON DELETE RESTRICT"],
    ["project_validations", "delivery_cycle", "INTEGER NOT NULL DEFAULT 1"],
    ["basts", "package_id", "TEXT REFERENCES project_commercial_packages(id) ON DELETE RESTRICT"],
    ["basts", "delivery_cycle", "INTEGER NOT NULL DEFAULT 1"],
    ["basts", "revision_no", "INTEGER NOT NULL DEFAULT 1"],
    ["basts", "finalized_pdf_storage_url", "TEXT"],
    ["basts", "finalized_pdf_content_base64", "TEXT"],
    ["basts", "pdf_hash", "TEXT"],
    ["basts", "verification_token", "TEXT"],
    ["basts", "finalized_at", "TEXT"],
    ["basts", "finalized_by", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
    ["basts", "revoked_at", "TEXT"],
    ["basts", "revoked_by", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
    ["basts", "revocation_reason", "TEXT"],
    ["basts", "seal_name_snapshot", "TEXT"],
    ["basts", "seal_role_snapshot", "TEXT"],
    ["tax_obligations", "reporting_status", "TEXT NOT NULL DEFAULT 'Candidate'"],
    ["tax_obligations", "tax_period", "TEXT"],
    ["tax_obligations", "tax_invoice_number", "TEXT"],
    ["tax_obligations", "tax_invoice_date", "TEXT"],
    ["tax_obligations", "return_reference", "TEXT"],
    ["tax_obligations", "reported_at", "TEXT"],
    ["tax_obligations", "reported_by", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
    ["tax_obligations", "reporting_notes", "TEXT"],
  ];
  for (const [table, column, definition] of columns) {
    await ensureColumn(client, table, column, definition);
  }

  await client.execute("DROP INDEX IF EXISTS quotations_scope_unique");
  await client.execute("DROP INDEX IF EXISTS basts_project_unique");
  await client.execute("DROP INDEX IF EXISTS project_validations_project_unique");
  await dropLegacyConstraint(client, "project_validations", "project_validations_project_id_key");
  await dropLegacyConstraint(client, "basts", "basts_project_id_key");
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS quotations_scope_revision_unique ON quotations(scope_id,revision_no)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS quotations_package_idx ON quotations(package_id,created_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS invoices_quotation_idx ON invoices(quotation_id,created_at)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS project_validations_package_cycle_unique ON project_validations(package_id,delivery_cycle)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS basts_package_cycle_revision_unique ON basts(package_id,delivery_cycle,revision_no)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS basts_verification_token_unique ON basts(verification_token)",
  );

  const timestamp = new Date().toISOString();
  const projects = await client.execute(
    "SELECT id,created_by,created_at FROM projects ORDER BY created_at,id",
  );
  for (const project of projects.rows) {
    const projectId = String(project.id);
    const existing = await client.execute({
      sql: "SELECT id FROM project_commercial_packages WHERE project_id=? ORDER BY sort_order,created_at LIMIT 1",
      args: [projectId],
    });
    const packageId = existing.rows[0]
      ? String(existing.rows[0].id)
      : `commercial-package-default-${projectId}`;
    if (!existing.rows[0]) {
      await client.execute({
        sql: `INSERT INTO project_commercial_packages
          (id,project_id,code,title,status,sort_order,created_by,created_at,updated_at)
          VALUES (?,?,?,'Lingkup Utama','Active',0,?,?,?)`,
        args: [
          packageId,
          projectId,
          "PKG-01",
          project.created_by ?? null,
          project.created_at ?? timestamp,
          timestamp,
        ],
      });
    }
    await client.batch([
      // Addenda used to be inserted with package_id NULL, which hid them from
      // every package counter and package-filtered quotation query. Adopt the
      // parent scope's package first — that is the only answer that stays
      // correct on a project with several packages — and only then fall back
      // to the project's default package. Both statements are scoped to
      // `package_id IS NULL`, so re-running the migration is a no-op.
      {
        sql: `UPDATE boq_scopes SET package_id=(
            SELECT parent.package_id FROM boq_scopes parent
            WHERE parent.id=boq_scopes.parent_scope_id
          )
          WHERE package_id IS NULL
            AND boq_id IN (SELECT id FROM boqs WHERE project_id=?)
            AND EXISTS (
              SELECT 1 FROM boq_scopes parent
              WHERE parent.id=boq_scopes.parent_scope_id
                AND parent.package_id IS NOT NULL
            )`,
        args: [projectId],
      },
      {
        sql: `UPDATE boq_scopes SET package_id=? WHERE package_id IS NULL
          AND boq_id IN (SELECT id FROM boqs WHERE project_id=?)`,
        args: [packageId, projectId],
      },
      // A quotation always belongs to the package of the scope it prices, so
      // inherit from the (now backfilled) scope before touching the default.
      {
        sql: `UPDATE quotations SET package_id=(
            SELECT s.package_id FROM boq_scopes s WHERE s.id=quotations.scope_id
          )
          WHERE project_id=? AND package_id IS NULL AND scope_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM boq_scopes s
              WHERE s.id=quotations.scope_id AND s.package_id IS NOT NULL
            )`,
        args: [projectId],
      },
      {
        sql: "UPDATE quotations SET package_id=? WHERE project_id=? AND package_id IS NULL",
        args: [packageId, projectId],
      },
      {
        sql: `UPDATE invoices SET package_id=?,quotation_id=COALESCE(quotation_id,
          (SELECT q.id FROM quotations q WHERE q.project_id=? ORDER BY q.created_at DESC LIMIT 1))
          WHERE project_id=? AND package_id IS NULL`,
        args: [packageId, projectId, projectId],
      },
      {
        sql: "UPDATE project_validations SET package_id=? WHERE project_id=? AND package_id IS NULL",
        args: [packageId, projectId],
      },
      {
        sql: "UPDATE basts SET package_id=? WHERE project_id=? AND package_id IS NULL",
        args: [packageId, projectId],
      },
    ], "write");
  }

  await client.execute(`UPDATE quotations SET
    taxable_base=CASE WHEN taxable_base=0 THEN total ELSE taxable_base END,
    grand_total=CASE WHEN grand_total=0 THEN total ELSE grand_total END`);
  await client.execute(`UPDATE invoices SET
    contract_grand_total=CASE WHEN contract_grand_total=0 THEN amount ELSE contract_grand_total END,
    subtotal_snapshot=CASE WHEN subtotal_snapshot=0 THEN amount ELSE subtotal_snapshot END,
    taxable_base_snapshot=CASE WHEN taxable_base_snapshot=0 THEN amount ELSE taxable_base_snapshot END`);
  await client.execute({
    sql: `INSERT INTO quotation_items
      (id,quotation_id,source_item_id,category,description,quantity,unit,cost_price,
       selling_price,sort_order,created_at)
      SELECT 'quotation-item-' || q.id || '-' || i.id,q.id,i.id,i.category,
        i.description,i.quantity,i.unit,i.cost_price,i.selling_price,i.sort_order,?
      FROM quotations q JOIN boq_items i ON i.scope_id=q.scope_id
      WHERE q.status<>'Draft'
        AND NOT EXISTS (SELECT 1 FROM quotation_items qi WHERE qi.quotation_id=q.id)`,
    args: [timestamp],
  });
  await client.execute({
    sql: `INSERT INTO bast_seal_settings
      (id,enabled,signer_name,signer_role,updated_at)
      VALUES ('global',0,'PerumNet Enterprise','Authorized Representative',?)
      ON CONFLICT (id) DO NOTHING`,
    args: [timestamp],
  });
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
      `UPDATE cms_site_texts SET
        value_content='Sistem IT yang rapi, stabil, dan siap dipakai.',
        value_content_en='Well-organized IT systems, stable and ready to use.',
        updated_at=?
       WHERE page_key='home' AND content_key='hero_title'
         AND value_content='Infrastruktur IT yang bekerja tanpa hambatan.'`,
      [timestamp],
    ),
    statement(
      `UPDATE cms_site_texts SET
        value_content='PerumNet Enterprise menangani jaringan, CCTV, Smart Home, IP PABX, dan software untuk hotel, villa, kantor, sekolah, serta area komersial di Bali.',
        value_content_en='PerumNet Enterprise delivers networks, CCTV, Smart Home, IP PABX, and software for hotels, villas, offices, schools, and commercial sites across Bali.',
        updated_at=?
       WHERE page_key='home' AND content_key='hero_description'
         AND value_content LIKE 'PerumNet Enterprise merancang,%'`,
      [timestamp],
    ),
    statement(
      `UPDATE cms_services SET
        title='Smart Home & Building Automation',
        title_en='Smart Home & Building Automation',
        summary='Otomasi pencahayaan, sensor, akses, dan kontrol perangkat yang dirancang untuk rumah, villa, serta area komersial.',
        summary_en='Lighting, sensors, access, and device control designed for homes, villas, and commercial spaces.',
        description='Kami merancang, memasang, menguji, dan mendokumentasikan otomasi pencahayaan, sensor, akses, serta kontrol perangkat agar sistem mudah digunakan dan dirawat.',
        description_en='We design, install, test, and document lighting automation, sensors, access, and device control so the system remains practical to use and maintain.',
        features_json=?,
        features_json_en=?,
        updated_at=?
       WHERE slug='smart-home-device' AND title='Smart Home Device'`,
      [
        JSON.stringify(["Otomasi pencahayaan", "Sensor & monitoring", "Kontrol akses & perangkat", "Instalasi, pengujian & dokumentasi"]),
        JSON.stringify(["Lighting automation", "Sensors & monitoring", "Access & device control", "Installation, testing & documentation"]),
        timestamp,
      ],
    ),
    statement(
      `INSERT INTO cms_site_texts
        (id,page_key,content_key,value_content,value_content_en,updated_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      ["cms-text-home-partners-eyebrow", "home", "partners_eyebrow", "PARTNER & KLIEN", "PARTNERS & CLIENTS", timestamp],
    ),
    statement(
      `INSERT INTO cms_site_texts
        (id,page_key,content_key,value_content,value_content_en,updated_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      ["cms-text-home-partners-title", "home", "partners_title", "Dipercaya berbagai bisnis, diperkuat partner teknologi.", "Trusted by businesses, strengthened by technology partners.", timestamp],
    ),
    statement(
      `INSERT INTO cms_site_texts
        (id,page_key,content_key,value_content,value_content_en,updated_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      ["cms-text-home-partners-description", "home", "partners_description", "Kami bekerja bersama organisasi dari beragam sektor dan mitra yang mendukung kualitas implementasi.", "We work with organizations across industries and partners that support dependable implementation.", timestamp],
    ),
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

  const seoSettings: Array<[string, string, string]> = [
    ["seo_title", "PerumNet Enterprise — Konsultan IT & Integrator Sistem Bali", "PerumNet Enterprise — IT Consultant & Systems Integrator in Bali"],
    ["seo_description", "Konsultan IT Bali untuk Managed WiFi, CCTV, Smart Home, IP PABX, dan software bagi hotel, villa, kantor, sekolah, serta area komersial.", "Bali IT consulting for Managed WiFi, CCTV, Smart Home, IP PABX, and software for hotels, villas, offices, schools, and commercial sites."],
    ["og_title", "Sistem IT yang rapi, stabil, dan siap dipakai.", "Well-organized IT systems, stable and ready to use."],
    ["og_description", "Survei, desain, instalasi, pengujian, dokumentasi, dan dukungan sistem IT untuk bisnis di Bali.", "Survey, design, installation, testing, documentation, and IT support for businesses in Bali."],
    ["business_legal_name", "PerumNet Enterprise", "PerumNet Enterprise"],
    ["business_area", "Bali, Indonesia", "Bali, Indonesia"],
    ["business_country", "ID", ""],
    ["postal_code", "80813", ""],
  ];
  for (const [key, value, valueEn] of seoSettings) {
    statements.push(statement(
      `INSERT INTO cms_site_settings
        (id,key_name,value_content,value_content_en,updated_at)
       VALUES (?,?,?,?,?) ON CONFLICT (key_name) DO NOTHING`,
      [`cms-setting-${key}`, key, value, valueEn, timestamp],
    ));
  }

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
    ["cms-portfolio-wifi", "Project Quenzo Beach Resort", "Managed WiFi and CCTV for reliable guest connectivity and resort-wide security.", "Padang Bai, Bali"],
    ["cms-portfolio-cctv", "Project Sandy House Project", "Managed WiFi, CCTV, and Smart House systems for connected, secure, and automated living.", "Pantai Indah Kapuk, Jakarta"],
    ["cms-portfolio-pabx", "Project Internal PerumNet", "IP PABX implementation for reliable, manageable internal communications at PerumNet.", "Karangasem, Bali"],
  ];
  for (const [id, titleEn, descriptionEn, locationEn] of portfolioTranslations) {
    statements.push(statement(
      "UPDATE cms_portfolios SET title_en=?,description_en=?,location_en=?,updated_at=? WHERE id=? AND title_en=''",
      [titleEn, descriptionEn, locationEn, timestamp, id],
    ));
  }

  // Replace only the three original placeholder records. The title guard makes
  // this a one-time content migration: once the real portfolio copy is in
  // place, later CMS edits are never overwritten at application startup.
  const portfolioRefreshes = [
    {
      id: "cms-portfolio-wifi",
      priorTitles: ["Managed WiFi Hospitality", "Managed WiFi & CCTV Hospitality"],
      title: "Project Quenzo Beach Resort",
      titleEn: "Project Quenzo Beach Resort",
      description: "Pengelolaan WiFi dan CCTV untuk konektivitas tamu serta keamanan area resort yang stabil.",
      descriptionEn: "Managed WiFi and CCTV for reliable guest connectivity and resort-wide security.",
      imageUrl: "/portfolio/quenzo-beach-resort-2026.png",
      location: "Padang Bai, Bali",
      locationEn: "Padang Bai, Bali",
      completedAt: "2026-05-28",
      sortOrder: 1,
    },
    {
      id: "cms-portfolio-cctv",
      priorTitles: ["CCTV Area Komersial", "Manage WiFi, CCTV & Smart Home"],
      title: "Project Sandy House Project",
      titleEn: "Project Sandy House Project",
      description: "Pengelolaan WiFi, CCTV, dan Smart House untuk konektivitas, keamanan, serta otomasi rumah yang terintegrasi.",
      descriptionEn: "Managed WiFi, CCTV, and Smart House systems for connected, secure, and automated living.",
      imageUrl: "/portfolio/sandy-house-project-network-rack-2026.png",
      location: "Pantai Indah Kapuk, Jakarta",
      locationEn: "Pantai Indah Kapuk, Jakarta",
      completedAt: "2026-04-16",
      sortOrder: 2,
    },
    {
      id: "cms-portfolio-pabx",
      priorTitles: ["IP PABX Kantor Cabang"],
      title: "Project Internal PerumNet",
      titleEn: "Project Internal PerumNet",
      description: "Implementasi IP PABX untuk komunikasi internal PerumNet yang stabil dan mudah dikelola.",
      descriptionEn: "IP PABX implementation for reliable, manageable internal communications at PerumNet.",
      imageUrl: "/portfolio/internal-perumnet-ip-pabx-2026.png",
      location: "Karangasem, Bali",
      locationEn: "Karangasem, Bali",
      completedAt: "2026-03-11",
      sortOrder: 3,
    },
  ];
  for (const item of portfolioRefreshes) {
    statements.push(statement(
      `UPDATE cms_portfolios
       SET title=?,title_en=?,description=?,description_en=?,image_url=?,image_storage_url=NULL,image_mime_type=NULL,location=?,location_en=?,completed_at=?,sort_order=?,is_published=1,updated_at=?
       WHERE id=? AND title IN (${item.priorTitles.map(() => "?").join(",")})`,
      [item.title, item.titleEn, item.description, item.descriptionEn, item.imageUrl, item.location, item.locationEn, item.completedAt, item.sortOrder, timestamp, item.id, ...item.priorTitles],
    ));
  }

  // Give the revised Sandy House cover a new URL so public browser and image
  // optimizer caches cannot continue serving the prior placeholder asset.
  statements.push(statement(
    "UPDATE cms_portfolios SET image_url=?,image_storage_url=NULL,image_mime_type=NULL,updated_at=? WHERE id=? AND image_url=?",
    ["/portfolio/sandy-house-project-network-rack-2026.png", timestamp, "cms-portfolio-cctv", "/portfolio/sandy-house-project-2026.png"],
  ));

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
      "Dokumen ini mengatur penggunaan situs dan layanan PerumNet Enterprise. Ruang lingkup pekerjaan, jadwal, biaya, metode pembayaran, garansi, dan dukungan mengikuti proposal, BOQ, SPK, atau perjanjian tertulis yang disetujui para pihak.\n\nKlien bertanggung jawab memberikan informasi lokasi, akses kerja, persetujuan teknis, dan pembayaran sesuai jadwal. Perubahan ruang lingkup harus disepakati tertulis dan dapat memengaruhi biaya maupun waktu pelaksanaan.\n\nHak atas perangkat lunak, desain, dokumentasi, konfigurasi, atau materi lain mengikuti ketentuan pada dokumen proyek. Informasi bisnis dan akses sistem diperlakukan sebagai informasi rahasia sesuai kebutuhan pelaksanaan.\n\nPerumNet Enterprise menerapkan upaya profesional untuk menjaga mutu pekerjaan. Batas tanggung jawab, keadaan kahar, penghentian pekerjaan, serta penyelesaian perselisihan mengikuti perjanjian yang berlaku dan hukum Republik Indonesia.\n\nPertanyaan dapat dikirim ke enterprise@perumnet.id.",
    ],
    [
      "cms-page-privacy",
      "Kebijakan Privasi",
      "Privacy Policy",
      "kebijakan-privasi",
      "Cara PerumNet Enterprise mengelola informasi pengunjung dan klien.",
      "How PerumNet Enterprise manages visitor and client information.",
      "PerumNet Enterprise dapat mengumpulkan informasi yang Anda kirimkan melalui formulir, WhatsApp, email, konsultasi, atau pelaksanaan proyek; termasuk nama, perusahaan, informasi kontak, lokasi, dan kebutuhan teknis.\n\nInformasi digunakan untuk menjawab permintaan, menyiapkan proposal, melaksanakan dan mendukung layanan, menjaga keamanan sistem, memenuhi kewajiban administrasi, serta meningkatkan kualitas layanan.\n\nAkses informasi dibatasi sesuai kebutuhan kerja dan dapat dibagikan kepada mitra pelaksana atau penyedia teknologi hanya sejauh diperlukan. Kami tidak menjual data pribadi.\n\nSitus dapat memproses data teknis dasar seperti alamat IP, jenis perangkat, log keamanan, dan cookie esensial. Data disimpan selama diperlukan untuk tujuan layanan, keamanan, kewajiban hukum, atau penyelesaian sengketa.\n\nAnda dapat meminta akses, koreksi, atau penghapusan data yang memenuhi ketentuan melalui enterprise@perumnet.id. Kebijakan ini dapat diperbarui ketika layanan atau ketentuan hukum berubah.",
    ],
  ];
  for (const [id, title, titleEn, slug, excerpt, excerptEn, content] of pages) {
    const contentEn = slug === "syarat-ketentuan"
      ? "These terms govern the use of the PerumNet Enterprise website and services. Project scope, schedule, fees, payment terms, warranty, and support are defined by the approved proposal, BOQ, work order, or written agreement.\n\nClients are responsible for providing accurate site information, work access, technical approvals, and payments on schedule. Scope changes must be agreed in writing and may affect delivery time and cost.\n\nOwnership of software, designs, documentation, configurations, and other deliverables follows the relevant project agreement. Business information and system credentials are treated as confidential as required for delivery.\n\nPerumNet Enterprise applies professional care to every engagement. Liability limits, force majeure, termination, and dispute resolution follow the applicable agreement and the laws of the Republic of Indonesia.\n\nQuestions can be sent to enterprise@perumnet.id."
      : "PerumNet Enterprise may collect information you provide through forms, WhatsApp, email, consultations, or project delivery, including names, company details, contact information, locations, and technical requirements.\n\nWe use this information to respond to enquiries, prepare proposals, deliver and support services, protect systems, fulfil administrative obligations, and improve service quality.\n\nAccess is restricted to people who need it for their work. Information may be shared with delivery partners or technology providers only when necessary. We do not sell personal data.\n\nThe website may process basic technical data such as IP addresses, device types, security logs, and essential cookies. Data is retained only as required for services, security, legal obligations, or dispute handling.\n\nYou may request access, correction, or eligible deletion by contacting enterprise@perumnet.id. This policy may be updated as services or legal requirements change.";
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

async function ensureCmsMailLoginSeed(client: DatabaseClient) {
  const timestamp = new Date().toISOString();
  const enterprise = {
    themeKey: "enterprise",
    browserTitle: "PerumNet Enterprise Mail",
    eyebrow: "PERUMNET ENTERPRISE",
    headline: "Mail & Collaboration",
    description: "Email bisnis yang aman, terpusat, dan siap bekerja.",
    cardTitle: "Masuk ke PerumNet Mail",
    logoUrl: "/mailcow/enterprise-logo.png",
    faviconUrl: "/mailcow/enterprise-favicon.png",
    revision: 1,
    isActive: true,
  };
  const perumnet = {
    themeKey: "perumnet",
    browserTitle: "PerumNet Mail",
    eyebrow: "PERUMNET MAIL",
    headline: "Email perusahaan untuk komunikasi kerja.",
    description: "Masuk untuk membuka email, kalender, dan kontak kerja PerumNet.",
    cardTitle: "Masuk ke akun email",
    logoUrl: "/mailcow/perumnet-logo.png",
    faviconUrl: "/mailcow/perumnet-favicon.png",
    revision: 1,
    isActive: false,
  };

  await client.batch([
    statement(
      `INSERT INTO cms_mail_login_configs
        (theme_key,browser_title,eyebrow,headline,description,card_title,
         logo_url,favicon_url,revision,is_active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (theme_key) DO NOTHING`,
      [enterprise.themeKey, enterprise.browserTitle, enterprise.eyebrow,
        enterprise.headline, enterprise.description, enterprise.cardTitle,
        enterprise.logoUrl, enterprise.faviconUrl, enterprise.revision, 1,
        timestamp, timestamp],
    ),
    statement(
      `INSERT INTO cms_mail_login_configs
        (theme_key,browser_title,eyebrow,headline,description,card_title,
         logo_url,favicon_url,revision,is_active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (theme_key) DO NOTHING`,
      [perumnet.themeKey, perumnet.browserTitle, perumnet.eyebrow,
        perumnet.headline, perumnet.description, perumnet.cardTitle,
        perumnet.logoUrl, perumnet.faviconUrl, perumnet.revision, 0,
        timestamp, timestamp],
    ),
  ], "write");

  const existingVersion = await client.execute(
    "SELECT id FROM cms_mail_login_versions LIMIT 1",
  );
  if (existingVersion.rows.length) return;
  const snapshot = JSON.stringify({
    activeTheme: "enterprise",
    themes: { enterprise, perumnet },
  });
  const contentHash = createHash("sha256").update(snapshot).digest("hex");
  const deploymentMode = process.env.APP_MODE === "demo"
    || process.env.MAIL_BRANDING_MODE === "capture"
    || process.env.NODE_ENV !== "production"
    ? "capture"
    : "ssh";
  await client.execute({
    sql: `INSERT INTO cms_mail_login_versions
      (id,active_theme,snapshot_json,content_hash,deployment_mode,status,
       error_message,created_by,created_at,deployed_at)
      VALUES (?,?,?,?,?,'Deployed',NULL,NULL,?,?)`,
    args: ["cms-mail-login-initial", "enterprise", snapshot, contentHash,
      deploymentMode, timestamp, timestamp],
  });
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

// Creating a quotation, invoice, validation or BAST now requires an Active
// commercial package. Packages created before that rule were stamped 'Draft' by
// the old column default — a state nothing can leave, because the status
// control did not exist yet and the transition table has no route back into
// Draft. Left alone they would silently refuse every new document. Promote them
// once; on every later boot the WHERE clause matches nothing, since no writer
// can produce a Draft package again (every INSERT names its status, and the
// request schema defaults to Active).
async function ensureCommercialPackageActiveDefault(client: DatabaseClient) {
  await client.execute(
    "UPDATE project_commercial_packages SET status='Active' WHERE status='Draft'",
  );
  // PostgreSQL still carries the stale 'Draft' default on the live column.
  // Nothing reads it — every insert is explicit — but a wrong default is a trap
  // for the next writer, and correcting it is one cheap statement. SQLite keeps
  // defaults inside the CREATE TABLE text and would need a full table rebuild
  // to change one, which is not worth it for a value no code path reaches.
  try {
    await client.execute(
      "ALTER TABLE project_commercial_packages ALTER COLUMN status SET DEFAULT 'Active'",
    );
  } catch {
    // SQLite, which cannot alter a column default in place.
  }
}

// The BAST void endpoint writes status='Void', but the original table declared
// CHECK (status IN ('Draft','Final')) — every revocation failed with a raw
// constraint error surfaced as a 500. Fresh databases now declare 'Void' in the
// schema; databases created before this fix are relaxed here. Idempotent: it
// inspects the live constraint first and does nothing once 'Void' is allowed.
async function ensureBastVoidStatus(client: DatabaseClient) {
  let tableSql: string | null = null;
  let sqlite = true;
  try {
    const result = await client.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='basts' LIMIT 1",
    );
    tableSql = result.rows[0]?.sql ? String(result.rows[0].sql) : null;
  } catch {
    sqlite = false;
  }
  if (!sqlite) {
    // PostgreSQL names the inline CHECK `basts_status_check`, so it can be
    // replaced in place. Dropping and re-adding in ONE statement keeps the
    // migration both re-runnable and atomic: a failure can never leave the
    // column with no constraint at all.
    try {
      await client.execute(
        `ALTER TABLE basts
          DROP CONSTRAINT IF EXISTS basts_status_check,
          ADD CONSTRAINT basts_status_check CHECK (status IN ('Draft', 'Final', 'Void'))`,
      );
    } catch {
      // Another dialect, or the constraint was never declared — nothing to relax.
    }
    return;
  }
  if (!tableSql) return;
  const checkPattern = /CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i;
  const declaredCheck = tableSql.match(checkPattern);
  if (!declaredCheck || /'Void'/i.test(declaredCheck[0])) return;
  // SQLite cannot alter a CHECK constraint, so rebuild the table from its own
  // stored DDL. Deriving the new DDL from sqlite_master (instead of restating
  // it here) preserves every column and default added by later migrations.
  const indexes = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='basts' AND sql IS NOT NULL",
  );
  const rebuiltSql = tableSql.replace(
    checkPattern,
    "CHECK (status IN ('Draft', 'Final', 'Void'))",
  );
  await client.execute("DROP TABLE IF EXISTS basts_status_migration");
  await client.execute("ALTER TABLE basts RENAME TO basts_status_migration");
  await client.execute(rebuiltSql);
  await client.execute("INSERT INTO basts SELECT * FROM basts_status_migration");
  // Dropping the old table also drops the indexes that travelled with it.
  await client.execute("DROP TABLE basts_status_migration");
  for (const row of indexes.rows) {
    await client.execute(String(row.sql));
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

function legacyVendorType(category: unknown) {
  return String(category ?? "").toLowerCase().includes("supplier")
    ? "Supplier"
    : "Jasa";
}

async function ensureProcurementSchema(client: DatabaseClient) {
  const columns: Array<[string, string, string]> = [
    ["vendors", "vendor_type", "TEXT NOT NULL DEFAULT 'Jasa'"],
    ["boq_items", "scope_id", "TEXT REFERENCES boq_scopes(id) ON DELETE RESTRICT"],
    ["quotations", "scope_id", "TEXT REFERENCES boq_scopes(id) ON DELETE RESTRICT"],
    ["quotations", "accepted_at", "TEXT"],
    ["quotations", "acceptance_attachment_name", "TEXT"],
    ["quotations", "acceptance_attachment_mime_type", "TEXT"],
    ["quotations", "acceptance_attachment_content_base64", "TEXT"],
    ["spks", "document_type", "TEXT NOT NULL DEFAULT 'SPK'"],
    ["spks", "workflow_status", "TEXT NOT NULL DEFAULT 'Draft'"],
    ["spks", "approval_status", "TEXT NOT NULL DEFAULT 'Draft'"],
    ["spks", "quotation_id", "TEXT REFERENCES quotations(id) ON DELETE RESTRICT"],
    ["spks", "created_by", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
    ["spks", "submitted_by", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
    ["spks", "submitted_at", "TEXT"],
    ["spks", "approved_by", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
    ["spks", "approved_at", "TEXT"],
    ["spks", "override_reason", "TEXT"],
    ["spks", "legacy_imported", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [table, column, definition] of columns) {
    await ensureColumn(client, table, column, definition);
  }

  await client.execute("DROP INDEX IF EXISTS quotations_project_unique");
  await client.execute(
    "CREATE INDEX IF NOT EXISTS boq_items_scope_idx ON boq_items(scope_id,sort_order)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS spks_quotation_idx ON spks(quotation_id)",
  );

  const timestamp = new Date().toISOString();
  const vendorCategories = await client.execute(
    "SELECT DISTINCT category FROM vendors WHERE trim(category)<>'' ORDER BY category",
  );
  for (const row of vendorCategories.rows) {
    const name = String(row.category);
    const existing = await client.execute({
      sql: "SELECT id,vendor_type FROM vendor_categories WHERE name=? LIMIT 1",
      args: [name],
    });
    const categoryId = existing.rows[0]
      ? String(existing.rows[0].id)
      : `vendor-category-${randomUUID()}`;
    const type = legacyVendorType(name);
    if (!existing.rows[0]) {
      await client.execute({
        sql: `INSERT INTO vendor_categories
          (id,name,name_en,vendor_type,status,sort_order,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          categoryId,
          name,
          name,
          type,
          "Aktif",
          vendorCategories.rows.indexOf(row),
          timestamp,
          timestamp,
        ],
      });
    }
    await client.batch(
      [
        {
          sql: "UPDATE vendors SET vendor_type=? WHERE category=? AND (vendor_type IS NULL OR vendor_type='Jasa')",
          args: [type, name],
        },
        {
          sql: `INSERT INTO vendor_category_assignments (vendor_id,category_id,created_at)
            SELECT id,?,? FROM vendors WHERE category=?
            ON CONFLICT DO NOTHING`,
          args: [categoryId, timestamp, name],
        },
      ],
      "write",
    );
  }

  const boqs = await client.execute(
    "SELECT id,project_id,created_at FROM boqs ORDER BY created_at",
  );
  for (const boq of boqs.rows) {
    const existingScope = await client.execute({
      sql: "SELECT id FROM boq_scopes WHERE boq_id=? AND sequence=0 LIMIT 1",
      args: [boq.id],
    });
    const scopeId = existingScope.rows[0]
      ? String(existingScope.rows[0].id)
      : `boq-scope-${randomUUID()}`;
    if (!existingScope.rows[0]) {
      const quotation = await client.execute({
        sql: `SELECT id,status,accepted_at,acceptance_attachment_name,created_at
          FROM quotations WHERE project_id=? ORDER BY created_at LIMIT 1`,
        args: [boq.project_id],
      });
      const storedStatus = String(quotation.rows[0]?.status ?? "");
      const acceptedHasProof =
        Boolean(quotation.rows[0]?.accepted_at) &&
        Boolean(String(quotation.rows[0]?.acceptance_attachment_name ?? "").trim());
      const legacyStatus =
        storedStatus === "Accepted" && !acceptedHasProof
          ? "Sent"
          : ["Draft", "Sent", "Accepted", "Rejected", "Void"].includes(storedStatus)
            ? storedStatus
            : "Draft";
      await client.execute({
        sql: `INSERT INTO boq_scopes
          (id,boq_id,kind,sequence,title,status,accepted_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          scopeId,
          boq.id,
          "Original",
          0,
          "BoQ Original",
          legacyStatus,
          quotation.rows[0]?.accepted_at ?? null,
          boq.created_at ?? timestamp,
          timestamp,
        ],
      });
    }
    await client.batch(
      [
        {
          sql: "UPDATE boq_items SET scope_id=? WHERE boq_id=? AND scope_id IS NULL",
          args: [scopeId, boq.id],
        },
        {
          sql: "UPDATE quotations SET scope_id=? WHERE project_id=? AND scope_id IS NULL",
          args: [scopeId, boq.project_id],
        },
        {
          sql: `UPDATE quotations SET status='Sent',accepted_at=NULL,updated_at=?
            WHERE scope_id=? AND status='Accepted'
              AND (accepted_at IS NULL OR acceptance_attachment_name IS NULL
                OR trim(acceptance_attachment_name)='')`,
          args: [timestamp, scopeId],
        },
        {
          sql: `UPDATE boq_scopes SET status='Sent',accepted_at=NULL,updated_at=?
            WHERE id=? AND EXISTS (
              SELECT 1 FROM quotations q WHERE q.scope_id=boq_scopes.id
                AND q.status='Sent'
                AND (q.accepted_at IS NULL OR q.acceptance_attachment_name IS NULL
                  OR trim(q.acceptance_attachment_name)='')
            )`,
          args: [timestamp, scopeId],
        },
      ],
      "write",
    );
  }

  const legacySpks = await client.execute(`
    SELECT s.*,t.id AS transaction_id,t.date AS transaction_date,t.amount AS transaction_amount
    FROM spks s
    LEFT JOIN transactions t ON t.source='SPK' AND t.reference_id=s.id
    WHERE NOT EXISTS (SELECT 1 FROM spk_items i WHERE i.spk_id=s.id)
  `);
  for (const spk of legacySpks.rows) {
    const itemId = `spk-item-${randomUUID()}`;
    const termId = `spk-term-${randomUUID()}`;
    const workflowStatus =
      String(spk.status) === "Draft"
        ? "Draft"
        : String(spk.status) === "Selesai"
          ? "Selesai"
          : String(spk.status);
    await client.batch(
      [
        {
          sql: `UPDATE spks SET document_type='SPK',workflow_status=?,
            approval_status=?,legacy_imported=1,updated_at=? WHERE id=?`,
          args: [
            workflowStatus,
            String(spk.status) === "Draft" ? "Draft" : "Approved",
            timestamp,
            spk.id,
          ],
        },
        {
          sql: `INSERT INTO spk_items
            (id,spk_id,description_snapshot,category_snapshot,quantity,unit,
             budget_unit_cost,agreed_unit_cost,line_total,sort_order,legacy_item,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            itemId,
            spk.id,
            spk.scope,
            "Legacy",
            1,
            "paket",
            spk.cost,
            spk.cost,
            spk.cost,
            0,
            1,
            spk.created_at ?? timestamp,
            timestamp,
          ],
        },
        {
          sql: `INSERT INTO spk_payment_terms
            (id,spk_id,label,term_type,planned_amount,requires_verification,sort_order,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [
            termId,
            spk.id,
            "Termin legacy",
            "Custom",
            spk.cost,
            0,
            0,
            spk.payment_status === "Dibayar" ? "Paid" : "Pending",
            spk.created_at ?? timestamp,
            timestamp,
          ],
        },
      ],
      "write",
    );
    if (spk.transaction_id) {
      await client.execute({
        sql: `INSERT INTO spk_payments
          (id,spk_id,term_id,amount,paid_date,vendor_invoice_number,payment_reference,
           payment_method,attachment_name,attachment_mime_type,attachment_content_base64,
           status,transaction_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT DO NOTHING`,
        args: [
          `spk-payment-${randomUUID()}`,
          spk.id,
          termId,
          spk.transaction_amount ?? spk.cost,
          spk.transaction_date ?? spk.paid_date ?? timestamp.slice(0, 10),
          "LEGACY",
          `LEGACY-${String(spk.number)}`,
          "Legacy",
          "Migrasi pembayaran lama",
          "text/plain",
          "bGVnYWN5",
          "Posted",
          spk.transaction_id,
          spk.created_at ?? timestamp,
          timestamp,
        ],
      });
    }
  }
}

// Step two of the pattern in server/db/README.md for the reconciliation memory
// added with the exclude/restore fix: excluding a mutasi has to remember which
// transaction it was booked against, otherwise restoring it invents a second
// `Bank:` transaction next to the one that already recorded the same cash.
async function ensureBankReconciliationSchema(client: DatabaseClient) {
  await ensureColumn(
    client,
    "bank_statement_entries",
    "excluded_transaction_id",
    "TEXT",
  );
}

// Manual transaction CRUD used to be gated by a denylist of source prefixes, so
// every new system source was tamperable until somebody remembered to add it.
// `origin` inverts that into an allowlist: only rows a human typed in are
// editable. The classification of pre-existing rows runs exactly once, right
// after the column is created — never again, so a row can not be silently
// re-classified later by a source string that happens not to match.
async function ensureTransactionOriginColumn(client: DatabaseClient) {
  try {
    await client.execute("SELECT origin FROM transactions LIMIT 1");
    return;
  } catch {
    // The column does not exist yet.
  }
  try {
    await client.execute(
      "ALTER TABLE transactions ADD COLUMN origin TEXT NOT NULL DEFAULT 'system'",
    );
  } catch {
    await client.execute("SELECT origin FROM transactions LIMIT 1");
    return;
  }
  await client.execute(`
    UPDATE transactions SET origin='manual'
    WHERE NOT (
      source IN ('Invoice','SPK')
      OR source LIKE 'Bank:%'
      OR source LIKE 'Profit Share%'
      OR source LIKE 'Procurement %'
      OR source LIKE 'Invoice Payment%'
      OR source LIKE 'Tax Settlement%'
      OR source LIKE 'Project Expense%'
      OR source LIKE 'Project Advance%'
      OR category='Bagi Hasil'
    )
  `);
}

async function ensureTaxAndEmailSchema(client: DatabaseClient) {
  const timestamp = new Date().toISOString();

  await ensureColumn(
    client,
    "email_deliveries",
    "sender_profile",
    "TEXT NOT NULL DEFAULT 'operational'",
  );
  await ensureColumn(
    client,
    "email_outbox",
    "sender_profile",
    "TEXT NOT NULL DEFAULT 'operational'",
  );

  await ensureColumn(
    client,
    "spk_payments",
    "gross_amount",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    client,
    "spk_payments",
    "withholding_amount",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await client.execute(
    "UPDATE spk_payments SET gross_amount=amount WHERE gross_amount=0",
  );

  await client.execute({
    sql: `INSERT INTO tax_settings (id,enabled,updated_at)
      VALUES ('global',0,?)
      ON CONFLICT (id) DO NOTHING`,
    args: [timestamp],
  });

  const presets: Array<
    [string, string, string, string, string, string, string, number]
  > = [
    [
      "tax-rule-ppn",
      "PPN",
      "Pajak Pertambahan Nilai",
      "Value Added Tax",
      "Client",
      "Add",
      "Payable",
      10,
    ],
    [
      "tax-rule-pph21",
      "PPH21",
      "PPh Pasal 21",
      "Article 21 Income Tax",
      "Vendor",
      "Withhold",
      "Payable",
      20,
    ],
    [
      "tax-rule-pph23",
      "PPH23",
      "PPh Pasal 23",
      "Article 23 Income Tax",
      "Vendor",
      "Withhold",
      "Payable",
      30,
    ],
    [
      "tax-rule-pph4-2",
      "PPH4-2",
      "PPh Pasal 4 ayat (2)",
      "Article 4(2) Final Income Tax",
      "Vendor",
      "Withhold",
      "Payable",
      40,
    ],
    [
      "tax-rule-other",
      "OTHER",
      "Pajak Lainnya",
      "Other Tax",
      "Both",
      "Add",
      "Expense",
      90,
    ],
  ];
  for (const [
    id,
    code,
    name,
    nameEn,
    scope,
    effect,
    treatment,
    sortOrder,
  ] of presets) {
    await client.execute({
      sql: `INSERT INTO tax_rules
        (id,code,name,name_en,scope,effect,rate_bps,accounting_treatment,
         status,sort_order,created_at,updated_at)
        VALUES (?,?,?,?,?,?,0,?,'Inactive',?,?,?)
        ON CONFLICT (code) DO NOTHING`,
      args: [
        id,
        code,
        name,
        nameEn,
        scope,
        effect,
        treatment,
        sortOrder,
        timestamp,
        timestamp,
      ],
    });
  }

  const legacyPaidInvoices = await client.execute(`
    SELECT i.*,
      (SELECT t.id FROM transactions t
       WHERE t.source='Invoice' AND t.reference_id=i.id
       ORDER BY t.created_at LIMIT 1) AS transaction_id
    FROM invoices i
    WHERE i.status='Lunas'
      AND NOT EXISTS (
        SELECT 1 FROM invoice_payments p
        WHERE p.invoice_id=i.id AND p.status='Posted'
      )
  `);
  for (const invoice of legacyPaidInvoices.rows) {
    const paymentId = `invoice-payment-${randomUUID()}`;
    await client.execute({
      sql: `INSERT INTO invoice_payments
        (id,invoice_id,gross_amount,cash_amount,withholding_amount,paid_date,
         payment_reference,payment_method,status,transaction_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT DO NOTHING`,
      args: [
        paymentId,
        invoice.id,
        invoice.amount,
        invoice.amount,
        0,
        invoice.paid_date ?? invoice.issue_date,
        `LEGACY-${String(invoice.number)}`,
        "Legacy",
        "Posted",
        invoice.transaction_id ?? null,
        invoice.created_at ?? timestamp,
        timestamp,
      ],
    });
  }
}

async function ensureProjectExpenseSchema(client: DatabaseClient) {
  const timestamp = new Date().toISOString();
  await ensureColumn(
    client,
    "quotations",
    "tax_enabled",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    client,
    "quotations",
    "tax_revision",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await client.execute(`
    UPDATE quotations
    SET tax_enabled=1
    WHERE EXISTS (
      SELECT 1 FROM document_taxes dt
      WHERE dt.document_type='Quotation' AND dt.document_id=quotations.id
    )
  `);
  const expenseColumns: Array<[string, string, string]> = [
    ["project_expenses", "payment_method", "TEXT NOT NULL DEFAULT 'Tunai'"],
    ["project_expenses", "bank_account_id", "TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL"],
    ["project_expenses", "paid_by_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL"],
  ];
  for (const [table, column, definition] of expenseColumns) {
    await ensureColumn(client, table, column, definition);
  }
  const categories = [
    ["expense-category-material", "Material", "Material", 10],
    ["expense-category-device", "Perangkat", "Equipment", 20],
    ["expense-category-transport", "Transportasi", "Transportation", 30],
    ["expense-category-meal", "Konsumsi", "Meals", 40],
    ["expense-category-accommodation", "Akomodasi", "Accommodation", 50],
    ["expense-category-field-service", "Jasa Lapangan", "Field Services", 60],
    ["expense-category-other", "Operasional Lain", "Other Operations", 70],
  ] as const;
  for (const [id, name, nameEn, sortOrder] of categories) {
    await client.execute({
      sql: `INSERT INTO project_expense_categories
        (id,name,name_en,status,sort_order,created_at,updated_at)
        VALUES (?,?,?,'Aktif',?,?,?) ON CONFLICT (id) DO NOTHING`,
      args: [id, name, nameEn, sortOrder, timestamp, timestamp],
    });
  }
}

async function ensureItemCatalogSchema(client: DatabaseClient) {
  const columns: Array<[string, string, string]> = [
    ["boq_items", "catalog_item_id", "TEXT REFERENCES item_catalog_items(id) ON DELETE RESTRICT"],
    ["boq_items", "catalog_price_tier", "INTEGER"],
    ["boq_items", "catalog_revision", "INTEGER"],
    ["boq_items", "manual_price_override", "INTEGER NOT NULL DEFAULT 0"],
    ["boq_items", "price_override_reason", "TEXT"],
    ["boq_template_items", "catalog_item_id", "TEXT REFERENCES item_catalog_items(id) ON DELETE RESTRICT"],
    ["boq_template_items", "catalog_price_tier", "INTEGER"],
    ["boq_template_items", "catalog_revision", "INTEGER"],
    ["boq_template_items", "manual_price_override", "INTEGER NOT NULL DEFAULT 0"],
    ["boq_template_items", "price_override_reason", "TEXT"],
    ["standalone_boq_items", "catalog_item_id", "TEXT REFERENCES item_catalog_items(id) ON DELETE RESTRICT"],
    ["standalone_boq_items", "catalog_price_tier", "INTEGER"],
    ["standalone_boq_items", "catalog_revision", "INTEGER"],
    ["standalone_boq_items", "manual_price_override", "INTEGER NOT NULL DEFAULT 0"],
    ["standalone_boq_items", "price_override_reason", "TEXT"],
  ];
  for (const [table, column, definition] of columns) {
    await ensureColumn(client, table, column, definition);
  }
  await client.execute(
    "CREATE INDEX IF NOT EXISTS boq_items_catalog_idx ON boq_items(catalog_item_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS boq_template_items_catalog_idx ON boq_template_items(catalog_item_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS standalone_boq_items_catalog_idx ON standalone_boq_items(catalog_item_id)",
  );

  const timestamp = new Date().toISOString();
  const categories = [
    ["catalog-category-networking", "Perangkat", "Networking", "Networking", 10],
    ["catalog-category-cctv", "Perangkat", "CCTV", "CCTV", 20],
    ["catalog-category-ip-pabx", "Perangkat", "IP PABX", "IP PABX", 30],
    ["catalog-category-smart-home", "Perangkat", "Smart Home Device", "Smart Home Device", 40],
    ["catalog-category-lan", "Material", "Kabel LAN", "LAN Cabling", 110],
    ["catalog-category-fiber", "Material", "Fiber Optic", "Fiber Optic", 120],
    ["catalog-category-connector", "Material", "Konektor & Terminasi", "Connectors & Termination", 130],
    ["catalog-category-rack-power", "Material", "Rack & Power", "Rack & Power", 140],
    ["catalog-category-accessory", "Material", "Mounting & Aksesori", "Mounting & Accessories", 150],
    ["catalog-category-installation", "Jasa", "Instalasi", "Installation", 210],
    ["catalog-category-setting", "Jasa", "Konfigurasi & Setting", "Configuration & Setup", 220],
    ["catalog-category-fiber-service", "Jasa", "Splicing & Terminasi Fiber", "Fiber Splicing & Termination", 230],
    ["catalog-category-testing", "Jasa", "Testing & Commissioning", "Testing & Commissioning", 240],
    ["catalog-category-documentation", "Jasa", "Dokumentasi", "Documentation", 250],
    ["catalog-category-mobilization", "Mobilitas", "Mobilisasi Tim", "Team Mobilization", 310],
    ["catalog-category-delivery", "Mobilitas", "Pengiriman Perangkat", "Equipment Delivery", 320],
    ["catalog-category-accommodation", "Mobilitas", "Akomodasi Lapangan", "Field Accommodation", 330],
  ] as const;
  for (const [id, role, name, nameEn, sortOrder] of categories) {
    await client.execute({
      sql: `INSERT INTO item_catalog_categories
        (id,boq_role,name,name_en,default_margin_1_bps,default_margin_2_bps,
         status,sort_order,created_at,updated_at)
        VALUES (?,?,?,?,2000,3000,'Aktif',?,?,?) ON CONFLICT (id) DO NOTHING`,
      args: [id, role, name, nameEn, sortOrder, timestamp, timestamp],
    });
  }
}

// Step two of the pattern in server/db/README.md for the project map.
//
// `coordinate_source` is what keeps a hand-placed pin alive: 'manual' means a
// person dropped it and no geocoder may touch it again, 'geocoded' means the
// guess is disposable, NULL means the project has never had coordinates. The
// two `geocoded_*` columns record what was asked and what came back, so a pin
// that landed in the wrong village can be diagnosed without re-running
// anything — and `geocoded_query` doubles as the "we already tried this exact
// text" marker that stops a repeated save from re-querying Nominatim.
//
// The range CHECKs are the same ones declared in `schemaSql`; both dialects
// accept a column CHECK in ADD COLUMN, and every existing row is NULL, which
// no CHECK rejects.
async function ensureProjectCoordinateSchema(client: DatabaseClient) {
  const columns: Array<[string, string, string]> = [
    ["projects", "latitude", "DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90)"],
    ["projects", "longitude", "DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180)"],
    ["projects", "coordinate_source", "TEXT"],
    ["projects", "geocoded_query", "TEXT"],
    ["projects", "geocoded_label", "TEXT"],
  ];
  for (const [table, column, definition] of columns) {
    await ensureColumn(client, table, column, definition);
  }
}

async function ensurePortfolioGalleryLimit(client: DatabaseClient) {
  if (client.dialect === "postgres") {
    const constraints = await client.execute(`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'cms_portfolio_media'::regclass AND contype = 'c'`);
    if (constraints.rows.some((row) => /sort_order\s*(?:BETWEEN\s+0\s+AND\s+19|>=\s+0[\s\S]*sort_order\s*<=\s+19)/i.test(String(row.definition)))) return;
    await client.execute(`ALTER TABLE cms_portfolio_media
      DROP CONSTRAINT IF EXISTS cms_portfolio_media_sort_order_check,
      ADD CONSTRAINT cms_portfolio_media_sort_order_check CHECK (sort_order BETWEEN 0 AND 19)`);
    return;
  }

  const table = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='cms_portfolio_media' LIMIT 1",
  );
  const tableSql = table.rows[0]?.sql ? String(table.rows[0].sql) : null;
  if (!tableSql || /sort_order\s+BETWEEN\s+0\s+AND\s+19/i.test(tableSql)) return;
  const checkPattern = /CHECK\s*\(\s*sort_order\s+BETWEEN\s+0\s+AND\s+9\s*\)/i;
  if (!checkPattern.test(tableSql)) return;
  const indexes = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='cms_portfolio_media' AND sql IS NOT NULL",
  );
  const rebuiltSql = tableSql.replace(checkPattern, "CHECK (sort_order BETWEEN 0 AND 19)");
  await client.execute("DROP TABLE IF EXISTS cms_portfolio_media_limit_migration");
  await client.execute("ALTER TABLE cms_portfolio_media RENAME TO cms_portfolio_media_limit_migration");
  await client.execute(rebuiltSql);
  await client.execute("INSERT INTO cms_portfolio_media SELECT * FROM cms_portfolio_media_limit_migration");
  await client.execute("DROP TABLE cms_portfolio_media_limit_migration");
  for (const row of indexes.rows) await client.execute(String(row.sql));
}

export async function initializeDatabase(client: DatabaseClient) {
  await client.executeMultiple(schemaSql);
  await ensureCmsBilingualSchema(client);
  await ensureBastEngineerRoleColumn(client);
  await ensureTransactionCategoryColumn(client);
  await ensureSpkPaymentColumns(client);
  await ensureProcurementSchema(client);
  await ensureCommercialPackageSchema(client);
  await ensureCommercialPackageActiveDefault(client);
  await ensureBastVoidStatus(client);
  await ensureBankReconciliationSchema(client);
  await ensureTransactionOriginColumn(client);
  await ensureProjectCoordinateSchema(client);
  await ensurePortfolioGalleryLimit(client);
  await ensureDocumentCounters(client);
  await ensureAuthHardeningSchema(client);
  await ensureTaxAndEmailSchema(client);
  await ensureProjectExpenseSchema(client);
  await ensureItemCatalogSchema(client);
  await ensureCmsSeed(client);
  await ensureCmsEnhancements(client);
  await ensureCmsLandingFeatures(client);
  await ensureCmsMailLoginSeed(client);

  const existing = await client.execute("SELECT id FROM users LIMIT 1");
  if (existing.rows.length) return;

  // The runtime reading, not the compile-time literal. This flag decides
  // whether a first boot may fall back to the well-known "perumnet123" seed
  // password and whether SEED_ADMIN_PASSWORD has to be twelve characters — both
  // of which quietly relaxed inside a `NODE_ENV=production next dev` process.
  // See server/runtime-env.ts.
  const production = isProductionRuntime();
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

  // Demo cash movements. They exist so a development or demo install has a
  // populated Keuangan page; a production install must never open its books
  // with roughly Rp 200 juta of fictitious movements, so they are gated on the
  // same condition that deactivates the demo user accounts.
  const transactionRows = production
    ? []
    : [
        ["trx-1", "project-1", "2026-07-18", "Pengeluaran", "Pembelian access point tahap 2", 29400000, "Material", "manual"],
        ["trx-2", "project-2", "2026-07-15", "Pemasukan", "Pembayaran invoice DP 30%", 29040000, "Invoice", "system"],
        ["trx-3", "project-1", "2026-07-10", "Pemasukan", "Pembayaran invoice DP 50%", 93725000, "Invoice", "system"],
        ["trx-4", "project-1", "2026-07-09", "Pengeluaran", "Termin awal teknisi jaringan", 6250000, "SPK", "system"],
        ["trx-5", "project-2", "2026-07-04", "Pengeluaran", "Pembelian kamera dan NVR", 41750000, "Material", "manual"],
      ];
  for (const row of transactionRows) {
    statements.push(statement(
      "INSERT INTO transactions (id,project_id,date,type,description,amount,source,origin,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [...row, "user-1", now, now],
    ));
  }

  await client.batch(statements, "write");
  // Fresh installations seed legacy-compatible rows above. Run the same
  // idempotent migration once more so those rows immediately receive their
  // Original scope, vendor classification, procurement lines, and payments.
  await ensureProcurementSchema(client);
  await ensureCommercialPackageSchema(client);
  await ensureDocumentCounters(client);
  await ensureTaxAndEmailSchema(client);
  await ensureProjectExpenseSchema(client);
  await ensureItemCatalogSchema(client);
}
