import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("Aktif"),
    lastActiveAt: text("last_active_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_token_hash_unique").on(table.tokenHash),
    index("password_reset_user_idx").on(table.userId),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    client: text("client").notNull(),
    location: text("location").notNull(),
    status: text("status").notNull().default("Draft"),
    startDate: text("start_date"),
    targetDate: text("target_date"),
    value: integer("value").notNull().default(0),
    managerId: text("manager_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("projects_code_unique").on(table.code),
    index("projects_status_idx").on(table.status),
  ],
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_members_unique").on(table.projectId, table.userId),
    index("project_members_user_idx").on(table.userId),
  ],
);

export const projectTasks = sqliteTable(
  "project_tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    ownerName: text("owner_name").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    status: text("status").notNull().default("Belum Mulai"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("project_tasks_project_idx").on(table.projectId)],
);

export const projectDocuments = sqliteTable(
  "project_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageUrl: text("storage_url"),
    contentBase64: text("content_base64"),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploaderName: text("uploader_name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("project_documents_project_idx").on(table.projectId)],
);

export const boqs = sqliteTable(
  "boqs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("Draft"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [uniqueIndex("boqs_project_unique").on(table.projectId)],
);

export const boqItems = sqliteTable(
  "boq_items",
  {
    id: text("id").primaryKey(),
    boqId: text("boq_id")
      .notNull()
      .references(() => boqs.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    costPrice: integer("cost_price").notNull().default(0),
    sellingPrice: integer("selling_price").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("boq_items_boq_idx").on(table.boqId)],
);

export const boqTemplates = sqliteTable("boq_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const boqTemplateItems = sqliteTable(
  "boq_template_items",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => boqTemplates.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    costPrice: integer("cost_price").notNull().default(0),
    sellingPrice: integer("selling_price").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("boq_template_items_template_idx").on(table.templateId)],
);

export const quotations = sqliteTable(
  "quotations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    status: text("status").notNull().default("Draft"),
    issuedAt: text("issued_at").notNull(),
    validUntil: text("valid_until"),
    total: integer("total").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("quotations_number_unique").on(table.number)],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    type: text("type").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("Belum Lunas"),
    paidDate: text("paid_date"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("invoices_number_unique").on(table.number),
    index("invoices_project_idx").on(table.projectId),
  ],
);

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  contact: text("contact").notNull(),
  email: text("email"),
  address: text("address"),
  rate: integer("rate").notNull().default(0),
  status: text("status").notNull().default("Aktif"),
  ...timestamps,
});

export const spks = sqliteTable(
  "spks",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    cost: integer("cost").notNull(),
    status: text("status").notNull().default("Draft"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("spks_number_unique").on(table.number),
    index("spks_project_idx").on(table.projectId),
  ],
);

export const basts = sqliteTable(
  "basts",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    completionDate: text("completion_date").notNull(),
    notes: text("notes").notNull(),
    installedItemsJson: text("installed_items_json").notNull(),
    clientName: text("client_name").notNull(),
    clientRole: text("client_role").notNull(),
    clientSignature: text("client_signature"),
    engineerName: text("engineer_name").notNull(),
    engineerSignature: text("engineer_signature"),
    status: text("status").notNull().default("Draft"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("basts_number_unique").on(table.number),
    index("basts_project_idx").on(table.projectId),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    source: text("source").notNull(),
    referenceId: text("reference_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("transactions_project_idx").on(table.projectId),
    index("transactions_date_idx").on(table.date),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    metadataJson: text("metadata_json"),
    ipAddress: text("ip_address"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(table.entity, table.entityId),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);
