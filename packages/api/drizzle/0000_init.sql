CREATE TABLE `acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`terms_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `blackouts` (
	`id` text PRIMARY KEY NOT NULL,
	`studio_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bulk_stock` (
	`type_id` text PRIMARY KEY NOT NULL,
	`qty_available` integer DEFAULT 0 NOT NULL,
	`qty_in_use` integer DEFAULT 0 NOT NULL,
	`qty_damaged` integer DEFAULT 0 NOT NULL,
	`qty_in_repair` integer DEFAULT 0 NOT NULL,
	`qty_lost` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checkout_records` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`equipment_line_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`unit_id` text,
	`qty` integer NOT NULL,
	`out_at` text NOT NULL,
	`out_by` text NOT NULL,
	`condition_out` text DEFAULT 'ok' NOT NULL,
	`due_at` text NOT NULL,
	`in_at` text,
	`in_by` text,
	`condition_in` text,
	`qty_ok` integer DEFAULT 0 NOT NULL,
	`qty_damaged` integer DEFAULT 0 NOT NULL,
	`qty_missing` integer DEFAULT 0 NOT NULL,
	`qty_lost` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`late` integer DEFAULT false NOT NULL,
	`last_overdue_notice_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_line_id`) REFERENCES `equipment_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `equipment_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`out_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `checkout_event_idx` ON `checkout_records` (`event_id`);--> statement-breakpoint
CREATE TABLE `course_offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`course_code` text NOT NULL,
	`section` text DEFAULT '' NOT NULL,
	`term` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`level_id` text NOT NULL,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`course_offering_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'enrolled' NOT NULL,
	`dropped_on` text,
	FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `enrollment_course_idx` ON `enrollments` (`course_offering_id`);--> statement-breakpoint
CREATE TABLE `equipment_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`min_level_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`min_level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_classes_name_unique` ON `equipment_classes` (`name`);--> statement-breakpoint
CREATE TABLE `equipment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`qty` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `equipment_types` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`name` text NOT NULL,
	`manufacturer` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`tracking` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_per_event` integer,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `equipment_classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `equipment_units` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`asset_tag` text NOT NULL,
	`serial_number` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`expected_back` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_units_asset_tag_unique` ON `equipment_units` (`asset_tag`);--> statement-breakpoint
CREATE TABLE `event_days` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`day` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_day_event_idx` ON `event_days` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_participants` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_type_studios` (
	`event_type_id` text NOT NULL,
	`studio_id` text NOT NULL,
	PRIMARY KEY(`event_type_id`, `studio_id`),
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_days` integer DEFAULT 1 NOT NULL,
	`max_hours_per_day` integer DEFAULT 8 NOT NULL,
	`daily_equipment_return` integer DEFAULT false NOT NULL,
	`pickup_window_minutes` integer DEFAULT 60 NOT NULL,
	`checkin_grace_minutes` integer DEFAULT 60 NOT NULL,
	`requires_results` integer DEFAULT false NOT NULL,
	`results_due_days` integer DEFAULT 7 NOT NULL,
	`requester_can_upload` integer DEFAULT false NOT NULL,
	`requires_sponsor_signoff` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_types_name_unique` ON `event_types` (`name`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`event_type_id` text NOT NULL,
	`studio_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`sponsor_id` text,
	`state` text DEFAULT 'Draft' NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`review_reasons` text DEFAULT '[]' NOT NULL,
	`override_requested` text DEFAULT '[]' NOT NULL,
	`override_justification` text DEFAULT '' NOT NULL,
	`submitted_at` text,
	`sponsor_decided_at` text,
	`staff_decided_at` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`cancel_reason` text DEFAULT '' NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sponsor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_state_idx` ON `events` (`state`);--> statement-breakpoint
CREATE INDEX `event_studio_idx` ON `events` (`studio_id`);--> statement-breakpoint
CREATE TABLE `holds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`event_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`auto_clear_at` text,
	`cleared_by` text,
	`cleared_reason` text,
	`cleared_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cleared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hold_user_idx` ON `holds` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `ics_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`studio_id` text,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ics_feeds_token_unique` ON `ics_feeds` (`token`);--> statement-breakpoint
CREATE TABLE `level_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`level_id` text NOT NULL,
	`source` text NOT NULL,
	`enrollment_id` text,
	`valid_from` text NOT NULL,
	`valid_until` text,
	`revoked_on` text,
	`revoked_by` text,
	`revoke_reason` text,
	`reason` text DEFAULT '' NOT NULL,
	`granted_by` text,
	`expiry_warned_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `grant_user_idx` ON `level_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `levels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rank` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `levels_rank_unique` ON `levels` (`rank`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`recipient_id` text NOT NULL,
	`event_id` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_recipient_idx` ON `notifications` (`recipient_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `opening_hours` (
	`id` text PRIMARY KEY NOT NULL,
	`studio_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`opens` text NOT NULL,
	`closes` text NOT NULL,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policy_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `result_access_log` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `result_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `result_items` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`storage_key` text,
	`url` text,
	`mime_type` text,
	`size_bytes` integer,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `result_packages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `result_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'collecting' NOT NULL,
	`results_due_at` text,
	`published_at` text,
	`published_by` text,
	`publish_override_reason` text,
	`retain_until` text,
	`sponsor_signoff` text NOT NULL,
	`sponsor_comment` text DEFAULT '' NOT NULL,
	`signed_off_at` text,
	`checkin_report` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_packages_event_id_unique` ON `result_packages` (`event_id`);--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`studio_id` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`assigned_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_assignment_uq` ON `role_assignments` (`user_id`,`role`,`studio_id`);--> statement-breakpoint
CREATE TABLE `stage_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`stage_template_id` text NOT NULL,
	`day_index` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`recipients` text NOT NULL,
	`assignee_role` text,
	`blocks_checkout` integer DEFAULT false NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`due_at` text NOT NULL,
	`status` text NOT NULL,
	`completed_by` text,
	`completed_at` text,
	`override_reason` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_template_id`) REFERENCES `stage_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stage_due_idx` ON `stage_instances` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `stage_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type_id` text NOT NULL,
	`seq` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`anchor` text NOT NULL,
	`offset_minutes` integer NOT NULL,
	`recipients` text NOT NULL,
	`assignee_role` text,
	`blocks_checkout` integer DEFAULT false NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text,
	`type_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`actor_id` text,
	`event_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `equipment_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `studios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`capacity_people` integer DEFAULT 1 NOT NULL,
	`min_level_id` text NOT NULL,
	`turnaround_minutes` integer DEFAULT 30 NOT NULL,
	`slot_granularity_minutes` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`min_level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studios_name_unique` ON `studios` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`idp_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`affiliation` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_idp_subject_unique` ON `users` (`idp_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);