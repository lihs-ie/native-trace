CREATE TABLE `llm_narrative_cache` (
	`signature` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`what_ja` text NOT NULL,
	`why_ja` text NOT NULL,
	`how_ja` text NOT NULL,
	`created_at` text NOT NULL
);
