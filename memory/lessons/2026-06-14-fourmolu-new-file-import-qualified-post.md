# Lesson: fourmolu は cabal 未登録の新規 .hs に default-language(GHC2024) を適用しない

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
fourmolu は `.cabal` の exposed-modules/other-modules に**登録済みの module からのみ** default-language(GHC2024)/default-extensions を抽出する。新規 .hs は未登録のため GHC2024 由来の `ImportQualifiedPost` が効かず postpositive `import X qualified` で parse error になり per-edit fitness hook が編集をブロックする。hook の fourmolu 呼び出しに `--ghc-opt -XImportQualifiedPost` を渡す**単一点修正**で解決する (grep gate は不要・FP ゼロ)。

## Trigger
ShadowingLagSpec / GoldenSpeakerSpec / GoldenSpeakerClient の 3 ファイルで、新規作成時に
postpositive `import Data.Text qualified as T` を書いたら per-edit fitness hook の fourmolu standalone が
`Found 'qualified' in postpositive position.` で exit 102 → 編集ブロック。当時の回避は先頭に
`{-# LANGUAGE ImportQualifiedPost #-}` を後付けすることだった (これらのファイルだけ pragma を持つ)。

## Verified facts
- 実機 fourmolu 0.19.0.1 (ghc-lib-parser 9.12.3) で再現確認した。
- cabal `default-language: GHC2024` は `default-extensions` ではない。fourmolu は GHC2024 を展開しない。
- 既存 worker .hs の大半 (Application/AnalyzerClient/Assessment/Scoring/ApplicationSpec/ScoringSpec の 6 個) は
  pragma 無しの postpositive qualified だが、cabal の exposed/other-modules に**登録済み**なので fourmolu が
  default-language を抽出でき plain check で通る。→ 「全 postpositive .hs に pragma 必須」grep gate は
  これら既存ファイルに大量 FP を出すため**採用しない** (failure-miner の明示警告通り)。
- prepositive `import qualified` を使う既存 .hs は 0 個。
- 新規・cabal 未登録ファイル: `fourmolu --mode check` で exit 102 (postpositive parse fail) →
  `fourmolu --ghc-opt -XImportQualifiedPost --mode check` で exit 0。
- 全 14 .hs (src/app/test) で plain と `--ghc-opt -XImportQualifiedPost` の exit-code diff = 0、
  かつ `--ghc-opt` 付きで全ファイル clean (整形差なし)。→ フラグ追加で既存挙動不変・FP ゼロ。

## General rule
fourmolu を standalone で per-file 起動するとき、cabal `default-language` に標準 (GHC2020/GHC2024 等) を
使っているプロジェクトでは、その標準が含む言語拡張 (GHC2024 なら ImportQualifiedPost 等) を `--ghc-opt -X...`
で明示的に渡す。fourmolu の cabal 抽出は **module が exposed/other-modules に登録済みのとき限定**で、新規
ファイルには効かない。「既存ファイルが通るから新規も通る」とは限らない (登録の有無で挙動が分かれる)。
正しいコードを toolchain 不整合でブロックする偽陽性は、コード側に pragma を撒くのではなく hook 起動側で直す。

## Promotion status
- [x] Root single-point fix (scripts/fitness/hook.sh の fourmolu 呼び出しに --ghc-opt -XImportQualifiedPost)
- [x] Verified: 新規未登録 .hs で plain exit 102 → --ghc-opt exit 0、既存 14 .hs で exit-code diff 0
- [x] Recorded in rules/promoted/promoted.yml (id: fourmolu_new_file_import_qualified_post)
- [x] Added Haskell rubric note (rubric/packs/haskell.md 補足節)
- [ ] grep gate (pragma 必須化) は不採用 (高 FP)。lesson + 根本修正で完結
