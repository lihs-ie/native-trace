# Lesson: Dockerfile のハードコード pip list は「ファイル共変更」では検査できない (CONTENT を見る)

<!-- memory/lessons/<date>-<slug>.md。1 lesson 1 file。誤りと判明したら削除、重複は更新。 -->

## One-line summary
python-analyzer / golden-speaker の Dockerfile は pyproject ではなくハードコード pip list で依存を焼き込むため、src が import する third-party を pyproject に足しても Dockerfile の pip 行に追記し忘れると image に入らず、起動時 import の `ModuleNotFoundError` が broad except に握り潰され silent runtime dead-wiring になる。`scripts/verify-analyzer-deps.sh` が import→distribution を解決し Dockerfile の pip 行 CONTENT と突合する。

## Trigger
2 回再発した P0 クラス:
- kokoro 2026-06-12 (memory `python-analyzer-dockerfile-hardcoded-pip`): TTS 依存が image 未反映で 500。
- scipy 2026-06-19 (incident ADR-018 acoustic-phonetic-diagnosis、event 2): `parselmouth_formant.py` が
  spectral centroid に scipy を import。`scipy>=1.11.0` は pyproject にあったが analyzer Dockerfile の
  pip list に無し。`docker compose up -d --build` 後 image に scipy が無く request 時 `ModuleNotFoundError` →
  broad `except Exception` が utterance 全体に `()` を返し `phonemeAcoustics: []` → worker `acousticEvidence: null`。
  cabal build / unit test (parselmouth を mock・dep 欠如時 pytest.skip) / 全 verify-*.sh / static-verifier /
  spec-grader は全部緑。runtime-verifier だけが live worker に実 WAV を POST して `acousticEvidence` 非 null を
  assert し捕捉。

## Verified facts
- 既存 wiring rule `python-analyzer-pyproject-needs-dockerfile` は pyproject↔Dockerfile の *ファイル共変更*
  しか見ず、Dockerfile を diff に含めれば OK を返す。pip 行に当該 distribution が入ったかは検査しない。
  → co-change しても pip 行への追記漏れを通すギャップ。これが本クラスの盲点。
- `scripts/verify-analyzer-deps.sh` (純静的、Docker 不要) を追加。src の top-level import を収集 →
  stdlib (host python `sys.stdlib_module_names`、無ければ維持リスト) と first-party
  (python_analyzer/golden_speaker/相対) を除外 → `scripts/module-to-dist.txt` で module→distribution 解決
  (parselmouth→praat-parselmouth / rvc_python→rvc-python 等の renaming 含む) → Dockerfile の pip install
  ブロックを解析した installed 集合 (∪ `scripts/base-image-pip-allowlist.txt`) と突合。
- **silent-skip 禁止 (rollback trap)**: stdlib でも first-party でも mapping にも無い module は FAIL させる。
  「未知は skip」にすると盲点を再生産する。未登録 third-party import probe で exit 1 を実証済。
- fire-check: clean → 両サービス OK で exit 0。python-analyzer Dockerfile から scipy pip 行を一時削除 →
  exit 1 で scipy のみを正確に指摘 (他 dep に FP なし)。restore → exit 0。実コマンドで確認。
- base-image-pip-allowlist は golden-speaker の numpy / praat-parselmouth (rvc-python==0.1.5 の pinned
  transitive) のみ。各行に理由コメント。無期限 allowlist は作らない。

## General rule
Dockerfile がハードコード pip list で依存を焼き込むサービスでは、「pyproject に足した」「Dockerfile を
共変更した」は image に dep が入った証拠にならない。src の実 import を distribution に解決し Dockerfile の
pip 行 CONTENT と突合する static gate を CI / fitness で要求する。新しい third-party を import したら
`module-to-dist.txt` に 1 行追加する (未登録は FAIL)。import 失敗を握り潰す broad except は fail-open。

## Promotion status
- [x] Added static content gate (scripts/verify-analyzer-deps.sh + module-to-dist.txt + base-image-pip-allowlist.txt)
- [x] Wired into fitness hook (scripts/agent-policy-hook.sh、両サービス src/**/*.py 編集時)
- [x] Wired into CI (.github/workflows/pr-gate.yml policy job、tree 全体)
- [x] Recorded in rules/promoted/promoted.yml (id: analyzer_dockerfile_dep_content_gap)
- [ ] eval 候補 (post-build Docker smoke: 既知 multi-vowel WAV を POST し phonemeAcoustics 長さ>=1 を assert、
      incident candidate #2) は未実装 — runtime/Docker が要るため別タスク
