{-# LANGUAGE ImportQualifiedPost #-}

module NativeTrace.Worker.ShadowingLagSpec (spec) where

import Data.Aeson (decode, encode)
import Data.ByteString.Lazy.Char8 qualified as LBS8
import Data.Text qualified as Text
import NativeTrace.Worker.AnalyzerClient (AnalyzerShadowingLagResult (..))
import NativeTrace.Worker.Types (PerSegmentLagEntry (..), ShadowingLagDto (..))
import Test.Hspec

spec :: Spec
spec = do
  describe "ShadowingLagDto ToJSON (M-SHL-3 / ADR-013)" $ do
    let dto =
          ShadowingLagDto
            { shadowingLagMilliseconds = 620.0,
              shadowingPerSegmentLag = [PerSegmentLagEntry (Text.pack "h") 200.0],
              shadowingSpeechRateRatio = Just 1.1,
              shadowingPauseCountLearner = Just 2,
              shadowingPauseCountReference = Just 1,
              shadowingRecommendSlowPlayback = True,
              shadowingThresholdMilliseconds = 500
            }
        encoded = LBS8.unpack (encode dto)
    it "emits recommendSlowPlayback and thresholdMilliseconds (worker-decided fields)" $ do
      encoded `shouldContain` "recommendSlowPlayback"
      encoded `shouldContain` "thresholdMilliseconds"
    it "emits the per-segment lag list with phoneme + lagMilliseconds" $ do
      encoded `shouldContain` "perSegmentLag"
      encoded `shouldContain` "\"phoneme\":\"h\""

  describe "AnalyzerShadowingLagResult FromJSON (analyzer contract)" $ do
    it "parses the analyzer response shape" $ do
      let body =
            "{\"lagMilliseconds\":350.5,\"perSegmentLag\":[{\"phoneme\":\"h\",\"lagMilliseconds\":200.0}],\"speechRateRatio\":1.2,\"pauseCountLearner\":2,\"pauseCountReference\":1}"
          parsed = decode (LBS8.pack body) :: Maybe AnalyzerShadowingLagResult
      fmap analyzerLagMilliseconds parsed `shouldBe` Just 350.5
      fmap (length . analyzerPerSegmentLag) parsed `shouldBe` Just 1
    it "tolerates missing optional fields (speechRateRatio / pauseCounts)" $ do
      let body = "{\"lagMilliseconds\":0.0}"
          parsed = decode (LBS8.pack body) :: Maybe AnalyzerShadowingLagResult
      fmap analyzerSpeechRateRatio parsed `shouldBe` Just Nothing
      fmap analyzerLagMilliseconds parsed `shouldBe` Just 0.0
