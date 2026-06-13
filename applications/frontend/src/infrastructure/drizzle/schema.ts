import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

// DB-001: materials
export const materials = sqliteTable(
  "materials",
  {
    identifier: text("identifier").primaryKey(),
    title: text("title").notNull(),
    sourceJson: text("source_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check("ck_materials_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check(
      "ck_materials_source_json",
      sql`${table.sourceJson} IS NULL OR json_valid(${table.sourceJson})`,
    ),
    index("idx_materials_active_updated").on(table.deletedAt, table.updatedAt),
  ],
);

// DB-002: section_series
export const sectionSeries = sqliteTable(
  "section_series",
  {
    identifier: text("identifier").primaryKey(),
    material: text("material")
      .notNull()
      .references(() => materials.identifier),
    title: text("title").notNull(),
    displayOrder: integer("display_order").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check("ck_section_series_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check("ck_section_series_display_order", sql`${table.displayOrder} >= 0`),
    index("idx_section_series_material_order").on(
      table.material,
      table.deletedAt,
      table.displayOrder,
    ),
  ],
);

// DB-003: sections
export const sections = sqliteTable(
  "sections",
  {
    identifier: text("identifier").primaryKey(),
    sectionSeries: text("section_series")
      .notNull()
      .references(() => sectionSeries.identifier),
    versionNumber: integer("version_number").notNull(),
    bodyText: text("body_text").notNull(),
    bodyTextHash: text("body_text_hash").notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    unique("uq_sections_series_version").on(table.sectionSeries, table.versionNumber),
    check("ck_sections_version_number", sql`${table.versionNumber} >= 1`),
    check("ck_sections_body_text_not_blank", sql`length(trim(${table.bodyText})) > 0`),
    index("idx_sections_latest").on(table.sectionSeries, table.deletedAt, table.versionNumber),
    index("idx_sections_body_hash").on(table.sectionSeries, table.bodyTextHash),
  ],
);

// DB-004: recording_attempts
export const recordingAttempts = sqliteTable(
  "recording_attempts",
  {
    identifier: text("identifier").primaryKey(),
    section: text("section")
      .notNull()
      .references(() => sections.identifier),
    status: text("status").notNull(),
    inputKind: text("input_kind").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    durationMilliseconds: integer("duration_milliseconds"),
    browserInfoJson: text("browser_info_json"),
    originalFileName: text("original_file_name"),
    failureReason: text("failure_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check("ck_recording_attempts_status", sql`${table.status} IN ('saving', 'ready', 'failed')`),
    check(
      "ck_recording_attempts_input_kind",
      sql`${table.inputKind} IN ('browser_recording', 'uploaded_file')`,
    ),
    check(
      "ck_recording_attempts_duration",
      sql`${table.durationMilliseconds} IS NULL OR ${table.durationMilliseconds} BETWEEN 1 AND 600000`,
    ),
    check(
      "ck_recording_attempts_browser_info_json",
      sql`${table.browserInfoJson} IS NULL OR json_valid(${table.browserInfoJson})`,
    ),
    check(
      "ck_recording_attempts_ready_duration",
      sql`${table.status} != 'ready' OR ${table.durationMilliseconds} IS NOT NULL`,
    ),
    check(
      "ck_recording_attempts_browser_origin",
      sql`NOT (${table.inputKind} = 'browser_recording' AND ${table.status} = 'ready') OR (${table.startedAt} IS NOT NULL AND ${table.endedAt} IS NOT NULL AND ${table.browserInfoJson} IS NOT NULL)`,
    ),
    check(
      "ck_recording_attempts_uploaded_origin",
      sql`NOT (${table.inputKind} = 'uploaded_file' AND ${table.status} = 'ready') OR (${table.startedAt} IS NULL AND ${table.endedAt} IS NULL AND ${table.browserInfoJson} IS NULL AND length(trim(${table.originalFileName})) > 0)`,
    ),
    index("idx_recording_attempts_section_recorded").on(
      table.section,
      table.deletedAt,
      table.createdAt,
    ),
    index("idx_recording_attempts_status").on(table.status, table.deletedAt),
  ],
);

// DB-005: audio_files
export const audioFiles = sqliteTable(
  "audio_files",
  {
    identifier: text("identifier").primaryKey(),
    recordingAttempt: text("recording_attempt")
      .notNull()
      .references(() => recordingAttempts.identifier),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMilliseconds: integer("duration_milliseconds").notNull(),
    sampleRate: integer("sample_rate"),
    channelCount: integer("channel_count"),
    sha256: text("sha256").notNull(),
    status: text("status").notNull(),
    physicalDeletedAt: text("physical_deleted_at"),
    deleteFailureReason: text("delete_failure_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    unique("uq_audio_files_recording_attempt").on(table.recordingAttempt),
    unique("uq_audio_files_storage_key").on(table.storageKey),
    check(
      "ck_audio_files_status",
      sql`${table.status} IN ('stored', 'deletion_pending', 'physically_deleted', 'delete_failed')`,
    ),
    check("ck_audio_files_size_bytes", sql`${table.sizeBytes} BETWEEN 1 AND 104857600`),
    check("ck_audio_files_duration", sql`${table.durationMilliseconds} BETWEEN 1 AND 600000`),
    check(
      "ck_audio_files_sample_rate",
      sql`${table.sampleRate} IS NULL OR ${table.sampleRate} > 0`,
    ),
    check(
      "ck_audio_files_channel_count",
      sql`${table.channelCount} IS NULL OR ${table.channelCount} > 0`,
    ),
    check("ck_audio_files_sha256", sql`length(${table.sha256}) = 64`),
    index("idx_audio_files_recording_attempt").on(table.recordingAttempt),
    index("idx_audio_files_delete_status").on(table.status, table.deletedAt, table.updatedAt),
  ],
);

// DB-006: analysis_runs
export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    identifier: text("identifier").primaryKey(),
    recordingAttempt: text("recording_attempt")
      .notNull()
      .references(() => recordingAttempts.identifier),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    canceledAt: text("canceled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check(
      "ck_analysis_runs_mode",
      sql`${table.mode} IN ('cloud_only', 'oss_worker_only', 'comparison')`,
    ),
    check(
      "ck_analysis_runs_status",
      sql`${table.status} IN ('queued', 'running', 'partial_succeeded', 'succeeded', 'failed', 'canceled')`,
    ),
    index("idx_analysis_runs_recording_attempt_created").on(
      table.recordingAttempt,
      table.deletedAt,
      table.createdAt,
    ),
    index("idx_analysis_runs_status").on(table.status, table.deletedAt, table.updatedAt),
  ],
);

// DB-007: analysis_jobs
export const analysisJobs = sqliteTable(
  "analysis_jobs",
  {
    identifier: text("identifier").primaryKey(),
    analysisRun: text("analysis_run")
      .notNull()
      .references(() => analysisRuns.identifier),
    engine: text("engine").notNull(),
    engineConfigJson: text("engine_config_json").notNull(),
    status: text("status").notNull(),
    priority: integer("priority").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRunAt: text("next_run_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leasedUntil: text("leased_until"),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    canceledAt: text("canceled_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    unique("uq_analysis_jobs_run_engine").on(table.analysisRun, table.engine),
    check("ck_analysis_jobs_engine", sql`${table.engine} IN ('cloud', 'oss_worker')`),
    check("ck_analysis_jobs_engine_config_json", sql`json_valid(${table.engineConfigJson})`),
    check(
      "ck_analysis_jobs_status",
      sql`${table.status} IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'canceled')`,
    ),
    check("ck_analysis_jobs_attempt_count", sql`${table.attemptCount} >= 0`),
    check("ck_analysis_jobs_max_attempts", sql`${table.maxAttempts} >= 1`),
    check("ck_analysis_jobs_attempt_limit", sql`${table.attemptCount} <= ${table.maxAttempts}`),
    check(
      "ck_analysis_jobs_lease_fields",
      sql`${table.status} NOT IN ('leased', 'running') OR (${table.leaseToken} IS NOT NULL AND ${table.leasedUntil} IS NOT NULL)`,
    ),
    index("idx_analysis_jobs_runnable").on(
      table.status,
      table.nextRunAt,
      table.attemptCount,
      table.maxAttempts,
      table.priority,
      table.createdAt,
    ),
    index("idx_analysis_jobs_expired_lease").on(
      table.status,
      table.leasedUntil,
      table.attemptCount,
      table.maxAttempts,
      table.priority,
      table.createdAt,
    ),
    index("idx_analysis_jobs_run_engine").on(table.analysisRun, table.engine),
    index("idx_analysis_jobs_run_status").on(table.analysisRun, table.deletedAt, table.status),
  ],
);

// DB-008: assessment_results
export const assessmentResults = sqliteTable(
  "assessment_results",
  {
    identifier: text("identifier").primaryKey(),
    analysisJob: text("analysis_job")
      .notNull()
      .references(() => analysisJobs.identifier),
    overallScore: integer("overall_score").notNull(),
    accuracyScore: integer("accuracy_score").notNull(),
    nativeLikenessScore: integer("native_likeness_score").notNull(),
    pronunciationScore: integer("pronunciation_score").notNull(),
    connectedSpeechScore: integer("connected_speech_score").notNull(),
    prosodyScore: integer("prosody_score").notNull(),
    assessmentResultJson: text("assessment_result_json").notNull(),
    rawResponseJson: text("raw_response_json").notNull(),
    engineSnapshotJson: text("engine_snapshot_json").notNull(),
    tokenizerVersion: text("tokenizer_version").notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    unique("uq_assessment_results_analysis_job").on(table.analysisJob),
    check("ck_assessment_results_overall_score", sql`${table.overallScore} BETWEEN 0 AND 100`),
    check("ck_assessment_results_accuracy_score", sql`${table.accuracyScore} BETWEEN 0 AND 100`),
    check(
      "ck_assessment_results_native_likeness_score",
      sql`${table.nativeLikenessScore} BETWEEN 0 AND 100`,
    ),
    check(
      "ck_assessment_results_pronunciation_score",
      sql`${table.pronunciationScore} BETWEEN 0 AND 100`,
    ),
    check(
      "ck_assessment_results_connected_speech_score",
      sql`${table.connectedSpeechScore} BETWEEN 0 AND 100`,
    ),
    check("ck_assessment_results_prosody_score", sql`${table.prosodyScore} BETWEEN 0 AND 100`),
    check("ck_assessment_results_assessment_json", sql`json_valid(${table.assessmentResultJson})`),
    check("ck_assessment_results_raw_response_json", sql`json_valid(${table.rawResponseJson})`),
    check(
      "ck_assessment_results_engine_snapshot_json",
      sql`json_valid(${table.engineSnapshotJson})`,
    ),
    index("idx_assessment_results_analysis_job").on(table.analysisJob, table.deletedAt),
    index("idx_assessment_results_scores").on(table.deletedAt, table.createdAt, table.overallScore),
  ],
);

// DB-010: diagnostic_sessions (Training Context — database-design.md §5b)
// 時刻列は TEXT ISO-8601（DB-001〜DB-008 規約）に揃える。
// assessment_result_json は AssessmentResult 識別子配列を JSON で保持する（1対多参照）。
// weakness_profile は weakness_profiles(identifier) を参照（completed 時は必須）。
export const diagnosticSessions = sqliteTable(
  "diagnostic_sessions",
  {
    identifier: text("identifier").primaryKey(),
    learner: text("learner").notNull(),
    promptSetJson: text("prompt_set_json").notNull(),
    status: text("status").notNull(),
    weaknessProfile: text("weakness_profile"),
    assessmentResultJson: text("assessment_result_json"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    check("ck_diagnostic_sessions_status", sql`${table.status} IN ('pending', 'completed')`),
    check("ck_diagnostic_sessions_prompt_set_json", sql`json_valid(${table.promptSetJson})`),
    check(
      "ck_diagnostic_sessions_assessment_result_json",
      sql`${table.assessmentResultJson} IS NULL OR json_valid(${table.assessmentResultJson})`,
    ),
    check(
      "ck_diagnostic_sessions_completed",
      sql`${table.status} != 'completed' OR (${table.weaknessProfile} IS NOT NULL AND ${table.assessmentResultJson} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
    index("idx_diagnostic_sessions_learner_created").on(
      table.learner,
      table.deletedAt,
      table.createdAt,
    ),
  ],
);

// DB-011: weakness_profiles (Training Context — database-design.md §5b)
// 学習者ごとに1プロファイル（uq_weakness_profiles_learner）。
// focus_sounds_json は FocusSound 配列を JSON で保持する（NonEmptyList 不変条件）。
export const weaknessProfiles = sqliteTable(
  "weakness_profiles",
  {
    identifier: text("identifier").primaryKey(),
    learner: text("learner").notNull(),
    diagnosticSession: text("diagnostic_session")
      .notNull()
      .references(() => diagnosticSessions.identifier),
    focusSoundsJson: text("focus_sounds_json").notNull(),
    lastUpdatedAt: text("last_updated_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    unique("uq_weakness_profiles_learner").on(table.learner),
    check("ck_weakness_profiles_focus_sounds_json", sql`json_valid(${table.focusSoundsJson})`),
    index("idx_weakness_profiles_learner").on(table.learner, table.deletedAt),
  ],
);

// DB-009: finding_dismissals
export const findingDismissals = sqliteTable(
  "finding_dismissals",
  {
    identifier: text("identifier").primaryKey(),
    assessmentResult: text("assessment_result")
      .notNull()
      .references(() => assessmentResults.identifier),
    findingIdentifier: text("finding_identifier").notNull(),
    dismissedAt: integer("dismissed_at").notNull(),
    reason: text("reason"),
    undoneAt: integer("undone_at"),
  },
  (table) => [
    check("ck_finding_dismissals_dismissed_at", sql`${table.dismissedAt} > 0`),
    check(
      "ck_finding_dismissals_undone_at",
      sql`${table.undoneAt} IS NULL OR ${table.undoneAt} > ${table.dismissedAt}`,
    ),
    index("idx_finding_dismissals_assessment_result").on(table.assessmentResult, table.undoneAt),
    index("idx_finding_dismissals_finding").on(
      table.assessmentResult,
      table.findingIdentifier,
      table.undoneAt,
    ),
  ],
);
