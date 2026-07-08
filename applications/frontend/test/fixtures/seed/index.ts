/**
 * test/fixtures/seed/index.ts — 共有シード関数 (ADR-031 M-FCH-1)
 *
 * seedSkeleton: material → section_series → section の 3 行のみ作成する。
 * recording/analysis/assessment は実 route に委ねる。
 *
 * 使用ルール:
 * - テストスコープ専用 (test/ および e2e/ のみ)。
 * - db:migrate (committed migration) で構築した throwaway DB 上で動作させること。
 * - db:push は禁止。
 *
 * NOTE: この module を本番 src/ から import することは fitness (M-FCH-8/D7) で禁止されている。
 */

import Database from "better-sqlite3";

// ---------- ID generator ----------

/**
 * run-unique ID。prefix + timestamp36 + random6 で衝突を避ける。
 * 既存 e2e/helpers/seed.ts の makeId と同形式。
 */
function makeIdentifier(prefix: string): string {
  return `FC_${prefix}_${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

// ---------- Skeleton seed ----------

export type SkeletonIdentifiers = {
  materialIdentifier: string;
  sectionSeriesIdentifier: string;
  sectionIdentifier: string;
};

export type SeedSkeletonOptions = {
  /**
   * セクションの本文テキスト。デフォルト: "Hello world."
   */
  bodyText?: string;
  /**
   * マテリアルのタイトル。デフォルト: run-unique な文字列。
   */
  materialTitle?: string;
};

/**
 * seedSkeleton — material + section_series + section の 3 行を DB に挿入する。
 *
 * recording/analysis/assessment は実 route に委ねる (ADR-031 M-FCH-1)。
 * idempotent: 毎回 run-unique な識別子を生成するため、重複しない。
 *
 * @param database - better-sqlite3 Database インスタンス (throwaway DB)
 * @param opts     - オプション
 * @returns SkeletonIdentifiers - 生成した識別子
 */
export function seedSkeleton(
  database: InstanceType<typeof Database>,
  opts: SeedSkeletonOptions = {},
): SkeletonIdentifiers {
  const materialIdentifier = makeIdentifier("MAT");
  const sectionSeriesIdentifier = makeIdentifier("SS");
  const sectionIdentifier = makeIdentifier("SEC");

  const now = new Date().toISOString();
  const bodyText = opts.bodyText ?? "Hello world.";
  const materialTitle = opts.materialTitle ?? `FC Test Material ${materialIdentifier}`;

  // 1. materials
  database
    .prepare(
      `INSERT INTO materials (identifier, title, source_json, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?)`,
    )
    .run(materialIdentifier, materialTitle, now, now);

  // 2. section_series
  database
    .prepare(
      `INSERT INTO section_series (identifier, material, title, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(sectionSeriesIdentifier, materialIdentifier, "FC Section Series", 0, now, now);

  // 3. sections
  const bodyTextHash = Buffer.from(bodyText).toString("base64").slice(0, 32);
  database
    .prepare(
      `INSERT INTO sections (identifier, section_series, version_number, body_text, body_text_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(sectionIdentifier, sectionSeriesIdentifier, 1, bodyText, bodyTextHash, now);

  return { materialIdentifier, sectionSeriesIdentifier, sectionIdentifier };
}

// ---------- Cascade cleanup ----------

/**
 * cascadeCleanup — seedSkeleton が作成した行と、実 route が作成した下位行を全て削除する。
 *
 * FK-safe 順序 (子→親) で DELETE する。
 * 実 route が作成した recording_attempts / analysis_runs / analysis_jobs /
 * assessment_results / finding_dismissals も materialIdentifier を辿って削除する。
 *
 * @param database           - better-sqlite3 Database インスタンス
 * @param materialIdentifier - seedSkeleton が返した materialIdentifier
 */
export function cascadeCleanup(
  database: InstanceType<typeof Database>,
  materialIdentifier: string,
): void {
  // section_series を通じて sections を特定する
  const sections = database
    .prepare<string, { identifier: string }>(
      `SELECT s.identifier
       FROM sections s
       JOIN section_series ss ON s.section_series = ss.identifier
       WHERE ss.material = ?`,
    )
    .all(materialIdentifier);

  for (const section of sections) {
    // recording_attempts → analysis_runs → analysis_jobs → assessment_results の順
    const recordings = database
      .prepare<
        string,
        { identifier: string }
      >(`SELECT identifier FROM recording_attempts WHERE section = ?`)
      .all(section.identifier);

    for (const recording of recordings) {
      const analysisRuns = database
        .prepare<
          string,
          { identifier: string }
        >(`SELECT identifier FROM analysis_runs WHERE recording_attempt = ?`)
        .all(recording.identifier);

      for (const run of analysisRuns) {
        const jobs = database
          .prepare<
            string,
            { identifier: string }
          >(`SELECT identifier FROM analysis_jobs WHERE analysis_run = ?`)
          .all(run.identifier);

        for (const job of jobs) {
          // finding_dismissals → assessment_results
          database
            .prepare(
              `DELETE FROM finding_dismissals WHERE assessment_result IN (SELECT identifier FROM assessment_results WHERE analysis_job = ?)`,
            )
            .run(job.identifier);
          database
            .prepare(`DELETE FROM assessment_results WHERE analysis_job = ?`)
            .run(job.identifier);
        }
        database.prepare(`DELETE FROM analysis_jobs WHERE analysis_run = ?`).run(run.identifier);
      }
      database
        .prepare(`DELETE FROM analysis_runs WHERE recording_attempt = ?`)
        .run(recording.identifier);
      // audio_files has FK → recording_attempts; delete before the parent
      database
        .prepare(`DELETE FROM audio_files WHERE recording_attempt = ?`)
        .run(recording.identifier);
    }
    database.prepare(`DELETE FROM recording_attempts WHERE section = ?`).run(section.identifier);
  }

  // sections
  database
    .prepare(
      `DELETE FROM sections WHERE section_series IN (SELECT identifier FROM section_series WHERE material = ?)`,
    )
    .run(materialIdentifier);

  // section_series
  database.prepare(`DELETE FROM section_series WHERE material = ?`).run(materialIdentifier);

  // materials
  database.prepare(`DELETE FROM materials WHERE identifier = ?`).run(materialIdentifier);
}

// ---------- Re-exports from lifted seed logic ----------
// e2e/helpers/seed.ts の後方互換のために re-export する (ADR-031 M-FCH-1)。
// e2e/helpers/seed.ts は shim として本 module を re-export する。

export {
  seedWorkspaceV2,
  cleanupSeed,
  buildSeedIdentifiers,
  seedCompletedDiagnosticSession,
  cleanupDiagnosticSeed,
  seedProgressSnapshots,
  cleanupProgressSeed,
  cleanupAllProgressSnapshotsForSentinel,
  seedPendingDiagnosticSession,
} from "../../../e2e/helpers/seed.ts";

export type {
  SeedIdentifiers,
  DiagnosticSeedIdentifiers,
  ProgressSeedIdentifiers,
} from "../../../e2e/helpers/seed.ts";
