# 配線ミス検出 rubric (core / 言語不受)

runtime-verifier が使う。「コードが存在する」ではなく「入口から出口までの経路が
**実行で証明された**か」を yes/no で判定する。各項目は機械検証可能な証拠を必須とする。

| 判定項目 | チェック内容 | 必要証拠 |
|---|---|---|
| 入口接続 | UI 操作 / CLI / HTTP route / job scheduler / event publish のいずれかが feature 入口として登録されているか | route 一覧 / UI test step / CLI help / job 定義 |
| entrypoint 逐語実行 | runtime evidence の各コマンドは `wiring_manifest.yml` の real_entrypoint / `package.json` 宣言 script を**逐語実行**しているか。convenience 引数 (例 `--repo-root` の明示)・mock 依存・実ツールが出さない理想 payload fixture で**代替していないか**。代替した緑は entrypoint 到達の証拠にしない | commands.txt の各行 vs 宣言 entrypoint の引数差分 / real entrypoint 実行ログ |
| 中継接続 | controller/handler から service/usecase へ **実呼び出し** があるか | grep/call graph / unit・feature test / 実行ログ |
| 出口接続 | repository / external adapter / queue / DB write / UI state update のいずれかが実際に呼ばれたか | DB state diff / contract result / UI assertion (HTTP mock ではなく) |
| 設定接続 | env/config/DI registration/feature flag が正しい値で配線されるか | config 読み込みログ / container binding / 起動ログ |
| 起動可能性 | app が起動し、該当経路で例外なく流れるか | smoke test / healthcheck / trace |
| 逆流防止 | 途中レイヤの依存方向が壊れていないか | structural test / custom lint |
| 回帰防止 | 既存経路を壊していないか | relevant regression suite |
| 目視不要 | 「人が読めば分かる」ではなく、機械検証だけで yes/no 判定できるか | pass/fail を返すコマンド一式 |

## 明示的に fail とする配線ミス例
- route 未登録 / handler から usecase を呼んでいない / DI container 未登録
- feature flag が常に off / migration 未適用
- フロント操作後に network request が飛ばない / 成功 toast だけ出て persistence されない
- event は publish するが consumer がいない
- E2E seed が worker / usecase を経由せず、derived 値 (`wordPositionLabel` / `whatJa` 等の
  実行時に算出されるフィールド) を直接 DB に差し込む。これは「seed → render が通る」ことしか証明せず、
  **live-derivation の証拠にならない** (実 entrypoint で導出が走らなくても seed 直焼きで緑になる)。
  derived フィールドを含む Must は、real entrypoint → usecase → DB の **integration assert** を
  別途要求する (実 generator / 実 analyzer で導出を走らせて DB state diff で確認する。incident 2026-06-13 M-104R-c)。

> 「成功 toast が出る」は証拠にならない。**reload 後 / read-back / DB state diff** まで確認する。
> 「E2E が緑」も、seed が derived 値を直焼きしているなら導出の証拠にならない。導出を走らせる経路を別途 assert する。

## 便利引数で entrypoint 到達を偽装しない (entrypoint 逐語実行)
- runtime evidence のコマンドが **wired entrypoint が渡さない引数を足している** と、便利パスだけ緑になり、
  本番が通る default-arg パスは未実行のまま false-green になる (incident 2026-06-20 drift-stage3:
  `compute_fingerprint.py --repo-root <abs>` を毎コマンドで明示 → 5-dot off-by-one の default パス crash を
  全コマンド緑が隠蔽。同型 5×: scipy dead-wiring / markdown-fence / v2 worker-crash / v2 pip-parselmouth)。
- runtime-verifier は **宣言 entrypoint を逐語実行**する: `wiring_manifest.yml` の real_entrypoint /
  `package.json` の宣言 script を、引数を足さずにそのまま叩いて観測する。`pnpm test:drift` が `--repo-root` を
  渡さないなら、verification も渡してはいけない。mock 依存・実ツールが出さない理想 payload fixture で
  代替した緑も entrypoint 到達の証拠にしない。
- これは「しばしば捏造される wiring-map に依存する静的 arg-diff grep」が脆いため **rubric (実行時 yes/no) で
  強制**する。commands.txt の各行と宣言 entrypoint の引数を突き合わせ、追加引数があれば「entrypoint 未到達・
  continue」とする。

## real_entrypoint を下流サービスのパスと取り違えない
- worker の **inbound real entrypoint** は `POST :8787/v1/pronunciation-assessments` (Servant `WorkerApi`)。
  `/v1/analyze` / `/v1/shadowing-lag` / `/v1/convert` は worker が呼ぶ **下流サービス (analyzer / golden) の
  パス** であり、worker の inbound entrypoint ではない。wiring-map の `real_entrypoint` には worker の
  inbound POST を記録し、下流クライアントが叩くパスと混同しない (incident 2026-06-14 で done-evaluator が
  spec / wiring-map の entrypoint を analyzer パスと取り違えていたのを指摘)。
- runtime-verify は real entrypoint (`POST :8787/v1/pronunciation-assessments`) から流して観測する。
  下流パスへ直 POST した結果は、worker の入口接続・中継接続の証拠にならない。
- **spec-curator チェック**: spec の受入条件 / wiring-map の `real_entrypoint` には worker の inbound
  = `POST /v1/pronunciation-assessments` (port 8787) を記録し、`/v1/analyze` (analyzer :8788) /
  `/v1/convert` (golden) 等の worker が呼ぶ下流サービスの route を worker の inbound entrypoint として
  記録しない (incident 2026-06-14 + spec draft の取り違え 2 回)。

## implementer 終了メッセージを配線証拠にしない
- implementer の終了メッセージにある「次に handler を結線する」「あとは Application.hs に足すだけ」
  のような **未来形の予告は配線証拠にならない**。実際に landed したのは予告の手前で止まっていることが多い
  (重い per-edit hook で budget 切れ早期終了したケースで頻発)。
- 終了メッセージを信用せず、**grep / build で実際に landed した結線点を確認する**。Servant なら
  `scripts/verify-servant-route-handler-parity.sh` の route 数 ↔ handler 数一致、または `cabal build`
  の成否で配線到達を yes/no 判定する。差分が残っていれば「未配線・continue」とし、残件だけ implementer に再投する。

## orchestrator の keyboard-grab は orphan 束縛を grep で確認する
- proven-done 実行中に orchestrator が implementer に dispatch せず **本番コードを直接編集** した場合、
  static-verifier は変更された本番ソース (`.hs`/`.ts`) を明示的に grep し、**orphan 化した let/where 束縛**
  — 束縛で値を計算したのに record-construction / call site の **すべて**で消費されていないもの
  (例: `acousticEvidence` 束縛を計算しながら `findingAcousticEvidence = Nothing` のまま) — が無いことを
  確認する。
- cabal `-Werror=unused-local-binds` ゲート (CAND-b2 / `haskell_unused_local_binding_dead_wiring`) が
  **PRIMARY** ライン。この Step 3.5 grep は、同等の compiler-flag による検査を持たない言語
  (例: `run-assessment-job/index.ts` に literal placeholder を残した TypeScript) 向けの **SECONDARY**
  ライン (incident 2026-06-19 ADR-018 event 1 GOP-site dead-`Nothing` / 2026-06-12 ORPHAN-1/2)。
