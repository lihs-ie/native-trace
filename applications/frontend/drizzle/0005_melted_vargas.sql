CREATE TABLE `hvpt_trials` (
	`identifier` text PRIMARY KEY NOT NULL,
	`training_session` text NOT NULL,
	`stimulus` text NOT NULL,
	`contrast` text NOT NULL,
	`correct_label_json` text NOT NULL,
	`response_json` text NOT NULL,
	`correct` integer NOT NULL,
	`reaction_time_milliseconds` integer NOT NULL,
	`presented_at` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`training_session`) REFERENCES `training_sessions`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_hvpt_trials_correct" CHECK("hvpt_trials"."correct" IN (0, 1)),
	CONSTRAINT "ck_hvpt_trials_reaction_time" CHECK("hvpt_trials"."reaction_time_milliseconds" > 0),
	CONSTRAINT "ck_hvpt_trials_correct_label_json" CHECK(json_valid("hvpt_trials"."correct_label_json")),
	CONSTRAINT "ck_hvpt_trials_response_json" CHECK(json_valid("hvpt_trials"."response_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_hvpt_trials_training_session` ON `hvpt_trials` (`training_session`,`deleted_at`,`presented_at`);--> statement-breakpoint
CREATE TABLE `spacing_schedules` (
	`identifier` text PRIMARY KEY NOT NULL,
	`learner` text NOT NULL,
	`focus_sound` text NOT NULL,
	`contrast` text NOT NULL,
	`state` text NOT NULL,
	`next_presentation_at` text NOT NULL,
	`recent_accuracy` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`focus_sound`) REFERENCES `weakness_profiles`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_spacing_schedules_state" CHECK("spacing_schedules"."state" IN ('rest', 'due', 'gate', 'done')),
	CONSTRAINT "ck_spacing_schedules_recent_accuracy" CHECK("spacing_schedules"."recent_accuracy" IS NULL OR ("spacing_schedules"."recent_accuracy" >= 0 AND "spacing_schedules"."recent_accuracy" <= 1))
);
--> statement-breakpoint
CREATE INDEX `idx_spacing_schedules_due` ON `spacing_schedules` (`state`,`deleted_at`,`next_presentation_at`);--> statement-breakpoint
CREATE INDEX `idx_spacing_schedules_learner_contrast` ON `spacing_schedules` (`learner`,`contrast`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_spacing_schedules_learner_contrast` ON `spacing_schedules` (`learner`,`contrast`);--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`identifier` text PRIMARY KEY NOT NULL,
	`learner` text NOT NULL,
	`kind` text NOT NULL,
	`contrast` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`aborted_at` text,
	`duration_minutes` integer,
	`session_accuracy` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "ck_training_sessions_kind" CHECK("training_sessions"."kind" IN ('hvpt_identification', 'production_drill', 'shadowing')),
	CONSTRAINT "ck_training_sessions_status" CHECK("training_sessions"."status" IN ('in_progress', 'completed', 'aborted')),
	CONSTRAINT "ck_training_sessions_completed" CHECK("training_sessions"."status" != 'completed' OR ("training_sessions"."ended_at" IS NOT NULL AND "training_sessions"."duration_minutes" IS NOT NULL)),
	CONSTRAINT "ck_training_sessions_aborted" CHECK("training_sessions"."status" != 'aborted' OR "training_sessions"."aborted_at" IS NOT NULL),
	CONSTRAINT "ck_training_sessions_duration_minutes" CHECK("training_sessions"."duration_minutes" IS NULL OR ("training_sessions"."duration_minutes" >= 1 AND "training_sessions"."duration_minutes" <= 30)),
	CONSTRAINT "ck_training_sessions_session_accuracy" CHECK("training_sessions"."session_accuracy" IS NULL OR ("training_sessions"."session_accuracy" >= 0 AND "training_sessions"."session_accuracy" <= 1))
);
--> statement-breakpoint
CREATE INDEX `idx_training_sessions_learner_started` ON `training_sessions` (`learner`,`deleted_at`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_training_sessions_contrast_started` ON `training_sessions` (`learner`,`contrast`,`deleted_at`,`started_at`);