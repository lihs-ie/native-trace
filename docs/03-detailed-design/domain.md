---
title: "NativeTrace ドメイン層設計書"
version: "1.0.0"
status: "draft"
created: "2026-06-02"
last_updated: "2026-06-03"
author: "lihs"
---

# ドメイン層設計書

## 1. はじめに

### 1.1 目的

本文書は、NativeTrace のドメイン層設計を定義する。設計基準は関数型ドメインモデリングとし、代数的データ型、Smart Constructor、Choice Type、NonEmptyList、Result型、Domain Event によって不正状態を作れないモデルを目指す。

NativeTrace の中心は、題材内のセクション系列に本文版を定義し、そのSectionを練習し、録音停止後に自動解析され、本文ハイライトで結果を確認する `PracticeSection` ワークフローである。本文書では、このワークフローを支える境界づけられたコンテキスト、集約、値オブジェクト、状態型、ドメイン関数、ドメインイベント、仕様/ポリシーを定義する。

TypeScript実装では `class` を使用せず、`type`、branded type、factory関数、pure functionで表現する。ワークフロー入力は `Command`、出力は `Output` と命名する。状態変更を伴うワークフロー/ドメイン関数は `NonEmptyList<DomainEvent>` を返し、派生計算関数はイベントを返さない。

### 1.2 関連文書

**上流文書（入力）:**

- [要件定義書](../01-requirements/requirements-specification.md)
- [基本設計書](../02-system-design/system-design.md)
- [詳細設計書](detailed-design.md)

**同層文書（詳細設計）:**

- [ユースケース層設計書](use-case.md)
- [インフラストラクチャ層設計書](infrastructure.md)
- [ACL設計書](acl.md)

**下流文書（出力）:**

- [API仕様書](../04-api-specification/api-specification.md)
- [データベース設計書](../05-database-design/database-design.md)
- テスト仕様書（未作成）

### 1.3 ドメイン設計原則

- プリミティブ値をドメインに直接露出せず、Domain Wrapperを使う。
- 検証が必要な値はSmart Constructorで生成し、失敗は`Result`で返す。
- 状態はstatusフィールドとoptional fieldではなく、Choice Typeで表現する。
- 集約内エンティティは禁止する。各集約は独立した集約ルートとして扱う。
- 集約間参照は識別子のみで行う。
- 自己識別子フィールドは`identifier`、他集約参照フィールドは`material`、`section`、`recordingAttempt`のように関連先名で表す。
- ランダム性が必要な識別子はUUIDv4、不要で複合識別子にする必要がない識別子はULIDを使う。
- Domainは永続化、Repository、HTTP、OpenAI API、OSS worker、ファイルシステムを知らない。

## 2. 境界づけられたコンテキスト

### 2.1 コンテキストマップ

NativeTrace MVPでは、ドメインコンテキストを単一の `Pronunciation Practice Context` とする。OpenAI APIとOSS解析workerはドメイン外部の実装詳細であり、UseCase層のPortとACLを通して連携する。

```mermaid
graph TD
    subgraph PPC["Pronunciation Practice Context"]
        Material["Material"]
        SectionSeries["SectionSeries"]
        Section["Section"]
        Recording["RecordingAttempt / AudioFile"]
        Analysis["AnalysisRun / AnalysisJob"]
        Assessment["AssessmentResult"]
        Engine["AnalysisEngine"]
    end

    OpenAI["OpenAI API<br>external"] -.->|ACL via UseCase Port| PPC
    Worker["OSS Analysis Worker<br>external"] -.->|ACL via UseCase Port| PPC
    Storage["Local Audio Storage<br>infrastructure"] -.->|UseCase Port| PPC
    DB["SQLite / Drizzle<br>infrastructure"] -.->|UseCase Repository Port| PPC
```

### 2.2 コンテキスト定義

| ID | コンテキスト名 | 責務 | 上流下流関係 |
|---|---|---|---|
| DD-001 | Pronunciation Practice Context | 題材、セクション系列、Section本文版、録音、解析実行、解析結果、発音練習履歴に関するドメインルールを管理する | 外部OpenAI API、OSS worker、Storage、DBとはUseCase Port、ACL、Infrastructure経由で連携する |

### 2.3 コンテキスト内モジュール

| モジュール | 責務 |
|---|---|
| Material | 題材コンテナ、タイトル、任意ソース情報、削除状態 |
| SectionSeries | 題材内の練習セクション系列、表示順、タイトル、削除状態 |
| Section | SectionSeriesに属する本文版。本文改訂時に新しい版を作る |
| Recording | 録音試行と録音状態 |
| AudioFile | 音声ファイルの保存・削除ライフサイクル |
| Analysis | 解析実行単位、解析ジョブ、ジョブ状態遷移 |
| Assessment | エンジン別解析結果、スコア、指摘、セグメント |
| AnalysisEngine | クラウド解析/OSS worker解析エンジンのマスタ的ドメイン情報 |

## 3. ユビキタス言語

| 用語 | 英語名 | 定義 | コンテキスト | 関連要件 |
|---|---|---|---|---|
| 発音練習 | PracticeSection | セクション本文を読み上げ、録音し、解析結果を確認する中心ワークフロー | Pronunciation Practice | [REQ-003](../01-requirements/requirements-specification.md#req-003), [REQ-005](../01-requirements/requirements-specification.md#req-005) |
| 題材 | Material | TEDなどの練習元をまとめるコンテナ。本文は直接持たず、Section本文版が本文を持つ | Pronunciation Practice | [REQ-001](../01-requirements/requirements-specification.md#req-001) |
| セクション系列 | SectionSeries | 題材内の練習セクション枠。表示順、タイトル、削除状態を持つ | Pronunciation Practice | [REQ-002](../01-requirements/requirements-specification.md#req-002) |
| セクション本文版 | Section | SectionSeriesに属する英文本文の版。改訂時は旧版を上書きせず新しいSectionを作る | Pronunciation Practice | [REQ-002](../01-requirements/requirements-specification.md#req-002) |
| 録音試行 | RecordingAttempt | セクションに対する1回分の録音 | Pronunciation Practice | [REQ-003](../01-requirements/requirements-specification.md#req-003) |
| 音声ファイル | AudioFile | 録音試行に紐づく保存済み音声ファイルのドメイン表現 | Pronunciation Practice | [REQ-017](../01-requirements/requirements-specification.md#req-017), [REQ-019](../01-requirements/requirements-specification.md#req-019) |
| 解析実行 | AnalysisRun | 録音停止後に開始される解析実行のまとまり | Pronunciation Practice | [REQ-009](../01-requirements/requirements-specification.md#req-009) |
| 解析ジョブ | AnalysisJob | 解析エンジンごとに実行される個別ジョブ | Pronunciation Practice | [REQ-009](../01-requirements/requirements-specification.md#req-009), [REQ-010](../01-requirements/requirements-specification.md#req-010) |
| 解析エンジン | AnalysisEngine | OpenAI APIまたはOSS workerなど、発音解析を実行する能力のドメイン表現 | Pronunciation Practice | [REQ-005](../01-requirements/requirements-specification.md#req-005), [REQ-008](../01-requirements/requirements-specification.md#req-008) |
| 解析結果 | AssessmentResult | エンジン別に保存される不変の解析結果スナップショット | Pronunciation Practice | [REQ-010](../01-requirements/requirements-specification.md#req-010), [REQ-011](../01-requirements/requirements-specification.md#req-011) |
| 指摘 | AssessmentFinding | 発音、本文一致、韻律、連結発話などの問題箇所 | Pronunciation Practice | [REQ-012](../01-requirements/requirements-specification.md#req-012), [REQ-014](../01-requirements/requirements-specification.md#req-014) |
| セグメント | AssessmentSegment | 本文文字範囲と音声時間範囲を結びつける解析単位 | Pronunciation Practice | [REQ-014](../01-requirements/requirements-specification.md#req-014), [REQ-017](../01-requirements/requirements-specification.md#req-017) |
| 比較モード | Comparison Mode | Cloud engineとOSS worker engineを同じ録音に対して実行する解析モード | Pronunciation Practice | [REQ-005](../01-requirements/requirements-specification.md#req-005), [REQ-010](../01-requirements/requirements-specification.md#req-010) |

## 4. 集約設計

### 4.1 集約一覧

集約内エンティティは禁止する。以下のすべてを独立集約として扱う。

| ID | 集約名 | 集約ルート | 不変条件 | 関連要件 |
|---|---|---|---|---|
| DD-010 | Material Aggregate | Material | Activeな題材だけがSectionSeries作成元になれる。タイトルは空でない | [REQ-001](../01-requirements/requirements-specification.md#req-001) |
| DD-011 | SectionSeries Aggregate | SectionSeries | Activeな系列だけが改訂・録音対象Sectionの親になれる。表示順は系列属性として共有する | [REQ-002](../01-requirements/requirements-specification.md#req-002) |
| DD-012 | Section Aggregate | Section | ActiveなSectionだけが録音対象になれる。`bodyText`は空でない。Sectionは作成後本文を変更しない | [REQ-002](../01-requirements/requirements-specification.md#req-002) |
| DD-013 | RecordingAttempt Aggregate | RecordingAttempt | Ready録音試行は必ず保存済み音声ファイルを参照する。Failed録音試行は失敗理由を持つ | [REQ-003](../01-requirements/requirements-specification.md#req-003) |
| DD-014 | AudioFile Aggregate | AudioFile | Stored音声ファイルだけが再生可能。削除失敗は再試行可能 | [REQ-017](../01-requirements/requirements-specification.md#req-017), [REQ-020](../01-requirements/requirements-specification.md#req-020) |
| DD-015 | AnalysisRun Aggregate | AnalysisRun | `AnalysisRun`は少なくとも1つの`AnalysisJob`と組み合わせて状態が判定される | [REQ-009](../01-requirements/requirements-specification.md#req-009) |
| DD-016 | AnalysisJob Aggregate | AnalysisJob | 状態ごとに必要なデータが異なる。Leasedはlease tokenと期限を必ず持つ | [REQ-009](../01-requirements/requirements-specification.md#req-009) |
| DD-017 | AssessmentResult Aggregate | AssessmentResult | 作成後不変。全スコア必須。segmentsはNonEmptyList | [REQ-011](../01-requirements/requirements-specification.md#req-011), [REQ-014](../01-requirements/requirements-specification.md#req-014) |
| DD-018 | AnalysisEngine Aggregate | AnalysisEngine | CloudとOSS workerで必要情報が異なる。無効なエンジンはジョブ作成対象にならない | [REQ-005](../01-requirements/requirements-specification.md#req-005), [REQ-008](../01-requirements/requirements-specification.md#req-008) |

### 4.2 集約関係図

```mermaid
graph TD
    Material["Material<br>Active | Deleted"]
    SectionSeries["SectionSeries<br>Active | Deleted"]
    Section["Section<br>Active | Deleted"]
    RecordingAttempt["RecordingAttempt<br>Saving | Ready | Failed | Deleted"]
    AudioFile["AudioFile<br>Stored | DeletionPending | Deleted | DeleteFailed"]
    AnalysisRun["AnalysisRun<br>status derived from jobs"]
    AnalysisJob["AnalysisJob<br>Queued | Leased | Running | Succeeded | Failed | Canceled"]
    AssessmentResult["AssessmentResult<br>immutable snapshot"]
    AnalysisEngine["AnalysisEngine<br>Cloud | OssWorker"]

    SectionSeries -->|material| Material
    Section -->|sectionSeries| SectionSeries
    RecordingAttempt -->|section| Section
    AudioFile -->|recordingAttempt| RecordingAttempt
    AnalysisRun -->|recordingAttempt| RecordingAttempt
    AnalysisJob -->|analysisRun| AnalysisRun
    AnalysisJob -->|analysisEngine| AnalysisEngine
    AssessmentResult -->|analysisJob| AnalysisJob
```

### 4.3 集約詳細

#### 4.3.1 Material Aggregate（DD-010）

##### Choice Type

```typescript
type Material =
  | ActiveMaterial
  | DeletedMaterial;

type ActiveMaterial = Readonly<{
  type: "active";
  identifier: MaterialIdentifier;
  title: MaterialTitle;
  source: MaterialSource | null;
  createdAt: Date;
  updatedAt: Date;
}>;

type DeletedMaterial = Readonly<{
  type: "deleted";
  identifier: MaterialIdentifier;
  title: MaterialTitle;
  deletedAt: Date;
}>;
```

##### 不変条件リスト

| No. | 不変条件 | 検証タイミング | 違反時の振る舞い |
|---|---|---|---|
| 1 | ActiveMaterialのタイトルは空でない | Smart Constructor | `InvalidMaterialTitle`を返す |
| 2 | source情報は任意。指定時はURL、sourceType等をSmart Constructorで検証する | Smart Constructor | `InvalidMaterialSource`を返す |
| 3 | DeletedMaterialからSectionSeriesは作れない | `createSectionSeries` | `MaterialAlreadyDeleted`を返す |

##### トランザクション境界

Material作成は単一集約の作成として1トランザクションで完結する。Material削除は関連SectionSeries等の論理削除を伴うため、UseCaseワークフローで複数集約の状態遷移をまとめて調整する。

#### 4.3.2 SectionSeries Aggregate（DD-011）

```typescript
type SectionSeries =
  | ActiveSectionSeries
  | DeletedSectionSeries;

type ActiveSectionSeries = Readonly<{
  type: "active";
  identifier: SectionSeriesIdentifier;
  material: MaterialIdentifier;
  title: SectionTitle;
  displayOrder: SectionDisplayOrder;
  createdAt: Date;
  updatedAt: Date;
}>;

type DeletedSectionSeries = Readonly<{
  type: "deleted";
  identifier: SectionSeriesIdentifier;
  material: MaterialIdentifier;
  title: SectionTitle;
  deletedAt: Date;
}>;
```

| No. | 不変条件 | 検証タイミング | 違反時の振る舞い |
|---|---|---|---|
| 1 | ActiveSectionSeriesのtitleは空でない | Smart Constructor | `InvalidSectionTitle`を返す |
| 2 | displayOrderは系列属性であり、Section版ごとの差分として持たない | `createSectionSeries` / `reviseSectionSeries` | `InvalidSectionDisplayOrder`を返す |
| 3 | DeletedSectionSeriesには新しいSection版を追加できない | `createSectionVersion` | `SectionSeriesAlreadyDeleted`を返す |

#### 4.3.3 Section Aggregate（DD-012）

```typescript
type Section =
  | ActiveSection;

type ActiveSection = Readonly<{
  type: "active";
  identifier: SectionIdentifier;
  sectionSeries: SectionSeriesIdentifier;
  version: SectionVersion;
  bodyText: SectionBodyText;
  createdAt: Date;
  updatedAt: Date;
}>;
```

| No. | 不変条件 | 検証タイミング | 違反時の振る舞い |
|---|---|---|---|
| 1 | bodyTextは空でない | Smart Constructor | `InvalidSectionBodyText`を返す |
| 2 | bodyTextは最大文字数、英字割合、制御文字禁止を満たす | Smart Constructor | `InvalidSectionBodyText`を返す |
| 3 | Sectionは作成後に本文を変更しない。本文改訂は新しいSection版を作る | `createSectionVersion` | `SectionVersionConflict`を返す |
| 4 | 録音は具体的なSection版に紐づく | `startRecordingAttempt` | `SectionNotRecordable`を返す |

#### 4.3.4 RecordingAttempt Aggregate（DD-013）

```typescript
type RecordingAttempt =
  | SavingRecordingAttempt
  | ReadyRecordingAttempt
  | FailedRecordingAttempt
  | DeletedRecordingAttempt;

type RecordingOrigin =
  | Readonly<{
      type: "browser_recording";
      startedAt: Date;
      endedAt: Date;
      browserInfo: BrowserInfo;
    }>
  | Readonly<{
      type: "uploaded_file";
      originalFileName: OriginalFileName;
      uploadedAt: Date;
    }>;

type SavingRecordingAttempt = Readonly<{
  type: "saving";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  inputKind: RecordingOrigin["type"];
  createdAt: Date;
}>;

type ReadyRecordingAttempt = Readonly<{
  type: "ready";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  audioFile: AudioFileIdentifier;
  origin: RecordingOrigin;
  duration: RecordingDuration;
  createdAt: Date;
}>;

type FailedRecordingAttempt = Readonly<{
  type: "failed";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  inputKind: RecordingOrigin["type"];
  failedAt: Date;
  failureReason: RecordingFailureReason;
}>;

type DeletedRecordingAttempt = Readonly<{
  type: "deleted";
  identifier: RecordingAttemptIdentifier;
  section: SectionIdentifier;
  deletedAt: Date;
}>;
```

| No. | 不変条件 | 検証タイミング | 違反時の振る舞い |
|---|---|---|---|
| 1 | ReadyRecordingAttemptは必ず`audioFile`を持つ | `markRecordingAttemptReady` | 型で表現 |
| 2 | FailedRecordingAttemptは必ず`failureReason`を持つ | `markRecordingAttemptFailed` | 型で表現 |
| 3 | DeletedRecordingAttemptは録音再生・解析対象にできない | 解析開始時 | `RecordingAttemptAlreadyDeleted`を返す |
| 4 | `browser_recording` は `startedAt`、`endedAt`、`browserInfo` をすべて持つ | `createRecordingOrigin` | Choice Typeで表現 |
| 5 | `uploaded_file` は録音時刻・ブラウザ情報を要求せず、`originalFileName` を持つ | `createRecordingOrigin` | Choice Typeで表現 |

#### 4.3.4 AudioFile Aggregate（DD-013）

```typescript
type AudioFile =
  | StoredAudioFile
  | DeletionPendingAudioFile
  | DeletedAudioFile
  | DeleteFailedAudioFile;
```

| 状態 | 必須データ | 許可される操作 |
|---|---|---|
| StoredAudioFile | relativePath, mimeType, sizeBytes, duration | 再生、削除要求 |
| DeletionPendingAudioFile | requestedAt | 物理削除実行 |
| DeletedAudioFile | deletedAt | なし |
| DeleteFailedAudioFile | failedAt, failureReason | 削除再試行 |

#### 4.3.5 AnalysisRun Aggregate（DD-014）

`AnalysisRun`は状態を持たない。状態は子`AnalysisJob`のNonEmptyListから派生する。

```typescript
type AnalysisRun = Readonly<{
  identifier: AnalysisRunIdentifier;
  recordingAttempt: RecordingAttemptIdentifier;
  mode: AnalysisMode;
  createdAt: Date;
}>;

type AnalysisRunStatus =
  | "queued"
  | "running"
  | "partial_succeeded"
  | "succeeded"
  | "failed"
  | "canceled";
```

| No. | 不変条件 | 検証タイミング | 違反時の振る舞い |
|---|---|---|---|
| 1 | AnalysisRunの状態判定にはNonEmptyList<AnalysisJob>が必要 | `deriveAnalysisRunStatus` | 空配列を型で禁止 |
| 2 | `comparison`ではCloudとOSS workerのジョブが必要 | `buildAnalysisJobsForMode` | `AnalysisEngineUnavailable`を返す |

#### 4.3.6 AnalysisJob Aggregate（DD-015）

```typescript
type AnalysisJob =
  | QueuedAnalysisJob
  | LeasedAnalysisJob
  | RunningAnalysisJob
  | SucceededAnalysisJob
  | FailedAnalysisJob
  | CanceledAnalysisJob;
```

| 状態 | 必須データ | 許可される遷移 |
|---|---|---|
| QueuedAnalysisJob | queuedAt | leased, canceled |
| LeasedAnalysisJob | leaseToken, leaseExpiresAt, attemptCount, maxAttempts | running, queued（retry）, canceled |
| RunningAnalysisJob | startedAt, leaseToken, attemptCount, maxAttempts | succeeded, failed, queued（retry）, canceled |
| SucceededAnalysisJob | finishedAt | なし |
| FailedAnalysisJob | finishedAt, failureReason | なし |
| CanceledAnalysisJob | canceledAt | なし |

`retryAnalysisJob` は、`failureKind = "retryable"` かつ `attemptCount < maxAttempts` の場合に限り、`LeasedAnalysisJob` または `RunningAnalysisJob` を `QueuedAnalysisJob` へ戻す。再queue時はlease情報を破棄し、`nextRunAt` と `queuedAt` を更新する。条件を満たさない失敗は `failAnalysisJob` で `FailedAnalysisJob` に確定する。

#### 4.3.7 AssessmentResult Aggregate（DD-016）

`AssessmentResult`は作成後不変のスナップショットである。再解析時は既存結果を更新せず、新しい`AnalysisJob`と`AssessmentResult`を作成する。

```typescript
type AssessmentResult = Readonly<{
  identifier: AssessmentResultIdentifier;
  analysisJob: AnalysisJobIdentifier;
  scores: ScoreSet;
  summary: AssessmentSummary;
  findings: ReadonlyArray<AssessmentFinding>;
  segments: NonEmptyList<AssessmentSegment>;
  metadata: AssessmentEngineMetadata;
  tokenizerVersion: TokenizerVersion;
  raw: UnknownEngineRawResult;
  engineSnapshot: AnalysisEngineSnapshot;
  createdAt: Date;
}>;

type AssessmentFinding = Readonly<{
  identifier: AssessmentFindingIdentifier;
  category: FindingCategory;
  severity: FindingSeverity;
  textRange: TextRange;
  audioRange: AudioRange | null;
  expected: PronunciationEvidence;
  detected: PronunciationEvidence;
  messageJa: string;
  messageEn: string | null;
  scoreImpact: number;
  confidence: Confidence0To1;
}>;

const FindingCategory = {
  ACCURACY: "accuracy",
  PRONUNCIATION: "pronunciation",
  CONNECTED_SPEECH: "connectedSpeech",
  PROSODY: "prosody",
  NATIVE_LIKENESS: "nativeLikeness",
} as const;

type FindingCategory =
  typeof FindingCategory[keyof typeof FindingCategory];

const FindingSeverity = {
  CRITICAL: "critical",
  MAJOR: "major",
  MINOR: "minor",
  SUGGESTION: "suggestion",
} as const;

type FindingSeverity =
  typeof FindingSeverity[keyof typeof FindingSeverity];

type PronunciationEvidence = Readonly<{
  text: string | null;
  ipa: string | null;
}>;
```

| No. | 不変条件 | 検証タイミング | 違反時の振る舞い |
|---|---|---|---|
| 1 | `ScoreSet`は全スコアを必ず持つ | `createAssessmentResult` | `IncompleteScoreSet`を返す |
| 2 | 各スコアは0から100の整数 | `createScore0To100` | `InvalidScore`を返す |
| 3 | confidenceは0から1の小数 | `createConfidence0To1` | `InvalidConfidence`を返す |
| 4 | findingsは空を許可する | `createAssessmentResult` | 空配列は成功 |
| 5 | segmentsはNonEmptyList | `createAssessmentResult` | `EmptyAssessmentSegments`を返す |
| 6 | 全Findingは一意な`identifier`を持ち、Highlightはその識別子を参照する | `createAssessmentResult` | `InvalidAssessmentFinding`を返す |
| 7 | `summary`、`metadata`、`tokenizerVersion`を必ず保存する | `createAssessmentResult` | `AssessmentSchemaInvalidError`を返す |

#### 4.3.8 AnalysisEngine Aggregate（DD-017）

```typescript
type AnalysisEngine =
  | CloudAnalysisEngine
  | OssWorkerAnalysisEngine;

type CloudAnalysisEngine = Readonly<{
  type: "cloud";
  identifier: AnalysisEngineIdentifier;
  displayName: AnalysisEngineDisplayName;
  provider: CloudProvider;
  modelName: ModelName;
  externalSendingRequired: true;
  enabled: boolean;
  configuration: AnalysisEngineConfiguration;
}>;

type OssWorkerAnalysisEngine = Readonly<{
  type: "oss_worker";
  identifier: AnalysisEngineIdentifier;
  displayName: AnalysisEngineDisplayName;
  workerVersion: WorkerVersion;
  modelName: ModelName;
  rulesetVersion: RulesetVersion;
  enabled: boolean;
  configuration: AnalysisEngineConfiguration;
}>;

const AssessmentEngineFailureKind = {
  RETRYABLE: "retryable",
  NON_RETRYABLE: "nonRetryable",
} as const;

type AssessmentEngineFailureKind =
  typeof AssessmentEngineFailureKind[keyof typeof AssessmentEngineFailureKind];
```

## 5. エンティティ

| ID | 名前 | 所属集約 | 識別子型 | ライフサイクル |
|---|---|---|---|---|
| DD-020 | Material | Material | MaterialIdentifier（ULID） | Active → Deleted |
| DD-021 | SectionSeries | SectionSeries | SectionSeriesIdentifier（ULID） | Active → Deleted |
| DD-022 | Section | Section | SectionIdentifier（ULID） | 作成後不変 |
| DD-023 | RecordingAttempt | RecordingAttempt | RecordingAttemptIdentifier（ULID） | Saving → Ready / Failed → Deleted |
| DD-024 | AudioFile | AudioFile | AudioFileIdentifier（ULID） | Stored → DeletionPending → Deleted / DeleteFailed |
| DD-025 | AnalysisRun | AnalysisRun | AnalysisRunIdentifier（ULID） | 作成後不変。状態はAnalysisJobから派生 |
| DD-026 | AnalysisJob | AnalysisJob | AnalysisJobIdentifier（ULID） | Queued → Leased → Running → Succeeded / Failed / Canceled |
| DD-027 | AssessmentResult | AssessmentResult | AssessmentResultIdentifier（ULID） | 作成後不変 |
| DD-028 | AnalysisEngine | AnalysisEngine | AnalysisEngineIdentifier（ULID） | Cloud / OssWorker、enabled切替 |

## 6. 値オブジェクト

| ID | 名前 | 所属集約 | 等価性基準 | バリデーションルール |
|---|---|---|---|---|
| DD-030 | MaterialIdentifier | Material | ULID値の一致 | ULID形式 |
| DD-031 | MaterialTitle | Material | 文字列の一致 | 空でない、前後空白正規化後に有効 |
| DD-032 | MaterialSource | Material | 各属性の一致 | 任意。指定時はsourceType、URL等が有効 |
| DD-033 | SectionSeriesIdentifier | SectionSeries | ULID値の一致 | ULID形式 |
| DD-034 | SectionDisplayOrder | SectionSeries | 整数値の一致 | 0以上 |
| DD-035 | SectionIdentifier | Section | ULID値の一致 | ULID形式 |
| DD-036 | SectionVersion | Section | 正整数値の一致 | 1以上 |
| DD-037 | SectionBodyText | Section | 文字列の一致 | 空不可、最大文字数、英字割合、制御文字禁止 |
| DD-038 | RecordingAttemptIdentifier | RecordingAttempt | ULID値の一致 | ULID形式 |
| DD-039 | RecordingDuration | RecordingAttempt | ミリ秒値の一致 | 0より大きい |
| DD-040 | BrowserInfo | RecordingAttempt | 各属性の一致 | browserName、deviceType等が有効 |
| DD-041 | AudioFileIdentifier | AudioFile | ULID値の一致 | ULID形式 |
| DD-042 | AudioMimeType | AudioFile | MIME type文字列の一致 | 対応形式のみ |
| DD-043 | AudioFileSize | AudioFile | byte数の一致 | 0より大きい |
| DD-044 | AnalysisRunIdentifier | AnalysisRun | ULID値の一致 | ULID形式 |
| DD-045 | AnalysisJobIdentifier | AnalysisJob | ULID値の一致 | ULID形式 |
| DD-046 | AnalysisLeaseToken | AnalysisJob | UUID値の一致 | UUIDv4形式 |
| DD-047 | AnalysisEngineIdentifier | AnalysisEngine | ULID値の一致 | ULID形式 |
| DD-048 | AssessmentResultIdentifier | AssessmentResult | ULID値の一致 | ULID形式 |
| DD-049 | Score0To100 | AssessmentResult | 整数値の一致 | 0から100の整数 |
| DD-050 | Confidence0To1 | AssessmentResult | 小数値の一致 | 0以上1以下 |
| DD-051 | TextRange | AssessmentResult | start/endの一致 | `startOffset < endOffset` |
| DD-052 | AudioRange | AssessmentResult | start/endの一致 | `startMilliseconds < endMilliseconds` |
| DD-053 | NonEmptyList<T> | 複数 | 先頭要素と残り要素の一致 | 1要素以上 |
| DD-054 | Pagination | Search Criteria | Choice Type | MVPではoffset/limitのみ |
| DD-055 | AssessmentFindingIdentifier | AssessmentResult | ULID値の一致 | ULID形式 |
| DD-056 | PronunciationEvidence | AssessmentResult | textとIPAの一致 | text/ipaは属性単位でNULL可 |
| DD-057 | TokenizerVersion | AssessmentResult | 文字列値の一致 | 空でないversion文字列 |

### 6.1 DomainError

`DomainError` はcaseごとに独立型を定義する。ACL変換後の共通解析結果が契約を満たさない場合は、engine通信失敗とは区別して `AssessmentSchemaInvalidError` を返す。

```typescript
export type AssessmentSchemaInvalidError = Readonly<{
  type: "assessmentSchemaInvalid";
  reason: string;
}>;

export type DomainError =
  | ValidationFailedError
  | NotFoundError
  | InvalidStateTransitionError
  | PersistenceFailedError
  | TransactionFailedError
  | AudioStorageFailedError
  | AssessmentEngineFailedError
  | AssessmentSchemaInvalidError;
```

## 7. ドメインサービス関数

ドメインサービスはクラスではなく、単一集約に自然に属さないドメイン関数として表現する。

| ID | 関数名 | 入力 | 出力 | 責務 |
|---|---|---|---|---|
| DD-060 | createSectionSeries | ActiveMaterial, SectionTitle, SectionDisplayOrder | Result<CreateSectionSeriesOutput, DomainError> | 題材内の練習セクション系列を作成する |
| DD-061 | createSectionVersion | ActiveSectionSeries, SectionBodyText, SectionVersion | Result<CreateSectionVersionOutput, DomainError> | SectionSeriesに属する本文版を作成する |
| DD-062 | reviseSectionSeries | ActiveSectionSeries, SectionTitle, SectionDisplayOrder | Result<ReviseSectionSeriesOutput, DomainError> | 系列のタイトルと表示順を改訂する |
| DD-063 | retireSectionSeries | ActiveSectionSeries | Result<RetireSectionSeriesOutput, DomainError> | SectionSeriesを通常表示から外す |
| DD-064 | markRecordingAttemptReady | SavingRecordingAttempt, StoredAudioFile, RecordingMetadata | Result<MarkRecordingAttemptReadyOutput, DomainError> | 保存中録音試行をReadyへ遷移させる |
| DD-065 | markRecordingAttemptFailed | SavingRecordingAttempt, RecordingFailureReason | Result<MarkRecordingAttemptFailedOutput, DomainError> | 保存中録音試行をFailedへ遷移させる |
| DD-066 | requestAudioFileDeletion | StoredAudioFile | RequestAudioFileDeletionOutput | 音声ファイル削除要求状態へ遷移させる |
| DD-067 | buildAnalysisJobsForMode | AnalysisRun, AnalysisMode, NonEmptyList<AnalysisEngine> | Result<BuildAnalysisJobsOutput, DomainError> | 解析モードから必要なジョブを生成する |
| DD-068 | leaseAnalysisJob | QueuedAnalysisJob, AnalysisLeaseToken, Date | LeaseAnalysisJobOutput | queuedジョブをleasedへ遷移させる |
| DD-069 | startAnalysisJob | LeasedAnalysisJob, Date | StartAnalysisJobOutput | leasedジョブをrunningへ遷移させる |
| DD-070 | completeAnalysisJob | RunningAnalysisJob, AssessmentResult, Date | CompleteAnalysisJobOutput | runningジョブをsucceededへ遷移させる |
| DD-071 | failAnalysisJob | RunningAnalysisJob, AnalysisJobFailureReason, Date | FailAnalysisJobOutput | runningジョブをfailedへ遷移させる |
| DD-072 | deriveAnalysisRunStatus | NonEmptyList<AnalysisJob> | AnalysisRunStatus | 子ジョブ状態からAnalysisRun状態を派生計算する |
| DD-073 | createAssessmentResult | CreateAssessmentResultCommand | Result<CreateAssessmentResultOutput, DomainError> | 不変条件を満たす解析結果を作成する |
| DD-074 | retryAnalysisJob | LeasedAnalysisJob \| RunningAnalysisJob, AssessmentEngineFailureKind, Date | Result<RetryAnalysisJobOutput, DomainError> | retryableかつ試行上限未満のジョブをqueuedへ戻す |

状態変更を伴う関数の`Output`は`events: NonEmptyList<DomainEvent>`を持つ。`deriveAnalysisRunStatus`のような派生計算関数はイベントを返さない。

`deriveAnalysisRunStatus` は次の優先順で決定する。

1. 1件以上が `running` または `leased` なら `running`
2. 実行中がなく1件以上が `queued` なら `queued`
3. 全Jobが `succeeded` なら `succeeded`
4. 1件以上が `succeeded` かつ残りが `failed` または `canceled` なら `partial_succeeded`
5. 全Jobが `canceled` なら `canceled`
6. 成功Jobがなく、1件以上が `failed` で残りも `failed` または `canceled` なら `failed`

これにより、キャンセル要求後も完了済みJobを保持したまま、子Jobの実状態からRun状態を再計算できる。

## 8. ドメインイベント

### 8.1 イベント一覧

| ID | イベント名 | 発行元 | トリガー条件 | ペイロード | 購読者 |
|---|---|---|---|---|---|
| DD-080 | MaterialCreated | Material | 題材が作成された | material, occurredAt | UseCase |
| DD-081 | SectionSeriesCreated | SectionSeries | セクション系列が作成された | sectionSeries, material, occurredAt | UseCase |
| DD-082 | SectionCreated | Section | Section本文版が作成された | section, sectionSeries, occurredAt | UseCase |
| DD-083 | SectionSeriesRetired | SectionSeries | セクション系列が通常表示から外された | sectionSeries, occurredAt | UseCase |
| DD-084 | RecordingAttemptStarted | RecordingAttempt | 録音試行が開始された | recordingAttempt, section, occurredAt | UseCase |
| DD-085 | RecordingAttemptSaved | RecordingAttempt | 録音音声が保存されReadyになった | recordingAttempt, audioFile, occurredAt | UseCase |
| DD-086 | RecordingAttemptFailed | RecordingAttempt | 録音保存が失敗した | recordingAttempt, failureReason, occurredAt | UseCase |
| DD-087 | AnalysisRunStarted | AnalysisRun | 解析実行が開始された | analysisRun, recordingAttempt, mode, occurredAt | UseCase |
| DD-088 | AnalysisJobQueued | AnalysisJob | 解析ジョブが作成された | analysisJob, analysisRun, analysisEngine, occurredAt | UseCase |
| DD-089 | AnalysisJobLeased | AnalysisJob | Runnerがジョブleaseを取得した | analysisJob, leaseToken, occurredAt | UseCase |
| DD-090 | AnalysisJobStarted | AnalysisJob | ジョブ実行が始まった | analysisJob, occurredAt | UseCase |
| DD-091 | AnalysisJobSucceeded | AnalysisJob | ジョブが成功した | analysisJob, assessmentResult, occurredAt | UseCase |
| DD-092 | AnalysisJobFailed | AnalysisJob | ジョブが失敗した | analysisJob, failureReason, occurredAt | UseCase |
| DD-093 | AnalysisJobCanceled | AnalysisJob | ジョブがキャンセルされた | analysisJob, occurredAt | UseCase |
| DD-094 | AssessmentResultCreated | AssessmentResult | 解析結果が作成された | assessmentResult, analysisJob, occurredAt | UseCase |
| DD-095 | RecordingAttemptDeleted | RecordingAttempt | 録音試行が削除された | recordingAttempt, occurredAt | UseCase |
| DD-096 | AudioFileDeletionRequested | AudioFile | 音声ファイル削除が要求された | audioFile, occurredAt | UseCase |
| DD-097 | AudioFileDeleted | AudioFile | 音声ファイル物理削除が完了した | audioFile, occurredAt | UseCase |
| DD-098 | AudioFileDeletionFailed | AudioFile | 音声ファイル物理削除が失敗した | audioFile, failureReason, occurredAt | UseCase |
| DD-123 | MaterialRevised | Material | 題材メタデータが改訂された | material, occurredAt | UseCase |
| DD-124 | MaterialRetired | Material | 題材が通常表示から外された | material, occurredAt | UseCase |
| DD-125 | SectionRevised | Section | 新しいSection本文版が作成された | section, sectionSeries, occurredAt | UseCase |
| DD-126 | AudioFileStored | AudioFile | 音声ファイル保存が完了した | audioFile, recordingAttempt, occurredAt | UseCase |
| DD-127 | AssessmentRunDiscarded | AnalysisRun | AnalysisRunが通常表示から外された | analysisRun, occurredAt | UseCase |

### 8.2 イベントフロー図

```mermaid
sequenceDiagram
    participant UseCase as UseCase Workflow
    participant Recording as RecordingAttempt functions
    participant Analysis as Analysis functions
    participant Job as AnalysisJob functions
    participant Assessment as AssessmentResult functions

    UseCase->>Recording: markRecordingAttemptReady(...)
    Recording-->>UseCase: RecordingAttemptSaved
    UseCase->>Analysis: startAnalysisRun(...)
    Analysis-->>UseCase: AnalysisRunStarted + AnalysisJobQueued
    UseCase->>Job: leaseAnalysisJob(...)
    Job-->>UseCase: AnalysisJobLeased
    UseCase->>Job: startAnalysisJob(...)
    Job-->>UseCase: AnalysisJobStarted
    UseCase->>Assessment: createAssessmentResult(...)
    Assessment-->>UseCase: AssessmentResultCreated
    UseCase->>Job: completeAnalysisJob(...)
    Job-->>UseCase: AnalysisJobSucceeded
```

## 9. 検索Criteria

### 9.1 Repository配置方針

Repository PortはDomain層には定義しない。Repository PortはUseCase層配下に定義し、Infrastructure層が実装する。Domain層はRepository、DB、transaction、storage、HTTPを知らない。

ただし、検索意図を表すCriteriaはドメイン語彙であり、Domain層のChoice Typeとして定義する。Repositoryの `search(criteria)` はこのCriteriaを受け取り、InfrastructureがSQL等へ変換する。

### 9.2 Criteria一覧

| ID | Criteria | 対象 | 主なcase |
|---|---|---|---|
| DD-100 | MaterialSearchCriteria | Material | activeMaterials, includingRetiredForHistory |
| DD-101 | SectionSeriesSearchCriteria | SectionSeries | activeSeriesInMaterial, seriesForHistory |
| DD-102 | SectionSearchCriteria | Section | activeLatestSectionsInMaterial, sectionVersionsInSeries, practiceHistorySectionsInSeries |
| DD-103 | RecordingAttemptSearchCriteria | RecordingAttempt | attemptsInSection, attemptsForHistory |
| DD-104 | AnalysisRunSearchCriteria | AnalysisRun | runsByRecordingAttempt, runsForHistory |
| DD-105 | AnalysisJobSearchCriteria | AnalysisJob | jobsByAnalysisRun, runnableJobsForInspection |
| DD-106 | AssessmentResultSearchCriteria | AssessmentResult | resultsByAnalysisRun, resultsByJobs |

### 9.3 Criteria表現ルール

```typescript
type Pagination =
  | { type: "offset"; offset: Offset; limit: Limit };

type SectionSearchCriteria =
  | {
      type: "activeLatestSectionsInMaterial";
      material: MaterialIdentifier;
      pagination: Pagination;
      sort: SectionSort;
    }
  | {
      type: "sectionVersionsInSeries";
      sectionSeries: SectionSeriesIdentifier;
      pagination: Pagination;
      sort: SectionVersionSort;
    }
  | {
      type: "practiceHistorySectionsInSeries";
      sectionSeries: SectionSeriesIdentifier;
      pagination: Pagination;
      sort: PracticeHistorySort;
    };
```

Criteriaはpage/sortも含む検索仕様全体を表す。MVPではoffset/limit方式のみ実装必須とし、カーソル方式は将来追加とする。CriteriaにDB列名、SQL断片、自由文字列のsort expressionを持たせない。

## 10. 仕様/ポリシー

仕様/ポリシーはクラスではなく、述語関数またはドメイン関数として表現する。

| ID | 仕様名 | 対象 | ビジネスルール |
|---|---|---|---|
| DD-110 | canCreateSectionSeries | ActiveMaterial | ActiveMaterialのみSectionSeries作成元にできる |
| DD-111 | canCreateSectionVersion | ActiveSectionSeries, SectionBodyText | ActiveSectionSeriesのみSection版を追加でき、本文は妥当性を満たす |
| DD-112 | canRecordSection | Section | ActiveSectionのみ録音可能 |
| DD-113 | canStartAnalysisRun | RecordingAttempt | ReadyRecordingAttemptのみ解析実行可能 |
| DD-114 | analysisModeRequiresEngines | AnalysisMode, AnalysisEngine list | `cloud_only`はCloud engine、`oss_worker_only`はOSS worker engine、`comparison`は両方が必要 |
| DD-115 | canPlayAudioFile | AudioFile | StoredAudioFileのみ再生可能 |
| DD-116 | canDeleteAudioFilePhysically | AudioFile | DeletionPendingAudioFileまたはDeleteFailedAudioFileのみ物理削除対象 |
| DD-117 | scoreMustBeInteger0To100 | Score0To100 | スコアは0から100の整数 |
| DD-118 | confidenceMustBe0To1 | Confidence0To1 | 信頼度は0以上1以下の小数 |
| DD-119 | assessmentSegmentsMustBeNonEmpty | AssessmentResult | segmentsはNonEmptyListでなければならない |
| DD-128 | canRetryAnalysisJob | LeasedAnalysisJob \| RunningAnalysisJob | retryable失敗かつ`attemptCount < maxAttempts`の場合だけqueuedへ戻せる |

## 11. 外部能力との境界

Domainは外部I/Oを直接実行しない。音声保存、音声削除、発音解析、Repository、transactionはUseCase層のPortとして定義し、InfrastructureまたはACLが実装する。

| ID | 能力 | Port定義場所 | 実装層 |
|---|---|---|---|
| DD-120 | 音声ファイル保存、読み込み、物理削除 | UseCase層 | Infrastructure |
| DD-121 | 録音音声とセクション本文から `AssessmentResultDraft` を生成する | UseCase層 | ACL |
| DD-122 | 集約の永続化、検索、論理削除 | UseCase層 | Infrastructure |

発音解析の具象実装名は `Adaptor` suffixに統一する。OpenAI/OSS Workerの外部モデルやHTTPレスポンスはACL内で `AssessmentResultDraft` へ正規化し、UseCase層で正式な `AssessmentResult` を作る。MVPの発音解析Portは `assess` のみを持ち、中止メソッドは持たない。

## 12. ワークフロー設計

### 12.1 PracticeSection

`PracticeSection` はNativeTraceの中心ワークフローである。UseCase層では複数の関数に分割されるが、Domain上は次の状態遷移とイベント列として捉える。

```text
ActiveSectionSeries + ActiveSection
  -> SavingRecordingAttempt
  -> ReadyRecordingAttempt
  -> AnalysisRun + NonEmptyList<AnalysisJob>
  -> AssessmentResult per succeeded job
```

### 12.2 Command / Output

```typescript
type CreateSectionCommand = Readonly<{
  sectionSeries: SectionSeriesIdentifier;
  bodyText: SectionBodyText;
}>;

type CreateSectionOutput = Readonly<{
  section: ActiveSection;
  events: NonEmptyList<SectionCreated>;
}>;

type StartAnalysisRunCommand = Readonly<{
  recordingAttempt: RecordingAttemptIdentifier;
  mode: AnalysisMode;
}>;

type StartAnalysisRunOutput = Readonly<{
  analysisRun: AnalysisRun;
  analysisJobs: NonEmptyList<AnalysisJob>;
  events: NonEmptyList<DomainEvent>;
}>;
```

## 13. 変更履歴

| バージョン | 日付 | 変更者 | 変更内容 |
|---|---|---|---|
| 1.0.0 | 2026-06-02 | lihs | 初版作成 |
