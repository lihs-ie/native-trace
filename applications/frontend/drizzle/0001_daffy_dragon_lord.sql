CREATE TABLE `finding_dismissals` (
	`identifier` text PRIMARY KEY NOT NULL,
	`assessment_result` text NOT NULL,
	`finding_identifier` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	`reason` text,
	`undone_at` integer,
	FOREIGN KEY (`assessment_result`) REFERENCES `assessment_results`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_finding_dismissals_dismissed_at" CHECK("finding_dismissals"."dismissed_at" > 0),
	CONSTRAINT "ck_finding_dismissals_undone_at" CHECK("finding_dismissals"."undone_at" IS NULL OR "finding_dismissals"."undone_at" > "finding_dismissals"."dismissed_at")
);
--> statement-breakpoint
CREATE INDEX `idx_finding_dismissals_assessment_result` ON `finding_dismissals` (`assessment_result`,`undone_at`);--> statement-breakpoint
CREATE INDEX `idx_finding_dismissals_finding` ON `finding_dismissals` (`assessment_result`,`finding_identifier`,`undone_at`);