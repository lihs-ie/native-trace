# Spec: f0-reference-contour

<!-- 親 spec: docs/specs/pronunciation-feedback-v2.md (M-114 / M-124)
     前提 spec: docs/specs/workspace-residuals.md の Should S-F0REF（本 spec が実装スライスとして昇格させる）
     要件: docs/01-requirements/pronunciation-feedback-requirements.md REQ-126（ピッチ・韻律可視化）/ REQ-114（韻律計測の拡充）
     研究根拠: docs/06-research/pronunciation-feedback-research.md §3.3-5（連続 F0 輪郭 > 記号表記、タイミングエラー 3–10% vs 40–50%）/ 音声+視覚 > 音声のみ
     design の正: applications/frontend/design-reference/design-system-v2.html §10 prosody（.f0card / .f0-ref 実線=chart-ref / .f0-learner 破線=chart-learner / [data-blind] / .f0-stress / .f0-word）
                  applications/frontend/design-reference/screens/workspace-v2.html
     ※ design-reference/ は gitignored。HTML 構造の正は handoff（memory: claude-design-port-status）を参照する。 -->

## Goal

- お手本（セクション本文）の Kokoro TTS 音声を parselmouth で F0 抽出し、その reference F0 輪郭（`timesMs`/`valuesHz`）を analyzer→worker→frontend の 3 言語スライスで配線し、`F0Chart.tsx` が学習者 F0（`.f0-learner` 破線）と同一グラフ上に お手本（`.f0-ref` 実線）として同一時間軸で重ね描きする。
- ブラインドモード（`[data-blind]`）で reference F0 輪郭を隠し、学習者が自己評価してから答え合わせできるようにする（REQ-126 最終フェーズの自己モニタリング）。
- 既存 workspace-v2 の動作（学習者 F0 描画・他の韻律ビュー）を壊さない（回帰防止）。`workspace-residuals.md` で `.f0-ref` を「準備中」プレースホルダーのまま据え置いた残ギャップを解消する。

## Must（満たさなければ done でない）

- [ ] **M-F0REF-a（analyzer: reference F0 抽出）**: python-analyzer が `referenceText`（= section 本文）から Kokoro TTS で General American 音声を合成し、`infrastructure/parselmouth_prosody.py` の `extract_f0_contour` で F0 を抽出して、`POST /v1/analyze` のレスポンスに reference F0 輪郭を返す。
  - `interface/schema.py` の `AnalysisResponse` に `referenceF0Contour: F0ContourResponse | None`（既存 `F0ContourResponse` 型を再利用、camelCase）を追加する。
  - 既存 `kokoro_tts.synthesize_speech` と `parselmouth_prosody.extract_f0_contour` を再利用する（新規合成・抽出ロジックを発明しない）。
  - mock/stub/fake/dummy 禁止（agent-policy）。reference F0 は実 TTS 音声から実抽出した値であること（偽輪郭・固定配列・乱数は不可）。
  - 学習者 F0 抽出（`f0Contour`）経路を壊さない。

- [ ] **M-F0REF-b（worker: contract 拡張）**: worker（Haskell）が analyzer の `referenceF0Contour` を受信して frontend へ渡す。
  - `AnalyzerClient.hs`: `AnalyzerResult` に `analyzedReferenceF0Contour :: Maybe F0Contour`（既存 `F0Contour` 型を再利用）を追加し、`FromJSON` で `referenceF0Contour` を `(.:?)` で optional 取得する。
  - `Types.hs`: `ProsodyOutput` に `prosodyReferenceF0TimesMs :: [Int]` / `prosodyReferenceF0ValuesHz :: [Double]` を追加し、`ToJSON` で `referenceF0Contour: { timesMs, valuesHz }`（学習者 `f0Contour` と同形）として出力する。reference 不在時は空配列または null（frontend schema と整合させる）。
  - `Scoring.hs`: `buildProsodyOutputFromData` が `analyzedReferenceF0Contour` を `ProsodyOutput` の reference フィールドへ写像する。
  - analyzer が `referenceF0Contour` を返さない場合（旧 analyzer / 抽出失敗）も worker・frontend が壊れないこと（後方互換）。

- [ ] **M-F0REF-c（frontend: ACL 配線 + 重ね描き）**: frontend が reference F0 を受信し、`F0Chart.tsx` が `.f0-ref` を `.f0-learner` と同一時間軸で重ね描きする。
  - `acl/.../oss-worker/schema.ts`: `prosodySchema` に `referenceF0Contour`（`f0ContourSchema` 再利用、`.nullable().optional().transform`）を追加する。
  - `acl/.../oss-worker/response-mapper.ts`: `prosody` 写像に `referenceF0Contour: response.prosody.referenceF0Contour` を追加する。
  - `lib/api-types.ts`: `ProsodyDto` に `referenceF0Contour: { timesMs: number[]; valuesHz: number[] } | null` を追加する。
  - `F0Chart.tsx`: reference F0 を `<path className="f0-ref" d={...} />` で描画し、`.f0-legend` の「お手本（準備中）」を実描画凡例に置換する。学習者・お手本を**同一時間軸に正規化**して同じ `viewBox` 内に重ねる（正規化方式は Open question Q2）。reference F0 が null/空のときは学習者のみ描画（既存挙動を退行させない）。

- [ ] **M-F0REF-d（ブラインドモード）**: `F0Chart.tsx` が `data-blind` 属性でブラインドモードを表現し、有効時は `.f0-ref`（お手本輪郭）を視覚的に隠す（DOM から除去 or CSS で非表示）。学習者輪郭は隠さない。トグルで表示/非表示を切り替えられる（REQ-126: 隠して自己評価 → 答え合わせ）。発動条件（手動トグル / 習熟度自動）は Open question Q3。

- [ ] **M-F0REF-e（real entrypoint 到達 + Docker rebuild）**: 上記が real public entrypoint（`POST /api/v1/sections/{id}/recording-attempts/.../analyze` → workspace route → `WorkspaceResultV2` の F0 ビュー）から到達可能で、観測可能挙動として描画される。analyzer/worker はビルド焼き込み（bind-mount 無し）のため、検証は `docker compose up -d --build`（analyzer + worker 再ビルド）後に行う（memory: docker-rebuild-required-for-code-changes）。

## Should（望ましいが必須でない）

- **S-F0REF-STRESS（強勢マーカー重畳）**: reference F0 輪郭上に語強勢の期待/実測（既存 `wordStress` の `expectedStress`/`predictedStress`）を `.f0-stress` / `.f0-stress--miss` としてマークする（REQ-126: 語強勢を輪郭上にマーク）。`workspace-residuals.md` で `.f0-ref` 未実装ゆえ同時 Non-goal とされた項目。reference F0 が入った本スライスで実装可能になるが、必須にはしない。

- **S-F0REF-CACHE（reference TTS キャッシュ）**: 同一 section 本文に対する Kokoro TTS + F0 抽出結果を section 単位でキャッシュし、再解析のたびに TTS を再実行しない。Open question Q1 の生成タイミング決定に依存する。

## 受入条件（acceptance — Must の確認方法）

- **M-F0REF-a** → `docker compose up -d --build` 後、`POST /v1/analyze` を実音声 + 非空 `referenceText` で叩き、レスポンス JSON の `referenceF0Contour.valuesHz` が非空（length > 0）かつ voiced フレーム（`> 0` の値）を 1 つ以上含むこと（偽の固定配列でないことは、`referenceText` を変えると輪郭が変わることで確認）。python-analyzer の `test/` に `extract_f0_contour(synthesize_speech(text))` が非空 F0 を返す統合テストが green。

- **M-F0REF-b** → `cabal test all` が green。worker の `AnalyzerClient` FromJSON テストが `referenceF0Contour` を含む JSON をパースして `analyzedReferenceF0Contour = Just ...` を得ること、`ProsodyOutput` ToJSON が `referenceF0Contour.timesMs`/`valuesHz` を出力することを assert。`referenceF0Contour` を含まない JSON でも `Nothing` でパース成功すること（後方互換）。

- **M-F0REF-c** → `pnpm typecheck` / `pnpm lint` / `pnpm test` green。`schema-and-response-mapper.test.ts` 系で `referenceF0Contour` が ProsodyDto まで写像されることを assert。`F0Chart.tsx` のユニットテスト（vitest）で、reference F0 を含む `prosody` を渡すと SVG に `path.f0-ref`（`d` 属性非空）が 1 つ描画され、学習者 `path.f0-learner` と同一 `viewBox` 内に存在することを assert。reference F0 が null のとき `path.f0-ref` が描画されず学習者のみ描画されること（退行なし）も assert。

- **M-F0REF-d** → `F0Chart.tsx` ユニットテストで、`data-blind` 有効時に `path.f0-ref` が DOM に存在しない（または `display:none` / `hidden`）こと、かつ `path.f0-learner` は存在することを assert。トグル操作で `.f0-ref` の表示/非表示が切り替わることを assert。

- **M-F0REF-e** → Playwright（`applications/frontend/e2e/`）で解析済み workspace 画面を開き、F0 ビューに切替（`viewMode === "f0"`）後、`.f0card .f0-ref`（`path`）と `.f0card .f0-learner`（`path`）が両方 visible であることを assert。reference F0 が実 TTS 由来であることは、`POST /v1/analyze` のレスポンス記録（`.agent-evidence/`）で `referenceF0Contour.valuesHz` が非空 + section 本文依存であることを示す。

## Non-goals（今回やらない）

- **リアルタイム F0 表示**: REQ-126 は「発話直後の事後表示」を必須とし、発話中のリアルタイム重ね描きは必須としない。本 spec も事後表示のみ。
- **F0 以外の韻律の重ね描き**: 強度（intensity）・持続時間・リズム（nPVI）等の参照重畳は対象外。本 spec は F0 輪郭に限定する（強勢マーカーは S-F0REF-STRESS の Should まで）。
- **Golden speaker（自分の声のお手本）**: REQ-128 の RVC/kNN-VC 由来 reference は対象外。reference は Kokoro TTS（General American）に限定する。
- **DTW 等の高度なアライメント実装の固定**: 時間軸正規化の具体方式（線形 vs DTW）は本 spec では決め打たない（Open question Q2）。
- **reference 音声そのものの再生 / A/B 比較**: お手本音声の再生・A/B 比較は `workspace-residuals.md` の M-AB 系の責務。本 spec は F0 輪郭の可視化のみ。
- **espeak/phonemizer ライセンス境界の再判断**: parselmouth（GPL-3.0）/ Kokoro（Apache-2.0）の配布形態ライセンス影響は既存 ADR の責務（REQ-NF-101）。本 spec は既存内部利用方針を踏襲し、新たな配布判断はしない。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **schema / public export（3 言語 wire contract 拡張）**: analyzer `AnalysisResponse`・worker `AnalyzerResult` / `ProsodyOutput`・frontend `ProsodyDto` / `prosodySchema` の 4 契約面に `referenceF0Contour` を同時追加する。1 つでも欠けると wire が割れる。enum/型追加は同一 PR で全層更新が必須（agent-policy 配線点契約）。
  - **config / background（Docker rebuild 焼き込み）**: analyzer・worker はビルド時焼き込みで bind-mount 無しのため、コード変更が `docker compose up -d --build` なしには実機反映されない。新規 Python 依存を足す場合は Dockerfile の pip list も更新が要る（memory: python-analyzer-dockerfile-hardcoded-pip。本 spec は既存 kokoro/parselmouth 再利用のため新依存は想定しないが、要確認）。
  - **background job（analyze 時の TTS 実行コスト）**: reference F0 抽出は analyze ごとに Kokoro TTS（CPU）を追加実行する。長い section 本文で解析レイテンシが増大する。生成タイミング/キャッシュ（Open question Q1 / S-F0REF-CACHE）の設計判断が要る。

## Open questions（人間確認 / 実装判断の分離）

> **解決済み（2026-06-14, lihs 回答 + 実装確定）**
> - **Q1 = (a)+(b) の段階導入**: lihs は「section ごとキャッシュ」を選択。実装は **MVP で (a) 都度合成**（`includeReferenceF0` フラグを全層に配線、default True=毎回計算）で稼働し、**section 単位の保存+再利用（flag=false で TTS skip）は後続スライス S-F0REF-CACHE** に分離。フラグの on/off は実機 live で確認済（runtime-verify.json）。本スライスの Must（M-F0REF-a〜e=overlay）は (a) で充足。
> - **Q2 = (a) 線形正規化**（MVP）。DTW 整列は別スライス候補。
> - **Q3 = (a) 手動トグル**（M-F0REF-d）。習熟度連動の自動発動は対象外。
> - **Q4 = reference 不在は null**（学習者 f0Contour と統一）。worker ToJSON は空時 `referenceF0Contour: null`、frontend schema は `.nullable()` で受ける。

1. **reference TTS の生成タイミング**（**人間確認要**）: お手本 TTS を (a) `POST /v1/analyze` のたびに `referenceText` から都度合成するか、(b) section 登録時に事前生成してキャッシュ（S-F0REF-CACHE）するか。(a) は実装が単純だが解析レイテンシが本文長に比例して増える。(b) は section ライフサイクル・キャッシュ無効化の設計が要る。MVP として (a) で始めるかは lihs の判断（解析レイテンシの許容値が UX 要件に直結するため）。

2. **時間軸正規化の方式**（**実装判断**、ただし方針は人間確認推奨）: 学習者とお手本は発話長が異なる。重ね描きの時間軸を (a) それぞれの `[minTime, maxTime]` を `[0,1]` に線形正規化して重ねるか、(b) DTW で音素/単語境界を対応づけて整列するか。研究（§3.3-5）が問うのは輪郭形状の気づきであり、MVP は (a) 線形で足りる見込み。DTW は別スライス候補。F0Chart は現状 `minTime`/`maxTime` で学習者を自身の範囲に正規化済みのため、reference を同方式で `[0,1]` 正規化して重ねるのが最小実装。最終方式は topology-mapper / implementer が決定するが、(b) を選ぶなら工数が跳ねるため事前共有。

3. **ブラインドモードの発動条件**（**人間確認要**）: `data-blind` を (a) ユーザーの手動トグル（ボタン）で切り替えるか、(b) 習熟度（REQ-113 の Stage 推定 / 診断結果）に応じて自動で最終フェーズに有効化するか。REQ-126 は「最終フェーズで隠す」と書くが習熟度連動の自動化は未確定。MVP は手動トグルで足りるか、自動化まで要るかは lihs の判断。本 spec の Must（M-F0REF-d）は「トグルで切替可能」までを要求し、自動発動は対象外とする（自動化が要るなら別途要件化）。

4. **reference 不在時の wire 表現**（**実装判断**）: analyzer が `referenceF0Contour` を返さない/抽出失敗時、worker `ProsodyOutput` で reference フィールドを「空配列 `[]`」とするか「null（フィールド省略 or `referenceF0Contour: null`）」とするか。frontend schema（`.nullable().optional()`）と F0Chart の null 分岐に整合させる。学習者 `f0Contour` は現状 worker が常に `f0Contour: { timesMs: [], valuesHz: [] }`（空配列）を出力するため、reference も同方式に揃えるのが一貫的。topology-mapper が 4 層の null/空表現を統一する。
