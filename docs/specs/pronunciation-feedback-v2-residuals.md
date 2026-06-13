# Spec: pronunciation-feedback-v2-residuals

<!-- 親 spec: docs/specs/pronunciation-feedback-v2.md（Must 番号体系・受入形式を継承）
     本 spec は前ラン proven-done 後にエスカレーションされた非ブロッキング残点 4 項目を正規化する。
     重複定義は [親 spec] を参照。 -->

## Goal

- 前ラン（pronunciation-feedback-v2）で done になったが未実施として残った、enum 定義済みで producer 未実装の connected speech 4 現象（linking/flap/assimilation/reduction）の producer を実装し、dead branch を解消する（M-102R）。
- finding の `wordPositionLabel` が null 固定のまま 3 層フィードバックの①観測サブ層が空になっている配線断を実値で埋める（M-104R）。
- `predictedStress` がほぼ全 0 になるヒューリスティックを F0 ピーク・強度・母音持続時間から有意な値を返すよう改善する（M-114R）。
- parselmouth（GPL-3.0）をローカル MVP の python-analyzer 内部利用として追加したことのライセンス影響を ADR-006 に記録する（M-ADR）。
- 前ラン未実行の Playwright smoke（workspace-v2 描画 + M-108 却下 round-trip）を実機で 1 本通す（M-SMOKE）。

## Must（満たさなければ done でない）

### M-102R（connected speech producer 実装）

- [ ] **M-102R-a（producer 実装）**: `linking`/`flap`/`assimilation`/`reduction` の 4 現象について、それぞれの分類ロジックを実装した producer 関数が `Scoring.hs`（または同モジュール）に存在し、対応するアライメント/特徴量入力に対して該当 `phenomenon` 文字列を持つ `AssessmentFinding` を生成する。生成条件は下記シグナル定義に従う。
  - **linking**: 単語末子音アライメント終端と次語頭母音アライメント開始の gap が閾値（デフォルト: 50ms）未満、かつ境界フレームの音響エネルギーが連続（無声区間なし）。`InterWordSilence` の `silenceDurationMs` をシグナルとして利用する。
  - **flap**: 期待音素 `/t/` または `/d/` に対し、アライメント上の持続時間が閾値（デフォルト: 60ms）未満、または NBest 上位候補に `ɾ` が現れる。`PhonemeGop` の `gopEndMs - gopStartMs` と `gopNBest` をシグナルとする。
  - **assimilation**: 期待音素に対し、後続調音点に同化した音素が NBest アライメント上で現れる文脈条件付き置換（例: `/n/` の前に `/p,b,m/` があるとき NBest 上位候補が `m`）。文脈は `PhonemeGop` の隣接音素から判定する。
  - **reduction**: 機能語/無強勢の期待フル母音に対し、シュワーまたは中央化母音 + 短時間（持続時間閾値: 80ms 未満）が実現。`SchwaRealization` と `PhonemeGop` 持続時間をシグナルとする。`weakForm` との区別: `weakForm` は辞書弱形語の強形/弱形実現、`reduction` は音響的母音弱化（単語依存しない）。

- [ ] **M-102R-b（analyzer 特徴量出力）**: analyzer（python-analyzer）が worker に返す HTTP レスポンスに、M-102R-a の producer が必要とする以下の特徴量が含まれることを contract で確認できる。新規フィールドが必要な場合は `AnalyzerClient.hs` の型と analyzer の `interface/schema.py` を同一 PR で拡張する。
  - `PhonemeGop` に `phonemeWordPosition`（`"initial" | "medial" | "final"`）フィールドを追加する（M-104R と共有）。analyzer 側では音素の単語内インデックスと単語長から計算して返す。
  - 既存の `InterWordSilence.silenceDurationMs`、`PhonemeGop.gopNBest`、`PhonemeGop.(gopEndMs - gopStartMs)`、`SchwaRealization.schwaRealized` は既に存在するため新規追加不要。

- [ ] **M-102R-c（dead branch 解消と配線確認）**: `POST http://localhost:8787/v1/pronunciation-assessments` 経由で当該 4 producer が呼ばれ得ることを、`Application.hs` の handler 呼び出し経路で確認できる（dead branch でなく到達可能）。linking/flap/assimilation/reduction のシグナル条件を満たす合成入力（アライメントを fixture で注入した unit test）に対し、各 producer が対応する phenomenon を持つ `AssessmentFinding` を少なくとも 1 件生成することを unit test で assert する。

- [ ] **M-102R-d（ADR-004 整合）**: ADR-004「connected-speech phenomena are presentation only（`severity = suggestion`, `scoreImpact = 0`）」に従い、4 現象の finding は `findingSeverity = FindingSeveritySuggestion`・`findingScoreImpact = 0.0` であることを unit test で assert する。

### M-104R（wordPositionLabel 配線）

- [ ] **M-104R-a（音素単語内位置の導出）**: M-102R-b で追加する `PhonemeGop.phonemeWordPosition`（`"initial" | "medial" | "final"`）を使い、`Scoring.hs` の `buildGopFinding` が `AssessmentFinding` に対応する位置情報を付与する。現状の finding 型に `wordPositionLabel` フィールドが存在しないため `AssessmentFinding` 型（`Types.hs`）に `findingWordPositionLabel :: Maybe Text` を追加し、ACL schema（`schema.ts`）と domain 型（`assessment-result.ts`）にも同フィールドを追加する。

- [ ] **M-104R-b（usecase 配線断の解消）**: `applications/frontend/src/usecase/run-assessment-job/index.ts` の `wordPositionLabel: null` ハードコード（2 箇所: line 585・601）を、finding の `wordPositionLabel`（非 null の場合）を渡すよう修正する。

- [ ] **M-104R-c（3 層フィードバック①観測への反映）**: real entrypoint（`GET /api/v1/sections/{id}/workspace`）のレスポンスで、音素アライメントから位置を特定できる finding の `feedbackLayers.whatJa`（①観測）に語頭/語中/語末のいずれかが含まれること（`resolvePositionLabel` が非空文字列を返す入力が渡ること）を assert する。

### M-114R（predictedStress 改善）

- [ ] **M-114R-a（F0 ピーク + 強度 + 母音持続時間の統合）**: `parselmouth_prosody.py` の `_predict_stress_from_acoustics` を改善し、以下の 3 シグナルを統合した推定を行う。
  - F0 ピーク: 単語区間内で有声フレーム（hz > 0）のうち最大 F0 が発話全体中央値を超えるとき強勢候補とする（現状の `has_f0_peak` は全区間で F0 > 0 があれば 1 になるため、ほぼ全単語が 1 になる欠陥を修正する）。
  - 強度: parselmouth の `sound.to_intensity()` で単語区間の平均強度を取得し、発話全体平均を超えた場合を強勢候補とする。
  - 母音持続時間: 現状の `max > average * 1.3` ヒューリスティックを維持しつつ、上記 2 シグナルと AND/OR 組合せにする（少なくとも F0 ピークシグナルの改善を必達とする）。

- [ ] **M-114R-b（全 0 回帰防止）**: 既存の `wordStressExpected`/`wordStressPredicted` の突合が prosody スコアに影響することを前ランで担保済み（M-114 達成）。改善後も prosody スコアが入力で変動することを回帰 assert する。

- [ ] **M-114R-c（有意な突合）**: 強勢パターンが既知の fixture（例: "RECORD（名詞: 第1音節強勢）" vs "reCORD（動詞: 第2音節強勢）"）に対し、`predictedStress` が全単語 0 でなく、少なくとも 1 単語で expected と一致または不一致を判定できること（`wordStressExpected != 0` または `wordStressPredicted != 0` が fixture で現れる）を unit test で assert する。

### M-ADR（ADR-006 ライセンス判断）

- [ ] **M-ADR-a（ADR-006 作成）**: `adr/006-parselmouth-gpl3-license-boundary.md`（仮タイトル、担当者が命名可）を以下の内容で作成する。形式は `adr/001`〜`005` と同一（英語・Status/Context/Decision/Consequences/Compliance/Notes 構成）。
  - **Status**: Accepted
  - **Decision**: NativeTrace はローカル MVP であり、parselmouth は python-analyzer プロセス（HTTP 境界で分離）の内部にのみ存在し、frontend/worker バイナリにはリンク・同梱されない（aggregate/process 分離）。よって GPL-3.0 を受容する。制約として「parselmouth は python-analyzer プロセス内に限定。配布形態が変わる場合（製品同梱配布・SaaS 公開）は再評価必須」を明記する。
  - **Considered alternatives**: parselmouth 撤去（前ラン M-114 で done になった prosody 実計測を巻き戻すため非現実的）を記す。
  - **Compliance**: ast-grep ルールが parselmouth の import を python-analyzer 外で禁止していることを記す。

### M-SMOKE（live smoke 実行）

- [ ] **M-SMOKE-a（workspace-v2 Playwright spec）**: `applications/frontend/e2e/` に workspace-v2 smoke spec（新規ファイル名: `workspace-v2.spec.ts` または相当）が存在し、以下を seed data 投入 → 描画 assert の形で green で通る。
  - seed: 解析済みセクション（OSS Worker finding 付き）を SQLite に投入。
  - assert: workspace 結果画面で `.fb3-row--what`、`.fb3-row--why`、`.fb3-row--fix`、`.nbest-row.is-top`、`.conf[data-level]`、`.gopmap .gp`、`.mini-axis .ma`、`.subscale` が存在する（前ラン M-WS の受入セレクタのサブセット）。

- [ ] **M-SMOKE-b（dismissal round-trip spec）**: 同 spec（または別 spec `dismissal.spec.ts`）に以下の round-trip を assert する。
  - seed → `POST` または `PATCH` の real dismissal endpoint に finding 却下リクエスト → `GET /api/v1/sections/{id}/workspace` で当該 finding の `dismissed: true` が返ることを assert する。
  - 却下エンドポイントは前ラン M-108 で実装済みの real endpoint を使う（mock 禁止）。

## Should（望ましいが必須でない）

- **S-102R-threshold（producer 閾値のキャリブレーション）**: linking gap 50ms / flap 60ms / reduction 80ms の各閾値は実録音で誤検出が多い場合に調整する。キャリブレーション自体は今回の Non-goal だが、定数名に `-- calibratable threshold` コメントを付けて可視化しておくことを推奨する。
- **S-104R-syllableNucleus（音節核位置の追加）**: 語頭/語中/語末に加えて音節核（`"nucleus"`）の粒度も将来的に追加できる拡張点として `resolvePositionLabel` に `case "nucleus"` のハンドルを保留しておく。今回は導出ロジック未実装のため `null` 返しで可。
- **S-114R-intensity（強度シグナルの精度向上）**: parselmouth `to_intensity()` が CPU コストで問題になる場合は soundfile ベースの RMS で代替してよい。parselmouth を使う場合は既存の `extract_f0_contour` と同一の例外ハンドリングパターン（`ImportError` フォールバック）に揃える。

## 受入条件（acceptance — Must の確認方法）

- **M-102R-a** → `cabal test all` で linking/flap/assimilation/reduction の各 producer に対する unit test が green。各テストは「シグナル条件を満たすアライメント stub 入力 → `findingPhenomenon == "linking"` 等が含まれる `[AssessmentFinding]` が返る」を assert する。

- **M-102R-b** → `cabal build all` が通り、`AnalyzerClient.hs` の `PhonemeGop` 型に `phonemeWordPosition :: Maybe Text` フィールドが存在する（または `gopWordPosition` 等同等名）ことを `grep -n "wordPosition" applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs` で確認。analyzer 側 `interface/schema.py` にも同フィールドが存在することを `grep -n "word_position\|phonemeWordPosition" applications/python-analyzer/src/python_analyzer/interface/` で確認。

- **M-102R-c** → `POST http://localhost:8787/v1/pronunciation-assessments`（`docker compose up` 後）に linking シグナル（`silenceDurationMs < 50`）を持つ fixture wav を送り、レスポンス JSON の `findings` に `"phenomenon": "linking"` が 1 件以上現れることを `curl | jq '[.findings[] | select(.phenomenon == "linking")] | length > 0'` で assert する。linking/flap/assimilation/reduction の各現象について同様に確認。

- **M-102R-d** → unit test で各 4 現象の finding について `findingSeverity == FindingSeveritySuggestion && findingScoreImpact == 0.0` を assert。`cabal test all` が green。

- **M-104R-a** → `grep -n "findingWordPositionLabel\|wordPositionLabel" applications/backend/src/NativeTrace/Worker/Types.hs` で `AssessmentFinding` に `findingWordPositionLabel` フィールドが存在する。`grep -n "wordPositionLabel" applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts` でスキーマに同フィールドが存在する。`pnpm typecheck` が green。

- **M-104R-b** → `grep -n "wordPositionLabel: null" applications/frontend/src/usecase/run-assessment-job/index.ts` で `null` ハードコードが 0 件になる（または finding の `wordPositionLabel` を参照するコードに置き換えられている）。

- **M-104R-c** → `GET /api/v1/sections/{id}/workspace`（解析済み・音素位置特定可能な finding があるセクション）のレスポンスで、`findings[].feedbackLayers.whatJa` に `"語頭"` または `"語中"` または `"語末"` が含まれる finding が 1 件以上あることを `curl | jq '[.data.resultsByEngine[].findings[] | select(.feedbackLayers.whatJa | test("語頭|語中|語末"))] | length > 0'` で assert する。

- **M-114R-a** → `python -m pytest applications/python-analyzer/` で `_predict_stress_from_acoustics` のテストが green。改善後の実装で F0 発話全体中央値との比較が行われることを unit test で確認する（`f0_in_word.max() > global_f0_median` 相当のロジックが存在する）。

- **M-114R-b** → 前ラン M-114 の受入（`worker prosody スコアが固定 65 でなく入力で変動する`）を確認する `cabal test all` の回帰テストが引き続き green。

- **M-114R-c** → 単語強勢が既知の fixture（例: 2 単語以上、うち 1 単語に第 1 強勢が期待される）を `parselmouth_prosody.py` の `extract_word_stress` に渡した場合、`predicted_stress` が全 0 にならない（少なくとも 1 単語で `predicted_stress >= 1`）ことを unit test で assert する。`python -m pytest` が green。

- **M-ADR-a** → `ls adr/006-*.md` でファイルが存在する。`grep -i "Status.*Accepted" adr/006-*.md` が一致する。`grep -i "python-analyzer\|process boundary\|GPL" adr/006-*.md` が一致する。

- **M-SMOKE-a** → `pnpm test:e2e` で `workspace-v2.spec.ts`（または相当）の workspace-v2 smoke が green。`.fb3-row--what`・`.gopmap .gp`・`.conf[data-level]` が存在することを Playwright `expect(locator).toBeVisible()` で assert。

- **M-SMOKE-b** → 同 E2E スイートの dismissal spec が green。`dismissed: true` が API レスポンスに返ることを Playwright `expect(response.json()).resolves.toMatchObject({ dismissed: true })` または同等で assert。

## Non-goals（今回やらない）

- M-103 (`matchesL1Pattern`) の合成音声 recall 改善——前ランで PARTIAL 扱いとなったが、本ラン Non-goal。合成音声での低シグナル限界は既知の trade-off として ADR-001 に記録済み。
- 検出 recall の数値目標（precision/recall の閾値キャリブレーション）——producer の到達性と分類ロジック存在が本質。閾値チューニングは今回対象外。
- 新規音響 ML モデル学習——producer はすべて既存アライメント/韻律からの classifier に限定。
- parselmouth を他ライブラリに差し替えること——ADR-006 は accept 既定。撤去は M-114 巻き戻しのため非対象。
- Phase 3 訓練画面・進捗・診断画面（HVPT/ドリル/シャドーイング/スケジューラ/progress/diagnostic）——[親 spec] Non-goal を継続。
- 上記 5 Must（M-102R/M-104R/M-114R/M-ADR/M-SMOKE）以外の前ラン残点の深掘り。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **public export / schema**: `AssessmentFinding` 型（`Types.hs`）への `findingWordPositionLabel` 追加が analyzer→worker→frontend の 3 層公開契約に同時に触れる（M-104R, M-102R-b）。`PhonemeGop` への `phonemeWordPosition` 追加も同様。
  - **routing**: M-102R-c は `Application.hs` の handler 経路（`WorkerApi` 型↔ handler の配線点）を通る実機確認を必要とする。
  - **config / ライセンス境界**: M-ADR は GPL-3.0 ライセンス受容の形式判断。配布形態変更時に再評価が必要な制約を記録する。
  - **background job**: M-SMOKE-b の dismissal round-trip は DB への永続化（前ラン M-108 の migration 済みテーブル）を経由するため、migration 状態に依存する。

## Open questions（あれば）

なし（実装判断として記録のみ）。未確定の実装判断点を以下に列挙する:

1. **producer の具体閾値**（linking gap 50ms / flap 60ms / reduction 80ms）——キャリブレーション前のデフォルト値。実録音データで誤検出が多い場合は `calibratable threshold` コメントを付けた定数として調整可。
2. **`wordPositionLabel` の粒度**——今回は `"initial"` / `"medial"` / `"final"` の 3 値。音節核（`"nucleus"`）は Should で拡張点として保留。1 音節語の扱い（`"final"` とするか `"initial"` とするか）は topology-mapper が決定する。
3. **M-SMOKE の seed 方法**——Playwright fixture から直接 SQLite に INSERT するか、seed スクリプトを呼ぶかは E2E 実装者が判断する。既存の `smoke.spec.ts` で用いているパターンに揃えること。
4. **ADR-006 のファイル名**——`006-parselmouth-gpl3-license-boundary.md` は暫定。実装者が内容に合ったタイトルを決定してよい（`adr/006-*.md` の glob に一致すれば受入条件を満たす）。
5. **M-114R での parselmouth `to_intensity()` vs RMS 代替**——CPU コストを実測して判断する。Should S-114R-intensity に記載のとおり両方可。
