CREATE TABLE `progress_snapshots` (
	`identifier` text PRIMARY KEY NOT NULL,
	`learner` text NOT NULL,
	`section` text NOT NULL,
	`source_assessment` text NOT NULL,
	`task_kind` text NOT NULL,
	`cefr_overall_score` integer NOT NULL,
	`cefr_segmental_score` integer NOT NULL,
	`cefr_prosodic_score` integer NOT NULL,
	`focus_scores_json` text NOT NULL,
	`cumulative_training_minutes` integer NOT NULL,
	`captured_at` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`section`) REFERENCES `sections`(`identifier`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_assessment`) REFERENCES `assessment_results`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_progress_snapshots_task_kind" CHECK("progress_snapshots"."task_kind" IN ('rereading', 'drill')),
	CONSTRAINT "ck_progress_snapshots_cefr_overall_score" CHECK("progress_snapshots"."cefr_overall_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_progress_snapshots_cefr_segmental_score" CHECK("progress_snapshots"."cefr_segmental_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_progress_snapshots_cefr_prosodic_score" CHECK("progress_snapshots"."cefr_prosodic_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_progress_snapshots_focus_scores_json" CHECK(json_valid("progress_snapshots"."focus_scores_json")),
	CONSTRAINT "ck_progress_snapshots_cumulative_training_minutes" CHECK("progress_snapshots"."cumulative_training_minutes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_progress_snapshots_learner_captured` ON `progress_snapshots` (`learner`,`deleted_at`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_progress_snapshots_section_captured` ON `progress_snapshots` (`section`,`deleted_at`,`captured_at`);