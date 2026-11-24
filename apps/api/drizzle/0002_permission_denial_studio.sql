DROP INDEX `permission_denial_uq`;--> statement-breakpoint
ALTER TABLE `permission_denials` ADD `studio_id` text REFERENCES studios(id);--> statement-breakpoint
CREATE UNIQUE INDEX `permission_denial_uq` ON `permission_denials` (`user_id`,`permission`,`studio_id`);