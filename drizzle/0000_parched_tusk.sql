CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`metadata_json` text,
	`ip_address` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `basts` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`project_id` text NOT NULL,
	`completion_date` text NOT NULL,
	`notes` text NOT NULL,
	`installed_items_json` text NOT NULL,
	`client_name` text NOT NULL,
	`client_role` text NOT NULL,
	`client_signature` text,
	`engineer_name` text NOT NULL,
	`engineer_signature` text,
	`status` text DEFAULT 'Draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `basts_number_unique` ON `basts` (`number`);--> statement-breakpoint
CREATE INDEX `basts_project_idx` ON `basts` (`project_id`);--> statement-breakpoint
CREATE TABLE `boq_items` (
	`id` text PRIMARY KEY NOT NULL,
	`boq_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit` text NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`selling_price` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`boq_id`) REFERENCES `boqs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `boq_items_boq_idx` ON `boq_items` (`boq_id`);--> statement-breakpoint
CREATE TABLE `boq_template_items` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit` text NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`selling_price` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `boq_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `boq_template_items_template_idx` ON `boq_template_items` (`template_id`);--> statement-breakpoint
CREATE TABLE `boq_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `boqs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boqs_project_unique` ON `boqs` (`project_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'Belum Lunas' NOT NULL,
	`paid_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE INDEX `invoices_project_idx` ON `invoices` (`project_id`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_url` text,
	`content_base64` text,
	`uploaded_by` text,
	`uploader_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_documents_project_idx` ON `project_documents` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_unique` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_id` text,
	`owner_name` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'Belum Mulai' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_tasks_project_idx` ON `project_tasks` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`client` text NOT NULL,
	`location` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`start_date` text,
	`target_date` text,
	`value` integer DEFAULT 0 NOT NULL,
	`manager_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_unique` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`issued_at` text NOT NULL,
	`valid_until` text,
	`total` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_number_unique` ON `quotations` (`number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `spks` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`cost` integer NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`start_date` text,
	`end_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spks_number_unique` ON `spks` (`number`);--> statement-breakpoint
CREATE INDEX `spks_project_idx` ON `spks` (`project_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`source` text NOT NULL,
	`reference_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transactions_project_idx` ON `transactions` (`project_id`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'Aktif' NOT NULL,
	`last_active_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`contact` text NOT NULL,
	`email` text,
	`address` text,
	`rate` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Aktif' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
