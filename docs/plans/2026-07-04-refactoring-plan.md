# NativeTrace リポジトリ全体リファクタリング計画書

- 作成日: 2026-07-04
- 基準コミット: `3684715` (branch `feat/finding-closed-remediation-loop`, working tree clean)
- 対象: リポジトリ全体（frontend / backend / python-analyzer / scripts / CI glue）
- 性質: **挙動保存リファクタリングのみ**。機能追加・仕様変更・数値挙動の変更は一切含まない。
  挙動変更を伴う修正候補は §4.2「エスカレーション一覧」に隔離してあり、実行者は着手してはならない。

> **line 番号について**: 本書のすべての `path:line` は基準コミット `3684715` 時点の値。
> 先行項目のコミットで行番号はずれる。**行番号はあくまで初期アンカーであり、実際の位置特定は
> 必ずシンボル名（関数名・型名・定数名）の検索で行うこと。** シンボルが見つからない場合は
> その項目を中断して報告する（先行項目で削除済みの可能性を疑う）。

---

## 1. 現状理解（実行者への文脈共有）

### 1.1 プロダクトとリポジトリ構成

NativeTrace は日本語話者向け英語発音チェック Web アプリ（ローカル MVP）。
モノレポで **5 つのアプリケーション** を持つ（ルート CLAUDE.md には 2 つしか書かれていないが実際は 5 つ）:

```
applications/
  frontend/         Next.js App Router (TS)。UI / API Route Handlers / ジョブ実行器 / SQLite+Drizzle。
                    src/ はオニオンアーキテクチャ: domain → usecase → (infrastructure | acl) → app
                    303 ファイル / 56k LOC。DI は src/registry.ts (750 行) に集約。
  backend/          Haskell (GHC2024 / Servant)。発音採点 worker。port 8787。
                    src/NativeTrace/Worker/ に 9 モジュール / 7.2k LOC。
  python-analyzer/  Python (FastAPI / uv)。音響計測サービス。port 8788。
                    wav2vec2 CTC アライメント / GOP / parselmouth 音響量 / kokoro TTS。
                    src 40 ファイル + test 35 ファイル / 12.3k LOC。
  golden-speaker/   Python。声質変換サービス。port 8789（compose profile: golden、通常起動しない）。
  aai/              Python。調音逆推定サービス。port 8790（compose profile: aai、通常起動しない）。
docs/               設計書一式（実装の正）。
adr/                ADR（015 以降日本語）。
scripts/            CI/hook 用 verify-*.sh、fitness/、agent-policy hooks、較正用 python 3 本。
.ast-grep/rules/    適応度関数 15 ルール（§1.5）。
```

### 1.2 データフロー（1 回の練習録音が通る経路）

```
ブラウザ録音 (MediaRecorder)
  → POST /api/v1/sections/{id}/practice-attempts  (frontend route handler)
  → usecase submit-practice-attempt: audio 保存 + RecordingAttempt/AudioFile/AnalysisRun/AnalysisJob 永続化
  → バックグラウンドランナー (src/instrumentation.ts → analysis-job-runner, 2 秒間隔, リース 300 秒)
  → usecase run-assessment-job: job リース → engine 解決 → acl 経由で worker 呼び出し
  → [oss_worker エンジン] POST http://localhost:8787/v1/pronunciation-assessments (Haskell worker)
      → worker が POST {ANALYZER_URL}/v1/analyze (python-analyzer) で GOP/音響量を取得
      → worker が Scoring.hs で採点・findings 生成 → JSON 応答
  → [cloud エンジン] OpenAI SDK (acl/pronunciation-assessment/openai)
  → 応答を zod (acl/oss-worker/schema.ts) で検証 → AssessmentResultDraft → domain AssessmentResult → SQLite
  → UI は GET /api/v1/sections/{id}/workspace を 2 秒ポーリングして結果表示
```

このほか worker → analyzer に `/v1/shadowing-lag`、frontend → analyzer 直で `/v1/tts`・`/v1/stimuli`、
frontend → worker 直で `/golden-speaker/convert`（プロキシ）・`/v1/gop-delta` がある。

### 1.3 言語間ワイヤ契約（**絶対に変更してはならないもの**）

3 言語で同じ JSON キーが**手書きで三重に**定義されている。リファクタリングでこれらの
文字列リテラルを変更すると、コンパイルは通るのに実機が壊れる。

| 契約 | Haskell 側 | TypeScript 側 | Python 側 |
|---|---|---|---|
| worker 応答 (findings 等) | `Types.hs` 手書き ToJSON（`"catalogId"` 等のキー文字列） | `acl/pronunciation-assessment/oss-worker/schema.ts`（365 行 zod ミラー） | — |
| analyzer 応答 | `AnalyzerClient.hs` 手書き FromJSON | — | `interface/schema.py`（Pydantic camelCase） |
| ルートパス | `Api.hs` WorkerApi 型 | 各 route/acl の fetch リテラル | `http_handler.py` + `app.py` |

**凍結対象（変更禁止）**: 全 JSON フィールド名（`catalogId`, `perPhonemeGop`, `nBest`, `startMs`,
`wordPosition`, `acousticEvidence` 内 18 キー等）、ルートパス、multipart のパート名
（`metadata` / `audio` / `reference_audio` / `learner_audio` / `browserInfo` 等）、DB カラム名、
HTTP ステータスの意味づけ、エラー封筒 `{"error":{code,message,retryable}}` の形。

### 1.4 テスト・検証基盤（2026-07-04 実測ベースライン）

基準コミットで全コマンド green を実測済み:

| コマンド（リポジトリルート） | 実測結果 |
|---|---|
| `pnpm lint` | PASS（warning 0 / error 0） |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — **85 テストファイル / 833 テスト / 約 75 秒**（vitest run） |
| `pnpm fitness` | PASS（`== fitness: OK ==`） |
| `cd applications/backend && cabal test all` | PASS（CI は GHC 9.10.3。ローカル cache は 9.12.2 でビルドされている点に注意） |
| analyzer テスト | ローカル .venv は Python 3.14 でドリフトしているため **Docker で実行するのが正**: `docker compose build analyzer && docker compose run --rm --no-deps analyzer bash -c "cd /app && PYTHONPATH=/app/src pytest test/ -v"` |
| E2E | `pnpm test:e2e`（Playwright。8 spec: smoke / diagnostic / progress / dismissal / engine-selector-rerecord / golden / training / workspace-v2） |
| フルサイクル | `pnpm test:fullcycle gop-delta`（docker compose で worker+analyzer を自前起動して実機経路を検証） |
| drift sentinel | `pnpm test:drift`（analyzer イメージ変更時に GOP band ±2.0 / nBest top-1 過半数 / フィールド名を実機検証） |

### 1.5 機械強制（これに反する変更は hook / CI がブロックする）

- **ast-grep 15 ルール**（`.ast-grep/rules/`、全て severity error）。特に:
  `no-class-declaration`（frontend src に class 禁止 → 抽出は必ず factory 関数で）、
  `domain-purity`（domain/usecase に react/next/drizzle/openai/node: import 禁止）、
  `environment-access-only-in-config`（`process.env` は `src/infrastructure/config/**` のみ）、
  `persistence-only-in-infrastructure`、`no-prod-doubles`、`no-test-bypass`、
  `python-no-infra-in-domain`、`python-no-domain-in-infra`、`python-no-whisper`。
- **ESLint 依存方向 zone**（`applications/frontend/eslint.config.mjs:10-44`）:
  domain → 何も import 不可（usecase/infrastructure/acl/app/components から）、
  usecase → infrastructure/acl/app/components 不可、acl → infrastructure/app 不可、
  infrastructure → acl/app 不可、domain/training → 追加で全層不可。
  **`src/lib` はどの方向にも未規制**（既知の穴。W54 で塞ぐ）。
- **PostToolUse hook**: Write/Edit のたびに `scripts/fitness/hook.sh`（対象ファイルの
  ast-grep + lint + 関連テスト。**Haskell ファイル編集は毎回 cabal test が走り重い**）と
  `scripts/agent-policy-hook.sh` が自動実行され、違反は編集がブロックされる。
- **CI**: frontend-ci / backend-ci / python-analyzer-ci / pr-gate.yml（verify-*.sh 11 本 +
  fullcycle smoke）。
- **backend 固有の検証スクリプト制約**:
  - `verify-servant-route-handler-parity.sh` は `Api.hs` の `type WorkerApi =` ブロックと
    `Application.hs` の `server =` ブロックを**テキストで**解析する。両定義をファイル移動・
    リネームしてはならない。
  - `verify-worker-http-client-timeout.sh` は `src/NativeTrace/Worker/*Client.hs` のうち
    `newManager tlsManagerSettings` を含むファイルに `responseTimeout` の文字列があることを課す。
    HTTP 呼び出し部を Client ファイルの外へ移してはならない（本計画では移さない）。
  - 新規 Haskell モジュールは `native-trace-worker.cabal` の `exposed-modules` に追加必須。
- **analyzer 固有**: コード変更は docker イメージ再ビルドまで実機に反映されない
  （bind-mount なし）。`Dockerfile` の pip 行は drift fingerprint の入力なので変更禁止。
  `test/selfeval/` は本番コードを import しない設計（ミラー実装は意図的。同期コメントを壊さない）。

### 1.6 主要な既知の負債（監査サマリ）

本計画の作業項目は 2026-07-04 に実施した 6 系統の全ファイル監査
（frontend 3 分割 / backend / analyzer / 横断）に基づく。数の目安:

- デッドコード: frontend 約 40 シンボル + 4 CSS ファイル、backend 11 件、analyzer 11 件、scripts 1 本（どこからも参照されない verify スクリプト）
- 重複: `Brand` ヘルパー 11 重複、非空文字列ファクトリ 22 重複、zod プロローグ 19+14 重複、
  リポジトリ boilerplate 62 箇所、Haskell multipart ビルダー 4 重複、ffmpeg デコーダ 3 重複ほか
- 巨大関数: `run-assessment-job` 846 行、`training/page.tsx` 1436 行、`domain/training/index.ts`
  1150 行（5 集約同居）、`Scoring.hs` の 180 行関数、analyzer `app.py` の 210 行ルート closure
- エラー処理の穴・命名違反・直値散在: 各所（作業項目で個別に扱う）

---

## 2. 項目 0: 安全網の構築（W00 — 最初に必ず実行）

### W00: 作業ブランチ作成とベースライン固定

**手順（この順に実行）**:

1. 前提確認:
   ```bash
   cd /Users/lihs/workspace/native-trace
   git status --short        # 期待: 出力なし（clean）。汚れていたら中断して報告。
   git log --oneline -1      # 基準は 3684715。異なる場合は §5 の「基準コミット差異時の手順」に従う。
   ```
2. ブランチ作成:
   ```bash
   git switch -c refactor/2026-07-repo-cleanup
   ```
3. ベースライン記録（結果をそのまま作業ログに貼る）:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm fitness
   (cd applications/backend && cabal build all && cabal test all)
   docker compose build analyzer
   docker compose run --rm --no-deps analyzer bash -c "cd /app && PYTHONPATH=/app/src pytest test/ -v"
   ```
   期待: すべて PASS。`pnpm test` は 85 files / 833 tests。
   **1 つでも FAIL したらリファクタリングを開始せず、失敗出力を添えて報告して中断。**
4. E2E ベースライン（UI に触る項目 W34/W35/W36/W50 を実行する予定がある場合のみ必須。
   30 分以上かかることがある）:
   ```bash
   pnpm test:e2e
   ```
   期待: 8 spec すべて PASS。FAIL した spec があれば記録し、以後の完了条件では
   「ベースラインで green だった spec が green のままであること」を判定基準にする。
5. この時点ではコミットするものはない（ブランチ作成のみ）。

**特性テストについて**: 本リポジトリは上記の通りテスト基盤が既に厚い（833 unit + 8 e2e + フルサイクル +
drift sentinel）。したがって包括的な特性テストの新設は不要で、**これから触るのに未テストの箇所だけ**
先にテストで固定する。それが W10（stats リポジトリ）と W11（pagination）であり、
該当リファクタ項目（W25 / W13）の直前に独立コミットとして実行する。

**リスク**: なし（読み取りとブランチ作成のみ）。
**戻し方**: `git switch feat/finding-closed-remediation-loop && git branch -D refactor/2026-07-repo-cleanup`

---

## 3. 作業項目リスト（実行順）

**共通ルール（全項目に適用）**:

- 1 項目 = 1 コミット。コミットメッセージは各項目の指定を使う。
- 各項目の「完了条件」コマンドが 1 つでも期待と異なれば、**コミットせず** `git restore .` で
  作業を破棄し、項目 ID・実行コマンド・出力を添えて報告して中断する。
- コミット済み項目を戻す場合は `git revert <そのコミット>`（履歴を書き換えない）。
- 削除系項目では、削除対象シンボルごとに `grep -rn "<symbol>" applications/frontend/src applications/frontend/e2e`
  （backend / analyzer は各 src・test・app）で参照 0 件（定義行と削除対象テストを除く）を
  **削除前に再確認**する。1 件でも参照が見つかったらそのシンボルはスキップし、報告に含める。
- frontend の完了条件の基本形は `pnpm lint && pnpm typecheck && pnpm test && pnpm fitness` がすべて PASS、
  かつ `pnpm test` の**テスト数が意図した増減と一致**すること（テストを消していないことの確認）。
  以下では「FE 検証一式」と略記する。
- backend の基本形は `cd applications/backend && fourmolu --mode check src app test && hlint src app test && cabal build all && cabal test all` すべて PASS。「BE 検証一式」と略記。
  （fourmolu が差分を出したら `--mode inplace` で整形して再実行してよい）
- analyzer の基本形は `docker compose build analyzer && docker compose run --rm --no-deps analyzer bash -c "cd /app && PYTHONPATH=/app/src pytest test/ -v"` PASS + `cd applications/python-analyzer && uv run ruff check src test` PASS。「PY 検証一式」と略記。

---

### Phase 1: デッドコード削除（すべて低リスク・表面積を先に減らす）

#### W01: frontend domain 層のデッドシンボル削除

- **対象**: `applications/frontend/src/domain/`
- **問題**: grep 検証済みの未使用 export が 14 件。読者に「使われている遷移」だと誤認させる。
- **どう変えるか** — 以下を定義ごと削除する:
  - `domain/analysis-job.ts` — `leaseAnalysisJob`（本番参照 0。infra は port `acquireLease` を使う。**参照しているテストケースも削除**）
  - `domain/recording-attempt.ts:192-221` — `markRecordingAttemptFailed` + `MarkRecordingAttemptFailedOutput`
  - `domain/assessment-result.ts:94-100` — `createAudioRange`
  - `domain/assessment-result.ts:86-92` — `createTextRange`（テスト専用。削除前に factory の実装を
    読み、返しているオブジェクトの**実際のフィールド名と値**を確認した上で、参照している
    `infrastructure/drizzle/repositories/__tests__/assessment-result-repository.test.ts:13,134` を
    同じ形のオブジェクトリテラル（`as TextRange` キャスト付き）で構築するよう書き換える。
    テストの assert 値は一切変えない）
  - `domain/shared.ts:11-13` — `nonEmptyListHead`, `nonEmptyListToArray`（`nonEmptyListHead` を使う
    `domain/__tests__/shared.test.ts` の該当ケースは `list[0]` 直接参照に書き換え）
  - `domain/audio-file.ts:87-98` — `AudioFileStored`, `AudioFileDeletionFailed`（イベント型。producer 不在）
  - `domain/training/index.ts:704-745, 1000-1006` — `TrainingSessionStarted`, `TrainingSessionAborted`,
    `StartTrainingSessionOutput`, `AbortTrainingSessionOutput`, `SpacingScheduleAdvanced`
    （対応する `startTrainingSession`/`abortTrainingSession` 関数はそもそも存在しない）
  - **削除禁止**: `domain/training/index.ts:392-468` の `updateWeaknessProfile` 一族
    （`EwmaConfig`/`FocusObservation`/`UpdateWeaknessProfileOutput`/`WeaknessProfileUpdated`）。
    DD-263 の設計済み未配線機能でありオーナー判断が必要（§4.2 に登録済み）。テストも残す。
- **完了条件**: FE 検証一式 PASS。`grep -rn "leaseAnalysisJob\|markRecordingAttemptFailed\|createAudioRange\|nonEmptyListToArray\|AudioFileStored\|TrainingSessionStarted\|SpacingScheduleAdvanced" applications/frontend/src applications/frontend/e2e` が 0 件。
- **リスク**: 低（型と未参照関数のみ）。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(frontend): remove dead domain exports`

#### W02: frontend usecase/port 層のデッドシンボル削除

- **対象**: `applications/frontend/src/usecase/`, `src/registry.ts`
- **問題**: 未使用 export 16 件と未使用 DI 依存 1 件。
- **どう変えるか**:
  - `XxxExecutor` 型 alias 11 件を削除: `start-drill/index.ts:172`, `submit-drill-attempt/index.ts:402`,
    `start-hvpt-session/index.ts:272`, `submit-hvpt-trial/index.ts:196`, `complete-hvpt-session/index.ts:307`,
    `capture-progress-snapshot/index.ts:141`, `view-progress/index.ts:99`, `compute-shadowing-lag/index.ts:172`,
    `complete-diagnostic-session/index.ts:465`, `view-diagnostic-result/index.ts:135`,
    `start-diagnostic-session/index.ts:86`
  - `submit-practice-attempt/index.ts:87-88` — `BrowserInfoInput`, `AudioSourceInput`（export ごと削除。
    zod schema 定数自体は残す）
  - `usecase/port/finding-dismissal-repository.ts:8-15` — 型 `FindingDismissal` を削除
    （`FindingDismissalRepository` interface は残す。interface 内でこの型を参照している場合は
    インラインの構造型に展開して等価に保つ）
  - `usecase/port/logger.ts:1` — 型 `LogLevel` 削除（未参照の場合のみ。interface が参照していれば残す）
  - `usecase/shared/tokenizer.ts:20,101-102` — `CONTRACTION_PATTERN` 定数と `void CONTRACTION_PATTERN;` 行を削除
  - `usecase/discard-assessment-run/index.ts:37` — Dependencies から `assessmentResultRepository` フィールドを
    削除し、`src/registry.ts` の `discardAssessmentRun: createDiscardAssessmentRun({...})` 呼び出しから
    同名の注入行を削除
- **完了条件**: FE 検証一式 PASS。`grep -rn "Executor = ReturnType" applications/frontend/src/usecase | wc -l` が 0。
- **リスク**: 低。registry 編集を含むため、開発サーバー起動中なら再起動が必要（既知: registry は
  hot-reload されない）。**戻し方**: `git revert`。
- **依存**: W01（同一ファイル群を触るため順序固定）。
- **コミット**: `refactor(frontend): remove dead usecase and port exports`

#### W03: frontend app/_shared・components のデッドファイル削除

- **対象**: `applications/frontend/src/app/`, `src/components/`
- **問題**: 丸ごと不使用のコンポーネント・CSS・ハンドラヘルパーが残置。
- **どう変えるか**:
  - `src/components/highlighted-text/index.tsx`（55 行全体）と `highlighted-text.module.css` を削除。
    `segment.ts` は `buildSegments` が `HighlightedWorkspaceText.tsx:3` から使われているため**残す**が、
    `segment.ts:74-85` の `severityToColorClass` のみ削除。barrel export があれば合わせて削除。
  - `src/app/page.module.css`, `src/app/history/page.module.css`,
    `src/app/materials/[materialIdentifier]/page.module.css`, `src/app/materials/new/page.module.css`
    の 4 ファイルを削除（どの .tsx からも import されていないことを削除前 grep で確認）。
  - `src/app/api/v1/_shared/handler.ts`（`handleResult`/`handleResultWithStatus`、参照 0）を削除。
  - `src/app/api/v1/_shared/errors.ts:103-105` — `domainErrorToStatus` を削除。
  - `src/app/api/v1/materials/route.ts:27-28` — 既に静的 import 済みの `domainErrorToResponse` を
    動的 re-import している行を削除。
  - `src/app/api/v1/sections/[sectionIdentifier]/practice-attempts/route.ts:102-109` —
    zod 検証後には到達不能な null 分岐を削除（直前の zod schema が値を保証していることを確認の上）。
  - 微小デッド: `src/app/diagnostic/[...]/result/page.tsx:317` の無意味な三項
    `${priorityClass === "prio--low" ? "" : ""}` を除去、
    `src/app/training/page.tsx:1287-1291,1306` の `referenceBytes = ... ? null : null` と
    `void referenceBytes` を削除、`training/page.tsx:143-145` の定数を返すだけの
    `buildInitialHvptPhase` をインライン化、`src/components/chrome/HomeNav.tsx:4` の
    union から未使用メンバー `"diagnostic"` を削除。
  - **削除禁止**: `src/components/workspace/DetailPanel.tsx`（V1 パネル）。現在 empty 分岐しか
    描画されないゾンビだが、`showMarks` 復活の意図が不明なためオーナー判断（§4.2）。
- **完了条件**: FE 検証一式 PASS。`pnpm test:e2e`（または W00 で green だった spec）PASS。
- **リスク**: 低〜中（UI ファイル削除のため e2e で確認）。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(frontend): remove dead components, css modules and route helpers`

#### W04: frontend lib 層のデッド export 削除

- **対象**: `applications/frontend/src/lib/`
- **問題**: `api-types.ts` に後継 DTO へ置き換え済みの孤児チェーンが残る。
- **どう変えるか** — 以下を削除（各シンボル、削除前に参照 0 を再確認）:
  - `lib/api-types.ts` — `ANALYSIS_MODE_LABELS`(411-415), `SEVERITY_LABELS`(444-449),
    `CATEGORY_LABELS`(451-457), `ENGINE_LABELS`(487-490), `Severity`(418),
    `ApiListResponse`(393-397) とそれのみが使う `PaginationDto`(381-386),
    デッドチェーン `ResultsByEngineDto`(175-178) → `AssessmentResultDto`(164-173) → `FindingDto`(148-162),
    `AnalysisRunDto`(92-97), `AnalysisJobDto`(99-105)。
    **残す**: `RecordingAttemptDto`, `MaterialSourceDto`, `SectionVersionSummaryDto`,
    `HighlightRangeDto`, `TokenRangeDto`（`WorkspaceDto`/`PracticePlanDto` 経由で生存）。
  - `lib/api-client.ts:71-81` — `apiPatch` を削除。
    **注意**: `materials/[id]` と `section-series/[id]` の PATCH ルートは存在するが、それらを叩く
    ページ側は `apiPatch` を使っていないことを grep で確認済み。参照が出たらスキップして報告。
  - `acl/pronunciation-assessment/oss-worker/schema.ts:365` — 型 `OssWorkerErrorResponse` の
    export を削除（schema 定数は使用中なので残す）。
  - `infrastructure/training/diagnostic-section-fixture.ts:20-21` と
    `drill-section-fixture.ts:23-24` の ID 定数 4 つから `export` を外す（ファイル内参照のみ）。
- **完了条件**: FE 検証一式 PASS。
- **リスク**: 低（型・未参照のみ）。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(frontend): remove orphaned lib/api-types exports`

#### W05: frontend config のデッドフィールド削除

- **対象**: `applications/frontend/src/infrastructure/config/index.ts`
- **問題**: env を受理しながらどこからも読まれない設定が 3 つあり、「効くはずのノブ」が嘘をつく。
- **どう変えるか**: `localAudioMaxBytes`（zod 定義 :32 + 読み取り :176）、
  `openaiRawResponseMaxBytes`（:34 + :177）、`diagnosticFocusAlpha`（:52 + :182）の
  スキーマ定義・`process.env` 読み取り・型フィールドを削除する。
  対応する env 変数（`LOCAL_AUDIO_MAX_BYTES` / `OPENAI_RAW_RESPONSE_MAX_BYTES` / `DIAGNOSTIC_FOCUS_ALPHA`）
  が compose.yaml・.env*・ドキュメントに書かれていないか grep し、あれば同コミットでその記述だけ削除。
  **代替案の禁止**: これらを「配線して活かす」方向はデフォルト値と異なる env 設定時に挙動が変わるため
  本計画では行わない（§4.2）。
- **完了条件**: FE 検証一式 PASS（config-helpers.test.ts が対象フィールドに触れていないことは監査で確認済み。
  触れていたらテストの該当 expect を削除）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(frontend): drop unread config fields`

#### W06: backend デッドコード削除（小物一式）

- **対象**: `applications/backend/`
- **問題**: 未使用関数・スタブ・未使用依存が 7 件。うち `generateFindings` は agent-policy が禁じる
  本番プレースホルダスタブでもある。
- **どう変えるか**:
  - `src/NativeTrace/Worker/Application.hs:286-289` — `analyzerErrorToServant` を削除し、
    それで不要になる import（`err502` を他で使っていなければ）を整理。
  - `src/NativeTrace/Worker/Catalog.hs:42-48` — `flWeight` を定義と export list（:10）から削除。
    （live パスの FL 重みは `Scoring.hs` `computeFindingPenalty` にあり、値が異なる。
    **`computeFindingPenalty` 側の数値には絶対に触れない。**）
  - `src/NativeTrace/Worker/Scoring.hs:1670-1675` — スタブ `generateFindings _ _ _ = []` を定義と
    export（:14）から削除。
  - `src/NativeTrace/Worker/Assessment.hs:52,64,75` — 一度も構築されない `MissingRequiredField`
    コンストラクタと `errorCode`/`errorMessage` の対応 2 case を削除。
    **前提確認**: `grep -rn "missing_required_field" applications/frontend/src` が 0 件であること
    （0 件を監査で確認済み。ヒットしたらこの箇条書きだけスキップして報告）。
  - `src/NativeTrace/Worker/Scoring.hs:1568-1570,1687-1690` — 単純 alias `catalogData = catalog`、
    `gopSeverity = gopToSeverity` をインライン化して削除。
  - `AaiClient.hs:1`, `GoldenSpeakerClient.hs:1`, `test/.../ShadowingLagSpec.hs:1`,
    `test/.../GoldenSpeakerSpec.hs:1` — GHC2024 で冗長な `{-# LANGUAGE ImportQualifiedPost #-}` 行を削除。
  - `native-trace-worker.cabal:44` — 未使用依存 `http-conduit >=2.3` の行を削除。
- **完了条件**: BE 検証一式 PASS。`grep -rn "flWeight\|generateFindings\|analyzerErrorToServant\|MissingRequiredField\|http-conduit" applications/backend/src applications/backend/app applications/backend/*.cabal` が 0 件。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(backend): remove dead code and unused http-conduit dependency`

#### W07: backend `scoreAssessment` シムの解体

- **対象**: `applications/backend/src/NativeTrace/Worker/Scoring.hs:1653-1668`, `Assessment.hs:188`,
  `test/.../ScoringSpec.hs`（`scoreAssessment` 参照 2 箇所）
- **問題**: `scoreAssessment` は定数ベースラインを返すだけのシムで、出力のうち実際に下流で
  読まれるのは `outputTokens` のみ（他フィールドは `scoreFromGop` が全 7 スコアを上書きすることを
  `Scoring.hs:518-526` で監査確認済み）。`ScoringOutput.summaryMessageJa/En`（:198-199）と
  `ScoringInput.inputByteLength`（:184）は書かれるが読まれない。
- **どう変えるか**:
  1. `Assessment.hs:188` の `scoreAssessment ...` 呼び出しを `tokenize text` の直接利用に置き換える
     （`buildAssessmentResponseFromGop` が必要としているのはトークン列のみ。置き換え前に
     当該関数内で `scoringOutput` のどのフィールドが参照されているかを読み、`outputTokens` 以外の
     参照が残っていたら**中断して報告**する — その場合この項目の前提が崩れている）。
  2. `scoreAssessment`、`ScoringOutput` の `summaryMessageJa`/`summaryMessageEn` フィールド、
     `ScoringInput.inputByteLength` を削除。`ScoringOutput` を positional で構築している箇所
     （`scoreFromGop` :503-526 等）をフィールド数変更に合わせて修正。
  3. ScoringSpec の `scoreAssessment` 直接テスト 2 件は `tokenize` のテストに置き換える
     （同じ入力文字列でトークン数・内容を assert）。
- **完了条件**: BE 検証一式 PASS。`grep -rn "scoreAssessment\|inputByteLength\|summaryMessageJa" applications/backend/src` が 0 件（`summaryMessageJa` は **Scoring.hs 内の ScoringOutput フィールドとしての**出現が 0 件という意味。`Types.hs` の wire 側 `summary.messageJa` は別物であり残る）。
- **リスク**: 中（レコード形状変更）。ただし数値挙動は「全フィールド上書き」を確認済みのため不変。
  **戻し方**: `git revert`。
- **依存**: W06（同ファイルの削除が先）。
- **コミット**: `refactor(backend): dissolve scoreAssessment shim into direct tokenize call`

#### W08: analyzer デッドコード削除 + 微整理

- **対象**: `applications/python-analyzer/`
- **問題**: 未使用関数・定数・パラメータが 11 件。
- **どう変えるか**:
  - `src/python_analyzer/infrastructure/stimulus/libritts_carver.py:362-397` — `_extract_wav_from_archive` 削除。
  - `src/python_analyzer/infrastructure/stimulus/kokoro_supplement.py:37` — 空定数 `_VOICE_SEX_MAP` 削除。
  - `src/python_analyzer/usecase/analyze_pronunciation.py:24` — 未使用 `_STRESS_MARKS` 削除。
  - `src/python_analyzer/infrastructure/parselmouth_prosody.py:188-201` — 本番不使用の
    `parse_espeak_stress` を削除し、`test/infrastructure/test_stress.py` の該当テストケースを削除
    （`_predict_stress_from_acoustics` / `extract_word_stress` のケースは残す）。
  - `src/python_analyzer/usecase/analyze_pronunciation.py:231-234` — `_get_expected_ipa_per_word` の
    未使用引数 `reference_text` を削除（呼び出し 1 箇所も修正）。
  - `src/python_analyzer/infrastructure/stimulus/context_classifier.py:38-42` —
    `classify_phonological_context` の未読引数 `position_in_utterance` / `utterance_word_count` を削除し、
    `libritts_carver.py:192-201` の、それらを計算するためだけの word-position スキャンループを削除。
  - `src/python_analyzer/infrastructure/speech_rate.py:8` — 未使用 `logger` 削除。
  - `src/python_analyzer/usecase/analyze_pronunciation.py:355-362` — 素通しヘルパー
    `_extract_pcm_bytes(audio)` をインライン化（呼び出し箇所を `audio.content` に）。
  - 同ファイル :56-72 — コピペで二重化した docstring の `Args:` ブロックの片方を削除。
  - 同ファイル :103-104 と :159-160 — `_tokenize_words` / `_estimate_word_boundaries` の
    二重計算を、`if self._prosody:` ブロックの**前**で一度だけ計算して両所で使う形にホイスト
    （純関数・同一入力のため挙動不変）。
  - `download_alignment.py:1-23` — 実体は残し、「Dockerfile carver stage で実行」と書かれた
    stale docstring を「dev ホストで out-of-band carve の前に手動実行する」旨に修正。
    **ファイル削除はしない**（較正・carve の来歴ツールのため）。
- **完了条件**: PY 検証一式 PASS。
- **リスク**: 低（本番挙動に影響する削除は含まない）。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(analyzer): remove dead code and duplicate computations`

#### W09: scripts 較正スクリプトの隔離と stale ログ削除

- **対象**: リポジトリルート `scripts/`, `smoke.log`
- **問題**: CI/hook のゲートスクリプト置き場に一回性の較正・シミュレーションスクリプトが同居。
  ルートの `smoke.log` は untracked かつ内容が現状と矛盾する stale ログ。
- **どう変えるか**:
  1. `scripts/calibration/` を作成し、`scripts/calibrate_speech_active_rms.py`、
     `scripts/simulate_label_debounce.py`、`scripts/simulate_meter_peak_hold.py` を `git mv` で移動。
  2. パス参照の更新（コメント・ドキュメント内の 6 箇所）:
     `adr/016-*.md:120,127`、`docs/specs/recording-volume-meter-smoothing.md:51,163`、
     `applications/frontend/src/components/workspace/volume-meter.ts:54,89`、および
     `grep -rn "simulate_label_debounce\|simulate_meter_peak_hold\|calibrate_speech_active_rms" --include='*.md' --include='*.ts' --include='*.tsx' .`（node_modules 除外）で見つかる残り全部を
     `scripts/calibration/...` に書き換える。
  3. `calibrate_speech_active_rms.py` 内の `sys.path.insert`（:22-24 付近）の相対パスが
     移動後も `applications/python-analyzer/src` を指すよう修正（`../` が 1 段深くなる）。
  4. `smoke.log`: **削除前に `cat smoke.log` を実行して内容を作業ログへ全文残した上で** `rm smoke.log`。
     （untracked なのでコミット対象ではないが、破壊的操作の記録規約として必須。）
- **完了条件**: `pnpm fitness` PASS。`bash scripts/agent-policy-hook.sh` が存在しないパスを参照して
  いないこと（`grep -rn "simulate_\|calibrate_speech" scripts/*.sh .claude/settings.json ci/ .github/` が 0 件 —
  監査でこれらのスクリプトはどの hook/CI からも参照されていないことを確認済み）。
  `python3 scripts/calibration/calibrate_speech_active_rms.py --help` 相当の起動が import エラーに
  ならないこと（.venv 依存で実行不能な場合は `python3 -c "import ast; ast.parse(open('scripts/calibration/calibrate_speech_active_rms.py').read())"` で構文と、目視で sys.path 修正を確認）。
- **リスク**: 低。**戻し方**: `git revert`（smoke.log はログに全文が残っている）。
- **依存**: W00。
- **コミット**: `chore(scripts): isolate calibration tools under scripts/calibration`

---

### Phase 2: 特性テストの先行追加（これから触る未テスト箇所の固定）

#### W10: stats リポジトリ 2 本の特性テスト追加

- **対象**: 新規 `applications/frontend/src/infrastructure/drizzle/repositories/__tests__/library-stats-repository.test.ts` と `material-detail-stats-repository.test.ts`
- **問題**: `library-stats-repository.ts`（269 行）と `material-detail-stats-repository.ts`（232 行）は
  リポジトリ中最複雑の 5 段結合＋集計をもつのに**テストが 1 つもない**。W25 で共通化する前に挙動を固定する。
- **どう変えるか**: 既存の repo テスト（例: `__tests__/training-repositories.test.ts`）と同じ流儀
  （実 SQLite + `createDrizzleDatabase` + migration 適用 + 直接 insert）で、次のシナリオを固定する。
  期待値は**実装を読んで導出した現在の出力**をそのまま書く（真値ではなく現状固定が目的）:
  1. 教材 1 件・series 1 件・section 1 件・ready 録音 2 件・succeeded run/job/result
     （overallScore 60 と 80）→ `findStatsByMaterials` が best=80、attempt 数=2、
     `lastPracticedAt` = 新しい方の録音時刻を返す。
  2. result が 1 件も無い教材 → best が null（または実装どおりの初期値。実装を読んで確定させる）。
  3. `deletedAt` が立った run/attempt が集計から除外される（**現行実装が除外している場合のみ**。
     除外していないならその挙動をそのまま assert し、テスト名に `current behavior:` 接頭辞を付ける）。
  4. `material-detail-stats-repository` 側: series 2 件で片方のみ結果あり → series 単位のキーで
     ベスト/履歴が分かれること。`countWords` 相当の wordCount 値（空白 2 連を含む本文で現行値を固定）。
- **完了条件**: `pnpm test` PASS、テストファイル 2 本・**全ケース green**（RED になった場合、
  それは期待値導出の誤りなので実装は変更せずテスト側を現実に合わせる）。lint/typecheck PASS。
- **リスク**: 低（テスト追加のみ）。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `test(frontend): characterization tests for stats repositories`

#### W11: `usecase/shared/pagination.ts` の特性テスト追加

- **対象**: 新規 `applications/frontend/src/usecase/shared/__tests__/pagination.test.ts`
- **問題**: `toDomainPagination` は不正値を黙って既定値に落とす仕様なのにテストが無い。W13 が触る。
- **どう変えるか**: 現挙動を固定: (a) `{}` → offset 0 / limit 20、(b) `{offset: 5, limit: 10}` →
  そのまま、(c) `{offset: -1}` → 既定値 fallback、(d) `{limit: 101}` → 既定値 fallback
  （createLimit の上限 100 を超えた場合の現行挙動を実装から読み取って固定）。
- **完了条件**: `pnpm test` PASS、新テスト green。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `test(frontend): pin toDomainPagination fallback semantics`

---

### Phase 3: 直値の命名（数値・文字列の値変更ゼロ）

#### W12: backend Scoring/Assessment の定数命名と同一ファイル内重複除去

- **対象**: `applications/backend/src/NativeTrace/Worker/Scoring.hs`, `Assessment.hs`
- **問題**: 採点式の係数・閾値が裸リテラルで散在し、`gopToHeat` は既存の名前付き閾値と同じ値を
  再ハードコード。NBest 整形とカタログ参照タプルの抽出が 3〜4 重に重複。
- **どう変えるか**（**すべて「リテラル→名前付き定数」「式の共有」であり、数値は 1 bit も変えない**）:
  - `Scoring.hs:1486-1492` `gopToHeat`: `-2.0`/`-8.0`/`-12.0` を既存の
    `gopCeiling`/`gopMinorThreshold`/`gopMajorThreshold`（:207-219）への参照に置換。`-5.0` は
    新定数 `gopHeatLevel1Threshold = -5.0` として :219 付近の定数群に追加して参照。
  - NBest 整形 3 重複（:599-606, :1229-1238, :1287-1296）を top-level ヘルパーに抽出:
    ```haskell
    toNBestOutput :: [NBestEntry] -> Maybe [NBestOutputEntry]
    toNBestOutput [] = Nothing
    toNBestOutput entries = Just (map toEntry (take 3 entries))
     where
      toEntry e = NBestOutputEntry { nBestOutputPhoneme = nBestPhoneme e, nBestOutputConfidence = nBestConfidence e }
    ```
    ※既存 3 箇所の `if null ... then Nothing else Just (take 3 ...)` と完全同値であることを
    置換前に各箇所で確認する（空リスト時 Nothing / 非空時 take 3）。
  - カタログ参照タプル 4 重複（:611-624, :966-969, :1021-1024, :1082-1085）を抽出:
    ```haskell
    catalogRef :: Maybe CatalogEntry -> (Maybe Text, Maybe Text)
    catalogRef (Just e) = (Just (catalogIdentifier e), Just (flRank (catalogFunctionalLoad e)))
    catalogRef Nothing = (Nothing, Nothing)
    ```
  - `deriveAcousticEvidence` 内の lax-duration 計算 2 重複（:858-865, :938-945）: 同一 `where` 節に
    `laxDurations` / `measuredDur` の共有 binding を作り両所から参照
    （**Nothing/`Just "ok"` の null 分岐差はそのまま残す**）。
  - `buildGopFinding`（:572-666）を、上記 `toNBestOutput`/`catalogRef` 適用後に
    `resolveCatalogMatch :: Text -> Maybe Text -> (Bool, Maybe Text, Maybe Text)`（:611-624 の case 梯子）を
    top-level に切り出して 3 分割する。出力レコードのフィールド値は一切変えない。
  - 裸リテラルの命名（値は変えず名前を付けて参照に置換）:
    `connectedSpeechScore`（:349-370）の 75/20/5/10.0/10、`computeProsodyScore`（:407-443）の
    65/20.0/5.0/15/10.0、`computeNBestAccuracyBonus`（:402）の 0.5/10.0、`scoreFromGop`（:503-515）の
    blend 60/40 と重み 30/20/20/15/15、`scoreToCefrBand`（:476-481）の 80/70/55/40、
    ガードレール最小区間 `(endMs - startMs) < 50`（:118）→ `aaiMinSegmentMs`、
    finding confidence 0.75/0.70/0.65/0.65（:988,1049,1110,1154）、`computePriority`（:1554-1566）の
    4/3/2/1/6/3、`refNpvi` 既定 65.0（:1602）→ `defaultReferenceNpvi`、
    `Assessment.hs:109` の 1..600000 と :80 のメッセージ文字列 `"[1, 600000]"` を定数から組み立て、
    `Assessment.hs:270` の `3.14159`（**`pi` に置換してはならない。値が変わる**）と 0.7/0.25 を命名。
  - `computeFindingPenalty`（:458-471）の FL 係数 4.0/3.0/1.5/0.8 と severity 係数 2.0/1.5/1.0/0.2 に
    「live パス唯一の正であり Catalog 側と統一しないこと（ADR 判断待ち）」というコメントを付ける。
    数値は変更禁止。
- **完了条件**: BE 検証一式 PASS（ScoringSpec 1506 行が数値挙動のピンとして機能する。
  1 ケースでも落ちたら数値を変えてしまった証拠なので即中断・破棄）。
- **リスク**: 中（採点コード）。ScoringSpec が広く固定しているため実質は低。**戻し方**: `git revert`。
- **依存**: W06, W07（同ファイル編集の順序固定）。
- **コミット**: `refactor(backend): name scoring literals and deduplicate intra-module helpers`

#### W13: frontend pagination ヘルパー導入と `as never` 排除

- **対象**: `applications/frontend/src/usecase/shared/pagination.ts` と、`as never` で pagination を
  組んでいる usecase 20 箇所（`grep -rn "as never" applications/frontend/src/usecase --include='*.ts' | grep -v test` で列挙。例: `retire-material/index.ts:77`, `view-material-practice-plan/index.ts:108,177`,
  `view-practice-workspace/index.ts:258,300`, `dismiss-finding/index.ts:77,91`,
  `review-practice-history/index.ts:159,193`）
- **問題**: `offset: 0 as never, limit: 1000 as never` がブランド型を無効化し、1/1000 等の意味も無名。
- **どう変えるか**:
  1. `pagination.ts` に追加:
     ```ts
     /** 「最新 1 件だけ取る」ための固定ページ */
     export const singleItemPage = (): Pagination => buildPage(0, 1);
     /** 実質無制限に全件取るための固定ページ（現行 1000 を踏襲） */
     export const unboundedPage = (): Pagination => buildPage(0, 1000);
     export const firstPage = (limit: number): Pagination => buildPage(0, limit);
     const buildPage = (offsetValue: number, limitValue: number): Pagination => {
       const offset = createOffset(offsetValue);
       const limit = createLimit(limitValue);
       if (offset === null || limit === null) return defaultPagination();
       return { type: "offset", offset, limit };
     };
     ```
     ※ `createLimit` の上限が 100 の場合、`unboundedPage` の 1000 は null → defaultPagination(limit 20)
     になり**挙動が変わってしまう**。実装前に `domain/shared.ts` の `createLimit` 上限を必ず確認し、
     1000 が通らない場合は `buildPage` を使わず現行値をそのまま持つ
     `{ type: "offset", offset: 0 as Offset, limit: 1000 as Limit }` を **このヘルパー 1 箇所に閉じ込める**
     形にする（cast をヘルパー内に集約するのが本項目の目的。挙動は現状維持が最優先）。
  2. 20 箇所の呼び出しを該当ヘルパー（値が 0/1 なら `singleItemPage()`、0/1000 なら `unboundedPage()`、
     それ以外は `firstPage(n)`）に置換。**各箇所の offset/limit の数値は変えない。**
  3. `toDomainPagination`（:19-34）内の `0 as Offset`/`20 as Limit` を `createOffset(0)!` ではなく
     `defaultPagination()` の再利用に整理（W11 のテストが green のまま）。
- **完了条件**: FE 検証一式 PASS。`grep -rn "as never" applications/frontend/src/usecase --include='*.ts' | grep -v test` の残存ヒットが
  (a) `run-assessment-job/index.ts` の engine 記述子 2 箇所（W22 で除去予定）と
  (b) `usecase/shared/pagination.ts` 内にキャストを閉じ込めた場合のその箇所、のみであること
  （つまり **20 箇所の呼び出し側から `as never` が消えている**こと）。W11 のテストが変更なしで green。
- **リスク**: 低〜中（境界値の取り違え）。W11 のテストと各 usecase の既存テストが網。**戻し方**: `git revert`。
- **依存**: W11。
- **コミット**: `refactor(frontend): centralize pagination literals behind shared helpers`

#### W14: frontend domain/usecase の業務定数 hoist

- **対象**: frontend domain / usecase 各所
- **問題**: severity 順序・リトライ間隔・診断閾値などの業務ルールが裸リテラルで重複。
- **どう変えるか**（値の変更なし・名前付けと単一参照化のみ）:
  - `domain/assessment-result.ts` に `export const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 4, major: 3, minor: 2, suggestion: 1 };` を追加し、
    `usecase/submit-drill-attempt/index.ts:181-186` と `:227-232` の同一マップ 2 つを削除して参照に置換。
  - `domain/analysis-job.ts` に `export const ANALYSIS_JOB_RETRY_DELAY_MILLISECONDS = 30_000;` と
    `export const DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS = 3;` を追加。:364 の `30000` と :175 の `3` を
    参照に置換し、`usecase/run-assessment-job/index.ts:71` の `z...default(3)` を
    `.default(DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS)` に。
  - `usecase/run-assessment-job/index.ts:604-607` の `?? 3` / `?? 8` を
    `DEFAULT_LLM_NARRATIVE_MAX_CONCURRENCY = 3` / `DEFAULT_LLM_NARRATIVE_MAX_FINDINGS = 8` と命名して
    ファイル冒頭の定数群に置き、「`infrastructure/config/index.ts` の既定値と手動同期」コメントを付ける。
  - `usecase/complete-diagnostic-session/index.ts:175-181` の severity→mastery マップを
    `SEVERITY_MASTERY_ESTIMATE` + `UNKNOWN_SEVERITY_MASTERY = 0.5` としてモジュールレベルへ、
    :234-241 の phenomenon→catalogId マップを `PHENOMENON_TO_CATALOG_ENTRY` として同様に hoist。
    さらに同ファイルのテストに「マップの全 value が `getAllCatalogEntries()` の id に存在する」
    assert を 1 ケース追加（カタログ改名の検知網）。
  - `usecase/view-diagnostic-result/index.ts:32-33` の `75` を `STAGE_II_OVERALL_THRESHOLD = 75` に。
  - `usecase/start-hvpt-session/index.ts:196` の `20` を `HVPT_STIMULUS_FETCH_LIMIT = 20` に。
  - `domain/training/index.ts:235-243` の `rankToScore` をモジュールレベル
    `FUNCTIONAL_LOAD_RANK_SCORES` に hoist（毎呼び出しの再構築も解消）。
  - `domain/shared.ts` に `export const hoursToMilliseconds = (hours: number): number => hours * 60 * 60 * 1000;`
    を追加し、`domain/training/index.ts:1028-1029` の 2 箇所を置換。
  - `domain/assessment-result.ts:254` の `type: "cloud" | "oss_worker"` と
    `usecase/view-practice-workspace/index.ts:70,151` のインライン union を `EngineType`
    （`domain/analysis-job.ts:26`）参照に置換。**`lib/api-types.ts:311` の wire 型は触らない。**
- **完了条件**: FE 検証一式 PASS。追加した catalog-id 整合 assert が green。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W01, W02（同ファイル編集順序）。
- **コミット**: `refactor(frontend): hoist business constants to named module-level definitions`

#### W15: frontend lib/UI 定数の命名と共有

- **対象**: `applications/frontend/src/lib/`, `src/app/`, `src/components/workspace/volume-meter.ts`
- **問題**: 較正済み閾値やポーリング周期がページ間で二重定義。
- **どう変えるか**（値変更なし）:
  - `LOW_VOLUME_DISPLAY_THRESHOLD = 41` とその導出コメント（`sections/[sectionIdentifier]/page.tsx:40-45`
    と `diagnostic/.../page.tsx:36-41` の二重定義）を `src/components/workspace/volume-meter.ts` に
    1 つだけ移して export し、両ページは import する。
  - `src/lib/score-bands.ts` を新設: `MATERIAL_COMPLETED_SCORE = 90`（`app/page.tsx:162`）、
    `SCORE_WARN_THRESHOLD = 75`（`ScoreRows.tsx:30`）、`TRAINING_PLATEAU_MINUTES = 400`
    （`training/page.tsx:442-443`, `progress/page.tsx:281-286`）を定義して参照置換。
    ※ `progress/page.tsx:64` の Stage-II 判定 `70` と result ページの stage enum 判定の**不一致は
    直さない**（挙動選択になるため §4.2）。70 に `STAGE_II_SCORE_HEURISTIC = 70` と命名だけする。
  - `src/lib/session-storage-keys.ts` を新設:
    `diagnosticSessionKey = (identifier: string) => \`diagnostic-session-${identifier}\``
    （`app/page.tsx:181` write / `diagnostic/.../page.tsx:115` read）、
    `TRAINING_WEAKNESS_PROFILE_KEY = "training-weakness-profile-id"`（`training/page.tsx:150` read、
    e2e `training.spec.ts:194` write — **e2e 側も同じ定数を import できないため文字列は変えない**）。
  - クライアントポーリング定数の命名: `sections/.../page.tsx:157` の裸 `2000` を
    `WORKSPACE_POLL_INTERVAL_MILLISECONDS = 2000` としてページ冒頭に定義
    （diagnostic ページは既に命名済み。値の統一はしない）。
- **完了条件**: FE 検証一式 PASS。`pnpm test:e2e` PASS（表示・タイミングの実挙動が不変であること）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W03。
- **コミット**: `refactor(frontend): name calibrated UI thresholds and share duplicated constants`

#### W16: analyzer 定数の命名

- **対象**: `applications/python-analyzer/src/python_analyzer/`
- **問題**: 番兵値・較正値が裸リテラルのまま複数箇所に散在。
- **どう変えるか**（**数値の変更・統一は一切しない**。名前を付けて参照させるだけ）:
  - `infrastructure/audio_energy.py` に `NO_SPEECH_DBFS_SENTINEL = -100.0` と
    `WADA_SNR_SENTINEL_DB = -120.0` を追加。`wav2vec2_aligner.py:313-317` の `-100.0` と、
    `audio_energy.py:126-144` 内 5 箇所の `-120.0` を参照に置換。
    さらに `rms_to_dbfs(rms: float) -> float`（rms < 1e-9 で番兵を返す現行ロジックをそのまま移設）を
    `audio_energy.py` に追加し `measure_audio_quality` から使う。
    **`test/selfeval/transforms.py` と `scripts/calibration/calibrate_speech_active_rms.py` の
    ミラー実装は絶対に import へ書き換えない**（selfeval は本番コード非依存が設計。コメントだけ
    「audio_energy.py の定数とミラー」への言及を維持）。
  - `infrastructure/prosody_analyzer.py:102` の `6500.0` / `5500.0` を
    `FEMALE_MAXIMUM_FORMANT_HZ = 6500.0` / `DEFAULT_MAXIMUM_FORMANT_HZ = 5500.0`（ADR-018 D2 コメント付き）
    としてモジュール冒頭に定義し参照置換。
  - `usecase/analyze_pronunciation.py:372,378` の裸 `16000` 2 箇所を
    `from python_analyzer.infrastructure.audio_energy import TARGET_SAMPLE_RATE` の参照に…
    **してはならない**（usecase→infrastructure import は W41 で禁止 rule 化する方向と矛盾）。
    代わりにファイル内定数 `_FALLBACK_SAMPLE_RATE_HZ = 16000` を定義して置換し、
    「audio_energy.TARGET_SAMPLE_RATE と手動同期」コメントを付ける。
  - `kokoro_tts.py:51` の `_KOKORO_SAMPLE_RATE` を export（名前を `KOKORO_SAMPLE_RATE` に）し、
    `prosody_analyzer.py:129` でインラインの `24000` を import 参照に置換
    （infra→infra なので依存方向は問題ない）。
- **完了条件**: PY 検証一式 PASS。`pnpm test:drift` を実行し **PASS**（イメージ再ビルドで
  fingerprint が変わり再実行パスに入るが、数値不変なら band 内で green になるはず。
  FAIL したら数値を変えた証拠なので即破棄・報告）。
- **リスク**: 低〜中（drift sentinel が最終網）。**戻し方**: `git revert` + イメージ再ビルド。
- **依存**: W08, W09（calibration スクリプトのパスが確定していること）。
- **コミット**: `refactor(analyzer): name sentinel and calibration constants`

#### W17: analyzer 共有語彙の一本化（mime セット / schwa / 母音核セット）

- **対象**: `applications/python-analyzer/src/python_analyzer/`
- **問題**: WAV mime セットが 2+1 箇所、schwa 定数が 2 箇所、IPA 母音核 frozenset が 3 箇所に
  コピペされ、手動同期に依存している。
- **どう変えるか**:
  - `domain/phoneme.py` に `VOWEL_NUCLEI: frozenset[str]` と `SCHWA_PHONEME = "ə"` を追加
    （値は `usecase/analyze_pronunciation.py:21` の現行セットと**文字単位で一致**させる。
    `parselmouth_prosody.py:18` 版は `ɵ` が重複しているだけで集合として同値 — 置換前に
    `python3 -c` で 3 セットの set 等価を機械確認する）。
  - `usecase/analyze_pronunciation.py:21`、`infrastructure/syllable.py:11`、
    `infrastructure/parselmouth_prosody.py:18`（こちらは**未使用**のため import 置換ではなく削除）、
    `infrastructure/speech_rate.py:11`、`infrastructure/weak_form.py:48` を domain 参照に置換。
    （domain→他層の import は発生しないので ast-grep `python-no-infra-in-domain` に抵触しない。
    infra→domain / usecase→domain は許容方向。）
  - WAV mime セット: `domain/` には置かず（HTTP 語彙のため）、
    `infrastructure/audio_decode_vocabulary.py` ではなく—既存モジュール構成を増やしすぎないため—
    `usecase/analyze_pronunciation.py:371` と `usecase/compute_shadowing_lag.py:84` の同一 frozenset を
    `usecase/ports.py` 冒頭の `WAV_MIME_TYPES` に一本化して両者から import。
    `wav2vec2_aligner.py:107-115` の superset（flac/aiff 入り）は**別物なので触らない**。
- **完了条件**: PY 検証一式 PASS。`pnpm test:drift` PASS。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W16。
- **コミット**: `refactor(analyzer): unify duplicated phoneme and mime vocabularies`

---

### Phase 4: frontend 重複除去（ヘルパー抽出）

#### W18: `Brand` ヘルパーと非空文字列ファクトリの一本化

- **対象**: `applications/frontend/src/domain/*.ts`, `src/domain/training/index.ts`, `src/usecase/assessment-result-draft.ts`
- **問題**: `declare const __brand; type Brand<T,B>` が 11 ファイルに重複。
  `value.trim().length > 0 ? (value as X) : null` ファクトリが 22 箇所に重複。
- **どう変えるか**:
  1. `domain/shared.ts` の `Brand`（:100-101）を `export type Brand<T, B> = ...` として公開し、
     他 10 ファイルのローカル宣言（`analysis-engine.ts:1-2`, `analysis-job.ts:10-11`,
     `analysis-run.ts:5-6`, `assessment-result.ts:6-7`, `audio-file.ts:4-5`, `material.ts:5-6`,
     `recording-attempt.ts:5-6`, `section-series.ts:6-7`, `section.ts:6-7`, `training/index.ts:31-32`）を
     削除して import に置換。ブランドタグ文字列 `B` は各型で一意なので名義性は保たれる。
  2. `domain/shared.ts` に汎用ファクトリを追加:
     ```ts
     export const createNonEmptyBrandedString = <T extends string>(value: string): T | null =>
       value.trim().length > 0 ? (value as T) : null;
     ```
     既存の `createXxxIdentifier` 系 22 関数は**公開名・シグネチャを維持したまま**中身を
     `createNonEmptyBrandedString<XxxIdentifier>(value)` への委譲 1 行に置き換える
     （呼び出し側は無変更）。対象は `grep -rn "trim().length > 0 ? (value as" applications/frontend/src`
     でヒットする全箇所（W01 で消えた分を除く）。
- **完了条件**: FE 検証一式 PASS。`grep -rn "declare const __brand" applications/frontend/src | wc -l` が 1（shared.ts のみ）。
- **リスク**: 低（型レベル + 同値な委譲）。**戻し方**: `git revert`。
- **依存**: W01（デッドファクトリ削除後）。
- **コミット**: `refactor(frontend): single Brand helper and generic branded-string factory`

#### W19: zod 検証プロローグの共通化（usecase 19 ファイル）

- **対象**: `applications/frontend/src/usecase/**/index.ts` のうち
  `parsed.error.errors.map((e) => e.message).join(", ")` を含む 19 ファイル + 新規 `usecase/shared/validation.ts`
- **問題**: 同一 3 行のボイラープレートが 19 回コピペされ、禁止略語 `e` も含む。
- **どう変えるか**: `usecase/shared/validation.ts` を新設:
  ```ts
  import { err, ok, type Result } from "neverthrow";
  import { type z } from "zod";
  import { type DomainError, validationFailed } from "../../domain/shared";

  export const parseInput = <Schema extends z.ZodTypeAny>(
    schema: Schema,
    input: unknown,
  ): Result<z.infer<Schema>, DomainError> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return err(
        validationFailed(
          "input",
          parsed.error.errors.map((zodIssue) => zodIssue.message).join(", "),
        ),
      );
    }
    return ok(parsed.data);
  };
  ```
  19 ファイルの `schema.safeParse(input)` + エラー分岐を `parseInput(schema, input)` 呼び出しに置換。
  **注意**: `validationFailed` の第 1 引数が `"input"` 以外（フィールド名指定）になっている箇所は
  第 1 引数もパラメータ化して**現行のフィールド名文字列を維持**する（エラーメッセージは観測可能挙動）。
  各ファイル置換のたび該当 usecase のテストが zod エラー文言を assert していないか確認し、
  assert があれば文言が変わっていないことをテスト green で担保。
- **完了条件**: FE 検証一式 PASS。`grep -rn "error.errors.map" applications/frontend/src/usecase --include='index.ts' | wc -l` が 0。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W18。
- **コミット**: `refactor(frontend): shared zod input parsing for usecases`

#### W20: 逐次 `ResultAsync` 走査の共通化

- **対象**: `usecase/shared/`（新規 `traverse.ts`）+ 7 箇所:
  `reassess-practice-attempt/index.ts:132-137`, `cancel-assessment-run/index.ts:56-65`,
  `discard-assessment-run/index.ts:76-105`, `submit-practice-attempt/index.ts:304-309`,
  `review-practice-history/index.ts:125-210`（3 クローン）
- **問題**: index 再帰による逐次永続化/構築が 7 回再実装され、history 側は O(n²) の配列 spread。
- **どう変えるか**:
  ```ts
  export const traverseSequentially = <Item, Output>(
    items: readonly Item[],
    apply: (item: Item, index: number) => ResultAsync<Output, DomainError>,
  ): ResultAsync<Output[], DomainError> =>
    items.reduce(
      (accumulator, item, index) =>
        accumulator.andThen((outputs) =>
          apply(item, index).map((output) => {
            outputs.push(output);   // 同一配列に push（O(n²) spread の除去。外部へは同じ配列参照を返すのみ）
            return outputs;
          }),
        ),
      okAsync<Output[], DomainError>([]),
    );
  ```
  - 永続化系 4 箇所は `traverseSequentially(items, (x) => repo.persist(x)).map(() => undefined)` 形に置換。
    `discard-assessment-run` の state フィルタと job 構築は呼び出し側に残す。
  - `review-practice-history` の 3 クローンは各 `build*Sequentially` を
    `traverseSequentially(items, buildOne)` に置換（**構築順序 = 出力順序が保たれることが要件**。
    reduce 逐次なので保たれる）。
  - **実行順が変わらないこと**（前の persist が resolve してから次が始まる）がこのヘルパーの
    存在理由なので、`Promise.all`/`ResultAsync.combine` へ書き換えてはならない。
- **完了条件**: FE 検証一式 PASS（対象 usecase のテストが persist 呼び出し順・回数を固定している）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W19。
- **コミット**: `refactor(frontend): shared sequential ResultAsync traversal`

#### W21: run 状態再計算ブロックの共通化（4 箇所）

- **対象**: 新規 `usecase/shared/analysis-run-status.ts` + `run-assessment-job/index.ts:230-241,264-275,1027-1048`,
  `cancel-assessment-run/index.ts:117-131`
- **問題**: 「兄弟 job を再取得 → 更新 job を差し替え → `deriveAnalysisRunStatus` → `updateStatus`」が
  4 回書かれ、空リスト時 fallback だけが site ごとに違う（`"queued"` / `"failed"` など）。
- **どう変えるか**:
  ```ts
  export const recomputeAnalysisRunStatus = (
    analysisJobRepository: AnalysisJobRepository,
    analysisRunRepository: AnalysisRunRepository,
    updatedJob: AnalysisJob,
    emptyFallback: AnalysisRunStatus,
  ): ResultAsync<void, DomainError> =>
    analysisJobRepository
      .search({ type: "jobsByAnalysisRun", analysisRun: updatedJob.analysisRun, pagination: /* 現行と同値 */ })
      .andThen((jobPage) => {
        const allJobs = jobPage.items.map((job) =>
          job.identifier === updatedJob.identifier ? updatedJob : job,
        );
        const nonEmpty = createNonEmptyList(allJobs);
        const newStatus = nonEmpty ? deriveAnalysisRunStatus(nonEmpty) : emptyFallback;
        return analysisRunRepository.updateStatus(updatedJob.analysisRun, newStatus);
      });
  ```
  **各呼び出し箇所の fallback リテラルを引数にそのまま渡す**（値の統一はしない。4 箇所の現行値を
  置換前に読み取って一致させる）。search の criteria/pagination も各所の現行値を引数化するか、
  4 箇所で同一なら定数化する（置換前に diff で確認）。
- **完了条件**: FE 検証一式 PASS（run-assessment-job / cancel-assessment-run のテストが
  status 遷移を固定済み）。
- **リスク**: 中（fallback 取り違え）。→ 置換前に 4 箇所の fallback 値を表にして作業ログへ残すこと。
  **戻し方**: `git revert`。
- **依存**: W20。
- **コミット**: `refactor(frontend): extract shared analysis-run status recomputation`

#### W22: run-assessment-job 内部重複の除去

- **対象**: `usecase/run-assessment-job/index.ts`
- **問題**: (a) engine 記述子リテラル 2 重複（:399-421 vs :435-456、`as never` 付き）、
  (b) cancel-persist-return 15 行ブロック 3 重複（:327-343, :378-396, :994-1012）、
  (c) finding→generator 入力マッピング 16 フィールドの 2 重複（:663-690 vs :798-818。
  ADR-021 コメントが「両呼び出し点に必須」と警告している箇所）。
- **どう変えるか**: 同一ファイル内 module-level に 3 ヘルパーを抽出:
  `buildEngineDescriptor(runningJob)`（1 回構築して find と assess 両方に渡す）、
  `persistCanceledOutput(dependencies, job, now)`、`toImprovementMessageInput(findingDraft)`
  （phenomenon fallback `"substitution"` を含め**両所の現行フィールドを突き合わせて完全一致**させる。
  1 フィールドでも差異があれば中断して報告 — 差異はバグの証拠なので勝手に片寄せしない）。
- **完了条件**: FE 検証一式 PASS（index.test.ts 1481 行が cancel 3 経路・messageJa 系を固定済み）。
- **リスク**: 低〜中。**戻し方**: `git revert`。
- **依存**: W21（同ファイル編集順序）。
- **コミット**: `refactor(frontend): deduplicate run-assessment-job internal blocks`

#### W23: dismiss/restore の解決チェーン共通化

- **対象**: `usecase/dismiss-finding/index.ts:71-131`, `usecase/restore-finding/index.ts:66-125`,
  新規 `usecase/shared/finding-resolution.ts`
- **問題**: section→最新 ready attempt→最新 run→succeeded jobs→results→対象 finding の 5 段解決
  （約 60 行）が 2 usecase でほぼ同一（末尾の action と error 文言のみ相違）。
- **どう変えるか**: `resolveAssessmentResultForFinding(dependencies, sectionIdentifier, findingIdentifier)`
  を抽出し、両 usecase から呼ぶ。**4 つのエラーメッセージ文字列は現行のまま**ヘルパーに移す
  （両ファイルで文言が同一であることを置換前に diff 確認。異なる場合は引数化して両方の文言を維持）。
- **完了条件**: FE 検証一式 PASS。
- **リスク**: 低（両 usecase ともテストあり）。**戻し方**: `git revert`。
- **依存**: W20。
- **コミット**: `refactor(frontend): shared finding-to-assessment-result resolution`

#### W24: focusScores 変換と 0-100 換算の共通化

- **対象**: `usecase/capture-progress-snapshot/index.ts:94-106`, `usecase/complete-hvpt-session/index.ts:242-251`,
  新規 `usecase/shared/focus-score.ts`
- **問題**: mastery×100→round→`createFocusScore`→`_unsafeUnwrap` の同一ブロックが 2 usecase に重複。
- **どう変えるか**:
  ```ts
  export const toScore0To100 = (value0To1: number): number => Math.round(value0To1 * 100);
  export const deriveFocusScoresFromWeaknessProfile = (
    weaknessProfile: WeaknessProfile,
  ): Result<FocusScore[], DomainError> =>
    Result.combine(
      weaknessProfile.focusSounds.map((sound) =>
        createFocusScore(String(sound.contrast), toScore0To100(Number(sound.mastery))),
      ),
    );
  ```
  両 usecase の手書き isErr スキャン + `_unsafeUnwrap` ループを置換。
  **スナップショット組み立て全体（CEFR 近似を含む）の統合はしない**（CEFR の出所が両者で異なり、
  統合は挙動判断を伴うため。§4.2）。`Math.round(x * 100)` の他の出現
  （`complete-hvpt-session:231`, `capture-progress-snapshot:83-85`）も `toScore0To100` 参照に置換。
- **完了条件**: FE 検証一式 PASS（capture-progress-snapshot の M-PG-2 統合テストが値を固定）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W19。
- **コミット**: `refactor(frontend): shared focus-score derivation and percent conversion`

#### W25: stats リポジトリ 2 本の共通走査抽出

- **対象**: `infrastructure/drizzle/repositories/library-stats-repository.ts:21-268`,
  `material-detail-stats-repository.ts:30-231`, 新規同ディレクトリ `section-score-traversal.ts`
- **問題**: attempt→run→job→result の 5 段結合 + best/history 集計 約 130 行がコピペされ、
  両者とも 250 行級の単一関数。
- **どう変えるか**: W10 の特性テストを網として、
  1. 共有ヘルパー `collectScoresBySection(database, sectionIdentifiers)` を抽出し、
     section 単位の `{ bestScore, scoreHistory, lastPracticedAt, attemptCount }` を返す。
     **クエリの発行順・`inArray` の段数・JS フィルタ条件は現行と同一**にする（性能改善はしない）。
  2. `library-stats` は material 単位、`material-detail-stats` は series 単位の group-by を
     それぞれ自ファイルに残す。両ファイルとも段階ごとの名前付き関数
     （`loadActiveSeries` / `mapSectionsToMaterials` / `assembleStats` 等）に分割。
- **完了条件**: `pnpm test`（W10 のテスト全 green・変更なし）+ FE 検証一式 PASS。
- **リスク**: 中（未テストだった領域）→ W10 が前提。**戻し方**: `git revert`。
- **依存**: W10。
- **コミット**: `refactor(frontend): extract shared section-score traversal for stats repositories`

#### W26: リポジトリ boilerplate の共通化（62 箇所）

- **対象**: `infrastructure/drizzle/repositories/*.ts` 全 20 ファイル + `infrastructure/local-audio-storage.ts`,
  新規 `infrastructure/drizzle/repositories/try-persistence.ts`
- **問題**: `okAsync(null).andThen(() => { try { ... } catch (e) { return errAsync({ type: "persistenceFailed", reason: String(e) } as DomainError); } })`
  が 62 回コピペされ、`as DomainError` が判別 union の型検査を無効化している。
- **どう変えるか**:
  ```ts
  export const tryPersistence = <Output>(
    work: () => Output,
  ): ResultAsync<Output, DomainError> =>
    okAsync(null).andThen(() => {
      try {
        return okAsync(work());
      } catch (caught) {
        return errAsync<Output, DomainError>({
          type: "persistenceFailed",
          reason: String(caught),
        });
      }
    });
  ```
  （`DomainError` union に `persistenceFailed` が正しく在ることを `domain/shared.ts` で確認し、
  cast なしの型付きリテラルにする。variant 名が違ったら**中断して報告** — 現行 62 箇所が全部
  cast で嘘をついていたことになるため。）
  各メソッドを `tryPersistence(() => { ...現行 try 本体... })` に機械置換。work 内で
  `Result` を返す既存箇所があれば `andThen` 版 `tryPersistenceResult` を並設して対応。
  1 ファイルずつ置換し、そのたび `pnpm test -- <対応する repo テスト>` を回すこと。
- **完了条件**: FE 検証一式 PASS。`grep -rn "as DomainError" applications/frontend/src/infrastructure | wc -l` が 0。
- **リスク**: 低〜中（機械的だが件数が多い）。**戻し方**: `git revert`。
- **依存**: W25（stats 2 ファイルの構造確定後に一括置換）。
- **コミット**: `refactor(frontend): typed tryPersistence helper replaces repository boilerplate`

#### W27: section fixture 3 本の共通化

- **対象**: `infrastructure/training/{diagnostic,drill,finding-retry}-section-fixture.ts`,
  新規 `infrastructure/training/sentinel-section-fixture.ts`
- **問題**: Material→Series→Section の ensure-upsert 約 110 行が 3 ファイルにコピペ
  （テストがあるのは finding-retry 版のみ）。
- **どう変えるか**: パラメータ化した `ensureSentinelSectionExists({ database, materialIdentifier, seriesIdentifier, materialTitle, seriesTitle, sectionIdentifier, bodyText, bodyTextHash })`
  を **finding-retry 版（テスト済み）を canonical として**抽出し、3 ファイルは定数 + 薄い委譲だけにする。
  **`body_text_hash` の `Buffer.from(text).toString("base64").slice(0, 32)` 計算は 3 本とも現行のまま**
  維持する（section-repository の sha256 との不整合は既知だが、統一は挙動変更のため §4.2）。
- **完了条件**: FE 検証一式 PASS（`finding-retry-section-fixture.test.ts` 6 ケースが不変で green）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W26。
- **コミット**: `refactor(frontend): parameterize sentinel section fixtures`

#### W28: ACL fetch+timeout 骨格の共通化

- **対象**: `acl/pronunciation-assessment/oss-worker/create-oss-worker-pronunciation-assessment-adaptor.ts:45-71`,
  `create-oss-worker-shadowing-lag-adaptor.ts:61-88`, 新規 `acl/pronunciation-assessment/shared/fetch-json.ts`
- **問題**: AbortController + setTimeout + json-tolerant-parse の骨格が 3 箇所（gop-delta 含む）に
  コピペ。gop-delta 版はエラー契約が throw 型に分岐済み。
- **どう変えるか**: `fetchJsonWithTimeout(url, init, timeoutMilliseconds): Promise<{ status: number; rawBody: unknown }>`
  を抽出し、**oss-worker の 2 adaptor のみ**置換する（timeout テストがある assessment 版を canonical に）。
  `clearTimeout` の位置・abort 時の error 分類（`classifyFetchError`）は現行と同一パスを維持。
  **gop-delta adaptor は触らない**（throw→Result 化は挙動整理として §4.2 へ）。
- **完了条件**: FE 検証一式 PASS（`adaptor-timeout.test.ts` が timeout 挙動を固定）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `refactor(frontend): shared fetch-with-timeout for oss-worker adaptors`

#### W29: improvement-message 共有ヘルパーと zod 断片の共通化

- **対象**: `acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts:24-26`,
  `acl/improvement-message/llm/grounding-prompt.ts:37-45`,
  `acl/pronunciation-assessment/{openai,oss-worker}/schema.ts`,
  新規 `acl/improvement-message/shared.ts` と `acl/pronunciation-assessment/shared/schema-fragments.ts`
- **問題**: `resolveDisplayText` とカタログ lookup 前処理が rule-based / llm で重複。
  `textRangeSchema` / `findingCategorySchema`（5 値 enum）/ `findingSeveritySchema`（4 値 enum）/
  `pronunciationEvidenceSchema` が openai / oss-worker の 2 schema に同一定義。
- **どう変えるか**: 同一断片を shared モジュールへ移して両側から import。
  **audioRange 系は秒/ミリ秒で意図的に異なるため対象外**（触らない）。zod schema の移動は
  実行時等価（同じ zod ノード）なので挙動不変。
- **完了条件**: FE 検証一式 PASS（oss-worker schema テスト 25 ケース + rule-based 19 ケースが網）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W28。
- **コミット**: `refactor(frontend): share improvement-message helpers and zod fragments across engine ACLs`

#### W30: route 層 multipart/MIME 検証の共通化

- **対象**: `app/api/v1/sections/[sectionIdentifier]/practice-attempts/route.ts:15-26,111-208`,
  `diagnostic-sessions/[...]/recording-attempts/route.ts:36-47,105-212`,
  `findings/[...]/retry-recordings/route.ts:52-63,200-207`,
  `training/drills/[...]/attempts/route.ts:46-57,165-272`, 新規 `app/api/v1/_shared/multipart.ts`
- **問題**: `SUPPORTED_MIME_TYPES` セット（domain `audio-file.ts:15-21` の 5 個目のコピー）、
  browser_recording multipart 検証 約 75 行 ×3、`recordedDurationMs` パース ×4 が文字単位で重複。
- **どう変えるか**:
  1. `_shared/multipart.ts` に `SUPPORTED_AUDIO_MIME_TYPES`（**domain の
     `createAudioMimeType` が受理する集合を re-export**。domain から import できない場合は
     domain 側に `export const SUPPORTED_AUDIO_MIME_TYPES` を追加してそれを唯一の定義にする）、
     `parseBrowserRecordingForm(formData): Result<{...}, {status, code, message}>`、
     `parseRecordedDurationMilliseconds(formData)` を抽出。
  2. 4 route の該当ブロックを置換。**エラー応答の status / code / message 文言は route ごとの現行値を
     引数またはマップで完全維持**する（route テストが 2 本しかないため、置換前に 4 route の
     エラー文言表を作って作業ログに残し、置換後に照合する）。
- **完了条件**: FE 検証一式 PASS + `retry-recordings/route.test.ts`（390 行）green +
  `pnpm test:e2e`（録音系 spec: engine-selector-rerecord / diagnostic / training が green）。
- **リスク**: 中（route はテスト希薄）。→ 文言表照合を必須手順にする。**戻し方**: `git revert`。
- **依存**: W03。
- **コミット**: `refactor(frontend): shared multipart validation for recording routes`

#### W31: route 層 zod/エラー封筒/リクエスト ID の共通化

- **対象**: `app/api/v1/**` の 14 route（zod 変換）+ `golden-speaker/convert/route.ts:17-20`,
  `tts/route.ts:21-30`, `retry-recordings/route.ts:73-84`（手書き封筒）+ requestIdentifier 生成 6 箇所
- **問題**: `parseResult.error.errors.map((e) => e.message).join(", ")` の 14 コピー、
  `req_` ID 生成 6 コピー、手書きエラー封筒 3 コピー。
- **どう変えるか**: `_shared/validation.ts`（route 用。W19 の usecase 用とは別物）に
  `zodErrorToValidationFailed(zodError, field = "input")` を、`_shared/response.ts` に
  `generateRequestIdentifier()` を 1 つだけ置き、`_shared/errors.ts` に
  `errorResponse(status, code, message)` を追加して 3 箇所の手書き封筒を置換。
  **JSON ボディ読み取りの 2 流儀（`request.json()` try/catch 系 vs `request.text()`→`JSON.parse(text || "{}")` 系）は
  空ボディ時の挙動が異なるため統一しない**（現状維持）。
- **完了条件**: FE 検証一式 PASS + tts/route.test.ts・retry-recordings/route.test.ts green。
- **リスク**: 低〜中。**戻し方**: `git revert`。
- **依存**: W30。
- **コミット**: `refactor(frontend): shared zod mapping, request identifiers and error envelopes for routes`

#### W32: lib 純関数の集約（browser 判定 / 時刻整形 / source ラベル / phenomenon / 語数）

- **対象**: 新規 `src/lib/browser-environment.ts`, `src/lib/format-time.ts`, `src/lib/material-source.ts`
  + `src/lib/phenomenon.ts` 拡張 + `usecase/shared/tokenizer.ts` 拡張
- **問題**: `detectBrowserInfo` がページ 2 箇所に同一定義、日時整形が 5+ 流儀、
  `SOURCE_TYPE_LABELS`+`isTed` が 2 箇所（lowercase 有無で発散）、phenomenon アイコンが 2 実装、
  語数カウントが 3 層で発散。
- **どう変えるか**:
  - `detectBrowserInfo`（`sections/.../page.tsx:47-57` と `diagnostic/.../page.tsx:66-76`）を
    `lib/browser-environment.ts` へ移して両ページから import（実装は現行と文字単位で同一に）。
  - `lib/format-time.ts` に `formatDateTimeMinutes(isoText)`（history:50-58 実装を canonical）と
    `formatMinutesSeconds(totalSeconds)`（`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`）を置き、
    history/compare/section/diagnostic/training/WorkspaceResultV2 の該当ローカル実装を置換。
    **出力文字列が現行と一致することを各置換箇所で目視確認**（フォーマット差異があればその箇所は
    置換せずスキップして報告）。
  - `SOURCE_TYPE_LABELS`/`isTed` を `lib/material-source.ts` に一本化。**lookup 前に lowercase する
    home 版（`page.tsx:20,41`）を canonical とする**。material ページ側は厳密には
    「大文字混じり source の表示」が変わり得るが、DB 上の値は小文字で保存されており実データでは
    不変（変わるケースが観測されたら中断して報告）。
  - `lib/phenomenon.ts` に result ページの contrast 文字列ヒューリスティック版
    `getPhenomenonIconForContrast` と `PHENOMENON_LABELS` を統合し、
    `result/page.tsx:63-73` / `diagnostic/.../page.tsx:53-63` を import に置換。
  - `usecase/shared/tokenizer.ts` に `countWords(bodyText)`（`trim().split(/\s+/).filter(Boolean).length`）
    を追加し、`view-material-practice-plan/index.ts:138` と
    `material-detail-stats-repository.ts:21-25` を置換（infra→usecase/shared の import は
    ESLint zone で許容方向）。`lib/body-validation.ts:44-49` は**公開 API のため現状維持**し、
    「tokenizer.countWords と同義」コメントのみ付ける。空文字列時の 0/1 差は domain 検証で
    空本文が存在しないため実データ不変（W10 の wordCount 特性テストが網）。
- **完了条件**: FE 検証一式 PASS + W10 テスト green + `pnpm test:e2e` PASS。
- **リスク**: 低〜中。**戻し方**: `git revert`。
- **依存**: W10, W15。
- **コミット**: `refactor(frontend): consolidate pure display helpers into lib`

#### W33: engine 表示（色・ラベル）の一本化

- **対象**: 新規 `src/lib/engine-display.ts` + 6 箇所
  （`EngineTabs.tsx:12-21`, `EngineSegSelector.tsx:17,26`, `WorkspaceResultV2.tsx:428-431`,
  `sections/.../page.tsx:532-535`, `compare/page.tsx:20-24,105`, `history/page.tsx:18-48`）
- **問題**: engine 種別→CSS 変数・表示名のマッピングが 6 実装（デフォルト分岐の有無で既に発散）。
- **どう変えるか**: `engineColorVariable(engineKind)` / `engineDisplayName(engineKind)` を lib に置き、
  6 箇所を置換。history の mode-keyed マップ（`comparison→OpenAI` 等）は engineKind 版の薄い
  ラッパーとして history 内に残す。**現行の色変数名・ラベル文字列を 6 箇所から表に起こして
  一致確認してから置換**（不一致があった箇所はその値を維持するため引数化）。
- **完了条件**: FE 検証一式 PASS + `pnpm test:e2e` PASS（表示同一性）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W32。
- **コミット**: `refactor(frontend): single source for engine colors and labels`

#### W34: TTS 再生 hook 化と audio リソースリーク修正

- **対象**: `components/workspace/ArticulationCard.tsx:147-166,275-288`, `DetailPanelV2.tsx:128-147,182-188`,
  `WorkspaceResultV2.tsx:168-235,345`, `training/page.tsx:932-946,1296-1303`,
  新規 `components/workspace/use-tts-playback.ts`
- **問題**: `/api/v1/tts` fetch→Blob→再生ルーチンが 4 実装。加えて AudioContext が close されず
  （Chrome は約 6 個で新規作成不能→再生が黙って死ぬ）、`URL.createObjectURL` が 6 箇所で revoke されず、
  `WorkspaceResultV2.tsx:171-173` はイベントリスナー cleanup を `void cleanup;` で捨てている。
- **どう変えるか**:
  1. `useTtsPlayback()` hook を新設（`no-class-declaration` 準拠の関数実装）: fetch→objectURL→
     `Audio` 再生、`ended`/unmount 時に `URL.revokeObjectURL`、再生成せず ref で保持。
     4 箇所を置換（WorkspaceResultV2 のキャッシュ挙動は hook のオプションで維持）。
  2. AudioContext を component ごとに lazy-singleton 化（ref 保持、unmount effect で `close()`）:
     `DetailPanelV2` の部分再生、`ArticulationCard.playClip`、training シャドーイング
     （`training/page.tsx:966` — 成功パスのみ close している現行を、finally 相当で必ず close に）。
  3. `WorkspaceResultV2` の `attachAudioEvents` cleanup を保存し、`stopCurrentAudio` と
     unmount effect で必ず呼ぶ。`ArticulationCard` に unmount effect を追加し、録音中 unmount で
     mic トラック停止・再生中 TTS 停止。
  ※これらは「見えない資源管理」の修正であり画面挙動は不変（リーク時の沈黙死がなくなる方向のみ）。
- **完了条件**: FE 検証一式 PASS（ArticulationCard 964 行テスト + WorkspaceV2.test が網）+
  `pnpm test:e2e`（workspace-v2 / golden / training green）。
- **リスク**: 中（jsdom で AudioContext は実質検証不能）。e2e green + コードレビューで担保。
  **戻し方**: `git revert`。
- **依存**: W33。
- **コミット**: `refactor(frontend): shared TTS playback hook and audio resource cleanup`

#### W35: 録音リグの hook 化（section / diagnostic 2 ページ）

- **対象**: `sections/[sectionIdentifier]/page.tsx:202-299`, `diagnostic/.../page.tsx:213-387`,
  新規 `components/workspace/use-recording-with-volume-meter.ts`
- **問題**: getUserMedia 制約・AnalyserNode・peak-hold ループ・タイマー・cleanup 約 90 行が
  2 ページにほぼ同一コピー（較正コメントまで複製）。
- **どう変えるか**: `useRecordingWithVolumeMeter({ onStop })` hook に抽出。
  getUserMedia 制約（`autoGainControl: false` 等）・rAF ループの数式・`LOW_VOLUME_DISPLAY_THRESHOLD`
  参照（W15 で一本化済み）・cleanup 順序を**現行と同一**に保ち、2 ページの `onstop` 送信コールバックは
  各ページに残す。置換は 1 ページずつ行い、各置換後に該当 e2e を回す。
- **完了条件**: FE 検証一式 PASS + `pnpm test:e2e`（engine-selector-rerecord / diagnostic green）。
- **リスク**: 中（録音はアプリの心臓部。e2e が主網）。**戻し方**: `git revert`（ページ単位でコミットを
  分けたければ 2 コミットに分割してよい。その場合メッセージに `(1/2)`/`(2/2)` を付ける）。
- **依存**: W15, W34。
- **コミット**: `refactor(frontend): extract shared recording hook with volume meter`

#### W36: AppTop 採用と SeverityCountPills 抽出

- **対象**: インライン brand ブロック 5 箇所（`training/page.tsx:1098-1112`, `diagnostic/.../page.tsx:457-467`,
  `diagnostic/.../result/page.tsx:166-179`, `progress/page.tsx:305-315`, `sections/.../page.tsx:357-369`）、
  severity ピル行 2 箇所（`sections/.../page.tsx:450-464`, `compare/page.tsx:129-141`）
- **問題**: `AppTop` コンポーネントが存在するのに 5 ページがブランドヘッダーを手書き。
  severity カウントピルが 2 ページで文字単位に同一。
- **どう変えるか**: 5 箇所を `<AppTop />`（+ 各ページ固有の crumb/action は children/props で現行 DOM を
  維持）に置換。`SeverityCountPills counts={...}` を `components/workspace/` に新設して 2 箇所を置換。
  **レンダリング結果の DOM 構造・class 名は現行と一致させる**（e2e セレクタが `.app-top` 系 class に
  依存。置換前後で該当ページの HTML を dev サーバーで目視比較するか、e2e green を根拠とする）。
- **完了条件**: FE 検証一式 PASS + `pnpm test:e2e` PASS。
- **リスク**: 低〜中（視覚同一性）。**戻し方**: `git revert`。
- **依存**: W03。
- **コミット**: `refactor(frontend): adopt AppTop and extract SeverityCountPills`

---

### Phase 5: backend / analyzer の重複除去と構造化

#### W37: backend 純粋ヘルパー共有モジュール（mime / multipart / timeout env）

- **対象**: `AnalyzerClient.hs:591-670`, `AaiClient.hs:41-54,152-203`, `GoldenSpeakerClient.hs:38-51,115-149`,
  新規 `src/NativeTrace/Worker/HttpSupport.hs`, `native-trace-worker.cabal`
- **問題**: `mimeTypeToExtension` が 3 ファイルに逐語コピー、multipart ボディ組み立て骨格が 4 実装、
  timeout env 解決（正の整数 or 120）が 3 実装（うち 1 つだけ `Handler` モナドで型も不統一）。
- **どう変えるか**:
  1. `HttpSupport.hs` を新設し cabal `exposed-modules` に追加。内容:
     - `mimeTypeToExtension :: Text -> Text`（3 コピーと同一実装）
     - `data MultipartPart = MultipartPart { partName, partFileName :: Maybe Text, partContentType :: Maybe Text, partBytes :: ByteString }`
       と `buildMultipartBody :: Text -> [MultipartPart] -> ByteString`。
       **既存 4 ビルダーの出力バイト列（sep/crlf/Content-Disposition 行・末尾 `--\r\n`）と
       完全一致**させること。移行は 1 クライアントずつ行い、各クライアントの旧実装と新実装で
       同一入力のバイト列一致を一時的な unit テスト（またはghci 比較）で確認してから旧実装を消す。
     - `readTimeoutSecondsEnv :: String -> IO Int`（`lookupEnv >=> readMaybe`、`Just n | n > 0 -> n`、
       他は 120。3 箇所を置換。`AnalyzerClient` の `Handler Text` 版 URL 解決は
       `IO` 版に揃え、呼び出し側で `liftIO`）。
  2. **HTTP 呼び出し（`newManager` / `httpLbs` / status 分岐）は各 Client に残す**
     （`verify-worker-http-client-timeout.sh` の per-file 不変条件を維持するため。
     invoke 梯子の共通化は P-EH1 の挙動判断と絡むため §4.2）。
- **完了条件**: BE 検証一式 PASS + `bash scripts/verify-worker-http-client-timeout.sh` PASS +
  `bash scripts/verify-wiring.sh` PASS + `pnpm test:fullcycle gop-delta` PASS
  （multipart バイト列の実機互換を fullcycle が最終確認）。
- **リスク**: 中（multipart 枠組みのバイト一致が要）。→ バイト一致確認を必須手順化。
  **戻し方**: `git revert`（cabal 変更も同コミットに含まれるため revert で完結）。
- **依存**: W06, W12。
- **コミット**: `refactor(backend): shared HttpSupport module for mime, multipart and timeout env`

#### W38: backend Application.hs の重複除去

- **対象**: `Application.hs:201-210,257-266,268-284,291-305`
- **問題**: metadata JSON decode-or-400 が 2 実装、`toServantError` が `badRequest` を再実装。
- **どう変えるか**:
  ```haskell
  decodeMetadataJson :: Aeson.FromJSON a => ByteString -> Handler a
  decodeMetadataJson bytes =
    case eitherDecodeStrict bytes of
      Right value -> pure value
      Left decodeError ->
        throwError (badRequest "invalid_metadata_json" ("Failed to parse metadata JSON: " <> Text.pack decodeError))
  ```
  `parseMetadata` / `parseShadowingMeta` を置換。`toServantError err = badRequest (Assessment.errorCode err) (Assessment.errorMessage err)` に単純化（出力バイト同一。ApplicationSpec の 400 系 3 テストが固定）。
- **完了条件**: BE 検証一式 PASS + `bash scripts/verify-servant-route-handler-parity.sh` PASS。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W37。
- **コミット**: `refactor(backend): deduplicate metadata decoding and 400 construction`

#### W39: AAI ガードレール整合ロジックの Scoring 移設

- **対象**: `Application.hs:100-144` → `Scoring.hs` 新関数
- **問題**: 純粋なドメインロジック（ガードレール通過 estimate の finding への突合・付与）が
  HTTP ハンドラ内にインライン展開され、HTTP 抜きでテストできない。
- **どう変えるか**: `Scoring.hs` に
  `attachArticulatoryEstimates :: [RawArticulatoryEstimate] -> [AssessmentFinding] -> [AssessmentFinding]`
  を追加（**中身は Application.hs:100-144 の list 内包・突合条件
  （phoneme 一致 + midpoint 含有）を字句移動**。判定式を 1 文字も変えない）。ハンドラは
  `pure baseResponse { responseFindings = attachArticulatoryEstimates rawEstimates (responseFindings baseResponse) }`
  相当の 1 式へ。`Scoring.hs` に `AaiClient` から `RawArticulatoryEstimate` の import が増えるのは許容
  （Haskell 側に層 lint は無い。循環しないことを確認: AaiClient は Scoring を import していない →
  監査で AaiClient の import は Types/AnalyzerClient のみと確認済み）。
  移設後、ScoringSpec に純関数となった `attachArticulatoryEstimates` の直接テストを 2 ケース追加
  （通過 estimate が対象 finding にだけ付く / どの finding にも合わない estimate は無視される —
  期待値は現行ハンドラの挙動から導出）。
- **完了条件**: BE 検証一式 PASS + 追加テスト green + parity スクリプト PASS。
- **リスク**: 低（純粋移動 + テスト追加）。**戻し方**: `git revert`。
- **依存**: W38。
- **コミット**: `refactor(backend): move articulatory estimate attachment into Scoring`

#### W40: `buildAssessmentResponseFromGop` の分割

- **対象**: `Assessment.hs:134-218`
- **問題**: 品質ゲート判定・low_quality 応答リテラル・通常応答パイプライン（build* 7 連）が
  85 行の単一 `where` 塊で、応答リテラル 2 つが 4 フィールドを重複記述。
- **どう変えるか**: `buildLowQualityResponse :: AssessmentRequest -> AnalyzerResult -> AssessmentResponse` と
  `buildNormalResponse ...` を top-level に抽出し、共有フィールド（meta / diagnostic マッピング）を
  共通 binding に。**両応答のフィールド値は現行と同一**（ScoringSpec の low_quality ゲートテストが
  `diagnosticPerPhonemeGop` 充足と `perPhonemeGop` 空を固定済み）。
- **完了条件**: BE 検証一式 PASS。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W12（同ファイルの定数化が先）。
- **コミット**: `refactor(backend): split low-quality and normal assessment response builders`

#### W41: analyzer 依存方向の是正（LagComputationPort）+ 適応度関数追加

- **対象**: `usecase/compute_shadowing_lag.py:10,15,77-110`, `usecase/ports.py`, `app.py`,
  `infrastructure/dtw_lag.py`, 新規 `.ast-grep/rules/python-no-infra-in-usecase.yml`
- **問題**: usecase が `infrastructure.dtw_lag` と numpy を直 import しており、
  usecase 層の自己宣言（domain のみ依存）と DI 方針に反する。この違反を検知する機械検査も無い。
- **どう変えるか**:
  1. `ports.py` に `LagComputationPort`（Protocol。`compute(reference_boundaries, learner_boundaries, reference_waveform, learner_waveform) -> ShadowingLagMeasurement` — 実際のシグネチャは現行 `compute_lag` 呼び出しから写経）を追加。
  2. `_load_waveform_numpy`（:77-110）を `infrastructure/dtw_lag.py` へ移設（numpy import ごと）。
  3. usecase は port を constructor 注入で受け、`app.py` の composition root で
     dtw_lag 実装を bind（`http_handler.set_shadowing_lag_use_case` 経路は不変）。
  4. `.ast-grep/rules/python-no-infra-in-usecase.yml` を新設（`python-no-domain-in-infra.yml` を雛形に、
     `src/python_analyzer/usecase/**` 内の `from python_analyzer.infrastructure...` import を error に）。
     `sgconfig.yml` への登録要否は既存ルールの配置に倣う。**ルール追加はリファクタ完了後**
     （先に足すと自分の作業がブロックされる）。
  5. `test/usecase/test_compute_shadowing_lag.py` の `_FixedAligner` 系 double に port の fake を追加
     （テスト専用 double は許容領域）。
- **完了条件**: PY 検証一式 PASS + `pnpm fitness` PASS（新ルールが green）+
  違反を意図的に 1 行書いて `ast-grep scan` が error を出すことを確認して戻す（ルール発火確認）。
- **リスク**: 低〜中。**戻し方**: `git revert`。
- **依存**: W16, W17。
- **コミット**: `refactor(analyzer): invert dtw_lag dependency behind LagComputationPort with fitness rule`

#### W42: `/v1/analyze` ルートの interface 層移設とマッパー抽出

- **対象**: `app.py:81-301`, `interface/http_handler.py`, `wiring_manifest.yml`（記述確認のみ）
- **問題**: リポジトリの配線規約（routes は `interface/http_handler.py` → `app.py` は `include_router` のみ）
  に反し、**最重要ルート `/v1/analyze` が composition root に直接定義**されている。210 行 closure が
  検証・実行・約 130 行の応答マッピングを混在。
- **どう変えるか**:
  1. `interface/http_handler.py` に `set_analyze_pronunciation_use_case(...)` setter を追加
     （`/v1/shadowing-lag` の既存 setter パターン（:240-246）を踏襲）し、ルート定義を移設。
  2. 応答マッピング（app.py:172-301）を `interface/` の純関数
     `to_analysis_response(result: RawMeasurementResult, speaker_sex: str) -> AnalysisResponse` に抽出。
     `test/interface/` にフィールド網羅の unit テストを追加（実 wav2vec2 不要。
     `RawMeasurementResult` を dataclass 直組みで与え、camelCase キーと値変換を assert —
     期待値は現行 app.py のマッピング式から導出）。
  3. `app.py` は use case 構築 + setter 呼び出し + `include_router` のみに。
     エラーマッピング（400/500/ALIGNMENT_FAILED 分岐）は**コード・文言・status とも現行を維持**。
  4. `wiring_manifest.yml` の `python-analyzer-entrypoint-needs-app-wiring` 系記述が新配置と
     整合することを確認（manifest が「router→include_router」を正とするなら本項目で実態が
     規約に合流する。manifest 側の修正が必要なら同コミットで行い、diff を報告に含める）。
- **完了条件**: PY 検証一式 PASS + `docker compose up -d --build worker analyzer` 後に
  `curl -sf http://localhost:8788/health` OK + `pnpm test:fullcycle gop-delta` PASS +
  `pnpm test:drift` PASS + `bash scripts/verify-wiring.sh` PASS。
- **リスク**: 中（最重要ルートの移動）。fullcycle + drift + interface E2E テスト
  （`test_http_handler.py` は TestClient で `/v1/analyze` を実打）が三重の網。
  **戻し方**: `git revert` + `docker compose up -d --build analyzer`。
- **依存**: W41（app.py の編集順序）。
- **コミット**: `refactor(analyzer): move /v1/analyze route into interface layer with pure response mapper`

---

### Phase 6: frontend 構造化（ファイル分割・巨大関数分解）

#### W43: `domain/training` god-module の分割

- **対象**: `domain/training/index.ts`（1150 行、5 集約同居）
- **問題**: DiagnosticSession+WeaknessProfile / ProgressSnapshot / TrainingSession / HvptTrial /
  SpacingSchedule の 5 集約が 1 モジュールに同居し、`captureProgressSnapshot`（:1112）は自分の
  集約セクション（:470）から 500 行離れている。約 30 の importer が全部を引き込む。
- **どう変えるか**: **純粋なファイル移動 + barrel re-export**（コード本文は 1 文字も変えない）:
  1. `domain/training/diagnostic.ts`（:29-468 — ブランド型・FocusSound・recomputeFocusPriority・
     initializeWeaknessProfile・completeDiagnosticSession・updateWeaknessProfile）、
     `progress-snapshot.ts`（:470-608 + :1074-1150 の captureProgressSnapshot）、
     `training-session.ts`（:610-808）、`hvpt-trial.ts`（:810-960）、
     `spacing-schedule.ts`（:962-1072）へ分割。ファイル間で必要になる型は明示 import。
  2. `domain/training/index.ts` は 5 ファイルの `export *`（または現行 export 名の明示 re-export）だけにする。
     → **importer 側の import パス（`domain/training`）は無変更**。
  3. `Brand`/共有ファクトリは W18 で `domain/shared` から import 済みのはずなので、各分割ファイルが
     それを import する。
- **完了条件**: FE 検証一式 PASS + `pnpm fitness` PASS（`domain-purity` と ADR-007 TC 境界 zone は
  `domain/training` ディレクトリ単位なので分割後も適用される）。`git diff --stat` で
  `index.ts` の削減行数と新 5 ファイルの追加行数の合計が概ね一致（±re-export 分）していること。
- **リスク**: 低（移動のみ・型検査が全捕捉）。**戻し方**: `git revert`。
- **依存**: W14, W18（同ファイルの内容変更が全部先に終わっていること）。
- **コミット**: `refactor(frontend): split domain/training god-module into per-aggregate files`

#### W44: `run-assessment-job` のステージ分解

- **対象**: `usecase/run-assessment-job/index.ts:291-1137`（846 行関数）
- **問題**: リース・キャンセル監視・IO 取得・engine 解決・draft 検証・LLM バッチ・finding 変換・
  永続化・イベント組み立てが単一 closure に同居（ネスト 12 段、mutable capture あり）。
- **どう変えるか**: **module-level の純関数/準関数へ段階抽出**（W22 のヘルパーは抽出済み前提）:
  - `validateDraft(draft): Result<ValidatedDraft, DomainError>`（:502-525 ほか検証群）
  - `precomputeFeedbackLayers(dependencies, findingDrafts): ResultAsync<Map<...>, DomainError>`（:592-741 の LLM バッチ）
  - `mapFindingsToDomain(dependencies, draft, precomputedLayers)`（:750-889）
  - `buildScoreSet(draft)`（:891-919）
  - `withCancelCheck(dependencies, jobIdentifier, continuation)`（3 つのキャンセル検問を包む）
  メイン関数は上記の直列合成だけにする。**キャンセル検問の位置（リース直後 / engine 呼び出し前 /
  永続化前）と `let jobDiagnosticPerPhonemeGop` の受け渡し（M-CRL-16 コメント）を変えない**
  （mutable capture は戻り値のタプル/フィールド渡しに置換してよいが、値の内容とタイミングは同一に）。
  1481 行の既存テストを**一切変更せず** green に保つことが挙動不変の証明。
- **完了条件**: FE 検証一式 PASS（`run-assessment-job/index.test.ts` 無変更で green）。
- **リスク**: 中。テストが厚いので実質は低〜中。**戻し方**: `git revert`。
- **依存**: W21, W22。
- **コミット**: `refactor(frontend): decompose run-assessment-job into named stages`

#### W45: registry の LLM provider 分岐抽出

- **対象**: `src/registry.ts:371-421`, 新規 `src/registry-improvement-message.ts`
  （または `src/infrastructure/…` 配下ではなく registry と同層 — `registry.ts` は
  composition root であり ESLint zone の対象外パスであることを `eslint.config.mjs` で確認して配置）
- **問題**: 750 行の DI ファイル内に、唯一の非自明ロジック（provider 分岐 + `isClaudeCodeAvailable`
  ダウングレード + console.warn）が埋まっている。
- **どう変えるか**: `buildImprovementMessageGenerator(config, database, logger)` を新ファイルへ
  純移動し、`registry.ts` からは 1 呼び出しに。**W02 で registry を触った後の状態を前提に、
  console.error/console.warn の JSON 形式ログはそのまま移す**（`logger` 化は挙動変更なのでしない —
  §4.2 C-28 参照）。`Container` 型・`globalThis.__nativeTraceContainer` キー・`getContainer` の
  シグネチャは**絶対に変えない**（dev hot-reload と全 route が依存）。
- **完了条件**: FE 検証一式 PASS + `pnpm dev` を起動して `curl -sf http://localhost:3000/api/v1/materials` が
  200 を返す（DI 再配線の実機確認。確認後 dev サーバーは停止してよい）。
- **リスク**: 低〜中（DI の要）。**戻し方**: `git revert`（+ dev サーバー再起動）。
- **依存**: W02。
- **コミット**: `refactor(frontend): extract improvement-message generator wiring from registry`

---

### Phase 7: 命名是正（限定）とエラー処理の穴の修正

#### W46: `BrowserInfo` → `BrowserEnvironment` リネーム

- **対象**: `domain/recording-attempt.ts:35-40` + 参照
  （`infrastructure/drizzle/repositories/recording-attempt-repository.ts:15,68`、
  usecase/route/page の型注釈・変数名）
- **問題**: ドメインモデル名に禁止語 `Info`。
- **どう変えるか**: 型 `BrowserInfo` → `BrowserEnvironment`、関連変数 `browserInfo` →
  `browserEnvironment`、`detectBrowserInfo`（W32 で lib 化済み）→ `detectBrowserEnvironment` に
  リネーム。**変更禁止**: multipart フィールド名 `"browserInfo"`（route が formData から取るキー、
  ページが append するキー）、DB カラム `browser_info_json`、zod schema のワイヤキー。
  これらは文字列リテラルなので `grep -rn '"browserInfo"' 'browser_info'` で境界を列挙してから
  内側の識別子だけを機械リネームする。
- **完了条件**: FE 検証一式 PASS + `pnpm test:e2e`（録音系 spec green = ワイヤキー無傷の証明）。
  `grep -rn "BrowserInfo" applications/frontend/src --include='*.ts' --include='*.tsx' | grep -v '"browserInfo"' | grep -v browser_info` が 0 件。
- **リスク**: 中（ワイヤキーの巻き込み）。→ 境界リテラル列挙を必須手順化。**戻し方**: `git revert`。
- **依存**: W32, W35（browserInfo 周辺の移動が確定してから）。
- **コミット**: `refactor(frontend): rename BrowserInfo to BrowserEnvironment (wire keys unchanged)`

#### W47: `MaterialDetailStatsRepository` → `SectionSeriesStatsRepository` リネーム

- **対象**: `usecase/port/material-detail-stats-repository.ts`（ファイル名ごと）、
  `infrastructure/drizzle/repositories/material-detail-stats-repository.ts`（同）、
  `usecase/view-material-practice-plan/index.ts:90`、`src/registry.ts:20,316`
- **問題**: 禁止語 `Detail` を含み、しかも実体は series 単位の統計（返す DTO は既に
  `SectionSeriesStats`）で名前が実装と不一致。
- **どう変えるか**: port 型・factory 名（`createDrizzleMaterialDetailStatsRepository` →
  `createDrizzleSectionSeriesStatsRepository`）・DI フィールド名・ファイル名を一括リネーム
  （`git mv` + tsc 追従）。W10/W25 のテストファイル名・import も追従。
- **完了条件**: FE 検証一式 PASS。`grep -rni "materialdetailstats" applications/frontend/src` が 0 件。
- **リスク**: 低（識別子のみ、tsc が全捕捉）。**戻し方**: `git revert`。
- **依存**: W25（同ファイルの構造変更後）。
- **コミット**: `refactor(frontend): rename MaterialDetailStats to SectionSeriesStats`

#### W48: backend 命名の是正（真偽値の意味・フィールド族の統一）

- **対象**: `Scoring.hs:266-277`（`checkAudioQuality`）と呼び出し（`Assessment.hs:171`、ScoringSpec ×10）、
  `AnalyzerClient.hs:330-332`（`analyzerSpeakerSex`）
- **問題**: `checkAudioQuality` は **True = 低品質** を返すのに名前が「品質 OK?」と読める。
  `AnalyzerResult` の 16 フィールド中 15 個が `analyzed*` なのに 1 個だけ `analyzer*`。
- **どう変えるか**: `checkAudioQuality` → `isLowQualityAudio`、`analyzerSpeakerSex` →
  `analyzedSpeakerSex` にリネーム（レコードフィールドのみ。**FromJSON 内のワイヤキー
  `"speakerSex"` は不変**）。参照（Scoring.hs:549、fixture、Spec）を追従。
- **完了条件**: BE 検証一式 PASS。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W40（Assessment.hs の分割後）。
- **コミット**: `refactor(backend): clarify audio-quality predicate and analyzed* field family`

#### W49: `intelligibility` 検証漏れの修正（`_unsafeUnwrap` 脱出経路の封鎖）

- **対象**: `usecase/run-assessment-job/index.ts`（W44 分解後の `validateDraft` / `buildScoreSet`）
- **問題**: draft 検証ループは 6 スコアキーのみ対象で `intelligibility` を検証せず、
  範囲外値（例 101）が来ると `createScore0To100(...)._unsafeUnwrap()` が **neverthrow の外で throw**
  → `failAnalysisJob` されずリースが宙に浮く。現行テストは null しか与えていない。
- **どう変えるか**:
  1. `validateDraft` の検証対象に `intelligibility`（nullable 分岐つき）を追加し、範囲外は
     他スコアと同じ `assessmentSchemaInvalid` 系エラーへ。
  2. `buildScoreSet` は検証済み値のみを扱う前提となるため `_unsafeUnwrap()` を維持してよいが、
     直上に「validateDraft が範囲を保証」というコメントを付ける。
  3. テスト追加: `scores.intelligibility: 101` の draft で job が**例外ではなく**
     schema-invalid の失敗経路（既存の schema-invalid ケースと同じ observable 挙動）に入ることを assert。
  ※これは「クラッシュ→定義済みエラー」への変更であり、正常系の挙動・数値は不変。
  エラー処理の穴の修正として本計画に含める。
- **完了条件**: FE 検証一式 PASS + 追加テスト green。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W44。
- **コミット**: `fix(frontend): validate intelligibility score before unwrap in run-assessment-job`

#### W50: `DetailPanelV2` の finding 切り替え時 state リーク修正

- **対象**: `components/workspace/WorkspaceResultV2.tsx:513-519`
- **問題**: `<DetailPanelV2 finding={selectedFinding} ...>` に `key` が無く、finding A を
  dismiss して finding B を選ぶと同一インスタンスが再利用され、B が dismissed 表示になる
  （`useState(finding?.dismissed ?? false)` は初回のみ評価されるため）。TTS/部分再生 state も同様に残留。
- **どう変えるか**: 1 行追加:
  ```tsx
  <DetailPanelV2
    key={selectedFinding.finding}
  ```
  （`selectedFinding` の一意キーとなるフィールド名は `WorkspaceResultV2` 内で `selectedFinding` が
  どの DTO かを読んで確定させる。finding 識別子フィールドが `finding` でなければそれに合わせる。）
  テスト追加: `WorkspaceV2.test.tsx` に「finding A を選択して dismissed 状態にする → finding B に
  切り替えると DetailPanelV2 が初期状態で描画される」ケースを 1 本追加。
  ※dismiss 済み表示のリークという**明白な UI バグの修正**であり、意図された挙動の変更ではない。
- **完了条件**: FE 検証一式 PASS + 追加テスト green + `pnpm test:e2e`（workspace-v2 spec green）。
- **リスク**: 低（remount は元コードの前提を回復するだけ）。**戻し方**: `git revert`。
- **依存**: W34（同ファイル編集順序）。
- **コミット**: `fix(frontend): remount DetailPanelV2 per finding to prevent state leak`

#### W51: neverthrow 整合性の修正（偽 Result / chain 内 throw）

- **対象**: `usecase/revise-material/index.ts:92-95`, `usecase/revise-practice-section/index.ts:117-139`,
  `usecase/browse-practice-materials/index.ts:113-115`
- **問題**: (a) `{ isOk: () => true, ... } as ReturnType<...>` の構造偽装 Result が 3 箇所 —
  neverthrow の他メソッドを呼んだ瞬間に壊れる。(b) `map` 内の `throw new Error("unreachable")` が
  1 箇所 — 発火すると DomainError ではなく unhandled rejection になる。
- **どう変えるか**: (a) は `ok(existing.title)`（neverthrow の実コンストラクタ）に置換。
  (b) は直前の filter を型述語 `(material): material is ActiveMaterial => material.type === "active"` に
  変えて throw 行を削除（`view-material-practice-plan:181-183` に既存の同パターンあり。それを踏襲）。
- **完了条件**: FE 検証一式 PASS（3 usecase とも既存テストあり・無変更で green）。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W19。
- **コミット**: `fix(frontend): replace forged Result literals and in-chain throw`

#### W52: smart-constructor 迂回キャストの正規化

- **対象**: usecase 層の `createXxx(...) as Xxx` パターン 23 箇所
  （`grep -rn ") as .*Identifier\|as PhonemeContrast\|as ResponseLabel\|as NonEmptyList" applications/frontend/src/usecase --include='index.ts'` で列挙）
- **問題**: ガード付き 15 箇所はキャストが `| null` を消すため TS がガードを死コードと誤認。
  **ガード無し 8 箇所**（`complete-diagnostic-session/index.ts:346-352,414-417`,
  `complete-hvpt-session/index.ts:144,188`, `start-hvpt-session/index.ts:239-241`,
  `submit-hvpt-trial/index.ts:102,146`, `submit-drill-attempt/index.ts:339,348`）は null が
  ブランド型として下流へ流れうる。`start-hvpt-session/index.ts:103-107,127-130` は
  コンストラクタ失敗時に偽 `ResponseLabel` を捏造。
- **どう変えるか**:
  1. `usecase/shared/identifier.ts` に
     `generateIdentifier<T>(entropyProvider, factory: (raw: string) => T | null, fieldName: string): Result<T, DomainError>`
     を追加（ULID 生成 → factory → null なら `validationFailed(fieldName, ...)`）。ULID→brand→check の
     9 箇所を置換。
  2. ガード付き 15 箇所: キャストを外し、`const identifier = createXxx(raw); if (identifier === null) return errAsync(validationFailed(...));` の
     narrow 形へ（**エラーメッセージは各所の現行文言を維持**）。
  3. ガード無し 8 箇所: 同形のガードを**追加**する。実 ULID/検証済み入力では発火しない経路なので
     正常系挙動は不変（発火時が throw/undefined 汚染から定義済みエラーになる — W49 と同種の穴封鎖）。
  4. `ResponseLabel` 捏造 2 箇所: `buildChoicesForStimulus` を `Result` 返しに変えて伝播
     （コメントいわく失敗不能なので dead-fallback の除去）。
- **完了条件**: FE 検証一式 PASS。`grep -rn "as never" applications/frontend/src/usecase --include='index.ts' | wc -l` が 0（W13 の pagination ヘルパー内 1 箇所を除く）。
  `grep -c ") as .*Identifier" 対象ファイル` が 0。
- **リスク**: 中（8 箇所のガード追加は理論上の挙動追加）。既存テストが正常系を固定。**戻し方**: `git revert`。
- **依存**: W18, W44（対象ファイルの構造確定後）。
- **コミット**: `fix(frontend): route branded-type construction through smart constructors`

#### W53: shadowing adaptor の ArrayBuffer コピー修正

- **対象**: `acl/pronunciation-assessment/oss-worker/create-oss-worker-shadowing-lag-adaptor.ts:40-50`
- **問題**: `input.referenceAudioBytes.buffer.slice(0)` は **byteOffset/byteLength を無視して
  underlying ArrayBuffer 全体**をコピーする。呼び出し側が subarray を渡した瞬間、worker に
  ゴミ音声が送られる潜在バグ（現行呼び出しは全長バッファのため未発火）。姉妹実装
  `request-mapper.ts:51` は正しく `new Uint8Array(...)` を使っている。
- **どう変えるか**: 2 つの Blob 構築を `new Blob([new Uint8Array(input.referenceAudioBytes)], ...)`
  形式に統一（learner 側も同様）。テスト追加: byteOffset 付き `Uint8Array` view を渡して
  Blob の中身が view の範囲と一致することを assert する unit テスト 1 本。
- **完了条件**: FE 検証一式 PASS + 追加テスト green。
- **リスク**: 低（現行呼び出しではバイト列同一・防御のみ強化）。**戻し方**: `git revert`。
- **依存**: W28（同ファイルの fetch 共通化後）。
- **コミット**: `fix(frontend): respect typed-array views when building shadowing audio blobs`

#### W54: 層違反の是正と ESLint zone の増設

- **対象**: `usecase/port/improvement-message-generator.ts:7`,
  `components/workspace/WorkspaceResultV2.tsx:10`, `applications/frontend/eslint.config.mjs`
- **問題**: (a) usecase port が UI DTO モジュール `lib/api-types` を import（api-types 自身の
  ヘッダ宣言に違反）。(b) components が `@/acl/golden-speaker/schema` を型 import（components 層で
  唯一の acl 依存）。どちらも ESLint zone の未規制領域なので機械検査に映らない。
- **どう変えるか**:
  1. `AcousticEvidenceDto` の形を port ファイル内の型定義（または `usecase/assessment-result-draft.ts`
     の既存 `AcousticEvidenceDraft` への参照 — 完全同形なら後者）に置換し、`lib/api-types` は
     その型を re-export する形に逆転（フィールドは 1 つも変えない。tsc が同形性を保証）。
  2. `GoldenConversionResponse` 型を `lib/api-types.ts` に移し、`acl/golden-speaker/schema.ts` は
     lib から import（zod schema 実体は acl に残す）。`WorkspaceResultV2` は lib から import。
  3. `eslint.config.mjs` の zone に
     `{ target: "./src/usecase", from: "./src/lib" }` と
     `{ target: "./src/components", from: "./src/acl" }` を追加
     （CLAUDE.md の「層ルールには適応度関数を同 PR で」に従う）。
- **完了条件**: FE 検証一式 PASS + `pnpm fitness` PASS + 逆検証: 一時的に components から acl を
  import する 1 行を書いて `pnpm lint` が error を出すことを確認して戻す（zone 発火確認）。
- **リスク**: 低〜中（型移動 + lint 増設）。**戻し方**: `git revert`。
- **依存**: W34（WorkspaceResultV2 編集順序）。
- **コミット**: `refactor(frontend): fix lib/acl layer breaches and enforce with eslint zones`

---

### Phase 8: glue / scripts / ドキュメント

#### W55: fitness コマンドの一本化

- **対象**: `applications/frontend/package.json` の `"fitness"` script、`scripts/fitness/check.sh`
- **問題**: frontend 側 `fitness` はどこからも参照されない上、
  `eslint --rule 'import/no-restricted-paths: error' src/`(zones 未指定) は**何も強制しない no-op**。
  一方で root fitness に無い `verify-no-harness-import-in-prod.sh` を含み、カバレッジが食い違う。
- **どう変えるか**:
  1. `scripts/fitness/check.sh` の末尾に `bash "$(dirname "$0")/../verify-no-harness-import-in-prod.sh"` 相当の
     呼び出しを追加（root fitness のカバレッジを frontend 版の上位互換にする）。
  2. frontend `package.json` の `"fitness"` を `"bash ../../scripts/fitness/check.sh"` への委譲 1 行に
     置換（no-op フラグの削除）。
- **完了条件**: `pnpm fitness` PASS（root）+ `cd applications/frontend && pnpm fitness` PASS（委譲）+
  逆検証: frontend src に一時的に `test/fullcycle` への import を書いて root fitness が FAIL する
  ことを確認して戻す。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W00。
- **コミット**: `chore(fitness): unify frontend fitness with root check including no-harness gate`

#### W56: デフォルトエンドポイント直値の集約

- **対象**: `applications/frontend/src/infrastructure/config/index.ts:148,168`、root `package.json:20`
- **問題**: `"http://localhost:8788"` が config の同一ファイル内に 2 回、root `test:drift` に
  `--analyzer-url http://localhost:8788`（`drift_check.py:515` の既定値の重複）が 1 回。
- **どう変えるか**: config 冒頭に `const DEFAULT_ANALYZER_ENDPOINT = "http://localhost:8788";` を
  置いて 2 箇所から参照。root `package.json` の `test:drift` から冗長な `--analyzer-url ...` 引数を
  削除（drift_check.py 側の既定値と同値であることを削除前に確認）。
  ※worker 8787 / analyzer 8788 の**言語間**重複（Main.hs / Dockerfile / compose / config）は
  各プロセスが自分の既定値を持つ構造上必然なので統一しない。compose.yaml を正とする旨の
  コメントを config の定数に付ける。
- **完了条件**: FE 検証一式 PASS + `pnpm test:drift` PASS。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W05。
- **コミット**: `refactor(config): name default analyzer endpoint and drop redundant drift arg`

#### W57: verify スクリプトの changed-files ロジック共通化

- **対象**: `scripts/verify-no-prod-doubles.sh:13-33`, `scripts/verify-test-bypass.sh:11-29`,
  `scripts/verify-no-stub-placeholder.sh:19-37`, `scripts/verify-wiring.sh:18-30`,
  新規 `scripts/lib/changed-files.sh`
- **問題**: `BASE_REF → git diff base...HEAD → working-tree fallback` ブロックが 4 スクリプトに
  コピペされ、`test_dir_re`/`code_ext_re` も 3 重複。2026-06-18 の「untracked 空振り」インシデントでは
  全コピーに同じパッチを当てる羽目になった。**これらは fail-open なマージゲート**であり、
  抽出ミスは「静かな green」として現れる（最も危険な壊れ方）。
- **どう変えるか**:
  1. `scripts/lib/changed-files.sh` に現行ブロックを 1 つだけ移し（`set -euo pipefail` 下で動く
     関数 `collect_changed_files` と共有正規表現変数）、4 スクリプトから `source` する。
     `agent-policy-hook.sh:21` が使う**単一ファイル引数モードを必ず温存**する。
  2. 移行後の回帰検証（**完了条件に含める必須手順**。インシデントの再現シナリオ）:
     ```bash
     # (a) working-tree フォールバック: untracked の違反ファイルを検知できるか
     echo 'const x = vi.mock("y");' > applications/frontend/src/tmp-violation.ts
     bash scripts/verify-no-prod-doubles.sh; echo "exit=$?"   # 期待: 非 0
     rm applications/frontend/src/tmp-violation.ts
     # (b) クリーン時に green か
     bash scripts/verify-no-prod-doubles.sh && bash scripts/verify-test-bypass.sh \
       && bash scripts/verify-no-stub-placeholder.sh && bash scripts/verify-wiring.sh; echo "exit=$?"  # 期待: 0
     # (c) 単一ファイル引数モード
     bash scripts/verify-no-prod-doubles.sh applications/frontend/src/registry.ts; echo "exit=$?"  # 期待: 0
     ```
  3. 4 スクリプトの検知ロジック本体（grep パターン等）は**一切変えない**。
- **完了条件**: 上記 (a)(b)(c) が期待どおり + `pnpm fitness` PASS + 通常編集で
  `scripts/agent-policy-hook.sh` がブロックを誤発火しない（この項目のコミット自体が hook を
  通過することが実地確認になる）。
- **リスク**: 中（fail-open ゲート）。→ 回帰シナリオを完了条件に組み込み済み。**戻し方**: `git revert`
  し、(a)(b)(c) を旧実装で再実行して健全性を確認。
- **依存**: 他の全項目より**後**（ゲート自体を工事中にしない）。W55。
- **コミット**: `refactor(scripts): extract shared changed-files collection for verify gates`

#### W58: 死んでいるライセンスゲートの CI 配線

- **対象**: `.github/workflows/pr-gate.yml`, `scripts/verify-cc-by-nc-exclusion.sh`
- **問題**: ADR-009/REQ-NF-101 のライセンスゲート（CC BY-NC / L2-ARCTIC 混入検査）が
  **どの CI・hook からも呼ばれておらず一度も走っていない**。stimuli 資産を触るリファクタが
  無検査で通る状態。
- **どう変えるか**: pr-gate.yml の policy job の verify ステップ列（既存 11 本の並び）に
  `- name: verify cc-by-nc exclusion` / `run: bash scripts/verify-cc-by-nc-exclusion.sh` を 1 ステップ追加。
  事前にローカルで `bash scripts/verify-cc-by-nc-exclusion.sh; echo $?` を実行し 0 を確認
  （現行資産で FAIL する場合は**配線せず**、失敗出力を添えて報告 — 資産側の問題は本計画の範囲外）。
- **完了条件**: ローカル実行 exit 0 + workflow YAML が `actionlint`（あれば）または
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pr-gate.yml'))"` で構文 OK。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W57（同一領域の工事完了後）。
- **コミット**: `ci(pr-gate): wire orphaned cc-by-nc exclusion gate`

#### W59: CLAUDE.md 構成ドリフトと no-harness ルールの整合

- **対象**: ルート `CLAUDE.md`（構成ブロック）、`.ast-grep/rules/no-harness-import-in-prod.yml`
- **問題**: CLAUDE.md の `applications/` 一覧に python-analyzer / golden-speaker / aai が無く、
  この計画のような「CLAUDE.md からスコープを見積もる」作業が 2 サービス分過小評価する。
  ast-grep の no-harness ルールは相対パス 3 段までしか列挙せず `../../../` とエイリアス import を
  見逃す（grep 版スクリプトとカバレッジが非対称）。
- **どう変えるか**:
  1. CLAUDE.md の構成ブロックに 3 アプリを 1 行ずつ追記（compose profile 注記つき。日本語）。
     ローカル GHC 9.12.2 / CI 9.10.3 の乖離注記をツールチェイン節に 1 行追加。
  2. `no-harness-import-in-prod.yml` を `domain-purity.yml` と同じ
     `kind: import_statement` + `regex:` 形式に書き換え、`test/fullcycle|test/selfeval` を含む
     import source を深さ非依存で検知させる。逆検証: 一時ファイルで `../../../test/fullcycle/x` と
     `@/test/selfeval/y` の import を書き `ast-grep scan` が両方 error にすることを確認して削除。
  3. grep 版 `verify-no-harness-import-in-prod.sh` は現状のまま（二重防御として維持）。
- **完了条件**: `pnpm fitness` PASS + 逆検証 2 パターン発火確認 + CLAUDE.md の差分が
  構成ブロックとツールチェイン節のみであること。
- **リスク**: 低。**戻し方**: `git revert`。
- **依存**: W55。
- **コミット**: `docs(claude): document 5-app layout and tighten no-harness ast-grep rule`

---

## 4. やらないことリスト

### 4.1 全面禁止（善意でもやってはならないこと）

1. **機能追加・仕様変更・UI の見た目変更**。本計画のスコープは挙動保存リファクタリングと、
   明示的に指定された「エラー処理の穴」の封鎖（W49/W50/W51/W52/W53）のみ。
2. **依存ライブラリの追加・更新・削除**（W06 の `http-conduit` 削除は「未使用依存の削除」であり唯一の例外。
   それ以外は package.json / cabal / pyproject / uv.lock / Dockerfile の依存行に触れない。
   **analyzer の Dockerfile pip 行は drift fingerprint の入力なので特に厳禁**）。
3. **ワイヤ契約の変更**: JSON フィールド名・ルートパス・multipart パート名・HTTP ステータス・
   エラー封筒の形・DB カラム名・`sessionStorage` キー文字列（§1.3 参照）。
   `catalogId` / `wordPositionLabel` / `browserInfo`（multipart キー）等は命名規約違反に見えるが
   **契約なので凍結**。
4. **採点・計測の数値挙動の変更**: `Scoring.hs` の全係数・閾値、analyzer の Praat/scipy パラメータ
   （time_step 0.005 / 6500・5500 Hz / sample_fractions / WADA 定数等）、`3.14159` の `pi` 化、
   Catalog と Scoring の FL 重み不一致の「修正」、`gopToHeat` の段の値。名前を付けても値は変えない。
5. **テストの削除・弱体化**（作業項目で明示された随伴更新以外）。`FAIL[KNOWN]` として登録済みの
   analyzer `noise_monotonicity` の失敗を「直す」「消す」ことも禁止（既知の open defect として管理中）。
6. **`test/selfeval/` に本番コードの import を足すこと**（ミラー実装は設計。逆方向の統一も禁止）。
7. **schema.ts（Drizzle）と migration の変更**。本計画に DB スキーマ変更は 1 件もない。
   もし必要に見えたらそれは計画の読み違い。
8. **ast-grep ルール・ESLint zone・verify スクリプトの検知ロジック本体の緩和**
   （W41/W54/W59 の「追加・厳格化」だけが許可されている）。
9. **`.agent-evidence/`・`ci/allowlist.yml`・`wiring_manifest.yml` の変更**（W42 の manifest 整合確認で
   差分が必要になった場合のみ、diff を報告に含めた上で許可）。
10. **`updateWeaknessProfile`（DD-263）一族と `DetailPanel.tsx`（V1）の削除**。設計済み未配線であり
    オーナー判断待ち（§4.2）。
11. **計画にない問題を見つけても直さないこと**。発見したら作業ログに「発見事項」として記録して
    次の項目へ進む。スコープ膨張がこの種の計画の最大の失敗要因。
12. **`git push --force`、履歴改変、`main`/`develop` への直接操作**。作業は
    `refactor/2026-07-repo-cleanup` ブランチ内で完結させる。push とマージはオーナーが行う。

### 4.2 エスカレーション一覧（発見済みだが挙動判断が必要 — 着手禁止、報告のみ）

監査で確認済みの「直したくなるが挙動が変わる」項目。実行者はこの表を最終報告に添付すること。

| # | 内容 | 場所 |
|---|---|---|
| E01 | worker: analyzer への接続失敗/timeout 例外が Handler を素通りして raw 500（文書上は 502） | `AnalyzerClient.hs:487,559`, `GoldenSpeakerClient.hs:88` |
| E02 | worker: `findTextRangeForTime` の式が常に最終トークンを指す（textRange が全 finding で末尾語） | `Scoring.hs:1413-1422` |
| E03 | worker: `buildHeatEntry` の index 計算が常に 0（heatmap の word が常に先頭語） | `Scoring.hs:1459-1484` |
| E04 | worker: `/version` は 0.1.0、assessment 応答は 0.2.0 と 2 つの version が併存 | `Application.hs:71` vs `Assessment.hs:148-151` |
| E05 | worker: 400 は JSON 封筒・502/503 は plain text の非対称エラー契約 | `AnalyzerClient.hs:492-510` ほか |
| E06 | worker: 品質ゲートがクライアント申告 durationMs を使い実測値を無視 | `Assessment.hs:139` |
| E07 | worker: HTTP client が per-request で TLS Manager を新規作成（接続プール無効） | 4 クライアント各所 |
| E08 | analyzer: espeak-ng subprocess に timeout 無し（ffmpeg は 30s あり） | `espeak_g2p.py:41-47` |
| E09 | analyzer: expectedStress は espeak 由来ではなく母音数ヒューリスティック（stress 記号は上流で常に除去済み） | `analyze_pronunciation.py:270-279`, `espeak_g2p.py:71` |
| E10 | analyzer: `/v1/tts` の RuntimeError が ErrorResponse 封筒にならず素の 500 | `http_handler.py:55-72` |
| E11 | analyzer: forced_align 失敗が空結果に潰され ALIGNMENT_FAILED と区別不能 | `wav2vec2_aligner.py:246-256` |
| E12 | analyzer: Kokoro KPipeline が呼び出しごとに再構築（TTS 遅い） / analyze で音声 3 回デコード・CTC 2 回推論 | `kokoro_tts.py:89`, `wav2vec2_aligner.py` |
| E13 | analyzer: Dockerfile の `ENV ANALYZER_PORT` は CMD に読まれず飾り | `Dockerfile`, `main.py:16` |
| E14 | frontend: retry-recordings ルートがインフラ障害を 422 low_quality と誤報告 | `retry-recordings/route.ts:122-125,271-272,319-323` |
| E15 | frontend: HVPT の presentedAt/reactionTime が捏造値（now-2s / セッション経過秒） | `training/page.tsx:346-347` |
| E16 | frontend: `training-weakness-profile-id` を書くのは e2e ヘルパーだけで、実ユーザーは training 画面に到達不能 | `training/page.tsx:150`, `e2e/training.spec.ts:194` |
| E17 | frontend: ドリル録音の chunks が組み立て・送信されず破棄（TODO sub-2 のまま UI だけ存在） | `training/page.tsx:903-926` |
| E18 | frontend: `extractTargetPhonemeFindings` の文書化された rule 2 が未実装で catalogId null の finding が全部素通り（ドリルがほぼ常に success） | `submit-drill-attempt/index.ts:143-159` |
| E19 | frontend: Stage-II 判定が progress 画面（score>=70 ヒューリスティック）と result 画面（stage enum）で不一致 / Now-Next-Later の閾値も 2 流儀 | `progress/page.tsx:58-66`, `result/page.tsx:38-48` |
| E20 | frontend: view-material-practice-plan が DB 障害を「空のプラン」として描画（notFound と障害の混同） | `view-material-practice-plan/index.ts:99-135` |
| E21 | frontend: run status が history（保存値）と workspace（jobs から導出）で不一致になりうる | `review-practice-history:133` vs `view-practice-workspace:325-328` |
| E22 | frontend: repository が criteria を無視して全件返す 3 箇所（resultsByAnalysisRun 等）と、soft-delete フィルタがページネーション後に適用される 3 箇所 | `assessment-result-repository.ts:130-141`, `section-series-repository.ts:105-127` ほか |
| E23 | frontend: analysis-job の終端状態保存が attemptCount 0 / maxAttempts 3 を固定書き込み（履歴消失） | `analysis-job-repository.ts:175-207` |
| E24 | frontend: audio ストリームの contentType が常に "audio/webm" / Range 未検証 / duration プレースホルダ 0 | `local-audio-storage.ts:58,87-98` |
| E25 | frontend: stimulus-client に timeout も zod 検証も無し（analyzer ハングで startHvptSession が無期限待ち） | `analyzer/stimulus-client.ts:41-60` |
| E26 | frontend: api-client が非 JSON エラー応答（Next の 500 HTML 等）で SyntaxError になり status が失われる / fetch に timeout 無し | `lib/api-client.ts:33-49` |
| E27 | frontend: golden-speaker/tts ルートが container を迂回して raw fetch（timeout 無し）/ golden-speaker ルートだけ `/v1` prefix 無し | `golden-speaker/convert/route.ts`, `tts/route.ts`, `Api.hs:32-35` |
| E28 | frontend: body_text_hash が sha256（section-repository）と base64-slice（fixtures）の 2 流儀で同じカラムに書かれる | `section-repository.ts:38-41` vs fixtures |
| E29 | frontend: セッション上限が 20 分（コード）と 30:00（表示）で不一致 | `training/page.tsx:393,749` |
| E30 | frontend: repositories が Clock/EntropyProvider port を使わず `new Date()`/`randomUUID()` 直呼び（spacingSchedule は persist ごとに createdAt を now で上書き） | 12 ファイル、特に `spacing-schedule-repository.ts:68` |
| E31 | frontend: 診断 poll ループに中断機構なし / unmount 後 setState | `diagnostic/.../page.tsx:232-253` |
| E32 | frontend: ArticulationCard の 422 low_quality が UI 無反応（スピナーが消えるだけ） | `ArticulationCard.tsx:325-328` |
| E33 | frontend: 押しても何も起きない inert コントロール群（home フィルタピル、複製ボタン、compare の再生ボタン等） | §監査 X5 の列挙参照 |
| E34 | frontend: history のセクション切替時に前セクションの行が表示されたまま（loading フラグが立たない） | `history/page.tsx:155-189` |
| E35 | frontend/worker: `speakerSex` を worker が analyzer に送っておらず、ADR-018 の性別別フォルマント天井が常に unknown 側 | `AnalyzerClient.hs:409-412` |
| E36 | domain: `findCatalogEntry` の substring/順序依存マッチ（自己文書化された latent shadowing bug） | `error-catalog/index.ts:191-213` |
| E37 | 命名の広域是正候補: `CatalogId`→`CatalogEntryIdentifier`（196 参照・ACL 境界要設計）、`ErrorCatalogEntry.id`→`identifier`、`insertionPositionMs` 等 `Ms`→`Milliseconds`（DTO 越境）、`view-progress` の公開フィールド `prev`→`previous` | 各所 |
| E38 | worker: `checkAudioQuality` に渡り続ける不使用 `_estimatedSnrDb` と ADR-032 無効化ゲートの残骸整理（再設計待ちで意図的保持） | `Scoring.hs:250-277` |

---

## 5. 実行者への指示文（このままコピペして渡す）

```
あなたは NativeTrace リポジトリのリファクタリング実行者です。
docs/plans/2026-07-04-refactoring-plan.md が唯一の作業指示書です。以下を厳守してください。

1. まず計画書の §1（現状理解）と §4（やらないことリスト）を全文読むこと。§4 は禁止事項であり、
   あなたの善意による逸脱（ついでの修正・整理・最適化）を明示的に禁止しています。
2. W00 から始め、W59 まで**計画書に書かれた順に 1 項目ずつ**実施する。項目の並列実施・順序入替は禁止。
   各項目の「依存」に列挙された項目が完了済みであることを着手前に確認する。
3. 1 項目 = 1 コミット。コミットメッセージは各項目の指定を使う。コミット前に必ずその項目の
   「完了条件」のコマンドをすべて実行し、期待結果と一致することを確認する。
4. 完了条件を満たせない場合は、コミットせず `git restore .`（新規ファイルは削除）で作業を破棄し、
   【項目 ID / 実行したコマンド / 完全な出力 / あなたの推定原因】を報告して停止する。
   勝手なリトライ・回避策・完了条件の読み替えは禁止。
5. 計画書の line 番号は基準コミット 3684715 時点の値。位置特定は必ずシンボル名の grep で行う。
   シンボルが見つからない・形が計画書の記述と食い違う場合は、その項目を中断して報告する。
6. 削除系項目では、削除対象ごとに計画書指定の grep で参照 0 件を削除前に再確認する。
   参照が見つかったシンボルはスキップし、報告に含める。
7. HEAD が 3684715 でない場合: 作業を始める前に報告し、指示を待つ。
   （計画は 3684715 の監査に基づく。ズレたベースへの適用はオーナー判断。）
8. このリポジトリは Write/Edit のたびに hook（fitness + agent-policy + 関連テスト）が自動実行される。
   Haskell ファイルの編集は毎回 cabal test が走り数分かかることがあるが正常。hook が編集をブロック
   した場合はその出力を報告する（hook の無効化・迂回は禁止）。
9. python-analyzer のコード変更は docker イメージ再ビルドまで実機に反映されない。
   analyzer 項目の完了条件にある `docker compose build analyzer` を省略しない。
10. 計画にない問題を発見しても修正しない。「発見事項」として最終報告に列挙する。
    §4.2 のエスカレーション一覧に該当する事象に触れる必要が生じたら、その項目を中断して報告する。
11. 全項目完了後の最終報告に含めるもの:
    - 項目ごとの結果表（W00〜W59: done / skipped(理由) / blocked(理由)）
    - 全体検証の最終実行結果: pnpm lint / typecheck / test / fitness、backend cabal test all、
      analyzer docker pytest、pnpm test:e2e、pnpm test:fullcycle gop-delta、pnpm test:drift
    - ベースライン(§2)との差分: テスト件数の増減とその内訳（追加した特性テスト・削除したデッドテスト）
    - 発見事項リストと §4.2 の表
12. push・PR 作成・マージはあなたの作業に含まれない。ローカルブランチ
    refactor/2026-07-repo-cleanup にコミットを積んだ状態で作業終了とする。
```

---

## 付録 A: 実行順序と依存の一覧表（トレース検証済み）

| ID | 内容（短縮） | 領域 | リスク | 依存 |
|---|---|---|---|---|
| W00 | ブランチ + ベースライン | 全体 | なし | — |
| W01 | domain デッド削除 | FE | 低 | W00 |
| W02 | usecase/port デッド削除 | FE | 低 | W01 |
| W03 | app/components デッド削除 | FE | 低〜中 | W00 |
| W04 | lib デッド削除 | FE | 低 | W00 |
| W05 | config デッドフィールド | FE | 低 | W00 |
| W06 | BE デッド削除（小） | BE | 低 | W00 |
| W07 | BE scoreAssessment シム解体 | BE | 中 | W06 |
| W08 | PY デッド削除 + 微整理 | PY | 低 | W00 |
| W09 | 較正スクリプト隔離 | glue | 低 | W00 |
| W10 | stats repo 特性テスト | FE | 低 | W00 |
| W11 | pagination 特性テスト | FE | 低 | W00 |
| W12 | BE Scoring 定数 + 内部 dedup | BE | 中 | W06, W07 |
| W13 | pagination ヘルパー | FE | 低〜中 | W11 |
| W14 | FE 業務定数 hoist | FE | 低 | W01, W02 |
| W15 | FE UI 定数共有 | FE | 低 | W03 |
| W16 | PY 定数命名 | PY | 低〜中 | W08, W09 |
| W17 | PY 語彙一本化 | PY | 低 | W16 |
| W18 | Brand + ファクトリ一本化 | FE | 低 | W01 |
| W19 | zod parseInput（usecase） | FE | 低 | W18 |
| W20 | traverseSequentially | FE | 低 | W19 |
| W21 | run 状態再計算共通化 | FE | 中 | W20 |
| W22 | run-assessment-job 内部 dedup | FE | 低〜中 | W21 |
| W23 | dismiss/restore チェーン | FE | 低 | W20 |
| W24 | focusScores 共通化 | FE | 低 | W19 |
| W25 | stats repo 共通走査 | FE | 中 | W10 |
| W26 | tryPersistence（62 箇所） | FE | 低〜中 | W25 |
| W27 | section fixture 共通化 | FE | 低 | W26 |
| W28 | ACL fetch+timeout | FE | 低 | W00 |
| W29 | ACL 共有ヘルパー/zod 断片 | FE | 低 | W28 |
| W30 | route multipart 共通化 | FE | 中 | W03 |
| W31 | route zod/封筒/reqId | FE | 低〜中 | W30 |
| W32 | lib 純関数集約 | FE | 低〜中 | W10, W15 |
| W33 | engine 表示一本化 | FE | 低 | W32 |
| W34 | TTS hook + リーク修正 | FE | 中 | W33 |
| W35 | 録音 hook | FE | 中 | W15, W34 |
| W36 | AppTop / SeverityCountPills | FE | 低〜中 | W03 |
| W37 | BE HttpSupport モジュール | BE | 中 | W06, W12 |
| W38 | BE Application dedup | BE | 低 | W37 |
| W39 | BE AAI 整合の Scoring 移設 | BE | 低 | W38 |
| W40 | BE 応答ビルダー分割 | BE | 低 | W12 |
| W41 | PY LagComputationPort + rule | PY | 低〜中 | W16, W17 |
| W42 | PY /v1/analyze 移設 | PY | 中 | W41 |
| W43 | training god-module 分割 | FE | 低 | W14, W18 |
| W44 | run-assessment-job 分解 | FE | 中 | W21, W22 |
| W45 | registry 分岐抽出 | FE | 低〜中 | W02 |
| W46 | BrowserInfo リネーム | FE | 中 | W32, W35 |
| W47 | MaterialDetailStats リネーム | FE | 低 | W25 |
| W48 | BE 命名是正 | BE | 低 | W40 |
| W49 | intelligibility 検証 | FE | 低 | W44 |
| W50 | DetailPanelV2 key | FE | 低 | W34 |
| W51 | neverthrow 整合 | FE | 低 | W19 |
| W52 | smart-constructor 正規化 | FE | 中 | W18, W44 |
| W53 | shadowing blob 修正 | FE | 低 | W28 |
| W54 | 層違反是正 + zone 増設 | FE | 低〜中 | W34 |
| W55 | fitness 一本化 | glue | 低 | W00 |
| W56 | endpoint 直値集約 | glue | 低 | W05 |
| W57 | changed-files 共通化 | glue | 中 | W55（かつ全コード項目の後） |
| W58 | CC-BY-NC ゲート配線 | glue | 低 | W57 |
| W59 | CLAUDE.md + no-harness ルール | glue | 低 | W55 |

**トレース検証の要点**（計画作成時に確認済み）:
- 削除（Phase 1）→ 定数（Phase 3）→ 抽出（Phase 4）→ 移動（Phase 5-6）の順なので、
  後段の項目が前段で消えたシンボルに依存することはない（例: W18 のファクトリ一本化は
  W01 で消える `createAudioRange` を対象に含まない。W12 の P-D9 対応は W06 の `flWeight` 削除が前提）。
- 同一ファイルを触る項目は依存で直列化してある（Scoring.hs: W06→W07→W12→W39→W48 /
  run-assessment-job: W14→W21→W22→W44→W49→W52 / registry: W02→W45 /
  WorkspaceResultV2: W33→W34→W50→W54 / app.py: W41→W42）。
- W57（verify スクリプト工事）を全コード項目の後に置くことで、「ゲート自体を工事しながら
  そのゲートで検証する」自己参照を避けている。
- W16 で「usecase→infrastructure import をしない」設計にしたのは、W41 で追加する ast-grep ルールと
  矛盾しないため（先行項目が後続項目の前提を壊さないことの例）。

## 付録 B: 監査で確認済みだが本計画に採用しなかったリファクタ候補（次バッチ候補）

挙動保存だが「効果に対して手間・リスクが見合わない」「UI 目視検証が必要」と判断したもの。
実行者は着手しないこと。

- `training/page.tsx`（1436 行）/ `sections/[sectionIdentifier]/page.tsx`（670 行）/
  `diagnostic/.../page.tsx`（758 行）/ `progress/page.tsx`（719 行）/ `history/page.tsx`（579 行）の
  ページ分割（shadowing・drill サブフローはテスト網が無く、W34/W35 の hook 抽出までに留めた）
- `ArticulationCard.tsx`（866 行）/ `WorkspaceResultV2.tsx`（648 行）/ `DetailPanelV2.tsx` の分割、
  `playGoldenAudio` の状態機械抽出、`AcousticDiagnosisCard.buildDirChips` のテーブル駆動化
- API ルート文字列のビルダー化（`src/lib/api-routes.ts`）と D8 StaticWave 共通化
- BE: `deriveAcousticEvidence`（180 行）の signedDeviation 抽出（挙動敏感 / ScoringSpec は厚いが
  Nothing/Just 縁の再現コストが高い）、`AssessmentFinding` 25 フィールドリテラルのテンプレート化、
  analyzer wire DTO の専用モジュール化（P-M3）、Japanese 文言の Summary モジュール分離（P-M4）
- PY: ffmpeg デコーダ 3 実装の統一（DUP-1。デコード経路の変更は挙動敏感）、
  `_compute_boundaries_and_gop` の分割（GF-2。GOP 演算のビット同一性が要求されるため
  drift 網だけでは不安）、carve パイプライン（GF-4/GF-5）と `get_stimuli` の分割、
  `ContrastCarveSummary.satisfies_req122` の配線（DUP-9）
- FE: `createRecordingFailureReason` の検証追加（rehydration 挙動変更）、`createAnalysisRun` の
  status 引数除去（呼び出し元調査要）、リポジトリへの Clock/Entropy DI（E30）、
  `_shared/handler.ts` の全ルート採用（W03 で削除を選択）

---

*計画終わり。質問・前提崩れ・完了条件不成立はすべて「中断して報告」で処理すること。*




