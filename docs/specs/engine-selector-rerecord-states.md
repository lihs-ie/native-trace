# Spec: engine-selector-rerecord-states

## Goal

`low_quality` および `failed` 状態の dock 行にエンジン選択セレクタ（OpenAI API / OSS Worker / ⊕ 比較の 3 択）を追加し、録音し直す前に `analysisMode` を変更できる導線を提供する。

## Must (満たさなければ done でない)

- [ ] Must-1: `low_quality` 状態の dock 行に、`cloudOnly` / `ossWorkerOnly` / `comparison` の 3 択セレクタが描画される
- [ ] Must-2: `failed` 状態の dock 行に、同 3 択セレクタが描画される
- [ ] Must-3: 各セレクタボタンをクリックすると `analysisMode` state が更新され、クリックしたボタンのみに `is-active` クラスが付き、他の 2 ボタンから外れる
- [ ] Must-4: セレクタで `analysisMode` を変更した後「録音し直す」ボタンを押すと、POST `.../practice-attempts` の `formData.analysisMode` に選択値が反映される
- [ ] Must-5: `idle` / `recording` / `analyzing` / `result` 状態における既存の表示・挙動が変わらない（既存ユニット・E2E テスト全通過）
- [ ] Must-6: DOM に `id="engineSeg"` の重複が存在しない（idle 行と low_quality / failed 行でセレクタが同居する場合、id は除去または class に置き換える）

## Should (望ましいが必須でない)

- セレクタの 3 ボタン JSX を `renderEngineSeg()` 等の内部関数に切り出し、idle / low_quality / failed で共有することで重複コードを排除する
- `dock-low-quality` / `dock-failed` 行の CSS を、セレクタ追加後もレイアウトが崩れないよう `justify-content: space-between` ベースで維持する
- `low_quality` 行のヒントテキスト（「音量が小さいか…」）と `failed` 行のエラーメッセージは現行のまま残す

## 受入条件 (acceptance — Must の確認方法)

- Must-1 → `deriveWorkspaceState` が `"low_quality"` を返すようにシードした状態でページを表示し、`.dock-low-quality .seg-item` のロケータで 3 要素が `toBeVisible()` を通る
- Must-2 → `deriveWorkspaceState` が `"failed"` を返すようにシードした状態でページを表示し、`.dock-failed .seg-item` のロケータで 3 要素が `toBeVisible()` を通る
- Must-3 → low_quality 状態で `.dock-low-quality .seg-item[data-eng="rust"]` をクリックし、そのボタンに `.is-active` が付き（`expect(button).toHaveClass(/is-active/)`）、他 2 ボタンに `.is-active` が無いことを確認する
- Must-4 → `page.route('**/practice-attempts', ...)` で POST を横取りし、`formData.get('analysisMode')` が直前に選択したエンジン値と一致することを assert する
- Must-5 → `pnpm test --run` がすべて通過し、`pnpm test:e2e` の既存スペック（`workspace-v2.spec.ts` 等）が 0 failure で完了する
- Must-6 → `grep -c 'id="engineSeg"' applications/frontend/src/app/materials/\[materialIdentifier\]/sections/\[sectionIdentifier\]/page.tsx` の出力が `0` である（id を class 化または除去した後）

## Non-goals (今回やらない)

- `result` 状態の `EngineTabs` コンポーネントおよび「⊕ 追加解析」ボタンの挙動変更
- `deriveWorkspaceState` 内の `low_quality` 判定ロジック（`errorCode === "low_quality_audio"` 分岐）の変更
- OSS Worker の response-mapper における空セグメント判定ロジックの変更
- backend（Haskell worker）/ python-analyzer / golden-speaker への変更
- `low_quality` / `failed` 状態で表示するエラーメッセージ・ヒントテキストの文言変更
- 録音ライブラリ選択（`RecordingLibraryPicker`）への変更

## Risk

- level: low
- escalate_to_opus: false
- 理由: 変更範囲は `applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/page.tsx` の JSX 追加と、必要に応じた `design-components.css` のレイアウト微修正のみ。新規 routing / auth / DI / schema / migration / background job / event subscription / public export のいずれにも触れない。既存 `analysisMode` state への描画追加のみであり、本番コードへのテストダブル混入余地も無い。

## Open questions

なし。要求・背景・修正方針・受入条件はすべて提供済みで未確定点は無い。
