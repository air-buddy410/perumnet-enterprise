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

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  phone: text("phone"),
  jobTitle: text("job_title"),
  bio: text("bio"),
  address: text("address"),
  birthDate: text("birth_date"),
  avatarMimeType: text("avatar_mime_type"),
  avatarStorageUrl: text("avatar_storage_url"),
  avatarContentBase64: text("avatar_content_base64"),
  preferredLanguage: text("preferred_language").notNull().default("id"),
  emailNotifications: integer("email_notifications").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull(),
    providerId: text("provider_id"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("email_deliveries_user_idx").on(table.userId, table.createdAt),
    index("email_deliveries_status_idx").on(table.status, table.createdAt),
  ],
);

export const userPermissions = sqliteTable("user_permissions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  permissionsJson: text("permissions_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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

export const standaloneBoqs = sqliteTable(
  "standalone_boqs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    client: text("client"),
    status: text("status").notNull().default("Draft"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("standalone_boqs_created_by_idx").on(
      table.createdBy,
      table.createdAt,
    ),
  ],
);

export const standaloneBoqItems = sqliteTable(
  "standalone_boq_items",
  {
    id: text("id").primaryKey(),
    standaloneBoqId: text("standalone_boq_id")
      .notNull()
      .references(() => standaloneBoqs.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    costPrice: integer("cost_price").notNull().default(0),
    sellingPrice: integer("selling_price").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("standalone_boq_items_boq_idx").on(table.standaloneBoqId),
  ],
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
  (table) => [
    uniqueIndex("quotations_number_unique").on(table.number),
    uniqueIndex("quotations_project_unique").on(table.projectId),
  ],
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
    paymentStatus: text("payment_status").notNull().default("Belum Dibayar"),
    paidDate: text("paid_date"),
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
    engineerRole: text("engineer_role").notNull().default("Project Manager"),
    engineerSignature: text("engineer_signature"),
    status: text("status").notNull().default("Draft"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("basts_number_unique").on(table.number),
    uniqueIndex("basts_project_unique").on(table.projectId),
  ],
);

export const projectValidations = sqliteTable(
  "project_validations",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("Draft"),
    notes: text("notes"),
    validatedBy: text("validated_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_validations_number_unique").on(table.number),
    uniqueIndex("project_validations_project_unique").on(table.projectId),
  ],
);

export const projectValidationItems = sqliteTable(
  "project_validation_items",
  {
    id: text("id").primaryKey(),
    validationId: text("validation_id")
      .notNull()
      .references(() => projectValidations.id, { onDelete: "cascade" }),
    boqItemId: text("boq_item_id").references(() => boqItems.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    checked: integer("checked").notNull().default(0),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("project_validation_items_validation_idx").on(table.validationId),
    uniqueIndex("project_validation_items_boq_unique").on(table.validationId, table.boqItemId),
  ],
);

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    bankName: text("bank_name").notNull(),
    accountName: text("account_name").notNull(),
    accountNumberMasked: text("account_number_masked").notNull(),
    externalAccountId: text("external_account_id"),
    currency: text("currency").notNull().default("IDR"),
    openingBalance: integer("opening_balance").notNull().default(0),
    currentBalance: integer("current_balance").notNull().default(0),
    syncMode: text("sync_mode").notNull().default("Manual"),
    status: text("status").notNull().default("Aktif"),
    lastSyncedAt: text("last_synced_at"),
    balanceUpdatedAt: text("balance_updated_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("bank_accounts_status_idx").on(table.status, table.bankName),
  ],
);

export const bankStatementImports = sqliteTable(
  "bank_statement_imports",
  {
    id: text("id").primaryKey(),
    bankAccountId: text("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    fileHash: text("file_hash").notNull(),
    statementMonth: text("statement_month"),
    rowCount: integer("row_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    importedBy: text("imported_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("bank_statement_imports_account_idx").on(
      table.bankAccountId,
      table.createdAt,
    ),
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
    category: text("category").notNull().default("Lainnya"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("transactions_project_idx").on(table.projectId),
    index("transactions_date_idx").on(table.date),
    uniqueIndex("transactions_source_reference_unique").on(
      table.source,
      table.referenceId,
    ),
  ],
);

export const projectProfitShares = sqliteTable(
  "project_profit_shares",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    recipientName: text("recipient_name").notNull(),
    percentageBps: integer("percentage_bps").notNull(),
    amount: integer("amount").notNull().default(0),
    status: text("status").notNull().default("Draft"),
    notes: text("notes"),
    paidDate: text("paid_date"),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    paidBy: text("paid_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("project_profit_shares_project_idx").on(
      table.projectId,
      table.status,
    ),
    uniqueIndex("project_profit_shares_transaction_unique").on(
      table.transactionId,
    ),
  ],
);

export const bankStatementEntries = sqliteTable(
  "bank_statement_entries",
  {
    id: text("id").primaryKey(),
    bankAccountId: text("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    importId: text("import_id").references(() => bankStatementImports.id, {
      onDelete: "set null",
    }),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    date: text("date").notNull(),
    description: text("description").notNull(),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    runningBalance: integer("running_balance"),
    reference: text("reference"),
    fingerprint: text("fingerprint").notNull(),
    reconciliationStatus: text("reconciliation_status")
      .notNull()
      .default("Imported"),
    source: text("source").notNull(),
    rawJson: text("raw_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("bank_statement_entries_fingerprint_unique").on(
      table.bankAccountId,
      table.fingerprint,
    ),
    index("bank_statement_entries_account_date_idx").on(
      table.bankAccountId,
      table.date,
    ),
    index("bank_statement_entries_transaction_idx").on(table.transactionId),
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

export const cmsSiteTexts = sqliteTable(
  "cms_site_texts",
  {
    id: text("id").primaryKey(),
    pageKey: text("page_key").notNull(),
    contentKey: text("content_key").notNull(),
    valueContent: text("value_content").notNull(),
    valueContentEn: text("value_content_en").notNull().default(""),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("cms_site_texts_key_unique").on(table.pageKey, table.contentKey),
  ],
);

export const cmsServices = sqliteTable(
  "cms_services",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    titleEn: text("title_en").notNull().default(""),
    summary: text("summary").notNull(),
    summaryEn: text("summary_en").notNull().default(""),
    description: text("description").notNull(),
    descriptionEn: text("description_en").notNull().default(""),
    featuresJson: text("features_json").notNull().default("[]"),
    featuresJsonEn: text("features_json_en").notNull().default("[]"),
    icon: text("icon").notNull().default("wifi"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: integer("is_published").notNull().default(1),
    ...timestamps,
  },
  (table) => [uniqueIndex("cms_services_slug_unique").on(table.slug)],
);

export const cmsPortfolios = sqliteTable("cms_portfolios", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  titleEn: text("title_en").notNull().default(""),
  description: text("description").notNull(),
  descriptionEn: text("description_en").notNull().default(""),
  imageUrl: text("image_url"),
  imageStorageUrl: text("image_storage_url"),
  imageMimeType: text("image_mime_type"),
  location: text("location"),
  locationEn: text("location_en").notNull().default(""),
  completedAt: text("completed_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  isPublished: integer("is_published").notNull().default(1),
  ...timestamps,
});

export const cmsTestimonials = sqliteTable("cms_testimonials", {
  id: text("id").primaryKey(),
  clientName: text("client_name").notNull(),
  companyName: text("company_name"),
  review: text("review").notNull(),
  reviewEn: text("review_en").notNull().default(""),
  isVisible: integer("is_visible").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const cmsPages = sqliteTable(
  "cms_pages",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    titleEn: text("title_en").notNull().default(""),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    excerptEn: text("excerpt_en").notNull().default(""),
    content: text("content").notNull(),
    contentEn: text("content_en").notNull().default(""),
    isPublished: integer("is_published").notNull().default(0),
    showInNavigation: integer("show_in_navigation").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex("cms_pages_slug_unique").on(table.slug)],
);

export const cmsSiteSettings = sqliteTable(
  "cms_site_settings",
  {
    id: text("id").primaryKey(),
    keyName: text("key_name").notNull(),
    valueContent: text("value_content").notNull(),
    valueContentEn: text("value_content_en").notNull().default(""),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("cms_site_settings_key_unique").on(table.keyName)],
);

export const cmsFaqs = sqliteTable("cms_faqs", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  questionEn: text("question_en").notNull().default(""),
  answer: text("answer").notNull(),
  answerEn: text("answer_en").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  isVisible: integer("is_visible").notNull().default(1),
  ...timestamps,
});

export const cmsPartners = sqliteTable("cms_partners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  organizationType: text("organization_type").notNull().default("partner"),
  category: text("category").notNull().default(""),
  websiteUrl: text("website_url").notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),
  logoStorageUrl: text("logo_storage_url"),
  logoMimeType: text("logo_mime_type"),
  sortOrder: integer("sort_order").notNull().default(0),
  isVisible: integer("is_visible").notNull().default(1),
  ...timestamps,
});
