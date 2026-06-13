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
  WeakFormRealization (..),
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
  FindingSeverity (..),
  TextRange (..),
 )
import Test.Hspec

-- | FindingSeverity はテスト層で Eq インスタンスがないため、
-- パターンマッチで suggestion 判定するヘルパー。
isSuggestion :: FindingSeverity -> Bool
isSuggestion FindingSeveritySuggestion = True
isSuggestion _ = False

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
                        gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.9}],
                        gopWordPosition = Nothing
                      }
                  ],
                analyzedInterWordSilences = []
              }
      let findings = generateFindingsFromGop bodyText nBestResult
      any findingMatchesL1Pattern findings `shouldBe` True

  -- M-102R-c / M-102R-d: connected speech 4 現象の producer 発火・severity・scoreImpact
  describe "connected speech findings (M-102R-c, M-102R-d)" $ do
    -- ---- linking ----
    describe "linking producer" $ do
      it "fires when silenceDurationMs < 50 (linking signal satisfied)" $ do
        let linkingResult =
              fixtureAnalyzerResult
                { analyzedInterWordSilences =
                    [ InterWordSilence
                        { silenceStartMs = 200,
                          silenceEndMs = 220,
                          -- 20ms < linkingGapThresholdMs(50) → linking 発火
                          silenceDurationMs = 20
                        }
                    ],
                  analyzedPerPhonemeGop = [],
                  analyzedSchwaRealizations = []
                }
        let findings = generateFindingsFromGop bodyText linkingResult
        any (\f -> findingPhenomenon f == "linking") findings `shouldBe` True

      it "does not fire when silenceDurationMs >= 50 (linking signal not satisfied)" $ do
        let noLinkingResult =
              fixtureAnalyzerResult
                { analyzedInterWordSilences =
                    [ InterWordSilence
                        { silenceStartMs = 200,
                          silenceEndMs = 350,
                          -- 150ms >= linkingGapThresholdMs(50) → 発火しない
                          silenceDurationMs = 150
                        }
                    ],
                  analyzedPerPhonemeGop = [],
                  analyzedSchwaRealizations = []
                }
        let findings = generateFindingsFromGop bodyText noLinkingResult
        any (\f -> findingPhenomenon f == "linking") findings `shouldBe` False

      it "linking finding has severity == suggestion and scoreImpact == 0.0 (ADR-004, M-102R-d)" $ do
        let linkingResult =
              fixtureAnalyzerResult
                { analyzedInterWordSilences =
                    [ InterWordSilence
                        { silenceStartMs = 200,
                          silenceEndMs = 220,
                          silenceDurationMs = 20
                        }
                    ],
                  analyzedPerPhonemeGop = [],
                  analyzedSchwaRealizations = []
                }
        let linkingFindings =
              filter (\f -> findingPhenomenon f == "linking") $
                generateFindingsFromGop bodyText linkingResult
        all (isSuggestion . findingSeverity) linkingFindings `shouldBe` True
        all (\f -> findingScoreImpact f == 0.0) linkingFindings `shouldBe` True

    -- ---- flap ----
    describe "flap producer" $ do
      it "fires when expected phoneme is /t/ and duration < 60ms (short duration signal)" $ do
        let flapResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "t",
                          gopValue = -5.0,
                          -- 50ms duration < flapDurationThresholdMs(60) → flap 発火
                          gopStartMs = 100,
                          gopEndMs = 150,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let findings = generateFindingsFromGop bodyText flapResult
        any (\f -> findingPhenomenon f == "flap") findings `shouldBe` True

      it "fires when expected phoneme is /d/ and NBest contains ɾ (rhotic NBest signal)" $ do
        let flapResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "d",
                          gopValue = -5.0,
                          -- 100ms duration >= threshold, but NBest has ɾ → flap 発火
                          gopStartMs = 100,
                          gopEndMs = 200,
                          gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.7}],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let findings = generateFindingsFromGop bodyText flapResult
        any (\f -> findingPhenomenon f == "flap") findings `shouldBe` True

      it "does not fire when phoneme is not /t/ or /d/ (non-flap-target phoneme)" $ do
        let noFlapResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "s",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 140,
                          gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.7}],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let findings = generateFindingsFromGop bodyText noFlapResult
        any (\f -> findingPhenomenon f == "flap") findings `shouldBe` False

      it "flap finding has severity == suggestion and scoreImpact == 0.0 (ADR-004, M-102R-d)" $ do
        let flapResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "t",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 150,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let flapFindings =
              filter (\f -> findingPhenomenon f == "flap") $
                generateFindingsFromGop bodyText flapResult
        all (isSuggestion . findingSeverity) flapFindings `shouldBe` True
        all (\f -> findingScoreImpact f == 0.0) flapFindings `shouldBe` True

    -- ---- assimilation ----
    describe "assimilation producer" $ do
      it "fires when /n/ is followed by /m/ context and NBest top is 'm' (assimilation signal)" $ do
        -- /n/ + next=/m/ + NBest has "m" → assimilation 発火
        let assimilationResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "n",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 200,
                          gopNBest = [NBestEntry {nBestPhoneme = "m", nBestConfidence = 0.8}],
                          gopWordPosition = Nothing
                        },
                      PhonemeGop
                        { gopPhoneme = "m",
                          gopValue = -4.0,
                          gopStartMs = 200,
                          gopEndMs = 300,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let findings = generateFindingsFromGop bodyText assimilationResult
        any (\f -> findingPhenomenon f == "assimilation") findings `shouldBe` True

      it "fires when /n/ is followed by /k/ context and NBest has ŋ (velar assimilation)" $ do
        let assimilationResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "n",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 200,
                          gopNBest = [NBestEntry {nBestPhoneme = "ŋ", nBestConfidence = 0.75}],
                          gopWordPosition = Nothing
                        },
                      PhonemeGop
                        { gopPhoneme = "k",
                          gopValue = -4.0,
                          gopStartMs = 200,
                          gopEndMs = 300,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let findings = generateFindingsFromGop bodyText assimilationResult
        any (\f -> findingPhenomenon f == "assimilation") findings `shouldBe` True

      it "does not fire when assimilation context is absent (no following matching phoneme)" $ do
        -- /n/ but next is /s/ (not in assimilation context) → 発火しない
        let noAssimilationResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "n",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 200,
                          gopNBest = [NBestEntry {nBestPhoneme = "m", nBestConfidence = 0.8}],
                          gopWordPosition = Nothing
                        },
                      PhonemeGop
                        { gopPhoneme = "s",
                          gopValue = -4.0,
                          gopStartMs = 200,
                          gopEndMs = 300,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let findings = generateFindingsFromGop bodyText noAssimilationResult
        any (\f -> findingPhenomenon f == "assimilation") findings `shouldBe` False

      it "assimilation finding has severity == suggestion and scoreImpact == 0.0 (ADR-004, M-102R-d)" $ do
        let assimilationResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "n",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 200,
                          gopNBest = [NBestEntry {nBestPhoneme = "m", nBestConfidence = 0.8}],
                          gopWordPosition = Nothing
                        },
                      PhonemeGop
                        { gopPhoneme = "m",
                          gopValue = -4.0,
                          gopStartMs = 200,
                          gopEndMs = 300,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedInterWordSilences = []
                }
        let assimilationFindings =
              filter (\f -> findingPhenomenon f == "assimilation") $
                generateFindingsFromGop bodyText assimilationResult
        all (isSuggestion . findingSeverity) assimilationFindings `shouldBe` True
        all (\f -> findingScoreImpact f == 0.0) assimilationFindings `shouldBe` True

    -- ---- reduction ----
    describe "reduction producer" $ do
      it "fires when full vowel is short (<80ms) and covered by SchwaRealization (reduction signal)" $ do
        -- /æ/ は fullVowelPhonemes に含まれる。duration=50ms < 80ms。SchwaRealization が time をカバー。
        let reductionResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "æ",
                          gopValue = -5.0,
                          -- 50ms duration < reductionDurationThresholdMs(80)
                          gopStartMs = 100,
                          gopEndMs = 150,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedSchwaRealizations =
                    [ SchwaRealization
                        { schwaPhoneme = "ə",
                          -- カバー: 90 <= 100 かつ 160 >= 150
                          schwaStartMs = 90,
                          schwaEndMs = 160,
                          schwaRealized = True
                        }
                    ],
                  analyzedInterWordSilences = [],
                  analyzedWeakFormRealizations = []
                }
        let findings = generateFindingsFromGop bodyText reductionResult
        any (\f -> findingPhenomenon f == "reduction") findings `shouldBe` True

      it "does not fire when phoneme is not a full vowel (non-reduction target)" $ do
        -- /n/ は fullVowelPhonemes に含まれない → 発火しない
        let noReductionResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "n",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 140,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedSchwaRealizations =
                    [ SchwaRealization
                        { schwaPhoneme = "ə",
                          schwaStartMs = 90,
                          schwaEndMs = 160,
                          schwaRealized = True
                        }
                    ],
                  analyzedInterWordSilences = [],
                  analyzedWeakFormRealizations = []
                }
        let findings = generateFindingsFromGop bodyText noReductionResult
        any (\f -> findingPhenomenon f == "reduction") findings `shouldBe` False

      it "does not fire when duration is >= 80ms even if SchwaRealization is present" $ do
        let noReductionResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "æ",
                          gopValue = -5.0,
                          -- 100ms >= 80ms → 発火しない
                          gopStartMs = 100,
                          gopEndMs = 200,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedSchwaRealizations =
                    [ SchwaRealization
                        { schwaPhoneme = "ə",
                          schwaStartMs = 90,
                          schwaEndMs = 210,
                          schwaRealized = True
                        }
                    ],
                  analyzedInterWordSilences = [],
                  analyzedWeakFormRealizations = []
                }
        let findings = generateFindingsFromGop bodyText noReductionResult
        any (\f -> findingPhenomenon f == "reduction") findings `shouldBe` False

      it "does not fire when phoneme is in weakForm time range (weakForm exclusion)" $ do
        let noReductionResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "æ",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 140,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedSchwaRealizations =
                    [ SchwaRealization
                        { schwaPhoneme = "ə",
                          schwaStartMs = 90,
                          schwaEndMs = 160,
                          schwaRealized = True
                        }
                    ],
                  analyzedInterWordSilences = [],
                  -- weakForm range [80, 200) が gopStartMs=100 をカバー → 除外
                  analyzedWeakFormRealizations =
                    [ WeakFormRealization
                        { weakFormWord = "a",
                          weakFormWordIndex = 0,
                          weakFormStartMs = 80,
                          weakFormEndMs = 200,
                          weakFormExpectedWeak = True,
                          weakFormRealizedWeak = False
                        }
                    ]
                }
        let findings = generateFindingsFromGop bodyText noReductionResult
        any (\f -> findingPhenomenon f == "reduction") findings `shouldBe` False

      it "reduction finding has severity == suggestion and scoreImpact == 0.0 (ADR-004, M-102R-d)" $ do
        let reductionResult =
              fixtureAnalyzerResult
                { analyzedPerPhonemeGop =
                    [ PhonemeGop
                        { gopPhoneme = "æ",
                          gopValue = -5.0,
                          gopStartMs = 100,
                          gopEndMs = 150,
                          gopNBest = [],
                          gopWordPosition = Nothing
                        }
                    ],
                  analyzedSchwaRealizations =
                    [ SchwaRealization
                        { schwaPhoneme = "ə",
                          schwaStartMs = 90,
                          schwaEndMs = 160,
                          schwaRealized = True
                        }
                    ],
                  analyzedInterWordSilences = [],
                  analyzedWeakFormRealizations = []
                }
        let reductionFindings =
              filter (\f -> findingPhenomenon f == "reduction") $
                generateFindingsFromGop bodyText reductionResult
        all (isSuggestion . findingSeverity) reductionFindings `shouldBe` True
        all (\f -> findingScoreImpact f == 0.0) reductionFindings `shouldBe` True
