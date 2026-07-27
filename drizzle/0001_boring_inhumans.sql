CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_name` text NOT NULL,
	`account_name` text NOT NULL,
	`account_number_masked` text NOT NULL,
	`external_account_id` text,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`current_balance` integer DEFAULT 0 NOT NULL,
	`sync_mode` text DEFAULT 'Manual' NOT NULL,
	`status` text DEFAULT 'Aktif' NOT NULL,
	`last_synced_at` text,
	`balance_updated_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_status_idx` ON `bank_accounts` (`status`,`bank_name`);--> statement-breakpoint
CREATE TABLE `bank_statement_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_account_id` text NOT NULL,
	`import_id` text,
	`transaction_id` text,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`running_balance` integer,
	`reference` text,
	`fingerprint` text NOT NULL,
	`reconciliation_status` text DEFAULT 'Imported' NOT NULL,
	`source` text NOT NULL,
	`raw_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `bank_statement_imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_statement_entries_fingerprint_unique` ON `bank_statement_entries` (`bank_account_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `bank_statement_entries_account_date_idx` ON `bank_statement_entries` (`bank_account_id`,`date`);--> statement-breakpoint
CREATE INDEX `bank_statement_entries_transaction_idx` ON `bank_statement_entries` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `bank_statement_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_account_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`statement_month` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`imported_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bank_statement_imports_account_idx` ON `bank_statement_imports` (`bank_account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cms_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text,
	`content` text NOT NULL,
	`is_published` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_pages_slug_unique` ON `cms_pages` (`slug`);--> statement-breakpoint
CREATE TABLE `cms_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`image_url` text,
	`image_storage_url` text,
	`image_mime_type` text,
	`location` text,
	`completed_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cms_services` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`features_json` text DEFAULT '[]' NOT NULL,
	`icon` text DEFAULT 'wifi' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_services_slug_unique` ON `cms_services` (`slug`);--> statement-breakpoint
CREATE TABLE `cms_site_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key_name` text NOT NULL,
	`value_content` text NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_site_settings_key_unique` ON `cms_site_settings` (`key_name`);--> statement-breakpoint
CREATE TABLE `cms_site_texts` (
	`id` text PRIMARY KEY NOT NULL,
	`page_key` text NOT NULL,
	`content_key` text NOT NULL,
	`value_content` text NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_site_texts_key_unique` ON `cms_site_texts` (`page_key`,`content_key`);--> statement-breakpoint
CREATE TABLE `cms_testimonials` (
	`id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`company_name` text,
	`review` text NOT NULL,
	`is_visible` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`event_type` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_deliveries_user_idx` ON `email_deliveries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_deliveries_status_idx` ON `email_deliveries` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_validation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`validation_id` text NOT NULL,
	`boq_item_id` text,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit` text NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`validation_id`) REFERENCES `project_validations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_validation_items_validation_idx` ON `project_validation_items` (`validation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_validation_items_boq_unique` ON `project_validation_items` (`validation_id`,`boq_item_id`);--> statement-breakpoint
CREATE TABLE `project_validations` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`notes` text,
	`validated_by` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`validated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_validations_number_unique` ON `project_validations` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_validations_project_unique` ON `project_validations` (`project_id`);--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`permissions_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`phone` text,
	`job_title` text,
	`bio` text,
	`address` text,
	`birth_date` text,
	`avatar_mime_type` text,
	`avatar_storage_url` text,
	`avatar_content_base64` text,
	`preferred_language` text DEFAULT 'id' NOT NULL,
	`email_notifications` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `basts_project_idx`;--> statement-breakpoint
ALTER TABLE `basts` ADD `engineer_role` text DEFAULT 'Project Manager' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `basts_project_unique` ON `basts` (`project_id`);--> statement-breakpoint
ALTER TABLE `spks` ADD `payment_status` text DEFAULT 'Belum Dibayar' NOT NULL;--> statement-breakpoint
ALTER TABLE `spks` ADD `paid_date` text;--> statement-breakpoint
UPDATE `spks`
SET `payment_status`='Dibayar',
  `paid_date`=COALESCE(
    `paid_date`,
    (SELECT `date` FROM `transactions`
      WHERE `transactions`.`source`='SPK'
        AND `transactions`.`reference_id`=`spks`.`id`
      LIMIT 1)
  )
WHERE EXISTS (
  SELECT 1 FROM `transactions`
  WHERE `transactions`.`source`='SPK'
    AND `transactions`.`reference_id`=`spks`.`id`
);--> statement-breakpoint
ALTER TABLE `transactions` ADD `category` text DEFAULT 'Lainnya' NOT NULL;--> statement-breakpoint
UPDATE `transactions`
SET `category` = CASE
  WHEN `source`='Invoice' THEN 'Penjualan'
  WHEN `source`='SPK' THEN 'Vendor'
  WHEN `source` IN ('Material','Perangkat') THEN 'Vendor'
  WHEN `source`='Operasional' THEN 'Operasional'
  ELSE 'Lainnya'
END;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_reference_unique` ON `transactions` (`source`,`reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_project_unique` ON `quotations` (`project_id`);
