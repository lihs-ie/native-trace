# Lesson: Servant route だけ追加・handler 未結線の早期終了を build 前に静的検出する

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
implementer が Api.hs の `type WorkerApi =` に route を追加しても Application.hs の `server = ... :<|> ...` に
handler を結線せず早期終了する再発があった。Servant は最終的に型エラーで弾くが、implementer が build を
回さず「次に handler を足す」と宣言したまま離脱すると未配線のまま done 報告される。route 数 ↔ handler 数の
parity を `scripts/verify-servant-route-handler-parity.sh` で**build を待たず静的**に機械検査する。

## Trigger
implementer の早期終了 3 回。既存 `wiring_manifest.yml: backend-servant-route-needs-handler` は
Api.hs を変えたら Application.hs も変えたか (co-change の有無) しか見ず、route 数と handler 数の parity は
見ない。Api.hs と Application.hs を両方触っていれば co-change rule は OK を返すため、route +1 して
handler を足し忘れた中間状態を捕捉できなかった。

## Verified facts
- 数え方: route 数 = `type WorkerApi =` ブロック内の HTTP method combinator (Get/Post/Put/Delete/Patch) 数。
  handler 数 = `server = ...` ブロック内のトップレベル `:<|>` 数 + 1。
- 単語境界 `\<`/`\>` は GNU awk 拡張で BSD awk (macOS) では効かない。`(^|[^A-Za-z])(Get|...)([^A-Za-z]|$)` の
  match ループに置き換えて移植性を確保した。
- clean: routes=5 / handlers=5 → exit 0。
- synthetic violation (Api.hs に `:<|> "diagnostics" :> Get '[JSON] HealthResponse` を追加・handler 無し):
  routes=6 / handlers=5 → exit 1、正しいエラーメッセージ。restore → exit 0。

## General rule
コンパイラが最終的に守る不変条件 (Servant の route↔handler 型一致等) でも、implementer が build を
回さず早期終了するクラスでは「build を待たない安価な静的 parity 検査」を per-edit hook + CI に置くと
中間状態の未配線を即座に検出できる。terminal の「次に X する」予告を配線証拠にしない。

## Promotion status
- [x] grep gate 新設 (scripts/verify-servant-route-handler-parity.sh)
- [x] Wired into fitness hook (scripts/agent-policy-hook.sh、Api.hs/Application.hs 編集時)
- [x] Wired into CI (.github/workflows/pr-gate.yml policy job の parity step)
- [x] Added Haskell rubric item (rubric/packs/haskell.md) + core wiring rubric 節
- [x] Recorded in rules/promoted/promoted.yml (id: servant_route_handler_parity)
- [x] Verified: clean exit 0 / synthetic violation exit 1 / restore exit 0
