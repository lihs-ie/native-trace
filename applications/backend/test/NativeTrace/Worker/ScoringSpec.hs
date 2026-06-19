module NativeTrace.Worker.ScoringSpec (spec) where

import Data.Map.Strict qualified as Map
import Data.Maybe (isJust, isNothing)
import Data.Text qualified as Text
import NativeTrace.Worker.AaiClient (callAai)
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  InsertedVowelInfo (..),
  InterWordSilence (..),
  NBestEntry (..),
  PhonemeAcoustic (..),
  PhonemeGop (..),
  SchwaRealization (..),
  SyllableInfo (..),
  WeakFormRealization (..),
 )
import NativeTrace.Worker.Scoring (
  ScoringInput (..),
  aaiDisplayEligibilityThreshold,
  articulatoryDisplayGuardrail,
  buildAssessmentScores,
  checkAudioQuality,
  classifyGopDelta,
  deriveAcousticEvidence,
  generateFindingsFromGop,
  hillenbrandGaVowelFormants,
  scoreAssessment,
  scoreFromGop,
  severityToScoreImpact,
 )
import NativeTrace.Worker.Types (
  AcousticEvidence (..),
  ArticulatoryEstimate (..),
  AssessmentFinding (..),
  AssessmentScores (..),
  BoundarySignal (..),
  CefrScore (..),
  DeltaSignal (..),
  FindingSeverity (..),
  GopDeltaResponse (..),
  TextRange (..),
 )
import Servant (runHandler)
import System.Environment (unsetEnv)
import Test.Hspec

-- | FindingSeverity はテスト層で Eq インスタンスがないため、
-- パターンマッチで suggestion 判定するヘルパー。
isSuggestion :: FindingSeverity -> Bool
isSuggestion FindingSeveritySuggestion = True
isSuggestion _ = False

-- | FindingSeverity の Major 判定ヘルパー（ADR-017 D1 asserts 用）。
isMajor :: FindingSeverity -> Bool
isMajor FindingSeverityMajor = True
isMajor _ = False

-- | テスト用の AnalyzerResult フィクスチャ（test-only、本番に入らない）。
fixtureAnalyzerResult :: AnalyzerResult
fixtureAnalyzerResult =
  AnalyzerResult
    { analyzedExpectedIpa = "hɛloʊ wɜrld",
      analyzedDetectedIpa = "hɛloʊ wɜld",
      analyzedPerPhonemeGop =
        [ PhonemeGop {gopPhoneme = "h", gopValue = -5.0, gopStartMs = 0, gopEndMs = 100, gopNBest = [], gopWordPosition = Nothing},
          PhonemeGop {gopPhoneme = "ɛ", gopValue = -13.0, gopStartMs = 100, gopEndMs = 200, gopNBest = [], gopWordPosition = Nothing},
          PhonemeGop {gopPhoneme = "l", gopValue = -9.5, gopStartMs = 200, gopEndMs = 300, gopNBest = [], gopWordPosition = Nothing},
          PhonemeGop {gopPhoneme = "oʊ", gopValue = -6.0, gopStartMs = 300, gopEndMs = 500, gopNBest = [], gopWordPosition = Nothing},
          PhonemeGop {gopPhoneme = "r", gopValue = -14.0, gopStartMs = 600, gopEndMs = 700, gopNBest = [], gopWordPosition = Nothing}
        ],
      analyzedInterWordSilences =
        [ InterWordSilence {silenceStartMs = 500, silenceEndMs = 600, silenceDurationMs = 100}
        ],
      analyzedSchwaRealizations = [],
      analyzedSpeechRatePhonemePerSecond = 8.0,
      analyzedMeanDbfs = -15.0,
      analyzedSpeechDurationSeconds = 0.7,
      analyzedF0Contour = Nothing,
      analyzedReferenceF0Contour = Nothing,
      analyzedWordStress = [],
      analyzedRhythm = Nothing,
      analyzedWeakFormRealizations = [],
      analyzedSyllables = [],
      analyzedPhonemeAcoustics = [],
      analyzerSpeakerSex = "unknown"
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
              gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.8}],
              gopWordPosition = Nothing
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
              gopNBest = [NBestEntry {nBestPhoneme = "s", nBestConfidence = 0.7}],
              gopWordPosition = Nothing
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
  describe "articulatoryDisplayGuardrail (ADR-019 D4 / M-AAI-11)" $ do
    let coords6 = (0.10, 0.20, 0.30, 0.40, 0.50, 0.60)
    it "(a) vowel + displayEligibility 0.6 + 60ms => Just (display)" $
      articulatoryDisplayGuardrail "iː" 0 60 0.6 coords6 `shouldSatisfy` isJust
    it "(a') approximant /r/ + displayEligibility 0.6 + 60ms => Just" $
      articulatoryDisplayGuardrail "r" 100 160 0.6 coords6 `shouldSatisfy` isJust
    it "(b) displayEligibility 0.5 (< 0.55 threshold) => Nothing (suppress)" $
      articulatoryDisplayGuardrail "iː" 0 60 0.5 coords6 `shouldSatisfy` isNothing
    it "(c) stop/fricative phoneme => Nothing (suppress to floor)" $ do
      articulatoryDisplayGuardrail "t" 0 60 0.9 coords6 `shouldSatisfy` isNothing
      articulatoryDisplayGuardrail "s" 0 60 0.9 coords6 `shouldSatisfy` isNothing
    it "(d) segment < 50ms (40ms) => Nothing (suppress)" $
      articulatoryDisplayGuardrail "iː" 0 40 0.9 coords6 `shouldSatisfy` isNothing
    it "displayEligibility threshold constant is 0.55 (calibratable, S-AAI-1)" $
      aaiDisplayEligibilityThreshold `shouldBe` (0.55 :: Double)

  describe "callAai soft-disable (ADR-019 / M-AAI-9)" $
    it "returns Nothing when AAI_URL is unset (must not fail the assessment)" $ do
      unsetEnv "AAI_URL"
      result <- runHandler (callAai "audio-bytes" "audio/wav" [])
      case result of
        Right Nothing -> pure ()
        Right (Just _) -> expectationFailure "expected Nothing when AAI_URL unset"
        Left _ -> expectationFailure "callAai must not throwError (soft-disable)"

  describe "AAI finding integration (ADR-019 / M-AAI-10 / M-AAI-17)" $ do
    it "M-AAI-10: all findings default findingArticulatoryEstimate = Nothing (AAI off / pre-enrichment)" $
      all (isNothing . findingArticulatoryEstimate) (generateFindingsFromGop bodyText fixtureAnalyzerResult)
        `shouldBe` True
    it "M-AAI-17: attaching articulatoryEstimate does NOT change findingScoreImpact (presentation-only)" $
      case generateFindingsFromGop bodyText fixtureAnalyzerResult of
        (finding : _) ->
          let est = ArticulatoryEstimate 0.10 0.20 0.30 0.40 0.50 0.60 0.70
              enriched = finding {findingArticulatoryEstimate = Just est}
           in findingScoreImpact enriched `shouldBe` findingScoreImpact finding
        [] -> expectationFailure "expected >=1 finding in fixture"

  describe "checkAudioQuality" $ do
    it "returns False (normal) when all criteria are satisfied" $ do
      let (meanDbfs, durationMs, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs durationMs detected expected gopValues `shouldBe` False

    it "returns True (low_quality) when meanDbfs is below threshold (-36.0, speech-active RMS, ADR-015)" $ do
      let (_, durationMs, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality (-37.0) durationMs detected expected gopValues `shouldBe` True

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
                  [ PhonemeGop {gopPhoneme = "h", gopValue = -3.0, gopStartMs = 0, gopEndMs = 100, gopNBest = [], gopWordPosition = Nothing},
                    PhonemeGop {gopPhoneme = "ɛ", gopValue = -4.0, gopStartMs = 100, gopEndMs = 200, gopNBest = [], gopWordPosition = Nothing}
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
                  [ PhonemeGop {gopPhoneme = "h", gopValue = -1.0, gopStartMs = 0, gopEndMs = 100, gopNBest = [], gopWordPosition = Nothing},
                    PhonemeGop {gopPhoneme = "ɛ", gopValue = -1.5, gopStartMs = 100, gopEndMs = 200, gopNBest = [], gopWordPosition = Nothing}
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

    it "epenthesis finding has severity == Major and scoreImpact == -5.0 (ADR-017 D1)" $ do
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
      let epenthesisFindings =
            filter (\f -> findingPhenomenon f == "epenthesis") $
              generateFindingsFromGop "strike" epenthesisResult
      all (isMajor . findingSeverity) epenthesisFindings `shouldBe` True
      all (\f -> findingScoreImpact f == -5.0) epenthesisFindings `shouldBe` True

    it "epenthesis finding has findingInsertedVowel == Just vowel when insertedVowel is present (ADR-017 D1)" $ do
      let epenthesisResult =
            fixtureAnalyzerResult
              { analyzedSyllables =
                  [ NativeTrace.Worker.AnalyzerClient.SyllableInfo
                      { syllableInfoWord = "strike",
                        syllableInfoWordIndex = 0,
                        syllableInfoExpectedCount = 1,
                        syllableInfoActualCount = 2,
                        syllableInfoInsertedVowels =
                          [ NativeTrace.Worker.AnalyzerClient.InsertedVowelInfo
                              { insertedVowelPositionMs = 350,
                                insertedVowelPhoneme = "ɯ"
                              }
                          ]
                      }
                  ],
                analyzedPerPhonemeGop = [],
                analyzedInterWordSilences = []
              }
      let epenthesisFindings =
            filter (\f -> findingPhenomenon f == "epenthesis") $
              generateFindingsFromGop "strike" epenthesisResult
      any (\f -> findingInsertedVowel f == Just "ɯ") epenthesisFindings `shouldBe` True

    it "epenthesis finding has findingInsertedVowel == Nothing when insertedVowels is empty (ADR-017 D1)" $ do
      let epenthesisResult =
            fixtureAnalyzerResult
              { analyzedSyllables =
                  [ NativeTrace.Worker.AnalyzerClient.SyllableInfo
                      { syllableInfoWord = "this",
                        syllableInfoWordIndex = 0,
                        syllableInfoExpectedCount = 1,
                        syllableInfoActualCount = 2,
                        syllableInfoInsertedVowels = []
                      }
                  ],
                analyzedPerPhonemeGop = [],
                analyzedInterWordSilences = []
              }
      let epenthesisFindings =
            filter (\f -> findingPhenomenon f == "epenthesis") $
              generateFindingsFromGop "this" epenthesisResult
      all (isNothing . findingInsertedVowel) epenthesisFindings `shouldBe` True

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
                        gopNBest = [NBestEntry {nBestPhoneme = "ɾ", nBestConfidence = 0.9}],
                        gopWordPosition = Nothing
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

  -- M-CRL-7 / ADR-022: GOP delta classification
  describe "classifyGopDelta (M-CRL-7 / ADR-022)" $ do
    describe "deltaSignal" $ do
      it "gopDelta > 5.0 → DeltaSignalImproved (original=-15, retry=-8, delta=7.0)" $ do
        let result = classifyGopDelta (-15) (-8)
        gopDeltaResponseGopDelta result `shouldBe` 7.0
        gopDeltaResponseDeltaSignal result `shouldBe` DeltaSignalImproved

      it "gopDelta < -2.0 → DeltaSignalRegressed (original=-8, retry=-12, delta=-4.0)" $ do
        let result = classifyGopDelta (-8) (-12)
        gopDeltaResponseGopDelta result `shouldBe` (-4.0)
        gopDeltaResponseDeltaSignal result `shouldBe` DeltaSignalRegressed

      it "gopDelta in (-2.0, 5.0] → DeltaSignalUnchanged (original=-10, retry=-8, delta=2.0)" $ do
        let result = classifyGopDelta (-10) (-8)
        gopDeltaResponseGopDelta result `shouldBe` 2.0
        gopDeltaResponseDeltaSignal result `shouldBe` DeltaSignalUnchanged

      it "gopDelta exactly 5.0 → DeltaSignalUnchanged (strict >, not >=)" $ do
        -- delta = retryGop - originalGop = (-5) - (-10) = 5.0
        -- improvement threshold is strict >; exactly 5.0 must be unchanged
        let result = classifyGopDelta (-10) (-5)
        gopDeltaResponseGopDelta result `shouldBe` 5.0
        gopDeltaResponseDeltaSignal result `shouldBe` DeltaSignalUnchanged

      it "gopDelta exactly -2.0 → DeltaSignalUnchanged (strict <, not <=)" $ do
        -- delta = (-12) - (-10) = -2.0
        -- regression threshold is strict <; exactly -2.0 must be unchanged
        let result = classifyGopDelta (-10) (-12)
        gopDeltaResponseGopDelta result `shouldBe` (-2.0)
        gopDeltaResponseDeltaSignal result `shouldBe` DeltaSignalUnchanged

    describe "boundarySignal strict severity thresholds" $ do
      it "gop exactly -8.0 → none severity (strict <; == is not minor)" $ do
        -- originalGop=-10 (minor), retryGop=-8.0 (none, because not < -8)
        -- minor→none = BoundarySignalCrossedMinor
        let result = classifyGopDelta (-10) (-8)
        gopDeltaResponseBoundarySignal result `shouldBe` BoundarySignalCrossedMinor

      it "gop exactly -12.0 → minor severity (strict <; == is not major)" $ do
        -- originalGop=-15 (major), retryGop=-12.0 (minor, because not < -12)
        -- major→minor = BoundarySignalCrossedMajor
        let result = classifyGopDelta (-15) (-12)
        gopDeltaResponseBoundarySignal result `shouldBe` BoundarySignalCrossedMajor

    describe "boundarySignal classification" $ do
      it "major→minor (original=-15, retry=-10) → BoundarySignalCrossedMajor" $ do
        let result = classifyGopDelta (-15) (-10)
        gopDeltaResponseBoundarySignal result `shouldBe` BoundarySignalCrossedMajor

      it "minor→none (original=-10, retry=-6) → BoundarySignalCrossedMinor" $ do
        let result = classifyGopDelta (-10) (-6)
        gopDeltaResponseBoundarySignal result `shouldBe` BoundarySignalCrossedMinor

      it "major→major (original=-15, retry=-13) → BoundarySignalNone" $ do
        let result = classifyGopDelta (-15) (-13)
        gopDeltaResponseBoundarySignal result `shouldBe` BoundarySignalNone

      it "major→none (original=-15, retry=-7) → BoundarySignalCrossedMajor" $ do
        let result = classifyGopDelta (-15) (-7)
        gopDeltaResponseBoundarySignal result `shouldBe` BoundarySignalCrossedMajor

  -- ADR-018 音響証拠 unit tests
  -- M-APD-10: hillenbrandGaVowelFormants ノルム map のキー検証
  describe "hillenbrandGaVowelFormants (M-APD-10)" $ do
    it "contains key (\"iː\", \"M\") for male /iː/ vowel" $ do
      Map.member ("iː", "M") hillenbrandGaVowelFormants `shouldBe` True

    it "contains key (\"iː\", \"F\") for female /iː/ vowel" $ do
      Map.member ("iː", "F") hillenbrandGaVowelFormants `shouldBe` True

  -- M-APD-11: deriveAcousticEvidence 方向ラベル + Lobanov ガード
  describe "deriveAcousticEvidence (M-APD-11)" $ do
    -- rhoticity label test: F3=2200Hz は /r/ → insufficient, /l/ → overRetroflex (dead zone なし)
    it "F3=2200Hz at /r/ → rhoticity=insufficient; at /l/ → overRetroflex (no dead zone)" $ do
      let measured =
            PhonemeAcoustic
              { acousticPhoneme = "r",
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Nothing,
                acousticF2Hz = Nothing,
                acousticF3Hz = Just 2200,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      -- /r/ with F3=2200 >= rhoticF3MaleHz(2000) → insufficient
      let rResult = deriveAcousticEvidence "r" measured "M" [measured]
      acousticRhoticity rResult `shouldBe` Just "insufficient"
      -- /l/ with same F3=2200 < lateralF3OverretroflexHz(2500) → overRetroflex
      let lMeasured = measured {acousticPhoneme = "l"}
      let lResult = deriveAcousticEvidence "l" lMeasured "M" [lMeasured]
      acousticRhoticity lResult `shouldBe` Just "overRetroflex"

    -- Lobanov ガード: speakerSex="unknown" で母音 ≥3 → tongueHeight が Just
    it "speakerSex=unknown with >=3 vowels → tongueHeight is Just (Lobanov normalisation runs)" $ do
      -- fullVowelPhonemes に含まれる母音を 3 つ用意。F1 に分散がある値を設定。
      let makeVowel p f1 =
            PhonemeAcoustic
              { acousticPhoneme = p,
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Just f1,
                acousticF2Hz = Just 2000,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let vowel1 = makeVowel "iː" 270
      let vowel2 = makeVowel "ɪ" 430
      let vowel3 = makeVowel "æ" 660
      let allVowels = [vowel1, vowel2, vowel3]
      let result = deriveAcousticEvidence "iː" vowel1 "unknown" allVowels
      isJust (acousticTongueHeight result) `shouldBe` True

    -- Lobanov ガード: speakerSex="unknown" で母音 <3 → tongueHeight が Nothing
    it "speakerSex=unknown with <3 vowels → tongueHeight is Nothing (false-positive guard)" $ do
      let makeVowel p f1 =
            PhonemeAcoustic
              { acousticPhoneme = p,
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Just f1,
                acousticF2Hz = Just 2000,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let vowel1 = makeVowel "iː" 270
      let vowel2 = makeVowel "ɪ" 430
      let twoVowels = [vowel1, vowel2]
      let result = deriveAcousticEvidence "iː" vowel1 "unknown" twoVowels
      acousticTongueHeight result `shouldBe` Nothing

    -- M-APD-11: M/F パスは sex ノルム行を直接参照する
    -- hillenbrand norm: iː M=(270,2290,3010), iː F=(437,2761,3372)
    -- 計測 F1=600 は M ノルム(270)の高い側 → "tooLow"(高 F1=低舌位)
    --                   F ノルム(437)の高い側 → "tooLow"
    -- 計測 F2=2500 は M ノルム(2290)の高い側 → "tooFront"
    --               F ノルム(2761)の低い側    → "tooBack" (2500 < 2761)
    -- → M/F で tongueBackness が異なることを確認。target も各 sex ノルムに一致。
    it "speakerSex=M vs F yields different tongueBackness (sex norm row differs) for iː F2=2500" $ do
      let makeSingleVowel p f1 f2 =
            PhonemeAcoustic
              { acousticPhoneme = p,
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Just f1,
                acousticF2Hz = Just f2,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      -- F2=3000 を使う: M norm 2290 → (3000-2290)/(2290*0.10)=710/229=3.1 → "tooFront"
      --                  F norm 2761 → (3000-2761)/(2761*0.10)=239/276.1=0.87 → "ok"
      let measuredHighF2 = makeSingleVowel "iː" 600 3000
      let resultMaleHighF2 = deriveAcousticEvidence "iː" measuredHighF2 "M" [measuredHighF2]
      let resultFemaleHighF2 = deriveAcousticEvidence "iː" measuredHighF2 "F" [measuredHighF2]
      -- M → tooFront (F2 far above M norm 2290)
      acousticTongueBackness resultMaleHighF2 `shouldBe` Just "tooFront"
      -- F → ok (F2=3000 is within 1 SD of F norm 2761)
      acousticTongueBackness resultFemaleHighF2 `shouldBe` Just "ok"
      -- また M/F の tongueBackness が異なることを確認
      acousticTongueBackness resultMaleHighF2 `shouldNotBe` acousticTongueBackness resultFemaleHighF2

    it "speakerSex=M acousticTargetF1Hz equals hillenbrand M norm for iː" $ do
      let measured =
            PhonemeAcoustic
              { acousticPhoneme = "iː",
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Just 600,
                acousticF2Hz = Just 2500,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let result = deriveAcousticEvidence "iː" measured "M" [measured]
      -- hillenbrand iː M norm: F1=270, F2=2290, F3=3010
      acousticTargetF1Hz result `shouldBe` Just 270
      acousticTargetF2Hz result `shouldBe` Just 2290

    it "speakerSex=F acousticTargetF1Hz equals hillenbrand F norm for iː" $ do
      let measured =
            PhonemeAcoustic
              { acousticPhoneme = "iː",
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Just 600,
                acousticF2Hz = Just 2500,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let result = deriveAcousticEvidence "iː" measured "F" [measured]
      -- hillenbrand iː F norm: F1=437, F2=2761, F3=3372
      acousticTargetF1Hz result `shouldBe` Just 437
      acousticTargetF2Hz result `shouldBe` Just 2761

    -- M-APD-11: M/F パスは >=3 母音ガードを適用しない
    it "speakerSex=M with only 1 vowel still returns Just for tongueHeight (not over-guarded)" $ do
      let singleVowel =
            PhonemeAcoustic
              { acousticPhoneme = "iː",
                acousticStartMs = 0,
                acousticEndMs = 100,
                -- F1=600Hz は M ノルム(270)より大幅に高い → fallback SD=270*0.10=27 → (600-270)/27=12.2 → "tooLow"
                acousticF1Hz = Just 600,
                acousticF2Hz = Just 2500,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let result = deriveAcousticEvidence "iː" singleVowel "M" [singleVowel]
      -- M/F パスは母音数によらず Just を返す (>=3 ガードは unknown のみ)
      isJust (acousticTongueHeight result) `shouldBe` True

    it "speakerSex=F with only 1 vowel still returns Just for tongueHeight (not over-guarded)" $ do
      let singleVowel =
            PhonemeAcoustic
              { acousticPhoneme = "iː",
                acousticStartMs = 0,
                acousticEndMs = 100,
                -- F1=600Hz は F ノルム(437)より大幅に高い → fallback SD=437*0.10=43.7 → (600-437)/43.7=3.7 → "tooLow"
                acousticF1Hz = Just 600,
                acousticF2Hz = Just 2500,
                acousticF3Hz = Nothing,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let result = deriveAcousticEvidence "iː" singleVowel "F" [singleVowel]
      isJust (acousticTongueHeight result) `shouldBe` True

  -- M-APD-17: scoreImpact 不変 — acousticEvidence の有無で findingScoreImpact が変わらないこと
  describe "scoreImpact invariant (M-APD-17)" $ do
    it "severityToScoreImpact FindingSeverityMajor == -5.0 (unchanged)" $ do
      severityToScoreImpact FindingSeverityMajor `shouldBe` (-5.0)

    it "severityToScoreImpact FindingSeverityMinor == -2.0 (unchanged)" $ do
      severityToScoreImpact FindingSeverityMinor `shouldBe` (-2.0)

    it "major GOP finding has same scoreImpact with or without acoustic match" $ do
      -- GOP -15 (major) で PhonemeAcoustic 有無を切り替える
      let majorGop =
            PhonemeGop
              { gopPhoneme = "r",
                gopValue = -15.0,
                gopStartMs = 0,
                gopEndMs = 100,
                gopNBest = [],
                gopWordPosition = Nothing
              }
      let matchingAcoustic =
            PhonemeAcoustic
              { acousticPhoneme = "r",
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Nothing,
                acousticF2Hz = Nothing,
                acousticF3Hz = Just 2200,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      -- with acoustic match
      let withAcousticResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop = [majorGop],
                analyzedPhonemeAcoustics = [matchingAcoustic],
                analyzedInterWordSilences = []
              }
      -- without acoustic match
      let withoutAcousticResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop = [majorGop],
                analyzedPhonemeAcoustics = [],
                analyzedInterWordSilences = []
              }
      let withFindings = generateFindingsFromGop bodyText withAcousticResult
      let withoutFindings = generateFindingsFromGop bodyText withoutAcousticResult
      -- scoreImpact は等しいこと
      map findingScoreImpact withFindings `shouldBe` map findingScoreImpact withoutFindings

    it "minor GOP finding has same scoreImpact with or without acoustic match" $ do
      let minorGop =
            PhonemeGop
              { gopPhoneme = "r",
                gopValue = -10.0,
                gopStartMs = 0,
                gopEndMs = 100,
                gopNBest = [],
                gopWordPosition = Nothing
              }
      let matchingAcoustic =
            PhonemeAcoustic
              { acousticPhoneme = "r",
                acousticStartMs = 0,
                acousticEndMs = 100,
                acousticF1Hz = Nothing,
                acousticF2Hz = Nothing,
                acousticF3Hz = Just 2200,
                acousticSpectralCentroidHz = Nothing,
                acousticDurationMs = 100
              }
      let withAcousticResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop = [minorGop],
                analyzedPhonemeAcoustics = [matchingAcoustic],
                analyzedInterWordSilences = []
              }
      let withoutAcousticResult =
            fixtureAnalyzerResult
              { analyzedPerPhonemeGop = [minorGop],
                analyzedPhonemeAcoustics = [],
                analyzedInterWordSilences = []
              }
      let withFindings = generateFindingsFromGop bodyText withAcousticResult
      let withoutFindings = generateFindingsFromGop bodyText withoutAcousticResult
      map findingScoreImpact withFindings `shouldBe` map findingScoreImpact withoutFindings
