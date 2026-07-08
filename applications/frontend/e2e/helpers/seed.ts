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
// Playwright / vitest / fullcycle driver (node --experimental-strip-types) はいずれも
// CWD=applications/frontend で起動するため、CWD 基準で解決する (override: DB_PATH)。
// 注: このファイルに import.meta を書いてはならない。Node 24 の native TS require が
// ESM 判定し、Playwright の CJS transform 出力が ESM スコープで実行されて load 不能になる。
const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data/native-trace.db");

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

// ---- Diagnostic seed types ----

export type DiagnosticSeedIdentifiers = {
  diagnosticSession: string;
  weaknessProfile: string;
  material: string;
  sectionSeries: string;
  section: string;
  recordingAttempt: string;
  analysisRun: string;
  analysisJob: string;
  assessmentResult: string;
  findingIdentifier: string;
  learner: string;
};

function buildDiagnosticSeedIdentifiers(): DiagnosticSeedIdentifiers {
  return {
    diagnosticSession: makeId("DS"),
    weaknessProfile: makeId("WP"),
    material: makeId("MAT"),
    sectionSeries: makeId("SS"),
    section: makeId("SEC"),
    recordingAttempt: makeId("RA"),
    analysisRun: makeId("AR"),
    analysisJob: makeId("AJ"),
    assessmentResult: makeId("ARES"),
    findingIdentifier: makeId("FND"),
    // Use unique learner per test run to avoid uq_weakness_profiles_learner conflict
    learner: makeId("LRN"),
  };
}

function buildDiagnosticPromptSetJson() {
  return JSON.stringify({
    prompts: [
      {
        identifier: "prompt-seg-01",
        text: "The right light was placed on the street corner.",
        targetCatalogId: "SUB-l-r",
        phenomenon: "segmental",
      },
      {
        identifier: "prompt-epe-01",
        text: "Please stop at the next station.",
        targetCatalogId: "EPN-sC",
        phenomenon: "epenthesis",
      },
      {
        identifier: "prompt-pro-01",
        text: "I believe the project will succeed.",
        targetCatalogId: null,
        phenomenon: "prosodic",
      },
    ],
  });
}

function buildDiagnosticFocusSoundsJson() {
  return JSON.stringify([
    {
      contrast: "/l/·/r/",
      catalogId: "SUB-l-r",
      functionalLoadRank: "max",
      occurrenceFrequency: 0.8,
      mastery: 0.2,
      priority: 0.74,
    },
    {
      contrast: "/æ/·/ʌ/",
      catalogId: "SUB-ae-a",
      functionalLoadRank: "high",
      occurrenceFrequency: 0.5,
      mastery: 0.4,
      priority: 0.545,
    },
    {
      contrast: "epenthesis-sC",
      catalogId: "EPN-sC",
      functionalLoadRank: "mid",
      occurrenceFrequency: 0.6,
      mastery: 0.3,
      priority: 0.43,
    },
  ]);
}

function buildDiagnosticAssessmentResultJson(findingIdentifier: string) {
  return JSON.stringify({
    scores: {
      overall: 68,
      accuracy: 62,
      nativeLikeness: 58,
      pronunciation: 65,
      connectedSpeech: 72,
      prosody: 60,
      intelligibility: 65,
      cefrOverall: { score: 62, band: "B1" },
      cefrSegmental: { score: 58, band: "A2+" },
      cefrProsodic: { score: 60, band: "B1" },
    },
    summary: {
      overallCommentJa: "全体的に通じる発音ですが、/l/-/r/の混同と母音挿入が顕著です。",
      overallCommentEn: null,
    },
    findings: [
      {
        identifier: findingIdentifier,
        phenomenon: "substitution",
        gop: -9.2,
        category: "pronunciation",
        severity: "major",
        textRange: { startOffset: 4, endOffset: 9 },
        audioRange: { startMilliseconds: 200, endMilliseconds: 650 },
        expected: { text: "right", ipa: "raɪt" },
        detected: { text: "right", ipa: "laɪt" },
        messageJa: "「right」の /r/ が /l/ に置き換わっています",
        messageEn: null,
        scoreImpact: -4,
        confidence: 0.91,
        detectedTopCandidate: "l",
        nBest: [
          { phoneme: "l", confidence: 0.78 },
          { phoneme: "r", confidence: 0.14 },
        ],
        matchesL1Pattern: true,
        functionalLoad: "max",
        catalogId: "SUB-l-r",
        wordPair: null,
        expectedPronunciation: null,
        insertedVowel: null,
        feedbackLayers: {
          whatJa: "/r/ が /l/ として実現されています",
          whyJa: "日本語の「ら行」は /r/ でも /l/ でもなく、英語の両音と混同されやすいです",
          howJa: "舌先を口の中に浮かせ、どこにも触れずに /r/ を発音してください",
        },
        dismissed: false,
        wordPositionLabel: "initial",
      },
    ],
    segments: [],
    metadata: {
      engineName: "NativeTrace OSS Worker v1",
      engineVersion: "1.0.0",
      modelName: "wav2vec2-large-xlsr-53",
      promptVersion: null,
      schemaVersion: "2.0.0",
    },
    tokenizerVersion: "e2e-diagnostic-seed-v1",
    perPhonemeGop: [],
    focusSounds: [],
    prosody: null,
    engineSummaryMessageJa: "/l/-/r/の置換が検出されました。",
  });
}

/**
 * seedCompletedDiagnosticSession — 完了済み DiagnosticSession + WeaknessProfile をDBに投入する。
 *
 * 結果画面 e2e テスト用。FK-safe 順序で INSERT する。
 * weakness_profiles の uq_weakness_profiles_learner 制約のため、実行ごとに異なる learner を使う。
 */
export function seedCompletedDiagnosticSession(): DiagnosticSeedIdentifiers {
  const ids = buildDiagnosticSeedIdentifiers();
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();

  // 1. material (diagnostic 専用セクションの親)
  db.prepare(
    `INSERT INTO materials (identifier, title, source_json, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`,
  ).run(ids.material, "E2E Diagnostic Material", now, now);

  // 2. section_series
  db.prepare(
    `INSERT INTO section_series (identifier, material, title, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ids.sectionSeries, ids.material, "E2E Diagnostic Series", 0, now, now);

  // 3. section
  const bodyText = "The right light was placed on the street corner.";
  const bodyTextHash = Buffer.from(bodyText).toString("base64").slice(0, 32);
  db.prepare(
    `INSERT INTO sections (identifier, section_series, version_number, body_text, body_text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ids.section, ids.sectionSeries, 1, bodyText, bodyTextHash, now);

  // 4. recording_attempt (uploaded_file + ready)
  db.prepare(
    `INSERT INTO recording_attempts (identifier, section, status, input_kind, original_file_name, duration_milliseconds, created_at, updated_at) VALUES (?, ?, 'ready', 'uploaded_file', 'diag-e2e.wav', 4500, ?, ?)`,
  ).run(ids.recordingAttempt, ids.section, now, now);

  // 5. analysis_run
  db.prepare(
    `INSERT INTO analysis_runs (identifier, recording_attempt, mode, status, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'oss_worker_only', 'succeeded', ?, ?, ?, ?)`,
  ).run(ids.analysisRun, ids.recordingAttempt, now, now, now, now);

  // 6. analysis_job
  db.prepare(
    `INSERT INTO analysis_jobs (identifier, analysis_run, engine, engine_config_json, status, attempt_count, max_attempts, next_run_at, queued_at, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'oss_worker', '{}', 'succeeded', 1, 3, ?, ?, ?, ?, ?, ?)`,
  ).run(ids.analysisJob, ids.analysisRun, now, now, now, now, now, now);

  // 7. assessment_result
  const assessmentResultJson = buildDiagnosticAssessmentResultJson(ids.findingIdentifier);
  const engineSnapshotJson = JSON.stringify({
    type: "oss_worker",
    identifier: "oss_worker_e2e_diag",
    displayName: "NativeTrace OSS Worker (E2E Diagnostic)",
    modelName: "wav2vec2-large-xlsr-53",
  });
  const rawResponseJson = JSON.stringify({ data: { source: "e2e-diagnostic-seed" } });

  db.prepare(
    `INSERT INTO assessment_results (identifier, analysis_job, overall_score, accuracy_score, native_likeness_score, pronunciation_score, connected_speech_score, prosody_score, assessment_result_json, raw_response_json, engine_snapshot_json, tokenizer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.assessmentResult,
    ids.analysisJob,
    68,
    62,
    58,
    65,
    72,
    60,
    assessmentResultJson,
    rawResponseJson,
    engineSnapshotJson,
    "e2e-diagnostic-seed-v1",
    now,
  );

  // 8. diagnostic_session (completed)
  const promptSetJson = buildDiagnosticPromptSetJson();
  const assessmentResultJsonArray = JSON.stringify([ids.assessmentResult]);
  db.prepare(
    `INSERT INTO diagnostic_sessions (identifier, learner, prompt_set_json, status, weakness_profile, assessment_result_json, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
  ).run(
    ids.diagnosticSession,
    ids.learner,
    promptSetJson,
    ids.weaknessProfile,
    assessmentResultJsonArray,
    now,
    now,
    now,
    now,
  );

  // 9. weakness_profile
  const focusSoundsJson = buildDiagnosticFocusSoundsJson();
  db.prepare(
    `INSERT INTO weakness_profiles (identifier, learner, diagnostic_session, focus_sounds_json, last_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(ids.weaknessProfile, ids.learner, ids.diagnosticSession, focusSoundsJson, now, now, now);

  db.close();
  return ids;
}

/**
 * seedPendingDiagnosticSession — pending 状態の DiagnosticSession をDBに投入する。
 *
 * 診断中画面 e2e テスト用。
 */
export function seedPendingDiagnosticSession(): DiagnosticSeedIdentifiers {
  const ids = buildDiagnosticSeedIdentifiers();
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();

  const promptSetJson = buildDiagnosticPromptSetJson();

  db.prepare(
    `INSERT INTO diagnostic_sessions (identifier, learner, prompt_set_json, status, weakness_profile, assessment_result_json, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', NULL, NULL, ?, NULL, ?, ?)`,
  ).run(ids.diagnosticSession, ids.learner, promptSetJson, now, now, now);

  db.close();
  return ids;
}

/**
 * cleanupDiagnosticSeed — diagnostic seed の後始末（FK-safe 順序で DELETE）。
 */
export function cleanupDiagnosticSeed(ids: DiagnosticSeedIdentifiers): void {
  const db = new Database(DB_PATH);

  // weakness_profiles → diagnostic_sessions → assessment chain → section chain
  db.prepare(`DELETE FROM weakness_profiles WHERE identifier = ?`).run(ids.weaknessProfile);
  db.prepare(`DELETE FROM diagnostic_sessions WHERE identifier = ?`).run(ids.diagnosticSession);

  if (ids.assessmentResult) {
    db.prepare(`DELETE FROM finding_dismissals WHERE assessment_result = ?`).run(
      ids.assessmentResult,
    );
    db.prepare(`DELETE FROM assessment_results WHERE identifier = ?`).run(ids.assessmentResult);
  }
  if (ids.analysisJob) {
    db.prepare(`DELETE FROM analysis_jobs WHERE identifier = ?`).run(ids.analysisJob);
  }
  if (ids.analysisRun) {
    db.prepare(`DELETE FROM analysis_runs WHERE identifier = ?`).run(ids.analysisRun);
  }
  if (ids.recordingAttempt) {
    db.prepare(`DELETE FROM recording_attempts WHERE identifier = ?`).run(ids.recordingAttempt);
  }
  if (ids.section) {
    db.prepare(`DELETE FROM sections WHERE identifier = ?`).run(ids.section);
  }
  if (ids.sectionSeries) {
    db.prepare(`DELETE FROM section_series WHERE identifier = ?`).run(ids.sectionSeries);
  }
  if (ids.material) {
    db.prepare(`DELETE FROM materials WHERE identifier = ?`).run(ids.material);
  }

  db.close();
}

// ---- Progress snapshot seed types ----

/**
 * sentinel learner ULID — infrastructure/config の診断固定学習者識別子と一致させる。
 * E2E では実際の API が使う config と同じ値を参照する。
 */
const SENTINEL_LEARNER = "01JWZLEARNER0000000000001";

export type ProgressSeedIdentifiers = {
  learner: string;
  snapshots: Array<{
    snapshot: string;
    section: string;
    sectionSeries: string;
    material: string;
    recordingAttempt: string;
    analysisRun: string;
    analysisJob: string;
    assessmentResult: string;
  }>;
};

function buildProgressSnapshotFocusScoresJson() {
  return JSON.stringify([
    { contrast: "/l/·/r/", score: 42 },
    { contrast: "/æ/·/ʌ/", score: 55 },
    { contrast: "epenthesis-sC", score: 63 },
  ]);
}

function buildProgressSnapshotFocusScoresJsonV2() {
  return JSON.stringify([
    { contrast: "/l/·/r/", score: 48 },
    { contrast: "/æ/·/ʌ/", score: 60 },
    { contrast: "epenthesis-sC", score: 67 },
  ]);
}

function buildProgressAssessmentResultJson(findingIdentifier: string) {
  return JSON.stringify({
    scores: {
      overall: 64,
      accuracy: 60,
      nativeLikeness: 55,
      pronunciation: 62,
      connectedSpeech: 70,
      prosody: 58,
      intelligibility: 62,
      cefrOverall: { score: 58, band: "B1" },
      cefrSegmental: { score: 54, band: "A2+" },
      cefrProsodic: { score: 46, band: "A2" },
    },
    summary: { overallCommentJa: "E2E progress seed snapshot", overallCommentEn: null },
    findings: [
      {
        identifier: findingIdentifier,
        phenomenon: "substitution",
        gop: -9.0,
        category: "pronunciation",
        severity: "major",
        textRange: { startOffset: 4, endOffset: 9 },
        audioRange: null,
        expected: { text: "right", ipa: "raɪt" },
        detected: { text: "right", ipa: "laɪt" },
        messageJa: "/r/ → /l/ 置換",
        messageEn: null,
        scoreImpact: -4,
        confidence: 0.9,
        detectedTopCandidate: "l",
        nBest: [],
        matchesL1Pattern: true,
        functionalLoad: "max",
        catalogId: "SUB-l-r",
        wordPair: null,
        expectedPronunciation: null,
        insertedVowel: null,
        feedbackLayers: null,
        dismissed: false,
        wordPositionLabel: "initial",
      },
    ],
    segments: [],
    metadata: {
      engineName: "NativeTrace OSS Worker v1",
      engineVersion: "1.0.0",
      modelName: "wav2vec2-large-xlsr-53",
      promptVersion: null,
      schemaVersion: "2.0.0",
    },
    tokenizerVersion: "e2e-progress-seed-v1",
    perPhonemeGop: [],
    focusSounds: [],
    prosody: null,
    engineSummaryMessageJa: "E2E progress seed",
  });
}

function buildProgressAssessmentResultJsonV2(findingIdentifier: string) {
  return JSON.stringify({
    scores: {
      overall: 70,
      accuracy: 66,
      nativeLikeness: 62,
      pronunciation: 68,
      connectedSpeech: 74,
      prosody: 63,
      intelligibility: 68,
      cefrOverall: { score: 64, band: "B1" },
      cefrSegmental: { score: 58, band: "B1" },
      cefrProsodic: { score: 50, band: "A2+" },
    },
    summary: { overallCommentJa: "E2E progress seed snapshot v2", overallCommentEn: null },
    findings: [
      {
        identifier: findingIdentifier,
        phenomenon: "substitution",
        gop: -7.5,
        category: "pronunciation",
        severity: "major",
        textRange: { startOffset: 4, endOffset: 9 },
        audioRange: null,
        expected: { text: "right", ipa: "raɪt" },
        detected: { text: "right", ipa: "laɪt" },
        messageJa: "/r/ → /l/ 置換（改善中）",
        messageEn: null,
        scoreImpact: -3,
        confidence: 0.88,
        detectedTopCandidate: "l",
        nBest: [],
        matchesL1Pattern: true,
        functionalLoad: "max",
        catalogId: "SUB-l-r",
        wordPair: null,
        expectedPronunciation: null,
        insertedVowel: null,
        feedbackLayers: null,
        dismissed: false,
        wordPositionLabel: "initial",
      },
    ],
    segments: [],
    metadata: {
      engineName: "NativeTrace OSS Worker v1",
      engineVersion: "1.0.0",
      modelName: "wav2vec2-large-xlsr-53",
      promptVersion: null,
      schemaVersion: "2.0.0",
    },
    tokenizerVersion: "e2e-progress-seed-v2",
    perPhonemeGop: [],
    focusSounds: [],
    prosody: null,
    engineSummaryMessageJa: "E2E progress seed v2",
  });
}

/**
 * seedProgressSnapshots — progress_snapshots を指定件数 DB に投入する。
 *
 * count=0: スナップショットなし (honest empty 検証用)
 * count=1: baseline 1 件 (prev なし)
 * count=2+: 複数 (prev あり / 比較再生有効)
 *
 * FK-safe 順序: material → section_series → sections → recording_attempts
 *   → analysis_runs → analysis_jobs → assessment_results → progress_snapshots
 *
 * sentinel learner (SENTINEL_LEARNER) を learner 列に使う。
 */
export function seedProgressSnapshots(count: number): ProgressSeedIdentifiers {
  if (count < 0 || count > 2) throw new Error("count must be 0, 1, or 2");

  const db = new Database(DB_PATH);
  const baseNow = new Date("2025-01-15T10:00:00.000Z");
  const snapshots: ProgressSeedIdentifiers["snapshots"] = [];

  for (let i = 0; i < count; i++) {
    const capturedAt = new Date(baseNow.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = capturedAt;

    const materialId = makeId("PGMAT");
    const sectionSeriesId = makeId("PGSS");
    const sectionId = makeId("PGSEC");
    const recordingAttemptId = makeId("PGRA");
    const analysisRunId = makeId("PGAR");
    const analysisJobId = makeId("PGAJ");
    const assessmentResultId = makeId("PGARES");
    const findingId = makeId("PGFND");
    const snapshotId = makeId("PGSNAP");

    // material
    db.prepare(
      `INSERT INTO materials (identifier, title, source_json, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`,
    ).run(materialId, `E2E Progress Material ${i + 1}`, now, now);

    // section_series
    db.prepare(
      `INSERT INTO section_series (identifier, material, title, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(sectionSeriesId, materialId, `E2E Progress Series ${i + 1}`, 0, now, now);

    // section
    const bodyText = "The right light was placed on the street corner.";
    const bodyTextHash = Buffer.from(bodyText + i)
      .toString("base64")
      .slice(0, 32);
    db.prepare(
      `INSERT INTO sections (identifier, section_series, version_number, body_text, body_text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(sectionId, sectionSeriesId, 1, bodyText, bodyTextHash, now);

    // recording_attempt
    db.prepare(
      `INSERT INTO recording_attempts (identifier, section, status, input_kind, original_file_name, duration_milliseconds, created_at, updated_at) VALUES (?, ?, 'ready', 'uploaded_file', 'progress-e2e.wav', 4500, ?, ?)`,
    ).run(recordingAttemptId, sectionId, now, now);

    // analysis_run
    db.prepare(
      `INSERT INTO analysis_runs (identifier, recording_attempt, mode, status, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'oss_worker_only', 'succeeded', ?, ?, ?, ?)`,
    ).run(analysisRunId, recordingAttemptId, now, now, now, now);

    // analysis_job
    db.prepare(
      `INSERT INTO analysis_jobs (identifier, analysis_run, engine, engine_config_json, status, attempt_count, max_attempts, next_run_at, queued_at, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'oss_worker', '{}', 'succeeded', 1, 3, ?, ?, ?, ?, ?, ?)`,
    ).run(analysisJobId, analysisRunId, now, now, now, now, now, now);

    // assessment_result
    const assessmentJson =
      i === 0
        ? buildProgressAssessmentResultJson(findingId)
        : buildProgressAssessmentResultJsonV2(findingId);
    const engineSnapshotJson = JSON.stringify({
      type: "oss_worker",
      identifier: "oss_worker_e2e_progress",
      displayName: "NativeTrace OSS Worker (E2E Progress)",
      modelName: "wav2vec2-large-xlsr-53",
    });
    const rawResponseJson = JSON.stringify({ data: { source: "e2e-progress-seed" } });
    db.prepare(
      `INSERT INTO assessment_results (identifier, analysis_job, overall_score, accuracy_score, native_likeness_score, pronunciation_score, connected_speech_score, prosody_score, assessment_result_json, raw_response_json, engine_snapshot_json, tokenizer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      assessmentResultId,
      analysisJobId,
      i === 0 ? 64 : 70,
      i === 0 ? 60 : 66,
      i === 0 ? 55 : 62,
      i === 0 ? 62 : 68,
      i === 0 ? 70 : 74,
      i === 0 ? 58 : 63,
      assessmentJson,
      rawResponseJson,
      engineSnapshotJson,
      `e2e-progress-seed-v${i + 1}`,
      now,
    );

    // progress_snapshot
    const focusJson =
      i === 0 ? buildProgressSnapshotFocusScoresJson() : buildProgressSnapshotFocusScoresJsonV2();
    db.prepare(
      `INSERT INTO progress_snapshots (identifier, learner, section, source_assessment, task_kind, cefr_overall_score, cefr_segmental_score, cefr_prosodic_score, focus_scores_json, cumulative_training_minutes, captured_at, created_at, deleted_at) VALUES (?, ?, ?, ?, 'rereading', ?, ?, ?, ?, 0, ?, ?, NULL)`,
    ).run(
      snapshotId,
      SENTINEL_LEARNER,
      sectionId,
      assessmentResultId,
      i === 0 ? 58 : 64,
      i === 0 ? 54 : 58,
      i === 0 ? 46 : 50,
      focusJson,
      capturedAt,
      now,
    );

    snapshots.push({
      snapshot: snapshotId,
      section: sectionId,
      sectionSeries: sectionSeriesId,
      material: materialId,
      recordingAttempt: recordingAttemptId,
      analysisRun: analysisRunId,
      analysisJob: analysisJobId,
      assessmentResult: assessmentResultId,
    });
  }

  db.close();
  return { learner: SENTINEL_LEARNER, snapshots };
}

/**
 * cleanupProgressSeed — progress_snapshots seed の後始末（FK-safe 順序で DELETE）。
 */
export function cleanupProgressSeed(ids: ProgressSeedIdentifiers): void {
  const db = new Database(DB_PATH);

  for (const snap of ids.snapshots) {
    db.prepare(`DELETE FROM progress_snapshots WHERE identifier = ?`).run(snap.snapshot);
    db.prepare(`DELETE FROM finding_dismissals WHERE assessment_result = ?`).run(
      snap.assessmentResult,
    );
    db.prepare(`DELETE FROM assessment_results WHERE identifier = ?`).run(snap.assessmentResult);
    db.prepare(`DELETE FROM analysis_jobs WHERE identifier = ?`).run(snap.analysisJob);
    db.prepare(`DELETE FROM analysis_runs WHERE identifier = ?`).run(snap.analysisRun);
    db.prepare(`DELETE FROM recording_attempts WHERE identifier = ?`).run(snap.recordingAttempt);
    db.prepare(`DELETE FROM sections WHERE identifier = ?`).run(snap.section);
    db.prepare(`DELETE FROM section_series WHERE identifier = ?`).run(snap.sectionSeries);
    db.prepare(`DELETE FROM materials WHERE identifier = ?`).run(snap.material);
  }

  db.close();
}

/**
 * cleanupAllProgressSnapshotsForSentinel — sentinel learner の全 progress_snapshot を削除する。
 *
 * E2E テスト間の干渉を防ぐため、各テストシナリオの beforeAll で呼び出す。
 * sentinel learner を共有しているため、他のテストが挿入したデータが残ると
 * API レスポンスに混入し honest empty の assert が失敗する。
 */
export function cleanupAllProgressSnapshotsForSentinel(): void {
  const db = new Database(DB_PATH);
  // sentinel learner の全スナップショットを soft delete ではなく物理削除
  db.prepare(`DELETE FROM progress_snapshots WHERE learner = ?`).run(SENTINEL_LEARNER);
  db.close();
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
