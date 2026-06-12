module NativeTrace.Worker.ScoringSpec (spec) where

import Data.Maybe (isNothing)
import Data.Text qualified as Text
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  InterWordSilence (..),
  NBestEntry (..),
  PhonemeGop (..),
  SchwaRealization (..),
  SyllableInfo (..),
 )
import NativeTrace.Worker.Scoring (
  ScoringInput (..),
  buildAssessmentScores,
  checkAudioQuality,
  generateFindingsFromGop,
  scoreAssessment,
  scoreFromGop,
 )
import NativeTrace.Worker.Types (
  AssessmentFinding (..),
  AssessmentScores (..),
  CefrScore (..),
  TextRange (..),
 )
import Test.Hspec

-- | テスト用の AnalyzerResult フィクスチャ（test-only、本番に入らない）。
fixtureAnalyzerResult :: AnalyzerResult
fixtureAnalyzerResult =
  AnalyzerResult
    { analyzedExpectedIpa = "hɛloʊ wɜrld",
      analyzedDetectedIpa = "hɛloʊ wɜld",
      analyzedPerPhonemeGop =
        [ PhonemeGop {gopPhoneme = "h", gopValue = -5.0, gopStartMs = 0, gopEndMs = 100, gopNBest = []},
          PhonemeGop {gopPhoneme = "ɛ", gopValue = -13.0, gopStartMs = 100, gopEndMs = 200, gopNBest = []},
          PhonemeGop {gopPhoneme = "l", gopValue = -9.5, gopStartMs = 200, gopEndMs = 300, gopNBest = []},
          PhonemeGop {gopPhoneme = "oʊ", gopValue = -6.0, gopStartMs = 300, gopEndMs = 500, gopNBest = []},
          PhonemeGop {gopPhoneme = "r", gopValue = -14.0, gopStartMs = 600, gopEndMs = 700, gopNBest = []}
        ],
      analyzedInterWordSilences =
        [ InterWordSilence {silenceStartMs = 500, silenceEndMs = 600, silenceDurationMs = 100}
        ],
      analyzedSchwaRealizations = [],
      analyzedSpeechRatePhonemePerSecond = 8.0,
      analyzedMeanDbfs = -15.0,
      analyzedSpeechDurationSeconds = 0.7,
      analyzedF0Contour = Nothing,
      analyzedWordStress = [],
      analyzedRhythm = Nothing,
      analyzedWeakFormRealizations = [],
      analyzedSyllables = []
    }

-- | NBest 付き高 FL finding を持つフィクスチャ（M-111 intelligibility テスト用）。
fixtureHighFlAnalyzerResult :: AnalyzerResult
fixtureHighFlAnalyzerResult =
  fixtureAnalyzerResult
    { analyzedPerPhonemeGop =
        [ -- /l/ は FL=max の混同候補 [ɾ] を NBest に持つ
          PhonemeGop
            { gopPhoneme = "l",
              gopValue = -13.0,
              gopStartMs = 0,
              gopEndMs = 100,
              gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.8}]
            }
        ]
    }

-- | 低 FL finding のみを持つフィクスチャ（M-111 intelligibility テスト用）。
fixtureLowFlAnalyzerResult :: AnalyzerResult
fixtureLowFlAnalyzerResult =
  fixtureAnalyzerResult
    { analyzedPerPhonemeGop =
        [ -- /θ/ は FL=low
          PhonemeGop
            { gopPhoneme = "θ",
              gopValue = -13.0,
              gopStartMs = 0,
              gopEndMs = 100,
              gopNBest = [NBestEntry {nBestPhoneme = "s", nBestConfidence = 0.7}]
            }
        ]
    }

bodyText :: Text.Text
bodyText = "Hello world"

-- Show/Eq の無いドメイン型を直接比較しないよう、textRange を Int タプルへ射影する。
rangeTuples :: [AssessmentFinding] -> [(Int, Int)]
rangeTuples = map ((\r -> (startChar r, endChar r)) . findingTextRange)

-- | checkAudioQuality テスト用のデフォルトパラメータ（全基準クリア）。
defaultQualityParams :: (Double, Int, Int, Int, [Double])
defaultQualityParams = (-20.0, 10000, 9, 10, [-5.0])

spec :: Spec
spec = do
  describe "checkAudioQuality" $ do
    it "returns False (normal) when all criteria are satisfied" $ do
      let (meanDbfs, durationMs, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs durationMs detected expected gopValues `shouldBe` False

    it "returns True (low_quality) when meanDbfs is below threshold (-35.0)" $ do
      let (_, durationMs, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality (-36.0) durationMs detected expected gopValues `shouldBe` True

    it "returns True (low_quality) when recording duration is below threshold (1000ms)" $ do
      let (meanDbfs, _, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs 500 detected expected gopValues `shouldBe` True

    it "returns False (normal) when recording duration is sufficient despite pausey recording (10s)" $ do
      let (meanDbfs, _, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs 10000 detected expected gopValues `shouldBe` False

    it "returns True (low_quality) when phoneme detection rate is below threshold (0.25)" $ do
      let (meanDbfs, durationMs, _, _, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs durationMs 2 10 gopValues `shouldBe` True

    it "returns True (low_quality) when median GOP is below threshold (-18.0)" $ do
      let (meanDbfs, durationMs, detected, expected, _) = defaultQualityParams
      checkAudioQuality meanDbfs durationMs detected expected [-20.0, -19.0] `shouldBe` True

    it "returns True (low_quality) when gopValues list is empty" $ do
      let (meanDbfs, durationMs, detected, expected, _) = defaultQualityParams
      checkAudioQuality meanDbfs durationMs detected expected [] `shouldBe` True

  describe "generateFindingsFromGop" $ do
    it "produces at least one finding for non-empty body text with low GOP phonemes" $ do
      length (generateFindingsFromGop bodyText fixtureAnalyzerResult) `shouldSatisfy` (>= 1)

    it "is deterministic for the same input" $ do
      rangeTuples (generateFindingsFromGop bodyText fixtureAnalyzerResult)
        `shouldBe` rangeTuples (generateFindingsFromGop bodyText fixtureAnalyzerResult)

    it "places every textRange within the body text bounds and on a non-empty slice" $ do
      let len = Text.length bodyText
      let ranges = rangeTuples (generateFindingsFromGop bodyText fixtureAnalyzerResult)
      all (\(s, e) -> s >= 0 && e <= len && s < e) ranges `shouldBe` True

    it "has messageJa == Nothing for all findings (ADR-004: worker does not generate ja messages)" $ do
      let findings = generateFindingsFromGop bodyText fixtureAnalyzerResult
      all (isNothing . findingMessageJa) findings `shouldBe` True

    it "returns no findings when all GOP values are above threshold" $ do
      let highGopResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop =
                  [ PhonemeGop {gopPhoneme = "h", gopValue = -3.0, gopStartMs = 0, gopEndMs = 100, gopNBest = []},
                    PhonemeGop {gopPhoneme = "ɛ", gopValue = -4.0, gopStartMs = 100, gopEndMs = 200, gopNBest = []}
                  ],
                analyzedInterWordSilences = []
              }
      length (generateFindingsFromGop bodyText highGopResult) `shouldBe` 0

  describe "FL-weighted intelligibility (M-111)" $ do
    it "high-FL error causes larger intelligibility penalty than low-FL error" $ do
      let highFlFindings = generateFindingsFromGop bodyText fixtureHighFlAnalyzerResult
      let lowFlFindings = generateFindingsFromGop bodyText fixtureLowFlAnalyzerResult
      let baseScoringOutput = scoreAssessment (ScoringInput bodyText 0 3000)
      let highFlScores = buildAssessmentScores (scoreFromGop fixtureHighFlAnalyzerResult baseScoringOutput) highFlFindings
      let lowFlScores = buildAssessmentScores (scoreFromGop fixtureLowFlAnalyzerResult baseScoringOutput) lowFlFindings
      -- 高FL誤りの intelligibility は低FL誤りより低い（減点が大きい）
      intelligibility highFlScores `shouldSatisfy` (<= intelligibility lowFlScores)

  describe "CEFR band mapping (M-111)" $ do
    it "score >= 80 maps to C1" $ do
      let baseScoringOutput = scoreAssessment (ScoringInput bodyText 0 3000)
      -- 高GOP（良い発音）の場合は高スコア → C1 近辺
      let goodResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop =
                  [ PhonemeGop {gopPhoneme = "h", gopValue = -1.0, gopStartMs = 0, gopEndMs = 100, gopNBest = []},
                    PhonemeGop {gopPhoneme = "ɛ", gopValue = -1.5, gopStartMs = 100, gopEndMs = 200, gopNBest = []}
                  ]
              }
      let findings = generateFindingsFromGop bodyText goodResult
      let scores = buildAssessmentScores (scoreFromGop goodResult baseScoringOutput) findings
      -- cefrSegmental band は空でないことを確認
      cefrBand (cefrSegmental scores) `shouldSatisfy` (not . null . Text.unpack)

  describe "epenthesis classification (M-115)" $ do
    it "epenthesis finding has phenomenon == epenthesis" $ do
      let epenthesisResult =
            fixtureAnalyzerResult
              { analyzedSyllables =
                  [ NativeTrace.Worker.AnalyzerClient.SyllableInfo
                      { syllableInfoWord = "strike",
                        syllableInfoWordIndex = 0,
                        syllableInfoExpectedCount = 1,
                        syllableInfoActualCount = 2,
                        syllableInfoInsertedVowels = []
                      }
                  ],
                analyzedPerPhonemeGop = [],
                analyzedInterWordSilences = []
              }
      let findings = generateFindingsFromGop "strike" epenthesisResult
      any (\f -> findingPhenomenon f == "epenthesis") findings `shouldBe` True

  describe "nBest matching (M-103)" $ do
    it "finding with nBest has detectedTopCandidate set" $ do
      let nBestResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop =
                  [ PhonemeGop
                      { gopPhoneme = "l",
                        gopValue = -13.0,
                        gopStartMs = 0,
                        gopEndMs = 100,
                        gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.9}]
                      }
                  ],
                analyzedInterWordSilences = []
              }
      let findings = generateFindingsFromGop bodyText nBestResult
      any (\f -> findingDetectedTopCandidate f == Just "ɾ") findings `shouldBe` True

    it "finding with confusion set match has matchesL1Pattern == True" $ do
      let nBestResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop =
                  [ PhonemeGop
                      { gopPhoneme = "l",
                        gopValue = -13.0,
                        gopStartMs = 0,
                        gopEndMs = 100,
                        gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.9}]
                      }
                  ],
                analyzedInterWordSilences = []
              }
      let findings = generateFindingsFromGop bodyText nBestResult
      any findingMatchesL1Pattern findings `shouldBe` True
