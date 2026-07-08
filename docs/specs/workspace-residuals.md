# Spec: workspace-residuals

<!-- 親 spec: docs/specs/pronunciation-feedback-v2.md (M-WS / M-124)
     前回 spec: docs/specs/pronunciation-feedback-v2-residuals.md
     本 spec は workspace-v2 解析結果ビューの残ギャップ 3 点（調音図解 / F0 お手本輪郭 / A/B 実再生）を正規化する。
     design の正: applications/frontend/design-reference/design-system-v2.html §06(artic) / §07(model) / §10(prosody)
                  applications/frontend/design-reference/screens/workspace-v2.html dock -->

## Goal

- `DetailPanelV2.tsx` の調音図解ボタンを design §06 仕様（差し替え可能 SVG プレースホルダー + 調音手順 + お手本再生 TTS 併置）に合致した実パネルとして実装し、高優先音素の finding から到達可能にする。
- `WorkspaceResultV2.tsx` dock の `.ab-srcs` / `.player` / `.speed` を実再生に配線する（self = 録音音声 `GET /api/v1/recording-attempts/{id}/audio`、model = お手本 TTS `POST /api/v1/tts`）。
- `F0Chart.tsx` の お手本輪郭（`.f0-ref`）を **Should** として scope する（analyzer 側 reference F0 未実装のため、today は学習者輪郭 + 正直プレースホルダーを維持し、analyzer 拡張は別スライスで行う）。
- 既存 workspace-v2 の動作を壊さない（回帰防止）。

## Must（満たさなければ done でない）

### M-ARTIC（調音図解パネル実装）

- [ ] **M-ARTIC-a（ArticulationCard コンポーネント）**: `applications/frontend/src/components/workspace/ArticulationCard.tsx` が存在し、以下の構造を持つ:
  - `.artic` ルート要素（design §06 `.artic` クラス準拠）
  - `.artic-fig` 内に IPA 記号（`.sym`）と `320×320` SVG プレースホルダー（`.ph` テキスト `"sagittal-diagram\nplaceholder\n320×320 · SVG"`）
  - `.artic-steps` に対象音素の調音手順テキスト（少なくとも 3 ステップ、日本語）
  - `.artic-audio` に「お手本 /X/ 単音」TTS 再生ボタン（`POST /api/v1/tts` 実呼び出し、mock 禁止）

- [ ] **M-ARTIC-b（高優先音素 10 件の定義）**: 高優先音素セット（`/r/ /l/ /æ/ /ʌ/ /iː/ /ɪ/ /θ/ /ð/ /v/ /f/ /ə/` の 11 音素）について、IPA 記号・調音手順・名称（日本語+英語）を持つ静的データ（型付き定数またはデータファイル）が frontend に存在する。型名は `ArticulationEntry`。

- [ ] **M-ARTIC-c（DetailPanelV2 からの到達）**: `DetailPanelV2.tsx` の「調音図解 → /X/」ボタン（現在 `disabled`）が、finding の `expected.ipa` が高優先音素セットに含まれる場合に `disabled` でなくなり、クリックで `ArticulationCard` がパネル内に展開（または overlay）される。高優先音素に含まれない場合はボタンが `disabled` のまま（変更なし）。本番コードに mock / stub 挿入禁止。

- [ ] **M-ARTIC-d（TTS 実配線の確認）**: `.artic-audio` 内の TTS ボタン押下が `POST /api/v1/tts` へ実リクエストを送り、返った `audio/wav` バイト列が再生される。`DetailPanelV2` の既存 `handlePlayTts` と同一の実装パターン（fetch → Blob → Audio 構築）を使う。`HTMLAudioElement` mock をコンポーネントに埋め込まない。

### M-AB（A/B 実音源再生配線）

- [ ] **M-AB-a（self ソース: 録音音声再生）**: `WorkspaceResultV2.tsx` dock の `.ab-srcs` で `self` が選択された状態で `.player .pp`（再生ボタン）を押下すると、`GET /api/v1/recording-attempts/{recordingAttemptIdentifier}/audio` から音声バイトを取得して `<audio>` で再生が開始される。`sectionIdentifier` から workspace レスポンスの `recordingAttempts` の最新エントリの `identifier` を取得して URL を構成する。

- [ ] **M-AB-b（model ソース: TTS 実再生）**: `WorkspaceResultV2.tsx` dock の `.ab-srcs` で `model` が選択された状態で `.player .pp` を押下すると、`POST /api/v1/tts` にセクション本文テキスト（`bodyText`）と現在の `playSpeed` を渡し、返った `audio/wav` バイト列を再生する。キャッシュ戦略: 同一テキスト・同一速度では再生中の `HTMLAudioElement` を再利用する（都度 fetch しない）。

- [ ] **M-AB-c（速度 chip 反映）**: `.speed` の speed chip（0.5x / 0.85x / 1.0x）切替が、次の再生セッションから有効になる。速度変更時は `ttsAudio` キャッシュを無効化し次回 fetch で反映する。`self` ソース（録音済み wav）の場合は `HTMLAudioElement.playbackRate` を speed に設定する。

- [ ] **M-AB-d（player UI 配線）**: `.player` 内に `.pp`（再生/一時停止トグル）・`.wave`（波形ビジュアライザー: 最低 10 本の `<i>` バー、active 時に `.on` クラスを付ける）・`.tt`（経過時間 / 総時間 `m:ss.s / m:ss.s` フォーマット）が存在し、再生中は `.pp` が一時停止アイコンに変わる。`timeupdate` イベントで `.tt` が更新される。

- [ ] **M-AB-e（golden は正直プレースホルダー維持）**: golden ソース選択時は再生を試みず、`gs-gate` テキスト「GPU 必要 / 準備中」が表示されたまま再生ボタンが無効になる（現在の挙動を維持）。本番コードに golden 用 mock / stub を挿入しない。

### M-REGRESSION（回帰防止）

- [ ] **M-REGRESSION-a（既存 workspace-v2 セレクタの維持）**: 前 spec M-WS の受入セレクタ（`.fb3-row--what` / `.gopmap .gp` / `.conf[data-level]` / `.nbest-row.is-top` / `.mini-axis .ma` / `.subscale`）が引き続き存在し、追加実装後も workspace-v2 Playwright spec が green のまま。

- [ ] **M-REGRESSION-b（DetailPanelV2 の既存機能維持）**: 却下（`POST /dismissal`）/ 復元（`DELETE /dismissal`）/ 既存 TTS 再生（③How ボタン）/ `feedbackLayers` 3 層表示 が引き続き動作する。変更後 `pnpm typecheck` / `pnpm test` が green。

## Should（望ましいが必須でない）

- **S-F0REF（F0 お手本輪郭）**: `F0Chart.tsx` に `.f0-ref` パスを追加し、`ProsodyDto` に `referenceF0Contour` フィールドを加える（`analyzer → worker → frontend` 3 層拡張）。今回 Must から除外する理由: python-analyzer の `AnalysisResponse` に `referenceF0Contour` フィールドが存在しない（grep で `f0.*ref` ゼロ件確認済み）。reference F0 を出すには kokoro TTS で合成 → parselmouth で F0 抽出 → `AnalysisResponse` に追加 → `AnalyzerClient.hs` 型拡張 → workspace ACL 配線 が要り、backend スライスを消費する。MVP の学習効果上は「学習者輪郭のみ + 正直プレースホルダー（『お手本（準備中）』）」で実験的価値が得られる。REQ-126 の F0 重ね描きは S-F0REF として別スライスで実装する。
  - S-F0REF を実装する場合の拡張点: `schema.py` `AnalysisResponse.referenceF0Contour: F0ContourResponse | None`、`AnalyzerClient.hs` の対応型追加、`ProsodyDto.referenceF0Contour`、`F0Chart.tsx` に `<path className="f0-ref" ...>` 追加。

- **S-ARTIC-REC（自分で試す録音ボタン）**: `.artic-audio` に design §06 の「自分で試す」録音ボタン（`.rec-btn`）を追加する。今回は録音インフラ（Web Audio API）統合のコストが大きいため必須にしない。ボタン UI のみ `disabled` 状態で配置してもよい。

- **S-AB-PARTIAL（指摘箇所部分再生）**: dock の「指摘箇所のみ」ボタン（design §07 に存在）で、選択中 finding の `audioRange`（`startMilliseconds`–`endMilliseconds`）を `GET /api/v1/recording-attempts/{id}/audio` に `Range: bytes` ヘッダーで部分取得して再生する。既存 route が `206 Partial Content` に対応済みのため feasible だが今回 Must には含めない。

## 受入条件（acceptance — Must の確認方法）

- **M-ARTIC-a** → `grep -rn "ArticulationCard" applications/frontend/src/components/workspace/` でファイルが存在する。`grep -n "artic-fig\|artic-steps\|artic-audio\|\.ph\|\.sym" applications/frontend/src/components/workspace/ArticulationCard.tsx` で全クラスが存在することを確認。`pnpm typecheck` が green。

- **M-ARTIC-b** → `grep -n "ArticulationEntry\|HIGH_PRIORITY_PHONEMES\|articulationData" applications/frontend/src/` でデータ定義が存在し、IPA 配列に `/r/` `/l/` `/θ/` `/ə/` を含む（11 音素）ことを単体 test で assert する。`pnpm test` が green。

- **M-ARTIC-c** → Playwright で解析済みセクション（finding の `expected.ipa` が `/l/` 等高優先音素のもの）の workspace 画面を開き、finding クリック → DetailPanelV2 表示 → 「調音図解 → /l/」ボタンが `disabled` でないことを `expect(button).not.toBeDisabled()` で assert。ボタン押下後 `.artic` 要素が `toBeVisible()` で確認できる。

- **M-ARTIC-d** → Playwright（または Vitest + fetchMock を使わない統合テスト）で `.artic-audio` の TTS ボタン押下が `POST /api/v1/tts` へ実 fetch を発行することを Network log で確認する。mock を使わない場合は `docker compose up` 環境で `pnpm test:e2e` で実 HTTP 確認する。

- **M-AB-a** → Playwright で workspace 画面（解析済み・録音試行あり）を開き、`.ab-srcs .ab-src:first-child`（自分）が `.is-active` → `.player .pp` クリック後、ブラウザ Network log に `GET /api/v1/recording-attempts/{id}/audio` リクエストが発生することを `page.waitForRequest` で assert する。

- **M-AB-b** → Playwright で `.ab-srcs` のお手本ボタン（`ab-src:nth-child(2)`）をクリック → `.is-active` に切替 → `.player .pp` クリック後、Network log に `POST /api/v1/tts` + `body.text === bodyText` + `body.speed === 0.85` のリクエストが発生することを assert する（`docker compose up` 後、kokoro 有効環境または TTS stub server 可）。

- **M-AB-c** → `.speed .sp-chip` で `0.5x` をクリック → `playSpeed` state が `0.5` になる（React state 検証または次の TTS fetch で `speed: 0.5` が渡ることを Network log で assert）。`pnpm typecheck` が green。

- **M-AB-d** → Playwright で再生開始後に `.player .wave i.on` が 1 件以上存在し、`.player .tt` のテキストが `m:ss.s / m:ss.s` パターン（正規表現 `/\d:\d{2}\.\d \/ \d:\d{2}\.\d/`）に一致することを assert する。

- **M-AB-e** → `grep -n "golden\|Golden" applications/frontend/src/components/workspace/WorkspaceResultV2.tsx` で mock / 実再生コードが追加されていないことを確認。Playwright で golden ボタン押下後 `.gs-gate` が `toBeVisible()` であり `.player .pp` が `toBeDisabled()` であることを assert する。

- **M-REGRESSION-a** → `pnpm test:e2e` で既存 `workspace-v2.spec.ts` の以下 assert が green: `.fb3-row--what`, `.gopmap .gp`, `.conf[data-level]`, `.nbest-row.is-top`, `.mini-axis .ma`, `.subscale`。

- **M-REGRESSION-b** → `pnpm typecheck` が green。`pnpm test --run` が green。Playwright dismissal round-trip（前 spec M-SMOKE-b）が引き続き green。

## Non-goals（今回やらない）

- **F0 お手本輪郭（`.f0-ref`）の実装**: python-analyzer への `referenceF0Contour` 追加・`AnalyzerClient.hs` 型拡張・workspace ACL 配線は今回対象外（Should S-F0REF として記録し別スライスで実施）。今回は「お手本（準備中）」プレースホルダーのまま維持する。
- **実 anatomical 調音 SVG 図版**: 矢状断面図の実 SVG は Non-goal。design §06 が「差し替え可能プレースホルダー」と明示しているため、テキストプレースホルダー構造（`.ph`）で合致とする。
- **golden 実音源（RVC）**: ADR-012 の training スライスで実装する。今回は `disabled` + `gs-gate` 維持。
- **自分で試す録音ボタン（`.rec-btn`）の実配線**: S-ARTIC-REC 参照。
- **指摘箇所部分再生**: S-AB-PARTIAL 参照。
- **Phase 3 画面（診断 / 進捗 / HVPT / ドリル / シャドーイング）**: 親 spec Non-goal を継承。
- **F0 強勢マーカー（`.f0-stress` / `.f0-stress--miss`）**: reference F0 未実装時は強勢位置の重ね描きも対象外。S-F0REF と同一スライスで実装する。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **public export**: `ArticulationCard` の TTS 呼び出しは `POST /api/v1/tts` を新たな経路から呼ぶ（既存 DetailPanelV2 の `handlePlayTts` と同一 endpoint だが別コンポーネントからの到達経路が増える）。
  - **routing**: `GET /api/v1/recording-attempts/{id}/audio` の Range 対応 route をドック再生から初めて利用する。既存 route は Range 対応済みだが、full fetch（Range なし）でのドック全文再生は未テスト経路。
  - **background job / event subscription**: `HTMLAudioElement.timeupdate` イベントで `.tt` を更新する非同期 UI ループが workspace コンポーネントの lifecycle に依存する。`useEffect` cleanup でイベントリスナーを必ず解除しないとメモリリークになる。
  - **config**: `WorkspaceResultV2` が `sectionIdentifier` のみを受け取り `recordingAttemptIdentifier` を workspace DTO から取り出す配線が必要。workspace route レスポンス（`GET /api/v1/sections/{id}/workspace`）の `recordingAttempts` 配列最新エントリの `identifier` を使う。

## Open questions

1. **workspace DTO への `recordingAttemptIdentifier` 引き渡し方法**: `WorkspaceResultV2` は現在 `engineResult` と `sectionIdentifier` のみを受け取る。self 再生のために最新 `recordingAttemptIdentifier` が必要。props に追加するか（親コンポーネントが workspace DTO を保持するため feasible）、`WorkspaceResultV2` に `latestRecordingAttemptIdentifier: string | null` prop を追加するか。topology-mapper が決定する。

2. **model TTS のテキスト**: dock の model 再生は `bodyText`（セクション本文全体）を TTS に渡すことを想定しているが、长い本文（100 字超）の場合 kokoro が複数チャンクを返し応答が遅くなる可能性がある。文字数上限を設けるか（例: 100 字で切るか）は実装者が実測して判断する。受入条件の network assert は影響しないが、UX 上の判断として記録する。

3. **`F0Chart` プレースホルダーの変更可否**: S-F0REF が別スライスで実装されるまで「お手本（準備中）」テキストは変更しないことを明示する。今回の実装で `F0Chart.tsx` を触る必要が生じた場合も、`f0-ref` 描画ロジックは追加しない。
