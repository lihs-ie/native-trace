CREATE TABLE `ab_usage_logs` (
	`identifier` text PRIMARY KEY NOT NULL,
	`learner` text NOT NULL,
	`source` text NOT NULL,
	`played_at` text NOT NULL,
	`quality_gate_passed` integer,
	CONSTRAINT "ck_ab_usage_logs_source" CHECK("ab_usage_logs"."source" IN ('self', 'model', 'golden')),
	CONSTRAINT "ck_ab_usage_logs_quality_gate_passed" CHECK("ab_usage_logs"."quality_gate_passed" IS NULL OR "ab_usage_logs"."quality_gate_passed" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `idx_ab_usage_logs_learner_played` ON `ab_usage_logs` (`learner`,`played_at`);--> statement-breakpoint
CREATE INDEX `idx_ab_usage_logs_source_played` ON `ab_usage_logs` (`source`,`played_at`);