PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_progress_snapshots` (
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
	FOREIGN KEY (`source_assessment`) REFERENCES `assessment_results`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_progress_snapshots_task_kind" CHECK("__new_progress_snapshots"."task_kind" IN ('rereading', 'drill')),
	CONSTRAINT "ck_progress_snapshots_cefr_overall_score" CHECK("__new_progress_snapshots"."cefr_overall_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_progress_snapshots_cefr_segmental_score" CHECK("__new_progress_snapshots"."cefr_segmental_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_progress_snapshots_cefr_prosodic_score" CHECK("__new_progress_snapshots"."cefr_prosodic_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_progress_snapshots_focus_scores_json" CHECK(json_valid("__new_progress_snapshots"."focus_scores_json")),
	CONSTRAINT "ck_progress_snapshots_cumulative_training_minutes" CHECK("__new_progress_snapshots"."cumulative_training_minutes" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_progress_snapshots`("identifier", "learner", "section", "source_assessment", "task_kind", "cefr_overall_score", "cefr_segmental_score", "cefr_prosodic_score", "focus_scores_json", "cumulative_training_minutes", "captured_at", "created_at", "deleted_at") SELECT "identifier", "learner", "section", "source_assessment", "task_kind", "cefr_overall_score", "cefr_segmental_score", "cefr_prosodic_score", "focus_scores_json", "cumulative_training_minutes", "captured_at", "created_at", "deleted_at" FROM `progress_snapshots`;--> statement-breakpoint
DROP TABLE `progress_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_progress_snapshots` RENAME TO `progress_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_progress_snapshots_learner_captured` ON `progress_snapshots` (`learner`,`deleted_at`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_progress_snapshots_section_captured` ON `progress_snapshots` (`section`,`deleted_at`,`captured_at`);