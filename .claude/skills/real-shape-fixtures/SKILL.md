---
name: real-shape-fixtures
description: worker/analyzer/LLM の出力を消費するロジックのテスト fixture を書く・直すときの規律。合成の「きれいな」fixture（正の GOP、全 field 充足、fence 無し JSON）が作る偽 green を防ぐ。負 GOP・phenomenon 自由文字列・catalogId null・markdown fence・referenceText 依存形のチェックリスト付き。テストや fixture の新規作成・修正、上流出力のパーサ実装の場面で使う。
---

# real-shape-fixtures — fixture は実出力の形で書く

## 規律（2 回の実 incident から昇格: 2026-06-14 worker-shape / 2026-06-19 markdown fence）

上流（worker / analyzer / LLM / 外部 CLI）の出力を消費する導出ロジックの fixture は、**実出力をキャプチャした形**で書く。合成正値 fixture は unit を緑にしたまま本番経路を壊す（偽 green）。過去の実例:

- 合成 fixture が正の GOP・全 field 充足で書かれ、実出力（負 GOP・null 混在）で導出ロジックが実機で壊れた。
- LLM narrative が ` ```json ` fence で wrap されて返り、`JSON.parse` 失敗 → **silent fallback** で固定文言に縮退し、静的検査は全部緑のまま品質欠陥として発覚。

## 実出力形チェックリスト（native-trace 固有）

- GOP は**負値**（-2〜-20 帯）。正の GOP を fixture に書いた時点で嘘。
- `phenomenon` は自由文字列（enum ではない）。
- `catalogId` は null があり得る。
- worker 出力の形は referenceText（= metadata の `sectionBodyText`）に**依存して変わる**。fixture の本文と期待形を別々に捏造しない。
- analyzer C1 fields: nBest は空配列があり得る。garbage IPA（例: "hello world" → `[v,n,l,w,w,ɹ,l,n]`）が正常系。
- LLM 出力: fence wrap・前置き文・末尾 truncation を想定した防御 parse。raw stdout をそのまま `JSON.parse` しない。

## 手順

1. live stack を立てて実出力をキャプチャする（live-stack-ops skill の curl レシピ）。
2. response JSON をそのまま fixture ファイル化。加工するなら実 response からの変形として行い、field を「きれい」に整形しない。
3. パーサには実出力での失敗ケース fixture（fence 付き・null 混在）を必ず 1 本入れる。

## silent fallback 禁止

- `except Exception` → 空配列 / 固定 fallback は静的 green を作る最悪パターン。依存欠落は module-top import で fail-fast、縮退するなら counter/log を必ず残す。
- unit が緑でも完了根拠にしない。最終防衛は runtime-verifier の live assert（real entrypoint からの観測）。
