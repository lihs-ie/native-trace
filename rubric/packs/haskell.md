# rubric pack: Haskell (servant / cabal)

cabal `exposed-modules` と app の結線が最頻の未配線点。`Api.hs`→`Main.hs`/`Application.hs`
への結線と、placeholder (`throwError err501` / `undefined`) の残置を重点検査する。

## 追加判定項目
- 新規 module が `exposed-modules` / `other-modules` に登録され、`Main.hs` か `Application.hs` から結線される。
- handler が `throwError err501` / `notImplemented` / `undefined` の placeholder を残していない。
- 新規 export 関数が本番呼び出し箇所から実参照される (`grep -rn '<fn>' src --include='*.hs'`)。
- server 起動 smoke と該当 endpoint が例外なく流れる。
- cabal の `common warnings` (各 `ghc-options`) に `-Werror=missing-fields` がある。無いとレコードに
  フィールドを追加して builder で設定し忘れた partial record construction が `-Wmissing-fields` の
  warning 止まりで build/test 緑を通過し、ToJSON 等の強制評価で runtime thunk crash (worker HTTP 000)
  になる。`scripts/verify-haskell-warnings.sh` が機械検査する (incident 2026-06-13)。
- **Servant route ↔ handler parity**: `Api.hs` の `type WorkerApi =` の route 数 (HTTP method
  combinator `Get`/`Post`/...) と `Application.hs` の `server = ... :<|> ...` の handler 数が一致する。
  route を足して handler 未結線のまま離脱していないか。`scripts/verify-servant-route-handler-parity.sh`
  が build を待たず静的に機械検査する (FC-2)。終了メッセージの「次に handler を足す」を配線証拠にしない。

## 推奨証拠
- `cabal build all` + `cabal test`。
- hlint の no-prod-doubles ルール (`*.Mock`/`*.Fake` module の restrict)。
- 文字列 parser / OIDC callback parser に `Test.QuickCheck` / fuzz target。

## 補足: 新規 .hs の postpositive `import X qualified`
- fourmolu は `.cabal` の `exposed-modules`/`other-modules` に**登録済みの module からのみ**
  `default-language` (GHC2024) / `default-extensions` を抽出する。新規 .hs はまだ cabal 未登録のため
  GHC2024 由来の `ImportQualifiedPost` が効かず postpositive `import X qualified` で parse error になる。
- これは per-edit fitness hook の fourmolu 呼び出しに `--ghc-opt -XImportQualifiedPost` を渡して
  解決済み (`scripts/fitness/hook.sh`)。**新規ファイルに pragma を都度書く必要はなく、cabal の
  default-language = GHC2024 と整合している** (FC-1: 根本単一点修正、既存 .hs への FP ゼロを確認済み)。
