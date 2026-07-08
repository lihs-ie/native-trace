# Lesson: verify-*.sh の default モードが未コミット作業を空振り green で通す盲点を塞ぐ

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary (CAND-A)
`verify-{no-prod-doubles,test-bypass,no-stub-placeholder,wiring}.sh` の default (no-arg) モードは
`changed` を `git diff --name-only --diff-filter=ACMRT origin/main...HEAD` (committed diff) だけで作る。
未コミット/untracked のみの作業ツリーで base に対する committed diff が空だと走査対象ゼロになり、
**vacuously exit 0 (空振り green)** を返す。committed diff が空のときだけ working-tree
(`git diff HEAD` + `git ls-files --others --exclude-standard`) にフォールバックするよう直し、
未コミット作業も検査対象に含める。

## Trigger
- 同一盲点 2 回: memory `verify-scripts-skip-untracked.md` (2026-06-11 agent-dev run の python-analyzer
  新規実装で reviewer-integration が発見) + this-session (2026-06-17/18)。
- per-file (`$1`) モード (fitness hook) と CI (commit 済みブランチで `base...HEAD` 非空) は元から正しい。
  **default モードの未コミット作業だけ**が盲点。`origin/main` が解決でき、かつ branch を切ったばかりで
  commit が無い (または base と even だが未コミット変更がある) 状態が該当する。
- 注意: memory には「no-stub-placeholder は `git ls-files --others` で untracked を拾う」とあるが、
  これは base が解決できない `else` フォールバック分岐のみ。base (origin/main) が解決できる通常経路では
  no-stub-placeholder も `base...HEAD` を使い untracked を拾わない (memory の記述は不正確だった)。

## Verified facts (fire-check)
- 盲点条件は `BASE_REF=HEAD` で再現できる (base==HEAD → `base...HEAD` committed diff が空)。CI は常に
  非空なのでこの分岐は CI-inert。
- 修正前 (committed HEAD 版スクリプト) + 未コミット violation: **exit 0** (vacuous pass = bug 再現)。
- 修正後 violation 在: **exit 1** (FIRES、対象ファイル名を出力)。
- 修正後 clean: **exit 0**。
- per-file (`$1`) hook モード (clean file): **exit 0** (hook 経路不変)。
- CI-mode (override 無し、origin/main base、develop で 785 file の非空 committed diff): **exit 0**、
  fallback は inert (committed diff 非空なので未到達)。
- cross-check: `verify-no-prod-doubles.sh` でも violation→exit 1 / clean→exit 0。
- 全 12 copy (4 script ×3 location) の fallback ブロックは md5 一致で byte-identical。
- 証跡: `.agent-evidence/self-improve-fire-check-2026-06-18.txt`。

## 3-location propagation + chezmoi
4 スクリプトを 3 箇所に同一修正:
1. native-trace `scripts/verify-*.sh` (live repo guards)。
2. dotfiles 自身の guards `scripts/verify-*.sh` (dotfiles も kit-guarded repo)。
3. kit templates `dot_claude/skills/agent-policy-kit/templates/scripts/executable_verify-*.sh`
   (将来 scaffold される repo に伝播)。
- 挿入位置: default `else` 分岐の `changed` 算出後。3 スクリプト (no-prod-doubles/test-bypass/
  no-stub-placeholder) は `test_dir_re` 行の手前。`verify-wiring.sh` は `changed` を top-level で作り
  `[ -z "$changed" ] && { ...; exit 0; }` の early exit が直後にあるため、フォールバックを **early exit
  の手前**に置く (構造が他 3 つと違う)。per-file 分岐は不変。
- 正本 `~/.claude/docs/agent-policy.md` §3 には working-tree ルール
  (「working-tree 状態で回す決定論ゲートは未コミット変更も検査対象に含める」) が **live には既存**。
  ただし source checkout (`workspace/dotfiles` feat/loop-harness-rebuild、`.local/share/chezmoi` main)
  には未反映だったので workspace/dotfiles 側 source に追記した (live と source の drift。下記参照)。

## chezmoi drift の注意 (重要)
chezmoi の sourceDir は `/Users/lihs/.local/share/chezmoi` (branch main、stale) で、タスクが編集対象に
指定した `/Users/lihs/workspace/dotfiles` (branch feat/loop-harness-rebuild) **ではない**。live
`~/.claude/docs/agent-policy.md` は両 source より新しく、working-tree ルールと §3 blockquote を既に持つ。
このため `chezmoi apply ~/.claude/docs/agent-policy.md` を今走らせると stale source で **live の既存
ルールを削除**してしまう (chezmoi diff で確認済)。`chezmoi apply` は実行せず人間にエスカレーションした
(タスクの STOP 指示: source mismatch / apply で live を壊すなら hand-copy せず報告)。source の正本一本化
(workspace/dotfiles の feat ブランチ → main → chezmoi sourceDir 同期) を人間に依頼する。

## General rule
git diff ベースの「変更集合」を作る決定論ゲートは、**committed diff が空のとき working-tree
(`git diff HEAD` + untracked) にフォールバック**しないと、未コミット作業を空振り green で通す。
CI は commit 済みツリーで回るので影響しないが、ローカル/agent の未コミット状態で「ゲート緑」を
完了証拠にすると盲点になる。フォールバックは committed diff が空のときだけ起動すれば CI-inert。

## Promotion status (CAND-A)
- [x] 4 script ×3 location に working-tree フォールバック追加 (fallback ブロック md5 一致)
- [x] bash -n syntax OK (native-trace 4 script)
- [x] 正本 §3 working-tree ルールを workspace/dotfiles source に追記 (live ~/.claude には既存)
- [x] Recorded in rules/promoted/promoted.yml (id: verify_gate_working_tree_blindspot)
- [x] Verified: 修正前 exit 0 (vacuous) / 修正後 violation exit 1 / clean exit 0 / per-file exit 0 /
      CI-mode exit 0 (fallback inert)。証跡 .agent-evidence/self-improve-fire-check-2026-06-18.txt
- [ ] chezmoi apply: 保留 (source drift で live を壊すため人間にエスカレーション)

---

## CAND-B note: spec-curator が worker inbound と下流 route を取り違える (doc-only)
- **盲点**: spec-curator が worker の inbound entrypoint (`POST :8787/v1/pronunciation-assessments`) と、
  worker が呼ぶ下流 route (`/v1/analyze` on analyzer :8788、`/v1/convert` on golden) を取り違える。
  real_entrypoint に下流 route を記録してしまう。
- **trigger**: 2 回 (incident 2026-06-14 で done-evaluator が wiring-map entrypoint を analyzer パスと
  取り違えたのを指摘 + this-session の spec draft)。
- **昇格先 (doc-only)**: prose grep gate は FP 過多 (spec は下流 route を正当に列挙する) で不可。
  - rubric/core/wiring.md の real_entrypoint 節に spec-curator 向けチェック行。
  - rubric/core/spec.md の判定原則に Must 正規化行。
  - 正本 §2 に spec-curator 向け generic 1 行。
  - kit templates rubric/core/{wiring,spec}.md に generic 版 (native-trace の具体 route は埋め込まない)。
- **eval は保留**: §6 しきい値は同 failure class 3 回。現在 2 回のため eval は **3 回目の再発で作成**
  (evals/ ファイルは今回作らない)。
- Recorded in rules/promoted/promoted.yml (id: spec_curator_worker_route_confusion, verified_fires: false)。
