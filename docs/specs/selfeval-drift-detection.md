# Spec: selfeval-drift-detection

<!-- 設計の正 / 背景:
       adr/031-full-cycle-e2e-test-harness-and-deterministic-fixtures.md
         D12-(2): drift 検出[自動]: analyzerCommit 変化 または Dockerfile pip-list hash 変化で
                  pinned case を再実行し pin と diff、benign は記録のみ（auto re-pin 禁止）
         D12-(3): regression[escalate]: sign-flip / enum 変化 / 所見 appear-disappear は human gate
         D12-(5): self-improve report: drift 状態・分類・escalate 判定を machine+human 読み形式で出力
     前提スライス（実装済み）:
         applications/python-analyzer/test/selfeval/run_selfeval.py — Loop-A self-eval harness
         applications/python-analyzer/test/fixtures/corpus/manifest.json — corpus manifest
         applications/frontend/test/fullcycle/driver.ts — tier-1 full-cycle driver
         root package.json test:fullcycle — entrypoint
     配線点 (agent-policy):
         python-analyzer: applications/python-analyzer/test/selfeval/compute_fingerprint.py（新規）
         python-analyzer: applications/python-analyzer/test/selfeval/drift_check.py（新規）
         python-analyzer: applications/python-analyzer/test/fixtures/corpus/manifest.json
                          observed.analyzerCommit の placeholder を LIVE 値で置換する経路を確立
         wiring_manifest.yml または root package.json: test:drift スクリプト（または test:fullcycle に統合）
     強制レイヤ: scripts/agent-policy-hook.sh / CI pr-gate.yml / verify-*.sh（既存）
                 Scoring.hs は本スライスで byte-unchanged（drift-check は読み取り専用）
     rebuild 注意: worker/analyzer はバイナリ焼き込み。fingerprint 計算は live イメージに対して実行すること
                   (memory: docker-rebuild-required-for-code-changes)
     driver.ts の ORPHAN-1 注意: nBest は worker→DB コントラクトに乗らない。
                   confidence 測定は /v1/analyze 直接呼び出しで取得する（run_selfeval.py 参照）。 -->

## Goal

- `analyzerCommit`（docker イメージ digest + Dockerfile pip-list hash の複合指紋）の変化を検出したとき、
  pinned self-eval corpus case を live `/v1/analyze` に対して再実行し、
  fresh 観測値と manifest pin を比較して **benign（帯域内ドリフト）** と **regression（符号反転・enum 変化・所見出没）** に分類する。
- regression 検出時は非ゼロ exit + 人間可読レポートでエスカレーションし、
  benign は記録のみ（auto re-pin しない）。
- 指紋一致時はスキップ（再実行コストゼロ）、指紋不一致時のみ再実行することで
  dep bump 起因の dead-wiring（incidents/2026-06-19-adr018-scipy-dockerfile-runtime-dead-wiring.md の再演）を自動検出する。

---

## Must（満たさなければ done でない）

### M-DRIFT-1（analyzer 指紋の計算と manifest への書き込み経路）

`applications/python-analyzer/test/selfeval/compute_fingerprint.py` を新規作成すること。
以下の 2 要素を組み合わせた単一文字列指紋を計算し返す関数 `compute_fingerprint(repo_root: str) -> str` を実装すること:

1. **docker イメージ digest**: `docker inspect native-trace-analyzer --format '{{.Id}}'` を実行して取得した
   `sha256:...` 文字列。analyzer コンテナが起動していない場合は `None`（指紋 absent）とし、
   呼び出し元でエラーとして扱うこと。
2. **Dockerfile pip-list hash**: `applications/python-analyzer/Dockerfile` の全行のうち
   `pip install` または `pip3 install` が含まれる行を抽出し、SHA-256 を計算した hex 文字列
   （memory: analyzer-dockerfile-hardcoded-pip — analyzer の依存は pyproject ではなく
   Dockerfile に直書きされている）。

最終指紋の形式: `"docker:<sha256>|pip:<hex>"`（パイプ区切り、両要素必須）。

`manifest.json` の `entries[*].observed.analyzerCommit` にこの指紋を書き込む
`write_fingerprint_to_manifest(manifest_path: str, fingerprint: str) -> None` を実装すること。
この関数を `--write` フラグ付きで CLI から呼び出せること:

```
python3 applications/python-analyzer/test/selfeval/compute_fingerprint.py --write
```

を実行したとき、manifest の `analyzerCommit` placeholder が LIVE 指紋で上書きされること。

### M-DRIFT-2（指紋変化トリガーによる pinned case 再実行）

`applications/python-analyzer/test/selfeval/drift_check.py` を新規作成すること。
以下のシーケンスを実装すること:

1. `compute_fingerprint()` で LIVE 指紋を計算する。
2. `manifest.json` の `entries[*].observed.analyzerCommit` を読み出し、pinned 指紋と比較する。
3. **LIVE 指紋 == pinned 指紋** の場合: `DRIFT fingerprint=match status=skip` を stdout に出力し、
   再実行なしで exit 0 する。
4. **LIVE 指紋 != pinned 指紋** の場合: pinned corpus case ごとに `POST /v1/analyze` を実行し、
   fresh 観測値（gop band / severity / findingFires / topNBest / confidenceMeasurement）を収集する。
   各 case は `manifest.json` の `observed` ブロックと照合する（M-DRIFT-4 で分類する）。

### M-DRIFT-4（benign vs regression 分類とエスカレーション）

M-DRIFT-2 で収集した fresh 観測値を以下の基準で分類すること。

> **計測レイヤの境界（analyzer contract に基づく確定事項）**: drift-check は analyzer の
> `POST /v1/analyze` を叩く analyzer-level sentinel である。`AnalysisResponse` は
> `perPhonemeGop[*].{gop, nBest}` / `detectedIpa` / `estimatedSnrDb` を返すが、
> **`severity` / `findingFires` は返さない**（それらは worker = Scoring.hs が gop から導出する
> worker-level 出力）。したがって drift-check は **analyzer が実際に emit する信号のみ**を比較する。
> `severity` / `findingFires` のドリフトは gop ドリフトの下流結果であり、gop sentinel が上流で捕捉する。
> worker-level の `observed.severity` / `observed.findingFires` は manifest に pin されたまま
> full-cycle harness（driver.ts → worker）のスコープに残し、本 analyzer sentinel は触れない。

**HARD regression トリガー（いずれかで escalate / exit 1）**:

- `gop` の符号が反転する（pinned band が全負なのに fresh が正、またはその逆）。
- `gop` が pinned band を margin（既定 ε=2.0 GOP）を超えて外れる（同符号でも band 外の大幅逸脱）。
- レスポンス構造が変化する（`perPhonemeGop` / `detectedIpa` 等のフィールド消失・型変化・`nBest` 空）。

**topNBest IPA 変化 = ADVISORY（majority-gated）**:

analyzer の nBest top-1 は拡散 CTC に起因して diffuse である（`rawTop1Conf=0.0142` / 2026-06-20 実測）。
1 position の変化は per-run ノイズに相当し、HARD トリガーとして扱うと誤検知が発生する。
したがって topNBest IPA 変化は多数決ゲートで評価する:

- 変化位置数 ≥ `ceil(N/2)`（例: 8 phonemes なら ≥ 4）→ **escalate**（regression）。
  これは scipy-incident class（モデルスワップで全音素の CTC 分布が変化）を検出する。
- 変化位置数 < `ceil(N/2)` → **benign + advisory のみ**。
  per-position の diff を `advisoryIpaDrift` としてレポートに記録するが、escalation しない。

**benign 条件（すべてを満たす場合 benign）**:

- HARD トリガー（gop sign-flip / gop out-of-band / structure broken）が不成立。
- topNBest IPA 変化位置数が majority 未満（minority ドリフトは benign、advisory 記録のみ）。
- レスポンス構造が intact（`perPhonemeGop` / `detectedIpa` / 各 phoneme の `nBest` 非空が存在）。

**escalation**:

- regression が 1 件以上ある場合: 非ゼロ exit（exit 1）+ M-DRIFT-5 の human-readable report を出力すること。
- benign のみの場合: exit 0 + 記録のみ（auto re-pin しないこと）。

### M-DRIFT-5（drift 状態レポートの出力）

M-DRIFT-2/4 の実行後、以下を両方の形式で出力すること。

**machine-readable（JSON）**:

`applications/python-analyzer/test/selfeval/drift_report.json`（または stdout への JSON dump）として、
以下のフィールドを含む JSON を出力すること:

```json
{
  "fingerprintLive": "<docker:sha256|pip:hex>",
  "fingerprintPinned": "<manifest 値>",
  "fingerprintMatch": true | false,
  "reruns": [
    {
      "entryIdentifier": "<manifest entry id>",
      "classification": "benign" | "regression" | "skip",
      "freshVsPinned": {
        "gop": { "fresh": { "min": ..., "max": ... }, "pinned": { "min": ..., "max": ... }, "inBand": true | false, "signFlip": true | false },
        "topNBest": {
          "fresh": [...],
          "pinned": [...],
          "match": true | false,
          "advisoryIpaDrift": { "changedPositions": 0, "total": 8, "escalated": false }
        },
        "detectedIpa": { "fresh": "...", "structureIntact": true | false }
      }
    }
  ],
  "escalate": true | false,
  "regressionCount": 0
}
```

**human-readable（stdout テキスト）**:

各 entry につき 1 行の verdict を出力すること:

```
DRIFT <entryIdentifier> <benign|regression|skip> fingerprint=<match|mismatch> classification=<benign|regression>
```

regression があれば続けて人間可読の diff を出力すること（例: `  gop sign-flip: h phoneme -6.6 -> +2.1`）。

### M-DRIFT-WIRING（実行可能配線と受入可能 entrypoint）

以下のいずれかを満たすこと（どちらでも可）:

- root `package.json` に `"test:drift": "pnpm --filter @native-trace/frontend exec python3 ..."` を追加し、
  `pnpm test:drift` で drift_check.py が実行される。
- または、`pnpm test:fullcycle` が drift_check.py を self-eval シーケンスに含める（driver.ts の shell-out 拡張）。

`wiring_manifest.yml` に `drift-check` エントリ（または既存 `practice-attempts` エントリへの `smoke:` 追記）を宣言すること。

---

## Should（望ましいが必須でない）

- **S-DRIFT-1（テスト可能な指紋比較）**: 指紋変化を mocked Dockerfile で unit test できるよう、
  `compute_fingerprint` の Dockerfile hash 計算を純粋関数（ファイルパスを引数に取る）にする。
  `pytest applications/python-analyzer/test/` が docker 依存なしで指紋計算部分をカバーできること。
- **S-DRIFT-2（benign ドリフトの累積記録）**: benign 分類時に fresh 観測値を
  `applications/python-analyzer/test/selfeval/drift_history.jsonl` に追記し、
  後続の人間による手動 re-pin の根拠データとして保存する。
- **S-DRIFT-3（Dockerfile pip-list 変化の早期警告）**: pip-list hash のみが変化して
  docker digest が変わらないケース（Dockerfile 更新後の未 rebuild 状態）を警告として出力する。
- **S-DRIFT-4（複数 corpus entry への対応）**: manifest に entry が複数ある場合、
  各 entry を独立に再実行・分類し、全 entry の結果を集約してエスカレーション判定すること。

---

## 受入条件（acceptance — Must の確認方法）

> worker/analyzer はバイナリ焼き込みのため、runtime verify 前に
> `docker compose up -d --build --wait` が必須（memory: docker-rebuild-required-for-code-changes）。
> 合否は yes/no で機械判定する。

### M-DRIFT-1 の確認

```
ls applications/python-analyzer/test/selfeval/compute_fingerprint.py
# ファイルが存在すること

grep -n "compute_fingerprint\|write_fingerprint_to_manifest" \
  applications/python-analyzer/test/selfeval/compute_fingerprint.py
# 両関数の定義が存在すること

grep -n "docker inspect\|pip install\|sha256\|pip:" \
  applications/python-analyzer/test/selfeval/compute_fingerprint.py
# docker inspect 呼び出しと pip-list hash 計算が実装されていること

python3 applications/python-analyzer/test/selfeval/compute_fingerprint.py --write
# exit 0 で終了し、以下が成立すること:

python3 -c "
import json
with open('applications/python-analyzer/test/fixtures/corpus/manifest.json') as f:
    m = json.load(f)
commit = m['entries'][0]['observed']['analyzerCommit']
assert commit.startswith('docker:'), f'not a live fingerprint: {commit}'
assert 'pip:' in commit, f'missing pip hash: {commit}'
print('PASS analyzerCommit=', commit)
"
# PASS が出力され、analyzerCommit が "docker:sha256...|pip:..." 形式であること
# (placeholder 文字列 "2026-06-20-first-run — TODO:" を含まないこと)
```

### M-DRIFT-2 の確認

```
ls applications/python-analyzer/test/selfeval/drift_check.py
# ファイルが存在すること

grep -n "compute_fingerprint\|analyzerCommit\|POST.*analyze\|fingerprintMatch\|skip" \
  applications/python-analyzer/test/selfeval/drift_check.py
# 指紋比較・skip分岐・POST /v1/analyze 呼び出しが実装されていること
```

**指紋一致時のスキップ確認（シミュレーション）**:

```
# manifest の analyzerCommit を LIVE 指紋に合わせた状態で実行
python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788
# stdout に "DRIFT fingerprint=match status=skip" を含む行が出力され、exit 0 であること
```

**指紋不一致時の再実行トリガー確認（シミュレーション）**:

```
# manifest の analyzerCommit を意図的に不一致な値に書き換えて実行
python3 -c "
import json, pathlib
p = pathlib.Path('applications/python-analyzer/test/fixtures/corpus/manifest.json')
m = json.loads(p.read_text())
m['entries'][0]['observed']['analyzerCommit'] = 'docker:sha256:DUMMY_OLD|pip:DUMMY_OLD'
p.write_text(json.dumps(m, indent=2))
print('manifest patched to mismatch fingerprint')
"

python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788
# stdout に "fingerprint=mismatch" を含む行が出力されること
# (manifest を元の LIVE 指紋に戻すこと — git checkout で可)
```

### M-DRIFT-4 の確認

**regression エスカレーション確認 — gop sign-flip（シミュレーション）**:

```
# manifest の gop.band を正値に書き換えて gop sign-flip regression を注入する
python3 -c "
import json, pathlib
p = pathlib.Path('applications/python-analyzer/test/fixtures/corpus/manifest.json')
m = json.loads(p.read_text())
m['entries'][0]['observed']['gop']['band'] = {'min': 2.0, 'max': 10.0}
m['entries'][0]['observed']['analyzerCommit'] = 'docker:sha256:DUMMY_OLD|pip:DUMMY_OLD'
p.write_text(json.dumps(m, indent=2, ensure_ascii=False))
print('manifest patched to gop sign-flip regression')
"

python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788
# exit code が 1 であること: echo $? → 1
# stdout に "regression" を含む行が出力されること
# stdout に "gop sign-flip" を含む行が出力されること
# (manifest を git checkout で元に戻すこと)
```

**regression エスカレーション確認 — majority IPA 変化（シミュレーション）**:

```
# manifest の topNBest.phonemes を全て 'ZZZ' に書き換えて majority IPA 変化 regression を注入する
# (8/8 = majority ≥ ceil(8/2)=4 → escalated)
python3 -c "
import json, pathlib
p = pathlib.Path('applications/python-analyzer/test/fixtures/corpus/manifest.json')
m = json.loads(p.read_text())
m['entries'][0]['observed']['topNBest']['phonemes'] = ['ZZZ','ZZZ','ZZZ','ZZZ','ZZZ','ZZZ','ZZZ','ZZZ']
m['entries'][0]['observed']['analyzerCommit'] = 'docker:sha256:DUMMY_OLD|pip:DUMMY_OLD'
p.write_text(json.dumps(m, indent=2, ensure_ascii=False))
print('manifest patched to simulate majority IPA-change regression')
"

python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788
# exit code が 1 であること: echo $? → 1
# stdout に "regression" を含む行が出力されること
# stdout に "DRIFT <entryIdentifier> regression" を含む行が出力されること
# (manifest を git checkout で元に戻すこと)
```

**minority IPA 変化は benign（advisory のみ）確認（シミュレーション）**:

```
# manifest の topNBest.phonemes[0] のみ 'ZZZ' に書き換えて minority IPA 変化を注入する
# (1/8 = minority < ceil(8/2)=4 → advisory のみ、escalation なし)
python3 -c "
import json, pathlib
p = pathlib.Path('applications/python-analyzer/test/fixtures/corpus/manifest.json')
m = json.loads(p.read_text())
m['entries'][0]['observed']['topNBest']['phonemes'][0] = 'ZZZ'
m['entries'][0]['observed']['analyzerCommit'] = 'docker:sha256:DUMMY_OLD|pip:DUMMY_OLD'
p.write_text(json.dumps(m, indent=2, ensure_ascii=False))
print('manifest patched to simulate minority IPA-change advisory')
"

python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788
# exit code が 0 であること: echo $? → 0
# stdout に "benign" を含む行が出力されること
# stdout に "advisoryIpaDrift" を含む行が出力されること（advisory 記録）
# stdout に "DRIFT.*regression" が含まれないこと
# (manifest を git checkout で元に戻すこと)
```

**benign ドリフト時の exit 0 確認（analyzerCommit のみ不一致 / シミュレーション）**:

```
# manifest の analyzerCommit のみ不一致にし、gop は帯域内・topNBest は一致のままにする
python3 -c "
import json, pathlib
p = pathlib.Path('applications/python-analyzer/test/fixtures/corpus/manifest.json')
m = json.loads(p.read_text())
m['entries'][0]['observed']['analyzerCommit'] = 'docker:sha256:DUMMY_OLD|pip:DUMMY_OLD'
p.write_text(json.dumps(m, indent=2, ensure_ascii=False))
print('manifest patched to fingerprint mismatch only')
"

python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788
# exit code が 0 であること: echo $? → 0
# stdout に "benign" を含む行が出力されること（regression 行が出ないこと）
# stdout に "DRIFT.*benign" が含まれ "DRIFT.*regression" が含まれないこと
# (manifest を git checkout で元に戻すこと)
```

### M-DRIFT-5 の確認

```
# drift_check.py を指紋不一致状態で実行後
python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788 \
  --report drift_report.json
# drift_report.json が生成され、以下のフィールドが存在すること:

python3 -c "
import json, sys
with open('drift_report.json') as f:
    r = json.load(f)
assert 'fingerprintLive' in r
assert 'fingerprintPinned' in r
assert 'fingerprintMatch' in r
assert 'reruns' in r
assert 'escalate' in r
assert 'regressionCount' in r
print('PASS machine-readable schema check')
"

# human-readable: stdout に DRIFT 行が出力されること
# regression 時: stdout に diff 記述行が出力されること（grep で確認）
grep -E "^DRIFT " <(python3 applications/python-analyzer/test/selfeval/drift_check.py \
  --analyzer-url http://localhost:8788 2>/dev/null)
# 1 行以上の DRIFT 行が確認できること
```

### M-DRIFT-WIRING の確認

```
# root package.json または wiring_manifest.yml で宣言されていること
grep -n "test:drift\|drift.check\|drift_check" package.json wiring_manifest.yml
# 1 件以上マッチすること（test:drift script または wiring_manifest smoke エントリ）

# pnpm test:drift または pnpm test:fullcycle から実行可能であること
pnpm test:drift || pnpm test:fullcycle
# exit 0 で終了すること（live analyzer 起動済み前提、指紋一致状態なら status=skip で OK）
```

### Scoring.hs byte-unchanged の確認

```
git diff applications/backend/src/NativeTrace/Worker/Scoring.hs
# 出力が 0 行（empty）であること

bash scripts/verify-no-stub-placeholder.sh
bash scripts/verify-no-prod-doubles.sh
bash scripts/verify-wiring.sh
# 全て exit 0 であること

pnpm fitness
pnpm lint
pnpm typecheck
# 全て exit 0 であること
```

---

## Non-goals（今回やらない）

- **M-DRIFT-3 auto re-pin**: benign ドリフト時の manifest `analyzerCommit` / `observed` 自動更新は
  corpus N が増えるまで保留。benign は記録のみ、re-pin は人間が手動で行う。
- **生産スコアリングへの自動介入**: `Scoring.hs` / `checkAudioQuality` / GOP 式を
  drift-check が編集・提案することは禁止。drift-check は read-only observer である。
- **Stage-4 harness-maintainer auto-calibration**: accumulated 信号から Scoring.hs 定数を自動 propose する
  `harness-maintainer` サブシステムは後続スライス（ADR-031 D12-(4)）。本スライスでは実装しない。
- **model retraining / Loop-B**: wav2vec2 GOP モデルの再学習・fine-tuning は Loop-B（human-gate）。
  drift-check の regression 信号をそのままモデル更新に使わない（ADR-031 D11 / ADR-004）。
- **既存 self-eval ファミリのロジック変更**: gain_invariance / noise_monotonicity / flip_directionality /
  confidence_measurement / calibration_ece の判定ロジックを本スライスで改変しない。
  drift-check はその pinned observed を**監視**するだけである。
- **cloud / remote infra**: drift-check はローカル docker のみで完結する。外部 API・クラウドストレージは使わない。
- **CI 組み込み（nightly / label-gated）**: cold analyzer build（start_period:180s）を CI に組み込む
  `fullcycle.yml` workflow は後続スライス。本スライスは local-first（runtime-verifier invoke）。
- **auto re-pin on benign**: drift が帯域内であってもスクリプトが自動で manifest を書き換えることは禁止。
  人間が `compute_fingerprint.py --write` を明示的に実行したときのみ pin が更新される。

---

## Risk

- level: **low**
- escalate_to_opus: **false**
- 理由:
  - 本スライスは **test scope 専用**（`applications/python-analyzer/test/selfeval/` のみ）であり、
    本番経路（Scoring.hs / AnalyzerClient.hs / assessment_results / UI）には一切書き込まない。
  - drift-check が持つ唯一の副作用は（a）manifest の `analyzerCommit` への指紋書き込み（`--write` 明示時のみ）、
    および（b）`drift_report.json` への JSON 書き出しのみ。
  - regression のエスカレーション権限は「非ゼロ exit + human-readable レポート出力」に限定され、
    自動 revert・自動 repin・Scoring.hs 編集は一切行わない。
  - **guardrail（機械強制）**: `Scoring.hs` への diff が agent commit に含まれた場合、
    既存 `scripts/verify-*.sh`（`orchestrator_hand_edit` net 同型、ADR-031 D12-(4)）が検出しブロックする。
    drift-check は `Scoring.hs` を import せず、触れる設計でもない。
  - cross-layer 呼び出しは `POST /v1/analyze`（読み取り専用 HTTP）のみ。
    `docker inspect` によるメタデータ取得も読み取り専用。
  - 新規ファイルは 2 本（`compute_fingerprint.py` / `drift_check.py`）と `wiring_manifest.yml` への 1 エントリのみ。
    既存ファイル `manifest.json` の `analyzerCommit` フィールドへの書き込みは `--write` 明示時かつ test scope 内。

---

## 配線点（wiring points）

| レイヤ | ファイル | 変更種別 |
|---|---|---|
| python-analyzer test | `applications/python-analyzer/test/selfeval/compute_fingerprint.py` | 新規 |
| python-analyzer test | `applications/python-analyzer/test/selfeval/drift_check.py` | 新規 |
| python-analyzer fixture | `applications/python-analyzer/test/fixtures/corpus/manifest.json` | `analyzerCommit` placeholder の LIVE 値置換（`--write` 実行時） |
| root scripts | `package.json` `test:drift`（または `wiring_manifest.yml` smoke エントリ） | 新規追加 |
| fullcycle driver（任意） | `applications/frontend/test/fullcycle/driver.ts` | drift_check.py shell-out の追加（S-DRIFT-4 以降、任意） |

`run_selfeval.py` と `driver.ts` の既存ロジックは変更しない（read-only 参照のみ）。

---

## Open questions

なし。ADR-031 D12 の Stage-3 drift detection スコープは確定済みであり、
未確定点は存在しない。benign auto re-pin（M-DRIFT-3）は明示 Non-goal として決定済み。
