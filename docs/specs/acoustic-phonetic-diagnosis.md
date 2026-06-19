# Spec: acoustic-phonetic-diagnosis

<!-- 設計の正 / 背景:
       adr/018-acoustic-phonetic-diagnosis-formant-spectral-vot.md (Accepted, 2026-06-18)
         D1: analyzer に per-phoneme 音響計測ポート追加 (measurement-only)
         D2: parselmouth to_formant_burg を発話全体で 1 回呼び境界中点サンプリング
             max_number_of_formants=5 (定数・本数) / maximum_formant=Hz 天井 (F→6500, M|unknown→5500)
         D3: 40ms 未満ガード (f1/f2/f3=None), 重心は 30ms 未満で None
         D4: Hillenbrand 1995 ノルムを worker Scoring.hs に static map
             speakerSex='unknown' → 発話内 Lobanov z-score (母音<3 → 偏差 None)
         D5: 偏差判定・方向ラベル導出は worker Scoring.hs (scoring policy 所有)
             5 方向ラベル: tongueHeight / tongueBackness / rhoticity / sibilantPlace / vowelLength
         D6: 自然文 (messageJa) は frontend ImprovementMessageGenerator (ADR-004/017 不変)
         D7: acousticEvidence は presentation/advice 用付帯証拠、scoreImpact 不変 (二重減点なし)
         D8: Phase 0+1 は incremental landing 順序 (母音長→フォルマント)。スコープカットではない
             Compliance の runtime-verify が /r/ rhoticity + /iː/ vowelLength を要求するため
             rhoticity/sibilantPlace も本スライスに含む
         D9: closed-loop first slice と独立 (前提でも依存でもない)
     スコープ除外 (Phase 2 以降):
         vot_ms, frication_energy_ratio — 同 ADR で明示的に "本 ADR スライスでは追加しない"
     関連 ADR (contract invariant):
         ADR-004: worker が scoring を所有, analyzer は measurement-only, messageJa=null (不変)
         ADR-006: parselmouth は python-analyzer 内のみ (GPL-3.0 境界)
         ADR-009: speakerSex 値集合 'F'/'M'/'unknown' の原典
         ADR-017: ImprovementMessageGenerator / messageJa 生成分担の確立
     配線点 (agent-policy §wiring):
         python-analyzer: domain/measurement.py (PhonemeAcousticMeasurement dataclass)
         python-analyzer: usecase/ports.py (ProsodyPort.measure_phoneme_acoustics)
         python-analyzer: infrastructure/parselmouth_formant.py (新規)
         python-analyzer: infrastructure/prosody_analyzer.py (method 追加)
         python-analyzer: usecase/analyze_pronunciation.py (:95 と :97 の間に挿入)
         python-analyzer: interface/schema.py (PhonemeAcousticResponse, AnalysisResponse, AnalysisMetadata)
         python-analyzer: app.py (handler mapping)
         backend: AnalyzerClient.hs (PhonemeAcoustic + FromJSON, AnalyzerResult 拡張)
         backend: Types.hs (AcousticEvidence + ToJSON, AssessmentFinding.findingAcousticEvidence)
         backend: Scoring.hs (hillenbrandGaVowelFormants map, deriveAcousticEvidence, calibratable 定数)
         frontend: acl/pronunciation-assessment/oss-worker/schema.ts (findingSchema.acousticEvidence)
         frontend: lib/api-types.ts (AcousticEvidenceDto, EngineFindingDto.acousticEvidence)
         frontend: usecase/port/improvement-message-generator.ts (Input.acousticEvidence 追加)
         frontend: usecase/run-assessment-job/index.ts (findingDraft.acousticEvidence を渡す)
         frontend: acl/improvement-message/rule-based/ (howJa 方向ラベル分岐追加)
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI
                 ast-grep no-parselmouth-outside-python-analyzer (既存ルール適用継続)
     rebuild 注意: worker/analyzer はバイナリ焼き込み。コード変更後は
                   `docker compose up -d --build worker` が必須
                   (memory: docker-rebuild-required-for-code-changes) -->

## Goal

- 所見 (finding) に「調音方向の実測証拠」を追加し、How がテンプレートでなく学習者の実発音に即した
  articulatory-direction テキストとなることを実現する。
- analyzer (python) が生の音響計測値 (formant Hz / spectral centroid / duration) だけを返し、
  worker (Haskell) が Hillenbrand ノルムとの偏差から 5 方向ラベル (tongueHeight / tongueBackness /
  rhoticity / sibilantPlace / vowelLength) を導出し、frontend が方向ラベルを自然文 (howJa) に変換する
  三分担で ADR-004 / ADR-017 の責務境界を維持する。
- scoreImpact は一切変更せず、acousticEvidence は presentation/advice 専用の付帯証拠として機能する。

## Must (満たさなければ done でない)

### python-analyzer 計測レイヤ (D1–D3)

- [ ] **M-APD-1 (PhonemeAcousticMeasurement dataclass)**
  `applications/python-analyzer/domain/measurement.py` に frozen dataclass
  `PhonemeAcousticMeasurement(phoneme: str, start_milliseconds: int, end_milliseconds: int,
  f1_hz: float | None, f2_hz: float | None, f3_hz: float | None,
  spectral_centroid_hz: float | None, duration_milliseconds: int)` を追加すること。
  外部ライブラリ依存なしの純 dataclass であること。
  `RawMeasurementResult` に `phoneme_acoustics: tuple[PhonemeAcousticMeasurement, ...] = field(default_factory=tuple)`
  を既存フィールド末尾に追加すること（後方互換）。
  `vot_ms` / `frication_energy_ratio` は追加しないこと (Phase 2 以降)。

- [ ] **M-APD-2 (ProsodyPort.measure_phoneme_acoustics — Protocol 追加)**
  `applications/python-analyzer/usecase/ports.py` の `ProsodyPort` Protocol に
  `def measure_phoneme_acoustics(self, audio_bytes: bytes, boundaries: tuple[AlignmentBoundary, ...], sample_rate: int) -> tuple[PhonemeAcousticMeasurement, ...]: ...`
  を追加すること。Protocol が構造的型チェックを行うため、実装漏れは型エラーで検出されること。

- [ ] **M-APD-3 (parselmouth_formant.py 新規)**
  `applications/python-analyzer/infrastructure/parselmouth_formant.py` を新規作成すること。
  `extract_phoneme_acoustics(audio_bytes, boundaries, sample_rate, maximum_formant_hz) -> tuple[PhonemeAcousticMeasurement, ...]` を実装すること。
  `parselmouth_prosody.py` の遅延 import (try/except ImportError) + `_decode_samples` パターンを踏襲すること。
  `sound.to_formant_burg(time_step=0.005, max_number_of_formants=5, maximum_formant=maximum_formant_hz, window_length=0.025, pre_emphasis_from=50)` を **発話全体で 1 回**呼ぶこと (per-phoneme で呼ばない)。
  `max_number_of_formants` は本数で常に **5** (定数)、`maximum_formant` は Hz 天井で呼び出し側から受け取ること。
  各境界中点で `formants.get_value_at_time(n, midpoint_s)` を n=1,2,3 で取得し、NaN は None にすること。
  区間が **40ms 未満**のとき f1/f2/f3 を None にすること (サンプリングをスキップ)。
  スペクトル重心は scipy/numpy で計算し、区間が **30ms 未満**のとき None にすること。
  母音長は境界差分で常に算出すること。
  `parselmouth` の import はこのファイル内のみとすること (ADR-006 境界)。
  生 Hz のみを返し、ノルム比較・偏差計算をしないこと。

- [ ] **M-APD-4 (ProsodyAnalyzer.measure_phoneme_acoustics — 委譲)**
  `applications/python-analyzer/infrastructure/prosody_analyzer.py` の `ProsodyAnalyzer` に
  `measure_phoneme_acoustics(self, audio_bytes, boundaries, sample_rate)` を追加すること。
  `speakerSex` が `'F'` のとき `maximum_formant_hz=6500`、`'M'` または `'unknown'` のとき `5500` を
  `parselmouth_formant.extract_phoneme_acoustics` に渡すこと。

- [ ] **M-APD-5 (analyze_pronunciation.py 配線)**
  `applications/python-analyzer/usecase/analyze_pronunciation.py` の `execute()` で、
  `:95` の `pcm_bytes = _extract_pcm_bytes(audio)` と `:97` の f0_contour 呼び出しの間に
  `phoneme_acoustics = self._prosody.measure_phoneme_acoustics(pcm_bytes, boundaries, sample_rate)` を追加すること。
  `RawMeasurementResult(...)` 構築に `phoneme_acoustics=phoneme_acoustics` を渡すこと。
  `boundaries` は `:65` で既に scope 内にあること、`pcm_bytes` は `:95` で抽出済みであることを前提とすること。

- [ ] **M-APD-6 (schema.py — PhonemeAcousticResponse + AnalysisResponse + AnalysisMetadata)**
  `applications/python-analyzer/interface/schema.py` に以下を追加すること:
  - 新規 `PhonemeAcousticResponse(BaseModel)`: `phoneme: str`, `startMs: int`, `endMs: int`,
    `f1Hz: float | None`, `f2Hz: float | None`, `f3Hz: float | None`,
    `spectralCentroidHz: float | None`, `durationMs: int` (全 camelCase)。
  - `AnalysisResponse` に `phonemeAcoustics: list[PhonemeAcousticResponse] = Field(default_factory=list)` を追加。
  - `AnalysisMetadata` に `speakerSex: str = Field(default="unknown")` を optional 追加。
    値集合は `'F'` / `'M'` / `'unknown'` のみ (ADR-009 / stimulus/domain.py:149 と一致)。
    `'male'` / `'female'` 表記を導入しないこと。

- [ ] **M-APD-7 (app.py handler mapping)**
  `applications/python-analyzer/app.py` の `analyze()` handler で、
  `RawMeasurementResult.phoneme_acoustics` を
  `[PhonemeAcousticResponse(...) for m in result.phoneme_acoustics]` にマップし、
  `AnalysisResponse(phonemeAcoustics=...)` に渡すこと。
  composition root (`build_use_case`) の変更は不要 (既存 ProsodyAnalyzer がそのまま新 method を保有)。

### backend worker 偏差判定レイヤ (D4–D5)

- [ ] **M-APD-8 (AnalyzerClient.hs — PhonemeAcoustic + FromJSON)**
  `applications/backend/src/AnalyzerClient.hs` に新規
  `data PhonemeAcoustic = PhonemeAcoustic { acousticPhoneme :: Text, acousticStartMs :: Int, acousticEndMs :: Int, acousticF1Hz :: Maybe Double, acousticF2Hz :: Maybe Double, acousticF3Hz :: Maybe Double, acousticSpectralCentroidHz :: Maybe Double, acousticDurationMs :: Int }`
  を追加し FromJSON を実装すること。
  `f1Hz` / `f2Hz` / `f3Hz` / `spectralCentroidHz` は `.:?` で取得すること (optional)。
  `AnalyzerResult` に `analyzedPhonemeAcoustics :: [PhonemeAcoustic]` を追加し、
  FromJSON で `o .:? "phonemeAcoustics" .!= []` とすること (旧 analyzer 後方互換)。
  export list に `PhonemeAcoustic (..)` を追加すること。

- [ ] **M-APD-9 (Types.hs — AcousticEvidence + AssessmentFinding 拡張)**
  `applications/backend/src/Types.hs` に新規
  `data AcousticEvidence = AcousticEvidence { acousticTongueHeight :: Maybe Text, acousticTongueBackness :: Maybe Text, acousticRhoticity :: Maybe Text, acousticSibilantPlace :: Maybe Text, acousticVowelLength :: Maybe Text, acousticMeasuredF1Hz :: Maybe Double, acousticMeasuredF2Hz :: Maybe Double, acousticMeasuredF3Hz :: Maybe Double, acousticTargetF1Hz :: Maybe Double, acousticTargetF2Hz :: Maybe Double, acousticTargetF3Hz :: Maybe Double }`
  を追加し ToJSON を実装すること。wire key は camelCase:
  `tongueHeight` / `tongueBackness` / `rhoticity` / `sibilantPlace` / `vowelLength` /
  `measuredF1Hz` / `measuredF2Hz` / `measuredF3Hz` / `targetF1Hz` / `targetF2Hz` / `targetF3Hz`。
  `AssessmentFinding` に `findingAcousticEvidence :: Maybe AcousticEvidence` を追加し、
  ToJSON で `"acousticEvidence" .= findingAcousticEvidence finding` を出力すること。
  export list に `AcousticEvidence (..)` を追加すること。

- [ ] **M-APD-10 (Scoring.hs — Hillenbrand ノルム map)**
  `applications/backend/src/Scoring.hs` に
  `hillenbrandGaVowelFormants :: Map (Text, Text) (Double, Double, Double)`
  (key=(IPA 文字列, sex 文字列)、value=(F1, F2, F3) の Hz 平均) を追加すること。
  sex key は `'F'` と `'M'` のみ (`'unknown'` キーを持たない)。
  代表値として少なくとも /iː/ / /ɪ/ / /æ/ / /ɑ/ / /uː/ の男女別エントリを含むこと。
  ソースコメントに "Hillenbrand et al. (1995) JASA 97(5):3099-3111" を引用すること。

- [ ] **M-APD-11 (Scoring.hs — deriveAcousticEvidence: 5 方向ラベル全て)**
  `Scoring.hs` に `deriveAcousticEvidence` ヘルパーを追加し、
  `buildGopFinding` が `findingAcousticEvidence = Just (deriveAcousticEvidence ...)` を設定すること。
  calibratable 定数 (GOP しきい値と同じ場所・方針) として以下を `Scoring.hs` に定義すること:
  `ACOUSTIC_F1_SD_THRESHOLD = 1.0` / `ACOUSTIC_F2_SD_THRESHOLD = 1.0` /
  `RHOTIC_F3_MALE_HZ = 2000` / `RHOTIC_F3_FEMALE_HZ = 2300` /
  `LATERAL_F3_OVERRETROFLEX_HZ = 2500` /
  `SIBILANT_S_CENTROID_HZ = 4500` / `SIBILANT_SH_CENTROID_HZ = 3500` /
  `TENSE_LAX_DURATION_RATIO = 1.4`。
  5 方向ラベルの導出規則:
  - `tongueHeight`: F1 が正規化後ノルム +1.0 SD 超 → `"tooLow"`, −1.0 SD 未満 → `"tooHigh"`, 範囲内 → `"ok"`。
  - `tongueBackness`: F2 が +1.0 SD 超 → `"tooFront"`, −1.0 SD 未満 → `"tooBack"`, 範囲内 → `"ok"`。
  - `rhoticity`: 期待音素 /r/ で F3 ≥ `RHOTIC_F3_MALE_HZ` (M/unknown) or ≥ `RHOTIC_F3_FEMALE_HZ` (F)
    → `"insufficient"` (tap 化の疑い)。期待音素 /l/ で F3 < `LATERAL_F3_OVERRETROFLEX_HZ` → `"overRetroflex"`。
    該当しない場合 `"ok"`。(2000–2500Hz 帯は期待音素ごとに一意決定、dead zone なし)
  - `sibilantPlace`: 期待音素 /s/ でスペクトル重心 < `SIBILANT_SH_CENTROID_HZ` → `"tooPalatal"` (/ɕ/ 化)。
    期待音素 /ʃ/ でスペクトル重心 > `SIBILANT_S_CENTROID_HZ` → `"tooAlveolar"`。該当しない場合 `"ok"`。
  - `vowelLength`: tense 母音 (/iː/ / /uː/) 期待で実測長さが lax ノルム比 `TENSE_LAX_DURATION_RATIO` 未満
    → `"tooShort"`。該当しない場合 `"ok"`。
  speakerSex が `'M'` または `'F'` のとき性別別 `hillenbrandGaVowelFormants` ノルム行を使うこと。
  speakerSex が `'unknown'` のとき発話内 Lobanov z-score 正規化を行うこと。
  母音が 3 個未満で正規化不能のとき偏差を Nothing にして方向判定をスキップすること (偽陽性回避)。
  `scoreImpact` は変更しないこと (D7 — 音響偏差は減点しない)。
  speakerSex は `AnalyzerResult` 経由で渡すこと。

### frontend 型・配線レイヤ (D6)

- [ ] **M-APD-12 (oss-worker/schema.ts — findingSchema.acousticEvidence)**
  `applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts` の `findingSchema` に
  `acousticEvidence` を optional+nullable で追加すること:
  ```
  z.object({
    tongueHeight: z.enum(["tooHigh","tooLow","ok"]).nullable().optional(),
    tongueBackness: z.enum(["tooFront","tooBack","ok"]).nullable().optional(),
    rhoticity: z.enum(["insufficient","overRetroflex","ok"]).nullable().optional(),
    sibilantPlace: z.enum(["tooPalatal","tooAlveolar","ok"]).nullable().optional(),
    vowelLength: z.enum(["tooShort","ok"]).nullable().optional(),
    measuredF1Hz: z.number().nullable().optional(),
    measuredF2Hz: z.number().nullable().optional(),
    measuredF3Hz: z.number().nullable().optional(),
    targetF1Hz: z.number().nullable().optional(),
    targetF2Hz: z.number().nullable().optional(),
    targetF3Hz: z.number().nullable().optional(),
  }).nullable().optional().transform(v => v ?? null)
  ```
  response-mapper.ts で `EngineFindingDto` へそのまま転写すること。

- [ ] **M-APD-13 (lib/api-types.ts — AcousticEvidenceDto + EngineFindingDto)**
  `applications/frontend/src/lib/api-types.ts` に新規型を追加すること:
  ```typescript
  export type AcousticEvidenceDto = {
    tongueHeight: "tooHigh" | "tooLow" | "ok" | null;
    tongueBackness: "tooFront" | "tooBack" | "ok" | null;
    rhoticity: "insufficient" | "overRetroflex" | "ok" | null;
    sibilantPlace: "tooPalatal" | "tooAlveolar" | "ok" | null;
    vowelLength: "tooShort" | "ok" | null;
    measuredF1Hz: number | null;
    measuredF2Hz: number | null;
    measuredF3Hz: number | null;
    targetF1Hz: number | null;
    targetF2Hz: number | null;
    targetF3Hz: number | null;
  };
  ```
  `EngineFindingDto` に `acousticEvidence: AcousticEvidenceDto | null` を追加すること。

- [ ] **M-APD-14 (ImprovementMessageGeneratorInput — acousticEvidence 追加)**
  `applications/frontend/src/usecase/port/improvement-message-generator.ts` の
  `ImprovementMessageGeneratorInput` に `acousticEvidence?: AcousticEvidenceDto | null` を追加すること。
  既存フィールドは変更しないこと (後方互換)。

- [ ] **M-APD-15 (run-assessment-job — acousticEvidence 配線)**
  `applications/frontend/src/usecase/run-assessment-job/index.ts` の
  `generate` 呼び出し input と `generateFeedbackLayers` 呼び出し input の両方に
  `acousticEvidence: findingDraft.acousticEvidence ?? null` を渡すこと。

- [ ] **M-APD-16 (rule-based generator — howJa 方向ラベル分岐追加)**
  `applications/frontend/src/acl/improvement-message/rule-based/` の howJa 生成ロジックに
  `acousticEvidence` の方向ラベル → 日本語 articulatory 文の分岐を追加すること。
  ADR D6 例に従い、少なくとも `tongueHeight="tooLow"` / `tongueHeight="tooHigh"` /
  `tongueBackness="tooFront"` / `tongueBackness="tooBack"` / `rhoticity="insufficient"` /
  `rhoticity="overRetroflex"` / `sibilantPlace="tooPalatal"` / `sibilantPlace="tooAlveolar"` /
  `vowelLength="tooShort"` の 9 ラベルに対応する日本語テキストを定義すること。
  `acousticEvidence` が null または全ラベルが `"ok"` のとき既存 howJa を維持すること (後方互換)。
  新 UI コンポーネントを追加しないこと (テキストが既存 feedbackLayers.howJa に乗るだけ)。

### エビデンス + ポリシー (agent-policy)

- [ ] **M-APD-17 (scoreImpact 不変アサート)**
  Haskell `cabal test all` で、GOP しきい値 (`gopMajorThreshold=-12.0` / `gopMinorThreshold=-8.0`) と
  severity→scoreImpact (-5/-2) が `acousticEvidence` の有無で変わらないことを
  `Scoring.hs` の unit test で assert すること。
  `AcousticEvidence` が Just の finding と Nothing の finding で同一 GOP に対して同一 `scoreImpact` が
  返ることを少なくとも 2 ケース (major / minor) で確認すること。

- [ ] **M-APD-18 (agent-policy: 証跡)**
  本番コードに mock / stub / fake / dummy / spy / test-bypass / placeholder stub を含まないこと
  (`scripts/verify-no-stub-placeholder.sh` 緑)。
  `scripts/verify-wiring.sh` 緑。`pnpm fitness` (ast-grep + ESLint 層間依存) 緑。
  `.agent-evidence/acoustic-phonetic-diagnosis/commands.txt` /
  `.agent-evidence/acoustic-phonetic-diagnosis/wiring-map.json` /
  `.agent-evidence/acoustic-phonetic-diagnosis/completion-report.md` を提出すること。

- [ ] **M-APD-19 (rhoticity 観測性: 境界中点の単点サンプリングを多点 median に置換)**
  `parselmouth_formant.py` の formant サンプリングを、各境界の幾何中点 1 点ではなく
  区間内側 0.3〜0.7 の複数点 (5〜7 点) で `get_value_at_time(n, t)` を取り、**NaN を除いた median** を
  採ること。全点 NaN のときのみ該当 formant を None にすること。これにより、forced-alignment が
  区間を過大に伸ばし幾何中点が voicing offset を越える音素 (例: /r/ — `rt_right_analyzer.json` で
  ɹ midpoint 295ms > 有声末尾 290ms → 旧実装は NaN→null) でも、内側の有声フレームから formant を取得できる。
  40ms guard (M-APD-3) は不変。spectral centroid は区間全体計算のため不変。既存母音の formant は
  中点近傍 median ゆえ概ね不変 (既存 unit/contract を維持すること)。
  **受入条件**: (1) **多点サンプリングの観測効果 (live)**: alignment が音声内に収まる `/r/` fixture
  (例 `right__103`) を analyzer (`POST :8788/v1/analyze`) に投入し、ɹ の `phonemeAcoustics.f3Hz` が
  非 null になること (旧単点中点では当該区間が NaN→null だった)。加えて unit テストで「中点のみ voiced 外・
  内側点は voiced」の合成境界 (`right__831` の旧境界 227-363ms, midpoint 295ms>voicing 末尾 290ms) に対し
  median F3 が回復することを assert。(2) **回帰なし**: `hello_world.wav` の phonemeAcoustics non-empty
  (M-APD-7) と既存 unit/cabal/frontend テストが緑のまま。
  **注 (fixture 限界・本 Must の境界)**: rhoticity ラベルの **finding-level** live 観測には ɹ が低 GOP で
  finding 化する録音が要る (現有 fixture は native clean のため ɹ は good GOP→finding 化せず)。label 派生
  自体は ScoringSpec (F3=2200→insufficient/overRetroflex) で unit cover。また `right__831` の**現ライブ
  アライナー**は ɹ 境界を 454-727ms (audio 終端 ~460ms の外) に置く重度 alignment 膨張 (ADR-001 管轄) の
  ため当該 fixture では多点でも全点 NaN。M-APD-19 が緩和するのは『中点のみ voiced 外で内側点は voiced』
  ケースに限られ、それを unit + `right__103` で実証する。alignment 精度そのものは ADR-001 の課題。
  注: 根本原因 (forced-alignment の区間膨張、実信号 ~290ms → aligner 773ms) は ADR-001 管轄であり
  本 Must では扱わない。多点 median サンプリングは**観測性の局所緩和**である。

## Should (望ましいが必須でない)

- **S-APD-1 (40–50ms 母音の保守的判定)**: 40ms 以上 50ms 未満の母音区間では `to_formant_burg` の
  サンプリング結果が返るが、信頼性が低い。方向判定の閾値を保守的に緩める (例: ±1.5 SD) か、
  コメントで calibratable である旨を明示することが望ましい (ADR Notes risk 参照)。
- **S-APD-2 (Lobanov 正規化の SD 暴れ注記)**: `deriveAcousticEvidence` に、
  同一母音の繰り返し録音等で SD が極小になり z-score が発散するリスクを calibratable コメントで記載すること。
- **S-APD-3 (VOT 誤適用防止コメント)**: Phase 2 実装者向けに `parselmouth_formant.py` または
  `Scoring.hs` に「/v/-/b/ に VOT を適用しないこと (摩擦エネルギー比を使うこと)」を明記すること。
- **S-APD-4 (retry delta 拡張点コメント)**: `AcousticEvidence` ToJSON の付近に、
  将来 re-record 後の「フォルマントが目標方向へ動いたか」delta 表示への拡張点 (D9) をコメントで残すこと。
- **S-APD-5 (dead-path 明記: speakerSex 休眠 + rhoticity 根本原因)**: 次の読者が dead path を bug と
  誤認しないよう、以下を明記すること。(1) `Scoring.hs` の M/F 正規化分岐に「runtime では speakerSex は
  常に 'unknown' — UI 収集は Non-goal、かつ FE request-mapper と worker `AnalyzerMetadata` の 2 層で
  未配線のため M/F 分岐は runtime 到達不能 (unit のみ被覆)」。(2) `AnalyzerClient.hs` の `AnalyzerMetadata`
  付近に「speakerSex を wire に乗せていない (M/F 活性化は UI+FE+Haskell 3 層の product 判断)」。
  (3) ADR-018 Notes に rhoticity の根本原因 (alignment 膨張) は ADR-001 管轄で M-APD-19 の多点
  サンプリングは局所緩和である旨。

## 受入条件 (acceptance — Must の確認方法)

> worker/analyzer はバイナリ焼き込みのため、コード変更後は `docker compose up -d --build worker`
> および analyzer rebuild が必須 (memory: docker-rebuild-required-for-code-changes)。

- **M-APD-1** →
  `grep -n "PhonemeAcousticMeasurement\|phoneme_acoustics" applications/python-analyzer/domain/measurement.py`
  で dataclass 定義と `RawMeasurementResult` フィールド追加が確認できること。
  `grep -n "vot_ms\|frication_energy_ratio" applications/python-analyzer/domain/measurement.py` が 0 件。
  `python -c "from domain.measurement import PhonemeAcousticMeasurement; print('ok')"` が `ok` を返すこと。

- **M-APD-2** →
  `grep -n "measure_phoneme_acoustics" applications/python-analyzer/usecase/ports.py`
  で Protocol に method 定義が確認できること。
  `python -m mypy applications/python-analyzer/` または型チェックが緑であること。

- **M-APD-3** →
  `ls applications/python-analyzer/infrastructure/parselmouth_formant.py` でファイルが存在すること。
  `grep -n "max_number_of_formants=5" applications/python-analyzer/infrastructure/parselmouth_formant.py`
  で定数 5 が確認できること。
  `grep -n "parselmouth" applications/python-analyzer/infrastructure/parselmouth_formant.py` で import が存在すること。
  `grep -rn "import parselmouth" applications/python-analyzer/ | grep -v "parselmouth_formant.py"` が 0 件
  (parselmouth_formant.py 以外に parselmouth import が漏れていないこと、ADR-006 境界)。
  unit test: `boundaries` が 40ms 未満のとき `f1_hz=None` / `f2_hz=None` / `f3_hz=None` が返ること。
  unit test: `boundaries` が 30ms 未満のとき `spectral_centroid_hz=None` が返ること。
  `cabal test all` または python test runner で unit tests 緑。

- **M-APD-4** →
  `grep -n "maximum_formant_hz\|6500\|5500" applications/python-analyzer/infrastructure/prosody_analyzer.py`
  で speakerSex='F'→6500 / それ以外→5500 の分岐が確認できること。

- **M-APD-5** →
  `grep -n "measure_phoneme_acoustics\|phoneme_acoustics" applications/python-analyzer/usecase/analyze_pronunciation.py`
  で :95 と :97 の間の挿入位置に呼び出しが確認できること。
  行番号が `:95 < 挿入行 < :97` (最新ソース上で) であること。

- **M-APD-6** →
  `grep -n "PhonemeAcousticResponse\|phonemeAcoustics\|speakerSex" applications/python-analyzer/interface/schema.py`
  で 3 つの追加が確認できること。
  `grep -n "'male'\|'female'\|\"male\"\|\"female\"" applications/python-analyzer/interface/schema.py` が 0 件
  (値集合に 'male'/'female' が混入しないこと)。
  unit test: `AnalysisMetadata(speakerSex="unknown")` が正常に生成されること。
  `AnalysisMetadata(speakerSex="invalid")` が validation error を発生させること (pydantic 型制約)。

- **M-APD-7** →
  `grep -n "PhonemeAcousticResponse\|phonemeAcoustics" applications/python-analyzer/app.py`
  で handler mapping が確認できること。
  live analyzer に実録音 WAV を POST したとき `AnalysisResponse` に `phonemeAcoustics` 配列が含まれること:
  `curl -X POST http://localhost:8787/analyze -F "audio=@<wav>" | jq '.phonemeAcoustics | length'` が 1 以上。

- **M-APD-8** →
  `grep -n "PhonemeAcoustic\|analyzedPhonemeAcoustics" applications/backend/src/AnalyzerClient.hs`
  で data 定義・FromJSON・AnalyzerResult フィールド追加・export が確認できること。
  `grep -n ".:?" applications/backend/src/AnalyzerClient.hs | grep -E "f1Hz|f2Hz|f3Hz|spectral"`
  で optional パースが確認できること。
  `cabal build all` 緑。

- **M-APD-9** →
  `grep -n "AcousticEvidence\|findingAcousticEvidence\|acousticEvidence" applications/backend/src/Types.hs`
  で data 定義・ToJSON・AssessmentFinding フィールド追加・export が確認できること。
  `grep -n "tongueHeight\|tongueBackness\|rhoticity\|sibilantPlace\|vowelLength" applications/backend/src/Types.hs`
  で 5 方向ラベルの wire key が確認できること。
  `cabal build all` 緑。

- **M-APD-10** →
  `grep -n "hillenbrandGaVowelFormants\|JASA 1995\|Hillenbrand" applications/backend/src/Scoring.hs`
  で static map 定義とソースコメントが確認できること。
  `grep -n "\"male\"\|\"female\"" applications/backend/src/Scoring.hs` が 0 件
  (sex key が 'F'/'M' のみであること)。
  unit test: `hillenbrandGaVowelFormants` が ("iː", "M") / ("iː", "F") のキーを含むこと。
  `cabal test all` 緑。

- **M-APD-11** →
  `grep -n "deriveAcousticEvidence\|RHOTIC_F3_MALE_HZ\|LATERAL_F3_OVERRETROFLEX_HZ\|TENSE_LAX_DURATION_RATIO" applications/backend/src/Scoring.hs`
  で calibratable 定数と関数定義が確認できること。
  unit test (label test — ADR Compliance 参照):
  (a) 期待音素 /r/ で F3=2200Hz のとき `acousticRhoticity = Just "insufficient"` であること。
  (b) 期待音素 /l/ で F3=2200Hz のとき `acousticRhoticity = Just "overRetroflex"` であること。
  (a)(b) の両ケースを同一ユニットテストで assert すること (dead zone なし確認)。
  unit test (policy test): `acousticEvidence` が Just のとき GOP `-15` の finding の `scoreImpact` が
  `acousticEvidence` が Nothing のときと同値であること (M-APD-17 参照)。
  unit test: speakerSex='unknown' で母音が 3 個以上のとき Lobanov 正規化が実行され偏差が Just になること。
  unit test: speakerSex='unknown' で母音が 2 個以下のとき偏差が Nothing になること。
  `cabal test all` 緑。

- **M-APD-12** →
  `grep -n "acousticEvidence\|tongueHeight\|rhoticity" applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts`
  で zod スキーマが確認できること。
  unit test: worker が `acousticEvidence: { rhoticity: "insufficient", ... }` を含む JSON を返したとき、
  `findingSchema.parse(...)` が成功しかつ `acousticEvidence.rhoticity === "insufficient"` であること
  (`schema-and-response-mapper.test.ts` に追加)。
  unit test: `acousticEvidence` キーが absent な旧フォーマット JSON も `findingSchema.parse(...)` が成功すること
  (後方互換確認)。
  `pnpm test --run` 緑。

- **M-APD-13** →
  `grep -n "AcousticEvidenceDto\|acousticEvidence" applications/frontend/src/lib/api-types.ts`
  で型定義と `EngineFindingDto` フィールド追加が確認できること。
  `pnpm typecheck` 緑。

- **M-APD-14** →
  `grep -n "acousticEvidence" applications/frontend/src/usecase/port/improvement-message-generator.ts`
  で `ImprovementMessageGeneratorInput` に optional フィールドが確認できること。
  `pnpm typecheck` 緑。

- **M-APD-15** →
  `grep -n "acousticEvidence" applications/frontend/src/usecase/run-assessment-job/index.ts`
  で `generate` と `generateFeedbackLayers` の両呼び出し input に `acousticEvidence` が渡されること
  (片方のみは不可)。
  `pnpm typecheck` 緑。

- **M-APD-16** →
  `grep -n "tooLow\|tooHigh\|tooFront\|tooBack\|insufficient\|overRetroflex\|tooPalatal\|tooAlveolar\|tooShort" applications/frontend/src/acl/improvement-message/rule-based/`
  (再帰) で 9 ラベル全ての日本語分岐が確認できること。
  unit test: `acousticEvidence: { tongueHeight: "tooLow" }` を入力したとき howJa が
  rule-based テンプレートと異なる articulatory テキストを返すこと。
  unit test: `acousticEvidence: null` のとき従来の howJa が維持されること。
  `grep -n "class " applications/frontend/src/acl/improvement-message/` (再帰) が 0 件 (クラス禁止)。
  `pnpm test --run` 緑。
  新規 `.tsx` ファイルが追加されていないこと:
  `git diff --name-only HEAD -- applications/frontend/src/components/ | grep "\.tsx$"` が 0 件。

- **M-APD-17** →
  `grep -n "scoreImpact\|gopMajorThreshold\|gopMinorThreshold" applications/backend/src/Scoring.hs`
  で既存 `-12.0` / `-8.0` / `-5` / `-2` が変更されていないこと。
  `cabal test all` で ADR-004 不変アサートが緑であること。

- **M-APD-18** →
  `bash scripts/verify-no-stub-placeholder.sh` 緑 (staged または working-tree mode)。
  `bash scripts/verify-wiring.sh` 緑。
  `pnpm fitness` 緑 (ast-grep + ESLint 層間依存)。
  `.agent-evidence/acoustic-phonetic-diagnosis/` の 3 ファイルが存在すること。
  `commands.txt` に live worker への実録音投入コマンドと `acousticEvidence.rhoticity` /
  `acousticEvidence.vowelLength` の観測実値を記録すること (runtime-verify)。
  `wiring-map.json` に
  `parselmouth_formant.extract_phoneme_acoustics → prosody_analyzer → analyze_pronunciation → schema.PhonemeAcousticResponse → app.py → AnalyzerClient.hs PhonemeAcoustic → Scoring.hs deriveAcousticEvidence → Types.hs AcousticEvidence → findingSchema (zod) → AcousticEvidenceDto → run-assessment-job → rule-based howJa`
  の経路が記述されること。

### Compliance 項目 (ADR Compliance 節 → 受入条件への翻訳)

- **contract test (analyzer phonemeAcoustics)** → M-APD-7 の live curl / M-APD-3 の unit test で判定可能。
- **contract test (to_formant_burg 引数取り違え回帰防止)** → M-APD-3 の `max_number_of_formants=5` grep で判定可能。
- **contract test (speakerSex 値集合)** → M-APD-6 の `'male'/'female'` grep 0 件で判定可能。
- **contract test (worker acousticEvidence ToJSON + zod parse)** → M-APD-12 の schema test で判定可能。
- **policy test (scoreImpact 不変)** → M-APD-17 の cabal test で判定可能。
- **label test (/r/ vs /l/ dead zone なし)** → M-APD-11 の unit test (a)(b) で判定可能。
- **fitness (no-parselmouth-outside-python-analyzer)** → M-APD-3 の grep + `pnpm fitness` で判定可能。
- **runtime-verify (/r/ rhoticity + /iː/ vowelLength live 観測)** → M-APD-18 の commands.txt で判定可能。
- **Lobanov 正規化検証 (母音<3 → None)** → M-APD-11 の unit test で判定可能。

## Non-goals (今回やらない)

- **VOT 計測 (`vot_ms`)**: Phase 2 以降。本スライスでは dataclass / schema に追加しない。
- **摩擦エネルギー比 (`frication_energy_ratio`)**: Phase 2 以降。/v/-/b/ 弁別は VOT ではなく摩擦エネルギー比であることを ADR が明文化しているが、実装は Phase 2。
- **scoreImpact への音響偏差の反映**: 意図的に除外。GOP が既に減点済みで二重減点を避ける (D7)。
- **新 UI コンポーネント / 画面**: acousticEvidence の方向ラベルは既存 feedbackLayers.howJa テキストに乗る。新規 `.tsx` は追加しない。
- **話者性別の UI 選択機能**: `AnalysisMetadata.speakerSex` は API optional フィールドとして追加するが、UI で収集する動線は本スライスに含まない。
- **re-record delta 表示**: acousticEvidence の「フォルマントが目標方向へ動いたか」delta 表示は将来拡張 (D9)。first slice (ADR-022 閉ループ) とは独立。
- **closed-loop first slice (ADR-022) への依存**: 本スライスは ADR-022 の前提でも依存でもない。
- **ADR-019 AAI / ADR-020 catalog 深化 / ADR-021 LLM ナラティブとの統合**: それぞれ独立 ADR のスコープ。ただし M-LLM-8 (llm-coaching-narrative) の `ACOUSTIC` grounding フィールドは本スライス完了後に自然に供給可能になる設計。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域):
  - **クロス言語 wire 契約 (python→Haskell→TypeScript)**: 3 層にまたがる型変更。
    `PhonemeAcousticResponse (python/camelCase)` → `PhonemeAcoustic (Haskell/FromJSON)` →
    `AcousticEvidenceDto (TypeScript/zod)` の全接点で一致を保証する必要がある。
    いずれか 1 層の変更漏れで silent misparse になる。
  - **ADR-004 scoring 契約境界 (additive のみ)**: `AssessmentFinding` に `findingAcousticEvidence` を追加する。
    scoreImpact への波及を防ぐ policy test (M-APD-17) が機械検証の要となる。
    cabal `-Werror=missing-fields` で未設定フィールドがあれば build error になる
    (memory: haskell-per-edit-hook-burns-subagent-budget 参照、大 Haskell タスクは subagent 分割推奨)。
  - **ADR-006 GPL-3.0 境界 (parselmouth_formant.py 新規)**: ast-grep `no-parselmouth-outside-python-analyzer`
    が新ファイルを境界内として扱うこと (applications/python-analyzer/** は ignores 済み) を CI で確認する。
    frontend / worker に `import parselmouth` が漏れた場合 GPL 汚染リスク。
  - **D2 引数取り違え回帰**: `max_number_of_formants` (本数=5) と `maximum_formant` (Hz 天井) の混同は
    フォルマント計測が全件無効になる致命的バグ。grep で `max_number_of_formants=5` を固定確認する。
  - **speakerSex 値集合逸脱**: `'male'`/`'female'` の混入で Hillenbrand key 突き合わせが全件 miss になり
    偏差が常に Nothing になるサイレント障害。grep ゲートで防ぐ。
  - **docker rebuild 必須**: worker/analyzer コード変更後の rebuild 忘れは runtime-verify で stale イメージの
    偽 green になる (memory: docker-rebuild-required-for-code-changes)。
  - **drizzle migration 不要 (今回は該当しない)**: schema 変更は python/Haskell/TypeScript 型のみで、
    SQLite schema は変更しない。migration 忘れリスクはこのスライスでは発生しない。

## Open questions

なし。ADR-018 の D1–D9 / Contract changes / Compliance / Alternatives / Notes が全判断を確定している。
Phase 2 (vot_ms / frication_energy_ratio) のスコープカットは ADR 本文に明示されている。
calibratable 定数の初期値は ADR D5 に全て列挙されており未確定点はない。
Lobanov 正規化の母音集合抽出は `Scoring.hs:902` の `fullVowelPhonemes` を使うことが ADR に明記されており
実装判断として確定している。
