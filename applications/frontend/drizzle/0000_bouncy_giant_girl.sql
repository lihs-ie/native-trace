CREATE TABLE `analysis_jobs` (
	`identifier` text PRIMARY KEY NOT NULL,
	`analysis_run` text NOT NULL,
	`engine` text NOT NULL,
	`engine_config_json` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_run_at` text NOT NULL,
	`lease_owner` text,
	`lease_token` text,
	`leased_until` text,
	`queued_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`canceled_at` text,
	`last_error_code` text,
	`last_error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`analysis_run`) REFERENCES `analysis_runs`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_analysis_jobs_engine" CHECK("analysis_jobs"."engine" IN ('cloud', 'oss_worker')),
	CONSTRAINT "ck_analysis_jobs_engine_config_json" CHECK(json_valid("analysis_jobs"."engine_config_json")),
	CONSTRAINT "ck_analysis_jobs_status" CHECK("analysis_jobs"."status" IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "ck_analysis_jobs_attempt_count" CHECK("analysis_jobs"."attempt_count" >= 0),
	CONSTRAINT "ck_analysis_jobs_max_attempts" CHECK("analysis_jobs"."max_attempts" >= 1),
	CONSTRAINT "ck_analysis_jobs_attempt_limit" CHECK("analysis_jobs"."attempt_count" <= "analysis_jobs"."max_attempts"),
	CONSTRAINT "ck_analysis_jobs_lease_fields" CHECK("analysis_jobs"."status" NOT IN ('leased', 'running') OR ("analysis_jobs"."lease_token" IS NOT NULL AND "analysis_jobs"."leased_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_runnable` ON `analysis_jobs` (`status`,`next_run_at`,`attempt_count`,`max_attempts`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_expired_lease` ON `analysis_jobs` (`status`,`leased_until`,`attempt_count`,`max_attempts`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_run_engine` ON `analysis_jobs` (`analysis_run`,`engine`);--> statement-breakpoint
CREATE INDEX `idx_analysis_jobs_run_status` ON `analysis_jobs` (`analysis_run`,`deleted_at`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_analysis_jobs_run_engine` ON `analysis_jobs` (`analysis_run`,`engine`);--> statement-breakpoint
CREATE TABLE `analysis_runs` (
	`identifier` text PRIMARY KEY NOT NULL,
	`recording_attempt` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`canceled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`recording_attempt`) REFERENCES `recording_attempts`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_analysis_runs_mode" CHECK("analysis_runs"."mode" IN ('cloud_only', 'oss_worker_only', 'comparison')),
	CONSTRAINT "ck_analysis_runs_status" CHECK("analysis_runs"."status" IN ('queued', 'running', 'partial_succeeded', 'succeeded', 'failed', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_runs_recording_attempt_created` ON `analysis_runs` (`recording_attempt`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_analysis_runs_status` ON `analysis_runs` (`status`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `assessment_results` (
	`identifier` text PRIMARY KEY NOT NULL,
	`analysis_job` text NOT NULL,
	`overall_score` integer NOT NULL,
	`accuracy_score` integer NOT NULL,
	`native_likeness_score` integer NOT NULL,
	`pronunciation_score` integer NOT NULL,
	`connected_speech_score` integer NOT NULL,
	`prosody_score` integer NOT NULL,
	`assessment_result_json` text NOT NULL,
	`raw_response_json` text NOT NULL,
	`engine_snapshot_json` text NOT NULL,
	`tokenizer_version` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`analysis_job`) REFERENCES `analysis_jobs`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_assessment_results_overall_score" CHECK("assessment_results"."overall_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_assessment_results_accuracy_score" CHECK("assessment_results"."accuracy_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_assessment_results_native_likeness_score" CHECK("assessment_results"."native_likeness_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_assessment_results_pronunciation_score" CHECK("assessment_results"."pronunciation_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_assessment_results_connected_speech_score" CHECK("assessment_results"."connected_speech_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_assessment_results_prosody_score" CHECK("assessment_results"."prosody_score" BETWEEN 0 AND 100),
	CONSTRAINT "ck_assessment_results_assessment_json" CHECK(json_valid("assessment_results"."assessment_result_json")),
	CONSTRAINT "ck_assessment_results_raw_response_json" CHECK(json_valid("assessment_results"."raw_response_json")),
	CONSTRAINT "ck_assessment_results_engine_snapshot_json" CHECK(json_valid("assessment_results"."engine_snapshot_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_assessment_results_analysis_job` ON `assessment_results` (`analysis_job`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_assessment_results_scores` ON `assessment_results` (`deleted_at`,`created_at`,`overall_score`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assessment_results_analysis_job` ON `assessment_results` (`analysis_job`);--> statement-breakpoint
CREATE TABLE `audio_files` (
	`identifier` text PRIMARY KEY NOT NULL,
	`recording_attempt` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_milliseconds` integer NOT NULL,
	`sample_rate` integer,
	`channel_count` integer,
	`sha256` text NOT NULL,
	`status` text NOT NULL,
	`physical_deleted_at` text,
	`delete_failure_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`recording_attempt`) REFERENCES `recording_attempts`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_audio_files_status" CHECK("audio_files"."status" IN ('stored', 'deletion_pending', 'physically_deleted', 'delete_failed')),
	CONSTRAINT "ck_audio_files_size_bytes" CHECK("audio_files"."size_bytes" BETWEEN 1 AND 104857600),
	CONSTRAINT "ck_audio_files_duration" CHECK("audio_files"."duration_milliseconds" BETWEEN 1 AND 600000),
	CONSTRAINT "ck_audio_files_sample_rate" CHECK("audio_files"."sample_rate" IS NULL OR "audio_files"."sample_rate" > 0),
	CONSTRAINT "ck_audio_files_channel_count" CHECK("audio_files"."channel_count" IS NULL OR "audio_files"."channel_count" > 0),
	CONSTRAINT "ck_audio_files_sha256" CHECK(length("audio_files"."sha256") = 64)
);
--> statement-breakpoint
CREATE INDEX `idx_audio_files_recording_attempt` ON `audio_files` (`recording_attempt`);--> statement-breakpoint
CREATE INDEX `idx_audio_files_delete_status` ON `audio_files` (`status`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_audio_files_recording_attempt` ON `audio_files` (`recording_attempt`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_audio_files_storage_key` ON `audio_files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `materials` (
	`identifier` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "ck_materials_title_not_blank" CHECK(length(trim("materials"."title")) > 0),
	CONSTRAINT "ck_materials_source_json" CHECK("materials"."source_json" IS NULL OR json_valid("materials"."source_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_materials_active_updated` ON `materials` (`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE `recording_attempts` (
	`identifier` text PRIMARY KEY NOT NULL,
	`section` text NOT NULL,
	`status` text NOT NULL,
	`input_kind` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`duration_milliseconds` integer,
	`browser_info_json` text,
	`original_file_name` text,
	`failure_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`section`) REFERENCES `sections`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_recording_attempts_status" CHECK("recording_attempts"."status" IN ('saving', 'ready', 'failed')),
	CONSTRAINT "ck_recording_attempts_input_kind" CHECK("recording_attempts"."input_kind" IN ('browser_recording', 'uploaded_file')),
	CONSTRAINT "ck_recording_attempts_duration" CHECK("recording_attempts"."duration_milliseconds" IS NULL OR "recording_attempts"."duration_milliseconds" BETWEEN 1 AND 600000),
	CONSTRAINT "ck_recording_attempts_browser_info_json" CHECK("recording_attempts"."browser_info_json" IS NULL OR json_valid("recording_attempts"."browser_info_json")),
	CONSTRAINT "ck_recording_attempts_ready_duration" CHECK("recording_attempts"."status" != 'ready' OR "recording_attempts"."duration_milliseconds" IS NOT NULL),
	CONSTRAINT "ck_recording_attempts_browser_origin" CHECK(NOT ("recording_attempts"."input_kind" = 'browser_recording' AND "recording_attempts"."status" = 'ready') OR ("recording_attempts"."started_at" IS NOT NULL AND "recording_attempts"."ended_at" IS NOT NULL AND "recording_attempts"."browser_info_json" IS NOT NULL)),
	CONSTRAINT "ck_recording_attempts_uploaded_origin" CHECK(NOT ("recording_attempts"."input_kind" = 'uploaded_file' AND "recording_attempts"."status" = 'ready') OR ("recording_attempts"."started_at" IS NULL AND "recording_attempts"."ended_at" IS NULL AND "recording_attempts"."browser_info_json" IS NULL AND length(trim("recording_attempts"."original_file_name")) > 0))
);
--> statement-breakpoint
CREATE INDEX `idx_recording_attempts_section_recorded` ON `recording_attempts` (`section`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_recording_attempts_status` ON `recording_attempts` (`status`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `section_series` (
	`identifier` text PRIMARY KEY NOT NULL,
	`material` text NOT NULL,
	`title` text NOT NULL,
	`display_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`material`) REFERENCES `materials`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_section_series_title_not_blank" CHECK(length(trim("section_series"."title")) > 0),
	CONSTRAINT "ck_section_series_display_order" CHECK("section_series"."display_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_section_series_material_order` ON `section_series` (`material`,`deleted_at`,`display_order`);--> statement-breakpoint
CREATE TABLE `sections` (
	`identifier` text PRIMARY KEY NOT NULL,
	`section_series` text NOT NULL,
	`version_number` integer NOT NULL,
	`body_text` text NOT NULL,
	`body_text_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`section_series`) REFERENCES `section_series`(`identifier`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_sections_version_number" CHECK("sections"."version_number" >= 1),
	CONSTRAINT "ck_sections_body_text_not_blank" CHECK(length(trim("sections"."body_text")) > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sections_latest` ON `sections` (`section_series`,`deleted_at`,`version_number`);--> statement-breakpoint
CREATE INDEX `idx_sections_body_hash` ON `sections` (`section_series`,`body_text_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sections_series_version` ON `sections` (`section_series`,`version_number`);