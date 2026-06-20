# Spec: fullcycle-self-eval-harness

<!-- 設計の正 / 背景:
       adr/031-full-cycle-e2e-test-harness-and-deterministic-fixtures.md (Proposed)
         D1: 合成音声決定論コーパス + manifest (a-priori 真値 vs 観測値 分離)
         D2: 劣化音声 4 境界（numpy+soundfile、LQAS gate 駆動）
         D3: tier-1 full-cycle driver (test:fullcycle) — stack-up→migrate→seed→next→POST→poll→assert→verdict line
         D4: seed skeleton を test/fixtures/seed/ に昇格（e2e/helpers/seed.ts から lift + re-export shim）
         D5: smoke invoke 規約変更 + pr-gate.yml integration_smoke を declare-only から invoke へ
         D7: harness/fixture が本番 src/ から import されない fitness（ast-grep / scripts/verify-*.sh）
         D8: gop-delta.case 先頭実装（hello_world.wav 再利用）+ verdict line
         D10-D12 追補 (2026-06-20 deep-research 改訂):
           Loop A (自動): confidence/uncertainty + calibration 測定 + metamorphic floor
           Loop B (human-gate): 注入置換オラクル・calibration 適用・Scoring.hs 変更 → 非対象
         Self-eval first slice = D3 driver 基盤 + D10 confidence/uncertainty + calibration 誤差測定 +
           metamorphic floor (gain 不変 / noise 単調 / flip 方向性) + D1 manifest + D7 fitness
     関連 ADR:
         ADR-004: scoring locus 不変（Scoring.hs は本スライスで byte-unchanged）
         ADR-008: DB — throwaway DB_PATH に db:migrate (db:push 不可)
         ADR-014/015: low_quality / LQAS gate（speech-active RMS, meanDbfs < -36）
         ADR-018/019/020/022: runtime-pending を閉じる対象スライス
     配線点 (agent-policy):
         frontend: applications/frontend/test/fixtures/seed/index.ts（新規）
         frontend: applications/frontend/test/fullcycle/driver.ts（新規）
         frontend: applications/frontend/test/fullcycle/cases/gop-delta.case.ts（新規）
         frontend: applications/frontend/package.json（test:fullcycle / fullcycle:up / fullcycle:down 追加）
         python-analyzer: applications/python-analyzer/test/selfeval/transforms.py（新規）
         python-analyzer: applications/python-analyzer/test/fixtures/corpus/manifest.json（新規 or 更新）
         wiring_manifest.yml: practice-attempts / retry-recordings の smoke: エントリ
         .github/workflows/pr-gate.yml: integration_smoke declare-only → invoke
         fitness: scripts/verify-*.sh または ast-grep で src/→test/{fullcycle,selfeval} import 禁止
     強制レイヤ: 上記 fitness + scripts/agent-policy-hook.sh + CI pr-gate.yml
     rebuild 注意: worker/analyzer はバイナリ焼き込み。コード変更後は
                   `docker compose up -d --build --wait` 必須
                   (memory: docker-rebuild-required-for-code-changes)。
     db:migrate 注意: throwaway DB も committed migration のみ（db:push 禁止）
                   (memory: drizzle-migration-regenerate-after-schema)。 -->

## Goal

- `test:fullcycle` として、実 route（`POST /api/v1/sections/{s}/practice-attempts`）から
  worker → analyzer → `assessment_results` 永続化 → assert の全経路を有界自動実行し、
  **fixture が用意できる Must を runtime-pending として受理しない**状態に移行する。
- Loop A の自己評価として、analyzer の `perPhonemeGop.nBest` から entropy/top-1 margin を計測し、
  現状 zero-info の production `confidence`（`severityToConfidence` 再ラベル）および CTC overconfidence を
  test scope で surface する。calibration 誤差（ECE 相当）を測定する（測定のみ、Scoring.hs 不変）。
- metamorphic floor として gain 不変 / noise 単調 / flip 方向性を assert し、
  analyzer の自己矛盾を regression-guard として自動検出する。

## Must（満たさなければ done でない）

### M-FCH-1（seedSkeleton — test scope 共有 module 昇格）

`applications/frontend/test/fixtures/seed/index.ts` を新規作成すること。
`seedSkeleton(database, opts): { materialIdentifier, sectionSeriesIdentifier, sectionIdentifier }` を
実 drizzle SQL（`db:migrate` 構築済み throwaway DB 上）で実装すること。
material → section_series → section の行のみ作成し、recording/analysis/assessment は実 route に委ねること。
run-unique ULID/UUID namespace で idempotent であること。
`cascadeCleanup(database, materialIdentifier)` で seed 行と実 route が作成した下位行を cascade-delete できること。
既存 `seedWorkspaceV2` / `cleanup*`（`e2e/helpers/seed.ts` 由来）を再 export すること。
`e2e/helpers/seed.ts` に後方互換の re-export shim を残すこと。
`db:push` を使わないこと（committed migration のみ）。

### M-FCH-2（full-cycle driver — stack → POST → verdict line → teardown）

`applications/frontend/test/fullcycle/driver.ts` を新規作成すること。
以下のシーケンスを実行する `runCase(caseDefinition)` を export すること:
1. `docker compose up -d --build --wait` でスタックを起動すること（stale image で実行しないこと）。
2. 一時 `DB_PATH` を作成し `db:migrate` で構築すること（`db:push` 禁止）。
3. `seedSkeleton()` を呼び seed することこと。
4. ephemeral `next start` を起動すること（`pnpm dev` ではなく production build を使うこと）。
5. 実 route `POST /api/v1/sections/{sectionIdentifier}/practice-attempts` に fixture 音声を POST すること（202 確認）。
6. `assessment_results` テーブルを有界 poll（上限 60s、`AnalysisJobRunner` ~2s tick 前提）し、
   当該 section に対応する行が出現することを確認すること。
7. JSON invariant を assert すること（case definition に従う）。
8. verdict line `SELFEVAL <family> <case> PASS|FAIL observed=<assertion>` を stdout に 1 行出力すること。
9. `cascadeCleanup()` で seed 行と実 route 作成行を削除し teardown すること。

### M-FCH-3（gop-delta.case.ts — 最初の実行可能 case）

`applications/frontend/test/fullcycle/cases/gop-delta.case.ts` を実装すること。
`hello_world.wav`（`applications/python-analyzer/test/fixtures/hello_world.wav`）を fixture 音声として使うこと。
以下を assert すること:
- `assessment_results` の行が poll 上限（60s）内に出現すること。
- `assessment_result_json` の `gopDelta` が有限数（`isFinite(gopDelta) === true`）であること。
- `assessment_result_json` の `retrySeverity` が `['critical','major','minor','suggestion','none']` のいずれかであること。
- frontend コードに `-12.0` / `-8.0` の scoring threshold リテラルが存在しないこと（grep で 0 件、M-CRL-11 不変条件）。
verdict line family を `'gop-delta'` とすること。

### M-FCH-4（package.json scripts — 3 スクリプト追加）

`applications/frontend/package.json` に以下を追加すること:
- `"test:fullcycle"`: `ts-node applications/frontend/test/fullcycle/driver.ts` 相当のエントリポイント（case を引数指定可能）。
- `"fullcycle:up"`: `docker compose up -d --build --wait`。
- `"fullcycle:down"`: `docker compose down`。
`pnpm test:fullcycle gop-delta` で M-FCH-3 の case が実行されること。

### M-FCH-5（confidence/uncertainty 測定 — Loop A headline）

test scope 内（`applications/frontend/test/fullcycle/` または `applications/python-analyzer/test/selfeval/`）で、
analyzer の `POST /v1/analyze` レスポンス `perPhonemeGop[*].nBest`（prob-descending、len ≥ 3）から
以下を計算し標準出力に記録すること:
- per-phoneme の **entropy**: `H = -sum(p * log(p))` for each nBest entry.
- per-phoneme の **top-1 margin**: `nBest[0].prob - nBest[1].prob`.
この測定値を production `confidence`（`severityToConfidence` 由来の `[0.6, 0.9]` 5 段階）と並べて出力し、
analyzer がどの音素で overconfident（entropy 低・margin 高）または uncertain（entropy 高・margin 低）かを
`SELFEVAL confidence_measurement <phoneme> observed=entropy:<H>,margin:<M>,prod_confidence:<C>` 行で出力すること。
calibration 誤差として ECE 相当（精度区間を分割した confidence と accuracy の加重平均誤差）を計算し、
`SELFEVAL calibration_ece observed=ece:<value>` 行で出力すること（ground truth は `nBest[0].prob` を proxy として使用）。
測定のみを行うこと。`Scoring.hs` を編集しないこと（byte-unchanged 確認は M-FCH-9 で行う）。
nBest が worker→DB コントラクトに乗っていない場合は `POST /v1/analyze` を直接呼んで取得すること
（topology を確認し、乗っていれば DB から、乗っていなければ直接 call することを実装コメントで明記すること）。

### M-FCH-6（metamorphic floor — transforms.py 実装）

`applications/python-analyzer/test/selfeval/transforms.py` を新規作成すること。
依存は `numpy`・`scipy`・`soundfile` のみ（librosa 不可）。
以下の変換関数を実装すること:
- `scale_gain(audio_array, factor) -> ndarray`: 振幅を `factor` 倍する。
- `add_pink_noise(audio_array, snr_db) -> ndarray`: 指定 SNR（dB）のピンクノイズを加算する。

以下の 3 アサートを実装し、live analyzer（`docker compose up -d --build --wait` 済み）に対して実行すること:

**(a) gain 不変性**: factor ∈ {0.5, 2.0} を適用した音声（LQAS window 内、送信前 dBFS を実測して確認）を
`POST /v1/analyze` に投じたとき、per-phoneme GOP が元音声と ±0.01 以内、`detectedIpa` が byte-identical、
`nBest` top-1 が変わらないことを assert すること。
`SELFEVAL metamorphic gain_invariance PASS|FAIL observed=max_gop_delta:<v>,ipa_match:<bool>` を出力すること。

**(b) noise 単調性**: SNR ラダー {clean, 20dB, 10dB, 5dB} で median(GOP) が非増加（± ε、中央値・分位数で判定）
であることを assert すること。per-phoneme の厳密一致は要求しないこと。
`SELFEVAL metamorphic noise_monotonicity PASS|FAIL observed=medians:<list>` を出力すること。

**(c) flip 方向性**: gain drop により dBFS が −36 を下回るとき `status == 'low_quality'` に転じること、
floor 上の control では GOP が不変のまま `status == 'normal'` であることを assert すること。
`SELFEVAL metamorphic flip_directionality PASS|FAIL observed=low_quality_triggered:<bool>,control_gop_stable:<bool>` を出力すること。

assert はすべて**帯域**（band）で行い、GOP float の厳密一致を使わないこと。
dBFS を送信前に `soundfile` + numpy で実測し、LQAS window（−36 dBFS 境界）を確認してから送信すること。
しきい値リテラル（`-36.0` 等）をハードコードせず、ADR-015 の `audioQualityMinMeanDbfs` 定数と整合する
コメントを残すこと（calibratable 旨を明記）。

### M-FCH-7（corpus manifest — a-priori 真値 vs 観測値の分離）

`applications/python-analyzer/test/fixtures/corpus/manifest.json` を新規作成または更新すること。
以下のスキーマを満たすこと（`attribution-manifest.json` のシェイプに倣う）:
- `aPriori` ブロック: `expectedRelation`（`==` で assert する真値、`expectedReferenceIpa` /
  `expectedQualityStatus` / `expectedCatalogId` / `expectedPhenomenon` 等）。
- `observed` ブロック: `gop`（band）/ `severity`（band）/ `findingFires`（bool）/ `topNBest`（top-1 phoneme）/
  `analyzerCommit`（pin 時の commit hash）。
- GOP float の厳密一致を `expectedRelation: "=="` フィールドに含めないこと。
- `hello_world.wav` を参照する最初のエントリを含むこと（D8 first slice）。
`analyzerCommit` が変化したとき観測値を再計測して再 pin する手順をコメントまたは README に明記すること。

### M-FCH-8（wiring + fitness — smoke invoke + import 禁止）

`wiring_manifest.yml` の `practice-attempts` および `retry-recordings` の `smoke:` に
`pnpm test:fullcycle gop-delta`（または対応 case 名）を宣言すること。
`.github/workflows/pr-gate.yml` の `integration_smoke` ジョブを declare-only から invoke に昇格すること
（コメント「v1 では smoke は wiring_manifest.yml に宣言のみ。follow-up で実行を有効化する」等を削除すること）。
`scripts/verify-*.sh`（既存）または新規 ast-grep ルールを追加し、
`applications/frontend/src/`（本番 `src/`）から `test/fullcycle/` または `test/selfeval/` への import が
存在しないことを機械強制すること。同 PR でこの fitness を追加すること（ADR-031 D7）。

### M-FCH-9（Scoring.hs byte-unchanged + agent-policy 証跡）

本スライスの全変更後、以下を確認すること:
- `git diff applications/backend/src/NativeTrace/Worker/Scoring.hs` が EMPTY であること（output が 0 行）。
- `bash scripts/verify-no-stub-placeholder.sh` 緑。
- `bash scripts/verify-no-prod-doubles.sh` 緑。
- `bash scripts/verify-wiring.sh` 緑。
- `pnpm fitness`（ast-grep + ESLint）緑。
- `pnpm lint` / `pnpm typecheck` / `pnpm test --run --passWithNoTests` 緑。
- `cabal build all` / `cabal test all` 緑（backend 変更なしのため pass が前提）。
- `.agent-evidence/fullcycle-self-eval/commands.txt`、
  `.agent-evidence/fullcycle-self-eval/wiring-map.json`、
  `.agent-evidence/fullcycle-self-eval/completion-report.md` を提出すること。
- `commands.txt` に `pnpm test:fullcycle gop-delta` の実行コマンドと観測した
  `SELFEVAL … PASS` 行の実テキストを記録すること。
- `commands.txt` に metamorphic 3 ケース（gain_invariance / noise_monotonicity / flip_directionality）の
  `SELFEVAL … PASS` 行と観測値を記録すること。

## Should（望ましいが必須でない）

- **S-FCH-1（rhoticity.case / aai.case の骨格）**: D8 で言及される `rhoticity.case.ts` と `aai.case.ts` を
  gop-delta.case と同一 driver 上に ~40 LOC の additive として追加すること。first slice の完了条件ではない。
- **S-FCH-2（corpus 成長 — 低 GOP /r/ fixture）**: `stimuli-assets/libritts/r-l/` から /r/ 低 GOP clip を
  manifest に追加し observed band を pin すること（D1 の hybrid 増分、realism 向上）。first slice 非必須。
- **S-FCH-3（transforms.py の再生成 recipe）**: `gen_fixtures.py`（またはコメント付き shell）で
  劣化音声（quiet-clean / near-silence / too-short / pure-noise）を再現可能にすること。
- **S-FCH-4（AnalysisJobRunner singleton 並列化メモ）**: case を並列実行するには別スタック起動が要ることを
  `driver.ts` のコメントに記録すること（first slice は逐次で許容）。
- **S-FCH-5（drift 検出 — analyzerCommit 差分チェック）**: `Dockerfile` の `pip list` hash が変化したとき
  pinned case を再実行して差分を報告するスクリプト骨格を `test/selfeval/` に置くこと（D12-(2)、Stage 2）。
- **S-FCH-6（tier-2 Playwright AFTER-panel）**: `e2e/after-panel.spec.ts` の骨格（D6）は first slice 非対象。

## 受入条件（acceptance — Must の確認方法）

> worker/analyzer はバイナリ焼き込みのため、runtime verify 前に `docker compose up -d --build --wait` が必須。
> stale image での実行は偽 green になる（memory: docker-rebuild-required-for-code-changes）。
> DB は `db:migrate`（committed migration）で構築すること（db:push 禁止、memory: drizzle-migration-regenerate-after-schema）。

- **M-FCH-1** →
  `ls applications/frontend/test/fixtures/seed/index.ts` でファイルが存在すること。
  `grep -n "seedSkeleton\|cascadeCleanup\|seedWorkspaceV2" applications/frontend/test/fixtures/seed/index.ts`
  で関数 export が確認できること。
  `grep -n "seedWorkspaceV2\|cleanup" applications/frontend/e2e/helpers/seed.ts`
  で re-export shim が確認できること（既存 import が壊れないこと）。
  `grep -rn "db:push\|drizzle-kit push" applications/frontend/test/` が 0 件であること。
  `pnpm typecheck` 緑。

- **M-FCH-2** →
  `ls applications/frontend/test/fullcycle/driver.ts` でファイルが存在すること。
  `grep -n "docker compose\|db:migrate\|seedSkeleton\|practice-attempts\|assessment_results\|SELFEVAL\|cascadeCleanup" applications/frontend/test/fullcycle/driver.ts`
  で stack-up / migrate / seed / POST / poll / verdict / teardown の各ステップが確認できること。
  `grep -n "SELFEVAL.*PASS\|SELFEVAL.*FAIL\|observed=" applications/frontend/test/fullcycle/driver.ts`
  で verdict line フォーマットが確認できること。

- **M-FCH-3** →
  `ls applications/frontend/test/fullcycle/cases/gop-delta.case.ts` でファイルが存在すること。
  `pnpm test:fullcycle gop-delta` を live スタック（`fullcycle:up` 済み）で実行したとき、
  stdout に `SELFEVAL gop-delta gop-delta PASS observed=` を含む行が出力されること。
  `grep -rn "\-12\.0\|\-8\.0\|gopMinorThreshold\|gopMajorThreshold" applications/frontend/src/`
  が scoring 判定として 0 件であること。

- **M-FCH-4** →
  `grep -n '"test:fullcycle"\|"fullcycle:up"\|"fullcycle:down"' applications/frontend/package.json`
  で 3 スクリプトが確認できること。
  `pnpm test:fullcycle --help` または `pnpm test:fullcycle gop-delta` が exit 0 で終了すること（live スタック前提）。

- **M-FCH-5** →
  `ls applications/frontend/test/fullcycle/` または
  `ls applications/python-analyzer/test/selfeval/` に confidence/calibration 測定ファイルが存在すること。
  実行後 stdout に以下が含まれること（live analyzer 前提）:
  - `SELFEVAL confidence_measurement` を含む行が 1 件以上。
  - `SELFEVAL calibration_ece observed=ece:` を含む行が 1 件。
  `grep -n "Scoring.hs\|severityToConfidence" <測定ファイル>` で Scoring.hs を import / 編集していないことを確認すること。
  `git diff applications/backend/src/NativeTrace/Worker/Scoring.hs` が空（0 行）であること。

- **M-FCH-6** →
  `ls applications/python-analyzer/test/selfeval/transforms.py` でファイルが存在すること。
  `grep -n "scale_gain\|add_pink_noise" applications/python-analyzer/test/selfeval/transforms.py`
  で 2 関数の定義が確認できること。
  `grep -rn "import librosa" applications/python-analyzer/test/selfeval/` が 0 件であること（librosa 禁止）。
  live analyzer（`fullcycle:up` 済み）で実行したとき以下の verdict line が stdout に出ること:
  - `SELFEVAL metamorphic gain_invariance PASS`
  - `SELFEVAL metamorphic noise_monotonicity PASS`
  - `SELFEVAL metamorphic flip_directionality PASS`
  `grep -rn "\-36\.0\|\-36 " applications/python-analyzer/test/selfeval/transforms.py` が
  ハードコードしきい値として存在しないこと（コメント or 変数参照のみ）。

- **M-FCH-7** →
  `ls applications/python-analyzer/test/fixtures/corpus/manifest.json` でファイルが存在すること。
  `grep -n "aPriori\|observed\|analyzerCommit\|hello_world" applications/python-analyzer/test/fixtures/corpus/manifest.json`
  で a-priori / observed 分離と hello_world.wav エントリが確認できること。
  `grep -rn "\"==\"" applications/python-analyzer/test/fixtures/corpus/manifest.json |  grep -i "gop"` が
  0 件であること（GOP float の `==` assert 禁止）。

- **M-FCH-8** →
  `grep -n "test:fullcycle\|smoke" wiring_manifest.yml` で `practice-attempts` / `retry-recordings` の
  smoke エントリが確認できること。
  `.github/workflows/pr-gate.yml` の `integration_smoke` ジョブが declare-only コメントを含まず、
  `pnpm test:fullcycle` を実際に invoke するステップを持つこと
  （`grep -n "integration_smoke" .github/workflows/pr-gate.yml` で invoke ステップが確認できること）。
  `pnpm fitness` 緑、かつ `applications/frontend/src/` 内に `test/fullcycle` または `test/selfeval` への
  import が存在しないこと（`grep -rn "test/fullcycle\|test/selfeval" applications/frontend/src/` が 0 件）。

- **M-FCH-9** →
  `git diff applications/backend/src/NativeTrace/Worker/Scoring.hs` の出力が空（0 行）であること。
  `bash scripts/verify-no-stub-placeholder.sh` 緑。
  `bash scripts/verify-no-prod-doubles.sh` 緑。
  `bash scripts/verify-wiring.sh` 緑。
  `pnpm fitness` 緑。
  `pnpm lint` / `pnpm typecheck` / `pnpm test --run --passWithNoTests` 緑。
  `ls .agent-evidence/fullcycle-self-eval/commands.txt .agent-evidence/fullcycle-self-eval/wiring-map.json .agent-evidence/fullcycle-self-eval/completion-report.md`
  で 3 ファイルが存在すること。
  `grep -n "SELFEVAL.*PASS" .agent-evidence/fullcycle-self-eval/commands.txt` で
  gop-delta と metamorphic 3 ケースの PASS 行が存在すること（最低 4 行）。

## Non-goals（今回やらない）

- **注入置換オラクル（Loop B）**: 合成音声で scorer を騙す注入置換オラクルは 21–34% false-alarm（OOD、
  arXiv:2305.17445）かつ self-training に該当し、human-gate が必要。本スライスでは採らない。
- **cross-engine differential（CrossASR 型）**: 2nd engine（OpenAI 等）外部依存で自己完結に反する。不採用。
- **calibration の適用（Scoring.hs 変更）**: production `confidence` フィールドの置換 / threshold 調整は
  Loop B（human-gate）。本スライスは calibration 誤差の**測定**のみ。`Scoring.hs` は byte-unchanged。
- **determinism probe**: analyzer の数値 bit-exact 再現性の検証は non-goal。観測値は band + analyzerCommit pin で扱う。
- **drift 自動化 Stage 3**: analyzerCommit 変化の自動 re-pin・sign-flip regression のエスカレーション機構は後続。
- **Loop B auto-tune**: label-free 信号で `Scoring.hs` 定数を自動調整することは ADR-004 が退けた
  「誤検出が誤是正を教える」に該当し禁止。calibration 提案は propose-only（rules/promoted 経由、human-gate）。
- **tier-2 Playwright AFTER-panel**（`e2e/after-panel.spec.ts`）: ブラウザ描画 verify は後続 D6 スライス。
- **fullcycle.yml CI workflow**: cold analyzer build（start_period:180s）を CI に組み込む label-gated/nightly ワークフローは後続。
- **drizzle schema/migration 新規追加**: 新テーブル・新カラムを本スライスで追加しない。
  throwaway DB は committed migration（`db:migrate`）のみで構築する。
- **hybrid real/corpus 音声（増分）**: ライセンス問題のない実音声は同一 manifest の増分として後続。
  first slice は合成音声のみ。
- **AAI 再構成 / RVC 不変**: articulatory モデル checkpoint 不在（S-AAI-5）。本スライス非対象。
- **VOT 測定**: 未 emit のため非対象。
- **aligner 非決定性 / speakerSex 収集 UI / articulatory checkpoint（D9 構造的 pending）**:
  fixture/harness では解けない構造的 pending。本スライスは閉じない。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **cross-layer（python + frontend + CI）**: python-analyzer の metamorphic/自己評価ハーネスと
    frontend の full-cycle driver が同一 PR に同居し、相互依存なく独立して動く必要がある。
  - **docker orchestration**: `up -d --build --wait` を driver 内から制御し、stale image での偽 green を
    機械的に排除する必要がある。cold analyzer（wav2vec2+parselmouth+Kokoro、start_period:180s）の
    起動待機が local/CI で重い。
  - **CI ゲート挙動変更**: `pr-gate.yml integration_smoke` が declare-only から invoke に昇格することで、
    worker/analyzer に触れる PR が CI で `pnpm test:fullcycle` を実行するようになる。
    cold build の CI コスト拡大リスクがある（GHA layer/HF model cache で緩和すべきだが first slice では
    local-first が前提）。
  - **新 harness 層の本番 import 禁止**: `test/fullcycle/` / `test/selfeval/` が本番 `src/` から
    import されないことを fitness で機械強制する必要がある。同 PR で fitness を追加しないと
    適応度関数の抜け穴になる（ADR-031 D7 同 PR 規則）。
  - **Scoring.hs byte-unchanged の保証**: confidence/uncertainty 測定が誤って Scoring.hs を変更しても
    build/lint は通る。`git diff` による byte-unchanged 確認を M-FCH-9 の受入条件に明示し、
    `scripts/verify-*.sh`（`orchestrator_hand_edit` net 同型）で機械強制することを推奨する。
  - **nBest の worker→DB 不在リスク**: `PhonemeHeatEntry` が nBest を DB に持ち込んでいない場合、
    confidence 測定は `POST /v1/analyze` への直接呼び出しが必要。topology 確認が先行必要。

## Open questions

なし。ADR-031 D1〜D9 + D10〜D12 追補（2026-06-20 deep-research 改訂）が全て確定しており、未確定点は存在しない。
以下は確定済みの PIN 値（open question ではない）:
- gain 不変性の GOP tolerance ±0.01 は calibratable。観測値 pin 時に調整可。
- ECE 計算の bin 数はデフォルト 10。測定スクリプトにコメントで明記。
- metamorphic noise ladder の SNR 値 {clean, 20, 10, 5}dB は ADR-031 D10 で固定。
- `hello_world.wav` を first case fixture として再利用することは D8 で確定済み。
