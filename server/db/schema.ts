import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    senderProfile: text("sender_profile").notNull().default("operational"),
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

export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    senderProfile: text("sender_profile").notNull().default("operational"),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: text("status").notNull().default("Pending"),
    provider: text("provider"),
    providerId: text("provider_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lockedAt: text("locked_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => [
    index("email_outbox_status_retry_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("email_outbox_user_idx").on(table.userId, table.createdAt),
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

export const projectCommercialPackages = sqliteTable(
  "project_commercial_packages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("Draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_commercial_packages_code_unique").on(table.projectId, table.code),
    index("project_commercial_packages_project_idx").on(table.projectId, table.sortOrder),
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

export const itemCatalogCategories = sqliteTable(
  "item_catalog_categories",
  {
    id: text("id").primaryKey(),
    boqRole: text("boq_role").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en").notNull().default(""),
    defaultMargin1Bps: integer("default_margin_1_bps").notNull().default(2000),
    defaultMargin2Bps: integer("default_margin_2_bps").notNull().default(3000),
    status: text("status").notNull().default("Aktif"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("item_catalog_categories_role_name_unique").on(table.boqRole, table.name),
    index("item_catalog_categories_sort_idx").on(table.boqRole, table.status, table.sortOrder, table.name),
  ],
);

export const itemCatalogBrands = sqliteTable(
  "item_catalog_brands",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => itemCatalogCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("Aktif"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("item_catalog_brands_category_name_unique").on(table.categoryId, table.name),
    index("item_catalog_brands_category_idx").on(table.categoryId, table.status, table.sortOrder, table.name),
  ],
);

export const itemCatalogItems = sqliteTable(
  "item_catalog_items",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => itemCatalogCategories.id, { onDelete: "restrict" }),
    brandId: text("brand_id").references(() => itemCatalogBrands.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en").notNull().default(""),
    model: text("model").notNull().default(""),
    specifications: text("specifications").notNull().default(""),
    unit: text("unit").notNull().default("unit"),
    costPrice: integer("cost_price").notNull().default(0),
    margin1Bps: integer("margin_1_bps").notNull().default(2000),
    margin2Bps: integer("margin_2_bps").notNull().default(3000),
    status: text("status").notNull().default("Aktif"),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("item_catalog_items_sku_unique").on(table.sku),
    index("item_catalog_items_filter_idx").on(table.categoryId, table.brandId, table.status, table.name),
  ],
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

export const boqScopes = sqliteTable(
  "boq_scopes",
  {
    id: text("id").primaryKey(),
    boqId: text("boq_id")
      .notNull()
      .references(() => boqs.id, { onDelete: "cascade" }),
    packageId: text("package_id").references(() => projectCommercialPackages.id, {
      onDelete: "restrict",
    }),
    parentScopeId: text("parent_scope_id"),
    kind: text("kind").notNull(),
    sequence: integer("sequence").notNull().default(0),
    title: text("title").notNull(),
    status: text("status").notNull().default("Draft"),
    acceptedAt: text("accepted_at"),
    acceptanceAttachmentName: text("acceptance_attachment_name"),
    acceptanceAttachmentMimeType: text("acceptance_attachment_mime_type"),
    acceptanceAttachmentContentBase64: text(
      "acceptance_attachment_content_base64",
    ),
    taxEnabled: integer("tax_enabled").notNull().default(0),
    taxRevision: integer("tax_revision").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("boq_scopes_boq_idx").on(table.boqId, table.sequence),
    uniqueIndex("boq_scopes_sequence_unique").on(
      table.boqId,
      table.sequence,
    ),
  ],
);

export const boqItems = sqliteTable(
  "boq_items",
  {
    id: text("id").primaryKey(),
    boqId: text("boq_id")
      .notNull()
      .references(() => boqs.id, { onDelete: "cascade" }),
    scopeId: text("scope_id").references(() => boqScopes.id, {
      onDelete: "restrict",
    }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    costPrice: integer("cost_price").notNull().default(0),
    sellingPrice: integer("selling_price").notNull(),
    catalogItemId: text("catalog_item_id").references(() => itemCatalogItems.id, { onDelete: "restrict" }),
    catalogPriceTier: integer("catalog_price_tier"),
    catalogRevision: integer("catalog_revision"),
    manualPriceOverride: integer("manual_price_override").notNull().default(0),
    priceOverrideReason: text("price_override_reason"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("boq_items_boq_idx").on(table.boqId),
    index("boq_items_scope_idx").on(table.scopeId, table.sortOrder),
  ],
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
    catalogItemId: text("catalog_item_id").references(() => itemCatalogItems.id, { onDelete: "restrict" }),
    catalogPriceTier: integer("catalog_price_tier"),
    catalogRevision: integer("catalog_revision"),
    manualPriceOverride: integer("manual_price_override").notNull().default(0),
    priceOverrideReason: text("price_override_reason"),
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
    catalogItemId: text("catalog_item_id").references(() => itemCatalogItems.id, { onDelete: "restrict" }),
    catalogPriceTier: integer("catalog_price_tier"),
    catalogRevision: integer("catalog_revision"),
    manualPriceOverride: integer("manual_price_override").notNull().default(0),
    priceOverrideReason: text("price_override_reason"),
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
    packageId: text("package_id").references(() => projectCommercialPackages.id, {
      onDelete: "restrict",
    }),
    scopeId: text("scope_id").references(() => boqScopes.id, {
      onDelete: "restrict",
    }),
    number: text("number").notNull(),
    status: text("status").notNull().default("Draft"),
    issuedAt: text("issued_at").notNull(),
    validUntil: text("valid_until"),
    total: integer("total").notNull(),
    revisionNo: integer("revision_no").notNull().default(1),
    supersedesId: text("supersedes_id"),
    discountEnabled: integer("discount_enabled").notNull().default(0),
    discountType: text("discount_type").notNull().default("Nominal"),
    discountValue: integer("discount_value").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    taxableBase: integer("taxable_base").notNull().default(0),
    taxAdditionsSnapshot: integer("tax_additions_snapshot").notNull().default(0),
    taxWithholdingsSnapshot: integer("tax_withholdings_snapshot").notNull().default(0),
    roundingMode: text("rounding_mode").notNull().default("None"),
    roundingStep: integer("rounding_step").notNull().default(0),
    roundingAdjustment: integer("rounding_adjustment").notNull().default(0),
    roundingReason: text("rounding_reason"),
    grandTotal: integer("grand_total").notNull().default(0),
    acceptedAt: text("accepted_at"),
    acceptanceAttachmentName: text("acceptance_attachment_name"),
    acceptanceAttachmentMimeType: text("acceptance_attachment_mime_type"),
    acceptanceAttachmentContentBase64: text(
      "acceptance_attachment_content_base64",
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quotations_number_unique").on(table.number),
    uniqueIndex("quotations_scope_revision_unique").on(table.scopeId, table.revisionNo),
    index("quotations_project_idx").on(table.projectId, table.createdAt),
    index("quotations_package_idx").on(table.packageId, table.createdAt),
  ],
);

export const quotationItems = sqliteTable(
  "quotation_items",
  {
    id: text("id").primaryKey(),
    quotationId: text("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id"),
    category: text("category").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    costPrice: integer("cost_price").notNull().default(0),
    sellingPrice: integer("selling_price").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("quotation_items_quotation_idx").on(table.quotationId, table.sortOrder),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageId: text("package_id").references(() => projectCommercialPackages.id, {
      onDelete: "restrict",
    }),
    quotationId: text("quotation_id").references(() => quotations.id, {
      onDelete: "restrict",
    }),
    number: text("number").notNull(),
    type: text("type").notNull(),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    amount: integer("amount").notNull(),
    calculationMode: text("calculation_mode").notNull().default("Nominal"),
    installmentBps: integer("installment_bps"),
    contractGrandTotal: integer("contract_grand_total").notNull().default(0),
    subtotalSnapshot: integer("subtotal_snapshot").notNull().default(0),
    discountSnapshot: integer("discount_snapshot").notNull().default(0),
    taxableBaseSnapshot: integer("taxable_base_snapshot").notNull().default(0),
    taxAdditionsSnapshot: integer("tax_additions_snapshot").notNull().default(0),
    taxWithholdingsSnapshot: integer("tax_withholdings_snapshot").notNull().default(0),
    roundingSnapshot: integer("rounding_snapshot").notNull().default(0),
    status: text("status").notNull().default("Belum Lunas"),
    paidDate: text("paid_date"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("invoices_number_unique").on(table.number),
    index("invoices_project_idx").on(table.projectId),
    index("invoices_quotation_idx").on(table.quotationId, table.createdAt),
  ],
);

export const vendorCategories = sqliteTable(
  "vendor_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameEn: text("name_en").notNull().default(""),
    vendorType: text("vendor_type").notNull(),
    status: text("status").notNull().default("Aktif"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("vendor_categories_name_unique").on(table.name),
    index("vendor_categories_sort_idx").on(
      table.status,
      table.sortOrder,
      table.name,
    ),
  ],
);

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  vendorType: text("vendor_type").notNull().default("Jasa"),
  contact: text("contact").notNull(),
  email: text("email"),
  address: text("address"),
  rate: integer("rate").notNull().default(0),
  status: text("status").notNull().default("Aktif"),
  ...timestamps,
});

export const vendorCategoryAssignments = sqliteTable(
  "vendor_category_assignments",
  {
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => vendorCategories.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("vendor_category_assignments_unique").on(
      table.vendorId,
      table.categoryId,
    ),
    index("vendor_category_assignments_category_idx").on(
      table.categoryId,
      table.vendorId,
    ),
  ],
);

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
    documentType: text("document_type").notNull().default("SPK"),
    workflowStatus: text("workflow_status").notNull().default("Draft"),
    approvalStatus: text("approval_status").notNull().default("Draft"),
    quotationId: text("quotation_id").references(() => quotations.id, {
      onDelete: "restrict",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedBy: text("submitted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: text("submitted_at"),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: text("approved_at"),
    overrideReason: text("override_reason"),
    legacyImported: integer("legacy_imported").notNull().default(0),
    paymentStatus: text("payment_status").notNull().default("Belum Dibayar"),
    paidDate: text("paid_date"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("spks_number_unique").on(table.number),
    index("spks_project_idx").on(table.projectId),
    index("spks_vendor_idx").on(table.vendorId, table.createdAt),
    index("spks_quotation_idx").on(table.quotationId),
  ],
);

export const spkItems = sqliteTable(
  "spk_items",
  {
    id: text("id").primaryKey(),
    spkId: text("spk_id")
      .notNull()
      .references(() => spks.id, { onDelete: "cascade" }),
    boqItemId: text("boq_item_id").references(() => boqItems.id, {
      onDelete: "restrict",
    }),
    quotationId: text("quotation_id").references(() => quotations.id, {
      onDelete: "restrict",
    }),
    descriptionSnapshot: text("description_snapshot").notNull(),
    categorySnapshot: text("category_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    budgetUnitCost: integer("budget_unit_cost").notNull().default(0),
    agreedUnitCost: integer("agreed_unit_cost").notNull().default(0),
    lineTotal: integer("line_total").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    legacyItem: integer("legacy_item").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("spk_items_spk_idx").on(table.spkId, table.sortOrder),
    index("spk_items_boq_item_idx").on(table.boqItemId),
    index("spk_items_quotation_idx").on(table.quotationId),
  ],
);

export const spkPaymentTerms = sqliteTable(
  "spk_payment_terms",
  {
    id: text("id").primaryKey(),
    spkId: text("spk_id")
      .notNull()
      .references(() => spks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    termType: text("term_type").notNull(),
    percentageBps: integer("percentage_bps"),
    plannedAmount: integer("planned_amount").notNull(),
    requiresVerification: integer("requires_verification").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("Pending"),
    ...timestamps,
  },
  (table) => [
    index("spk_payment_terms_spk_idx").on(table.spkId, table.sortOrder),
  ],
);

export const spkVerifications = sqliteTable(
  "spk_verifications",
  {
    id: text("id").primaryKey(),
    spkId: text("spk_id")
      .notNull()
      .references(() => spks.id, { onDelete: "cascade" }),
    termId: text("term_id").references(() => spkPaymentTerms.id, {
      onDelete: "set null",
    }),
    verifiedAmount: integer("verified_amount").notNull(),
    progressPercentage: integer("progress_percentage"),
    notes: text("notes"),
    attachmentName: text("attachment_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentContentBase64: text("attachment_content_base64"),
    verifiedBy: text("verified_by").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: text("verified_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("spk_verifications_spk_idx").on(table.spkId, table.verifiedAt),
    index("spk_verifications_term_idx").on(table.termId),
  ],
);

export const poReceipts = sqliteTable(
  "po_receipts",
  {
    id: text("id").primaryKey(),
    spkId: text("spk_id")
      .notNull()
      .references(() => spks.id, { onDelete: "cascade" }),
    receiptNumber: text("receipt_number"),
    receivedAt: text("received_at").notNull(),
    notes: text("notes"),
    attachmentName: text("attachment_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentContentBase64: text("attachment_content_base64"),
    receivedBy: text("received_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("po_receipts_spk_idx").on(table.spkId, table.receivedAt),
  ],
);

export const poReceiptItems = sqliteTable(
  "po_receipt_items",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => poReceipts.id, { onDelete: "cascade" }),
    spkItemId: text("spk_item_id")
      .notNull()
      .references(() => spkItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("po_receipt_items_receipt_idx").on(table.receiptId),
    index("po_receipt_items_spk_item_idx").on(table.spkItemId),
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
    packageId: text("package_id").references(() => projectCommercialPackages.id, {
      onDelete: "restrict",
    }),
    deliveryCycle: integer("delivery_cycle").notNull().default(1),
    revisionNo: integer("revision_no").notNull().default(1),
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
    finalizedPdfStorageUrl: text("finalized_pdf_storage_url"),
    finalizedPdfContentBase64: text("finalized_pdf_content_base64"),
    pdfHash: text("pdf_hash"),
    verificationToken: text("verification_token"),
    finalizedAt: text("finalized_at"),
    finalizedBy: text("finalized_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id, { onDelete: "set null" }),
    revocationReason: text("revocation_reason"),
    sealNameSnapshot: text("seal_name_snapshot"),
    sealRoleSnapshot: text("seal_role_snapshot"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("basts_number_unique").on(table.number),
    uniqueIndex("basts_package_cycle_revision_unique").on(table.packageId, table.deliveryCycle, table.revisionNo),
    uniqueIndex("basts_verification_token_unique").on(table.verificationToken),
    index("basts_project_idx").on(table.projectId),
  ],
);

export const bastSealSettings = sqliteTable("bast_seal_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  signerName: text("signer_name").notNull().default("PerumNet Enterprise"),
  signerRole: text("signer_role").notNull().default("Authorized Representative"),
  sealMimeType: text("seal_mime_type"),
  sealContentBase64: text("seal_content_base64"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull(),
});

export const projectValidations = sqliteTable(
  "project_validations",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageId: text("package_id").references(() => projectCommercialPackages.id, {
      onDelete: "restrict",
    }),
    deliveryCycle: integer("delivery_cycle").notNull().default(1),
    status: text("status").notNull().default("Draft"),
    notes: text("notes"),
    validatedBy: text("validated_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_validations_number_unique").on(table.number),
    uniqueIndex("project_validations_package_cycle_unique").on(table.packageId, table.deliveryCycle),
    index("project_validations_project_idx").on(table.projectId),
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

export const projectExpenseCategories = sqliteTable(
  "project_expense_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameEn: text("name_en").notNull(),
    status: text("status").notNull().default("Aktif"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_expense_categories_name_unique").on(table.name),
    index("project_expense_categories_status_idx").on(
      table.status,
      table.sortOrder,
      table.name,
    ),
  ],
);

export const projectAdvances = sqliteTable(
  "project_advances",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    disbursedDate: text("disbursed_date").notNull(),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    paymentReference: text("payment_reference").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("Open"),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedBy: text("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_advances_number_unique").on(table.number),
    uniqueIndex("project_advances_transaction_unique").on(table.transactionId),
    index("project_advances_project_status_idx").on(
      table.projectId,
      table.status,
      table.disbursedDate,
    ),
    index("project_advances_recipient_idx").on(
      table.recipientUserId,
      table.status,
    ),
  ],
);

export const projectExpenses = sqliteTable(
  "project_expenses",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    purchaseDate: text("purchase_date").notNull(),
    merchant: text("merchant").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => projectExpenseCategories.id, { onDelete: "restrict" }),
    totalAmount: integer("total_amount").notNull(),
    currency: text("currency").notNull().default("IDR"),
    fundingSource: text("funding_source").notNull(),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    advanceId: text("advance_id").references(() => projectAdvances.id, {
      onDelete: "restrict",
    }),
    notes: text("notes"),
    itemDetailsJson: text("item_details_json").notNull().default("[]"),
    workflowStatus: text("workflow_status").notNull().default("Draft"),
    settlementStatus: text("settlement_status").notNull().default("Unposted"),
    duplicateAcknowledged: integer("duplicate_acknowledged").notNull().default(0),
    reviewReason: text("review_reason"),
    selfApprovalReason: text("self_approval_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedBy: text("submitted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: text("submitted_at"),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: text("approved_at"),
    rejectedBy: text("rejected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    rejectedAt: text("rejected_at"),
    voidedBy: text("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_expenses_number_unique").on(table.number),
    index("project_expenses_project_status_idx").on(
      table.projectId,
      table.workflowStatus,
      table.purchaseDate,
    ),
    index("project_expenses_creator_status_idx").on(
      table.createdBy,
      table.workflowStatus,
      table.createdAt,
    ),
    index("project_expenses_settlement_idx").on(
      table.settlementStatus,
      table.updatedAt,
    ),
  ],
);

export const projectExpenseAttachments = sqliteTable(
  "project_expense_attachments",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => projectExpenses.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("Receipt"),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    storageUrl: text("storage_url"),
    contentBase64: text("content_base64"),
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_expense_attachments_expense_idx").on(
      table.expenseId,
      table.createdAt,
    ),
    index("project_expense_attachments_hash_idx").on(table.sha256),
  ],
);

export const projectExpenseSettlements = sqliteTable(
  "project_expense_settlements",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id").references(() => projectExpenses.id, {
      onDelete: "restrict",
    }),
    advanceId: text("advance_id").references(() => projectAdvances.id, {
      onDelete: "restrict",
    }),
    settlementType: text("settlement_type").notNull(),
    amount: integer("amount").notNull(),
    settlementDate: text("settlement_date").notNull(),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    paymentReference: text("payment_reference").notNull(),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("Posted"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_expense_settlements_transaction_unique").on(
      table.transactionId,
    ),
    index("project_expense_settlements_expense_idx").on(
      table.expenseId,
      table.status,
      table.settlementDate,
    ),
    index("project_expense_settlements_advance_idx").on(
      table.advanceId,
      table.status,
      table.settlementDate,
    ),
  ],
);

export const projectExpenseEvents = sqliteTable(
  "project_expense_events",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id")
      .notNull()
      .references(() => projectExpenses.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    note: text("note"),
    metadataJson: text("metadata_json"),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_expense_events_expense_idx").on(
      table.expenseId,
      table.createdAt,
    ),
  ],
);

export const spkPayments = sqliteTable(
  "spk_payments",
  {
    id: text("id").primaryKey(),
    spkId: text("spk_id")
      .notNull()
      .references(() => spks.id, { onDelete: "cascade" }),
    termId: text("term_id").references(() => spkPaymentTerms.id, {
      onDelete: "set null",
    }),
    grossAmount: integer("gross_amount").notNull().default(0),
    withholdingAmount: integer("withholding_amount").notNull().default(0),
    amount: integer("amount").notNull(),
    paidDate: text("paid_date").notNull(),
    vendorInvoiceNumber: text("vendor_invoice_number").notNull(),
    paymentReference: text("payment_reference").notNull(),
    paymentMethod: text("payment_method").notNull(),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    attachmentName: text("attachment_name").notNull(),
    attachmentMimeType: text("attachment_mime_type").notNull(),
    attachmentContentBase64: text("attachment_content_base64").notNull(),
    status: text("status").notNull().default("Posted"),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedBy: text("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (table) => [
    index("spk_payments_spk_idx").on(table.spkId, table.paidDate),
    index("spk_payments_term_idx").on(table.termId),
    index("spk_payments_bank_account_idx").on(table.bankAccountId),
  ],
);

export const invoicePayments = sqliteTable(
  "invoice_payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    grossAmount: integer("gross_amount").notNull(),
    cashAmount: integer("cash_amount").notNull(),
    withholdingAmount: integer("withholding_amount").notNull().default(0),
    paidDate: text("paid_date").notNull(),
    paymentReference: text("payment_reference").notNull(),
    paymentMethod: text("payment_method").notNull(),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    attachmentName: text("attachment_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentContentBase64: text("attachment_content_base64"),
    status: text("status").notNull().default("Posted"),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedBy: text("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (table) => [
    index("invoice_payments_invoice_idx").on(table.invoiceId, table.paidDate),
    index("invoice_payments_bank_account_idx").on(table.bankAccountId),
  ],
);

export const taxSettings = sqliteTable("tax_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at").notNull(),
});

export const taxRules = sqliteTable(
  "tax_rules",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en").notNull(),
    scope: text("scope").notNull(),
    effect: text("effect").notNull(),
    rateBps: integer("rate_bps").notNull().default(0),
    accountingTreatment: text("accounting_treatment").notNull(),
    status: text("status").notNull().default("Inactive"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_rules_code_unique").on(table.code),
    index("tax_rules_scope_sort_idx").on(
      table.scope,
      table.status,
      table.sortOrder,
      table.code,
    ),
  ],
);

export const documentTaxes = sqliteTable(
  "document_taxes",
  {
    id: text("id").primaryKey(),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    ruleId: text("rule_id").references(() => taxRules.id, {
      onDelete: "restrict",
    }),
    ruleCode: text("rule_code").notNull(),
    ruleName: text("rule_name").notNull(),
    ruleNameEn: text("rule_name_en").notNull(),
    scope: text("scope").notNull(),
    effect: text("effect").notNull(),
    accountingTreatment: text("accounting_treatment").notNull(),
    rateBps: integer("rate_bps").notNull(),
    taxableBase: integer("taxable_base").notNull(),
    amount: integer("amount").notNull(),
    locked: integer("locked").notNull().default(0),
    lockedAt: text("locked_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("document_taxes_document_rule_unique").on(
      table.documentType,
      table.documentId,
      table.ruleId,
    ),
    index("document_taxes_document_idx").on(
      table.documentType,
      table.documentId,
    ),
    index("document_taxes_project_idx").on(
      table.projectId,
      table.documentType,
    ),
  ],
);

export const taxObligations = sqliteTable(
  "tax_obligations",
  {
    id: text("id").primaryKey(),
    documentTaxId: text("document_tax_id")
      .notNull()
      .references(() => documentTaxes.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull(),
    amount: integer("amount").notNull(),
    settledAmount: integer("settled_amount").notNull().default(0),
    status: text("status").notNull().default("Outstanding"),
    reportingStatus: text("reporting_status").notNull().default("Candidate"),
    taxPeriod: text("tax_period"),
    taxInvoiceNumber: text("tax_invoice_number"),
    taxInvoiceDate: text("tax_invoice_date"),
    returnReference: text("return_reference"),
    reportedAt: text("reported_at"),
    reportedBy: text("reported_by").references(() => users.id, { onDelete: "set null" }),
    reportingNotes: text("reporting_notes"),
    dueDate: text("due_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("tax_obligations_document_tax_unique").on(table.documentTaxId),
    index("tax_obligations_status_idx").on(
      table.direction,
      table.status,
      table.dueDate,
    ),
    index("tax_obligations_project_idx").on(table.projectId, table.status),
  ],
);

export const catalogAiRuns = sqliteTable(
  "catalog_ai_runs",
  {
    id: text("id").primaryKey(),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("Requested"),
    query: text("query").notNull(),
    sourceUrl: text("source_url"),
    inputMimeType: text("input_mime_type"),
    recommendationJson: text("recommendation_json"),
    model: text("model").notNull(),
    confidence: integer("confidence").notNull().default(0),
    expiresAt: text("expires_at"),
    errorMessage: text("error_message"),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: text("approved_at"),
    rejectedBy: text("rejected_by").references(() => users.id, { onDelete: "set null" }),
    rejectedAt: text("rejected_at"),
    overrideReason: text("override_reason"),
    catalogItemId: text("catalog_item_id").references(() => itemCatalogItems.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [index("catalog_ai_runs_user_idx").on(table.requestedBy, table.createdAt)],
);

export const catalogAiSources = sqliteTable(
  "catalog_ai_sources",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => catalogAiRuns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    accessedAt: text("accessed_at").notNull(),
    ...timestamps,
  },
  (table) => [index("catalog_ai_sources_run_idx").on(table.runId)],
);

export const taxSettlements = sqliteTable(
  "tax_settlements",
  {
    id: text("id").primaryKey(),
    obligationId: text("obligation_id")
      .notNull()
      .references(() => taxObligations.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    settlementDate: text("settlement_date").notNull(),
    paymentReference: text("payment_reference").notNull(),
    paymentMethod: text("payment_method").notNull(),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    attachmentName: text("attachment_name"),
    attachmentMimeType: text("attachment_mime_type"),
    attachmentContentBase64: text("attachment_content_base64"),
    status: text("status").notNull().default("Posted"),
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedBy: text("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (table) => [
    index("tax_settlements_obligation_idx").on(
      table.obligationId,
      table.settlementDate,
    ),
    index("tax_settlements_bank_account_idx").on(table.bankAccountId),
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

export const cmsMailLoginConfigs = sqliteTable(
  "cms_mail_login_configs",
  {
    themeKey: text("theme_key").primaryKey(),
    browserTitle: text("browser_title").notNull(),
    eyebrow: text("eyebrow").notNull(),
    headline: text("headline").notNull(),
    description: text("description").notNull(),
    cardTitle: text("card_title").notNull(),
    logoUrl: text("logo_url").notNull().default(""),
    logoSourceStorageUrl: text("logo_source_storage_url"),
    logoStorageUrl: text("logo_storage_url"),
    logoMimeType: text("logo_mime_type"),
    faviconUrl: text("favicon_url").notNull().default(""),
    faviconStorageUrl: text("favicon_storage_url"),
    faviconMimeType: text("favicon_mime_type"),
    revision: integer("revision").notNull().default(1),
    isActive: integer("is_active").notNull().default(0),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [index("cms_mail_login_configs_active_idx").on(table.isActive)],
);

export const cmsMailLoginVersions = sqliteTable(
  "cms_mail_login_versions",
  {
    id: text("id").primaryKey(),
    activeTheme: text("active_theme").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    contentHash: text("content_hash").notNull(),
    deploymentMode: text("deployment_mode").notNull(),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    deployedAt: text("deployed_at"),
  },
  (table) => [index("cms_mail_login_versions_created_idx").on(table.createdAt)],
);

export const cmsLeads = sqliteTable(
  "cms_leads",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    fullName: text("full_name").notNull(),
    whatsapp: text("whatsapp").notNull(),
    email: text("email"),
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    location: text("location").notNull(),
    serviceInterest: text("service_interest").notNull(),
    budgetRange: text("budget_range"),
    targetStart: text("target_start"),
    message: text("message").notNull(),
    privacyConsentAt: text("privacy_consent_at").notNull(),
    sourcePath: text("source_path").notNull().default("/"),
    language: text("language").notNull().default("id"),
    status: text("status").notNull().default("New"),
    assignedTo: text("assigned_to").references(() => users.id, { onDelete: "set null" }),
    retentionUntil: text("retention_until").notNull(),
    retentionExtendedAt: text("retention_extended_at"),
    retentionExtendedBy: text("retention_extended_by").references(() => users.id, { onDelete: "set null" }),
    anonymizedAt: text("anonymized_at"),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cms_leads_idempotency_unique").on(table.idempotencyKey),
    index("cms_leads_status_created_idx").on(table.status, table.createdAt),
    index("cms_leads_assigned_idx").on(table.assignedTo, table.status),
    index("cms_leads_retention_idx").on(table.retentionUntil, table.anonymizedAt),
  ],
);

export const cmsLeadNotes = sqliteTable(
  "cms_lead_notes",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull().references(() => cmsLeads.id, { onDelete: "cascade" }),
    noteType: text("note_type").notNull().default("note"),
    body: text("body").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("cms_lead_notes_lead_idx").on(table.leadId, table.createdAt)],
);

export const publicFormRateLimits = sqliteTable(
  "public_form_rate_limits",
  {
    fingerprintHash: text("fingerprint_hash").notNull(),
    routeKey: text("route_key").notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    blockedUntil: text("blocked_until"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fingerprintHash, table.routeKey] }),
  ],
);
