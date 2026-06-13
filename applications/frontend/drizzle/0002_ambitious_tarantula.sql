CREATE TABLE `diagnostic_sessions` (
	`identifier` text PRIMARY KEY NOT NULL,
	`learner` text NOT NULL,
	`prompt_set_json` text NOT NULL,
	`status` text NOT NULL,
	`weakness_profile` text,
	`assessment_result_json` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "ck_diagnostic_sessions_status" CHECK("diagnostic_sessions"."status" IN ('pending', 'completed')),
	CONSTRAINT "ck_diagnostic_sessions_prompt_set_json" CHECK(json_valid("diagnostic_sessions"."prompt_set_json")),
	CONSTRAINT "ck_diagnostic_sessions_assessment_result_json" CHECK("diagnostic_sessions"."assessment_result_json" IS NULL OR json_valid("diagnostic_sessions"."assessment_result_json")),
	CONSTRAINT "ck_diagnostic_sessions_completed" CHECK("diagnostic_sessions"."status" != 'completed' OR ("diagnostic_sessions"."weakness_profile" IS NOT NULL AND "diagnostic_sessions"."assessment_result_json" IS NOT NULL AND "diagnostic_sessions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_diagnostic_sessions_learner_created` ON `diagnostic_sessions` (`learner`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `weakness_profiles` (
	`identifier` text PRIMARY KEY NOT NULL,
	`learner` text NOT NULL,
	`diagnostic_session` text NOT NULL,
	`focus_sounds_json` text NOT NULL,
	`last_updated_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`diagnostic_session`) REFERENCES `diagnostic_sessions`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_weakness_profiles_focus_sounds_json" CHECK(json_valid("weakness_profiles"."focus_sounds_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_weakness_profiles_learner` ON `weakness_profiles` (`learner`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_weakness_profiles_learner` ON `weakness_profiles` (`learner`);