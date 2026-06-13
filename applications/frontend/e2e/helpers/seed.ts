/**
 * E2E seed helper — テスト専用 SQLite 直接 INSERT
 *
 * 本番コードへの依存なし。better-sqlite3 を直接使い、
 * assessment_result JSON を自力で組み立てて DB に投入する。
 *
 * 呼び出し: beforeAll で `seedWorkspaceV2()` を実行して
 *   返値の `sectionIdentifier` をテスト URL に使う。
 *
 * cleanup: afterAll で `cleanupSeed(seedIdentifiers)` を呼ぶ。
 */

import Database from "better-sqlite3";
import path from "path";

// ---- DB path ----
// Next.js は CWD=applications/frontend で起動するため DB_PATH もその相対パス
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, "../../data/native-trace.db");

// ---- Seed identifiers (固定 ULID-like; E2E run ごとに一意にしたい場合は randomUUID に替えてよい) ----
export type SeedIdentifiers = {
  material: string;
  sectionSeries: string;
  section: string;
  recordingAttempt: string;
  analysisRun: string;
  analysisJob: string;
  assessmentResult: string;
  findingIdentifier: string;
};

function makeId(prefix: string): string {
  return `E2E_${prefix}_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function buildSeedIdentifiers(): SeedIdentifiers {
  return {
    material: makeId("MAT"),
    sectionSeries: makeId("SS"),
    section: makeId("SEC"),
    recordingAttempt: makeId("RA"),
    analysisRun: makeId("AR"),
    analysisJob: makeId("AJ"),
    assessmentResult: makeId("ARES"),
    findingIdentifier: makeId("FND"),
  };
}

// ---- Finding data with v2 fields ----
function buildFinding(findingIdentifier: string) {
  // substitution finding: "Hello" (0..5) → "ɦɛ.loʊ" expected vs "hɛ.loʊ" detected
  return {
    identifier: findingIdentifier,
    phenomenon: "substitution",
    gop: -8.5,
    category: "pronunciation",
    severity: "major",
    textRange: { startOffset: 0, endOffset: 5 },
    audioRange: { startMilliseconds: 0, endMilliseconds: 420 },
    expected: { text: "Hello", ipa: "hɛloʊ" },
    detected: { text: "Hello", ipa: "ɦɛloʊ" },
    messageJa: "「Hello」の語頭 /h/ が有声化しています",
    messageEn: null,
    scoreImpact: -3,
    confidence: 0.87,
    // v2 fields
    detectedTopCandidate: "ɦ",
    nBest: [
      { phoneme: "ɦ", confidence: 0.72 },
      { phoneme: "h", confidence: 0.18 },
      { phoneme: "x", confidence: 0.05 },
    ],
    matchesL1Pattern: true,
    functionalLoad: "high",
    catalogId: "SUB-h-voiced",
    wordPair: null,
    expectedPronunciation: null,
    insertedVowel: null,
    feedbackLayers: {
      whatJa: "語頭の /h/ が有声の [ɦ] として実現されています",
      whyJa: "日本語には有声摩擦音 [ɦ] が現れないため、英語の /h/ と混同されやすいです",
      howJa: "喉を閉めずに息を漏らすように /h/ を発音してください。「ハ」の息だけの部分を使います",
    },
    dismissed: false,
    wordPositionLabel: "initial",
  };
}

// ---- Assessment result JSON ----
function buildAssessmentResultJson(findingIdentifier: string) {
  const finding = buildFinding(findingIdentifier);
  return {
    scores: {
      overall: 72,
      accuracy: 68,
      nativeLikeness: 65,
      pronunciation: 70,
      connectedSpeech: 80,
      prosody: 75,
      intelligibility: 70,
      cefrOverall: { score: 65, band: "B1" },
      cefrSegmental: { score: 62, band: "B1" },
      cefrProsodic: { score: 70, band: "B1+" },
    },
    summary: {
      overallCommentJa:
        "全体的に通じる英語ですが、語頭の子音発音と母音の調音位置に改善の余地があります。",
      overallCommentEn: null,
    },
    findings: [finding],
    segments: [
      {
        textRange: { startOffset: 0, endOffset: 42 },
        audioRange: { startMilliseconds: 0, endMilliseconds: 3200 },
        transcript: "Hello world this is a pronunciation test",
        confidence: 0.91,
      },
    ],
    metadata: {
      engineName: "NativeTrace OSS Worker v1",
      engineVersion: "1.0.0",
      modelName: "wav2vec2-large-xlsr-53",
      promptVersion: null,
      schemaVersion: "2.0.0",
    },
    tokenizerVersion: "e2e-seed-v1",
    // v2: perPhonemeGop — GOP ヒートマップ用
    perPhonemeGop: [
      { word: "Hello", phoneme: "h", gop: -2.1, heat: 0.3 },
      { word: "Hello", phoneme: "ɛ", gop: 5.4, heat: 0.85 },
      { word: "Hello", phoneme: "l", gop: 6.2, heat: 0.9 },
      { word: "Hello", phoneme: "oʊ", gop: 4.8, heat: 0.75 },
      { word: "world", phoneme: "w", gop: 7.1, heat: 0.95 },
      { word: "world", phoneme: "ɜː", gop: 3.2, heat: 0.55 },
      { word: "world", phoneme: "l", gop: 5.8, heat: 0.88 },
      { word: "world", phoneme: "d", gop: 6.5, heat: 0.91 },
    ],
    // v2: focusSounds
    focusSounds: [
      {
        pair: "h/ɦ",
        phenomenon: "substitution",
        functionalLoad: "high",
        occurrences: 1,
        priority: "now",
        reasonJa: "高 FL かつ日本語話者典型パターン",
        catalogId: "SUB-h-voiced",
      },
    ],
    // v2: prosody
    prosody: {
      f0Contour: {
        timesMs: [0, 100, 200, 300, 400, 500],
        valuesHz: [0, 180, 220, 200, 160, 0],
      },
      wordStress: [
        { word: "Hello", wordIndex: 0, expectedStress: 1, predictedStress: 1 },
        { word: "world", wordIndex: 1, expectedStress: 1, predictedStress: 0 },
      ],
      rhythmNpvi: 42.5,
      referenceNpvi: 48.2,
      weakFormRate: 0.65,
    },
    engineSummaryMessageJa: "語頭 /h/ の有声化が確認されました。明瞭性スコアは通じるレベルです。",
  };
}

// ---- Engine snapshot ----
function buildEngineSnapshot() {
  return {
    type: "oss_worker",
    identifier: "oss_worker_e2e_seed",
    displayName: "NativeTrace OSS Worker (E2E Seed)",
    modelName: "wav2vec2-large-xlsr-53",
  };
}

// ---- Main seed function ----
export function seedWorkspaceV2(): SeedIdentifiers {
  const ids = buildSeedIdentifiers();
  const db = new Database(DB_PATH);

  const now = new Date().toISOString();

  // materials
  db.prepare(
    `INSERT INTO materials (identifier, title, source_json, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`,
  ).run(ids.material, "E2E Test Material (workspace-v2 smoke)", now, now);

  // section_series
  db.prepare(
    `INSERT INTO section_series (identifier, material, title, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ids.sectionSeries, ids.material, "E2E Section Series", 0, now, now);

  // sections
  const bodyText = "Hello world, this is a pronunciation test.";
  const bodyTextHash = Buffer.from(bodyText).toString("base64").slice(0, 32);
  db.prepare(
    `INSERT INTO sections (identifier, section_series, version_number, body_text, body_text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ids.section, ids.sectionSeries, 1, bodyText, bodyTextHash, now);

  // recording_attempts (status='ready', input_kind='uploaded_file')
  // ck_recording_attempts_ready_duration: status='ready' requires duration_milliseconds NOT NULL
  // ck_recording_attempts_uploaded_origin: uploaded_file + ready requires original_file_name, no started_at/ended_at/browser_info
  db.prepare(
    `INSERT INTO recording_attempts (identifier, section, status, input_kind, original_file_name, duration_milliseconds, created_at, updated_at) VALUES (?, ?, 'ready', 'uploaded_file', 'e2e-test.wav', 3000, ?, ?)`,
  ).run(ids.recordingAttempt, ids.section, now, now);

  // analysis_runs
  db.prepare(
    `INSERT INTO analysis_runs (identifier, recording_attempt, mode, status, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'oss_worker_only', 'succeeded', ?, ?, ?, ?)`,
  ).run(ids.analysisRun, ids.recordingAttempt, now, now, now, now);

  // analysis_jobs (status='succeeded')
  db.prepare(
    `INSERT INTO analysis_jobs (identifier, analysis_run, engine, engine_config_json, status, attempt_count, max_attempts, next_run_at, queued_at, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'oss_worker', '{}', 'succeeded', 1, 3, ?, ?, ?, ?, ?, ?)`,
  ).run(ids.analysisJob, ids.analysisRun, now, now, now, now, now, now);

  // assessment_results
  const assessmentResultJson = JSON.stringify(buildAssessmentResultJson(ids.findingIdentifier));
  const engineSnapshotJson = JSON.stringify(buildEngineSnapshot());
  const rawResponseJson = JSON.stringify({ data: { source: "e2e-seed" } });

  db.prepare(
    `INSERT INTO assessment_results (identifier, analysis_job, overall_score, accuracy_score, native_likeness_score, pronunciation_score, connected_speech_score, prosody_score, assessment_result_json, raw_response_json, engine_snapshot_json, tokenizer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.assessmentResult,
    ids.analysisJob,
    72,
    68,
    65,
    70,
    80,
    75,
    assessmentResultJson,
    rawResponseJson,
    engineSnapshotJson,
    "e2e-seed-v1",
    now,
  );

  db.close();
  return ids;
}

// ---- Cleanup function ----
export function cleanupSeed(ids: SeedIdentifiers): void {
  const db = new Database(DB_PATH);

  // Delete in FK-safe order (children first)
  db.prepare(`DELETE FROM finding_dismissals WHERE assessment_result = ?`).run(
    ids.assessmentResult,
  );
  db.prepare(`DELETE FROM assessment_results WHERE identifier = ?`).run(ids.assessmentResult);
  db.prepare(`DELETE FROM analysis_jobs WHERE identifier = ?`).run(ids.analysisJob);
  db.prepare(`DELETE FROM analysis_runs WHERE identifier = ?`).run(ids.analysisRun);
  db.prepare(`DELETE FROM recording_attempts WHERE identifier = ?`).run(ids.recordingAttempt);
  db.prepare(`DELETE FROM sections WHERE identifier = ?`).run(ids.section);
  db.prepare(`DELETE FROM section_series WHERE identifier = ?`).run(ids.sectionSeries);
  db.prepare(`DELETE FROM materials WHERE identifier = ?`).run(ids.material);

  db.close();
}
