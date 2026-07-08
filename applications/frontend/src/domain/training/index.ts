/**
 * Training Context — domain layer (barrel)
 *
 * 設計の正: docs/03-detailed-design/domain.md §14 (DD-200/201/260-263)
 *          docs/specs/diagnostic-screen.md M-DG-1/3/4
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *          adr/010-diagnostic-weakness-profile-focus-derivation.md (重み/α はconfig由来)
 *
 * domain 純粋性: I/O なし、class 構文禁止、数値 literal 禁止 (DD-293)
 * 他 BC 参照: AssessmentResultIdentifier / SectionIdentifier を識別子のみで参照
 *
 * 集約ごとに以下へ分割済み（importer 側の import パスは本ファイルのまま変わらない）:
 * - diagnostic.ts        — DiagnosticSession + WeaknessProfile (DD-200/201/260-263)
 * - progress-snapshot.ts — ProgressSnapshot (DD-205/268)
 * - training-session.ts  — TrainingSession (DD-202/241/242/264)
 * - hvpt-trial.ts        — HvptTrial (DD-203/245/246/265/266)
 * - spacing-schedule.ts  — SpacingSchedule (DD-204/248/267)
 */

export * from "./diagnostic";
export * from "./progress-snapshot";
export * from "./training-session";
export * from "./hvpt-trial";
export * from "./spacing-schedule";
