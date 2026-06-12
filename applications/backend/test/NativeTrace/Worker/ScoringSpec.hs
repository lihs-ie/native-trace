module NativeTrace.Worker.ScoringSpec (spec) where

import Data.Maybe (isNothing)
import Data.Text qualified as Text
import NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  InterWordSilence (..),
  PhonemeGop (..),
  SchwaRealization (..),
 )
import NativeTrace.Worker.Scoring (
  checkAudioQuality,
  generateFindingsFromGop,
 )
import NativeTrace.Worker.Types (
  AssessmentFinding (..),
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
        [ PhonemeGop {gopPhoneme = "h", gopValue = -5.0, gopStartMs = 0, gopEndMs = 100},
          PhonemeGop {gopPhoneme = "ɛ", gopValue = -13.0, gopStartMs = 100, gopEndMs = 200},
          PhonemeGop {gopPhoneme = "l", gopValue = -9.5, gopStartMs = 200, gopEndMs = 300},
          PhonemeGop {gopPhoneme = "oʊ", gopValue = -6.0, gopStartMs = 300, gopEndMs = 500},
          PhonemeGop {gopPhoneme = "r", gopValue = -14.0, gopStartMs = 600, gopEndMs = 700}
        ],
      analyzedInterWordSilences =
        [ InterWordSilence {silenceStartMs = 500, silenceEndMs = 600, silenceDurationMs = 100}
        ],
      analyzedSchwaRealizations = [],
      analyzedSpeechRatePhonemePerSecond = 8.0
    }

bodyText :: Text.Text
bodyText = "Hello world"

-- Show/Eq の無いドメイン型を直接比較しないよう、textRange を Int タプルへ射影する。
rangeTuples :: [AssessmentFinding] -> [(Int, Int)]
rangeTuples = map ((\r -> (startChar r, endChar r)) . findingTextRange)

-- | checkAudioQuality テスト用のデフォルトパラメータ（全基準クリア）。
-- meanDbfs: -20.0 (> -35.0), durationMs: 10000 (10秒 >= 1000ms),
-- detected: 9, expected: 10 (率 0.9 > 0.25), gopValues: [-5.0] (中央値 -5.0 > -18.0)
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
      -- 総録音時間 500ms < 1000ms → low_quality
      let (meanDbfs, _, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs 500 detected expected gopValues `shouldBe` True

    it "returns False (normal) when recording duration is sufficient despite pausey recording (10s)" $ do
      -- 総録音時間 10000ms >= 1000ms → 短すぎ判定では弾かれない
      let (meanDbfs, _, detected, expected, gopValues) = defaultQualityParams
      checkAudioQuality meanDbfs 10000 detected expected gopValues `shouldBe` False

    it "returns True (low_quality) when phoneme detection rate is below threshold (0.25)" $ do
      -- detected: 2, expected: 10 → rate 0.2 < 0.25
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
                  [ PhonemeGop {gopPhoneme = "h", gopValue = -3.0, gopStartMs = 0, gopEndMs = 100},
                    PhonemeGop {gopPhoneme = "ɛ", gopValue = -4.0, gopStartMs = 100, gopEndMs = 200}
                  ],
                analyzedInterWordSilences = []
              }
      -- GOP が閾値（-8.0）を上回るため finding は生成されない（connectedSpeech も無音なし）
      length (generateFindingsFromGop bodyText highGopResult) `shouldBe` 0
