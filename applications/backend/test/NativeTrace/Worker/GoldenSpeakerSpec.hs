{-# LANGUAGE ImportQualifiedPost #-}

module NativeTrace.Worker.GoldenSpeakerSpec (spec) where

import Data.Aeson (decode, encode)
import Data.ByteString.Lazy.Char8 qualified as LBS8
import Data.Text qualified as Text
import NativeTrace.Worker.Types (GoldenSpeakerConversionDto (..))
import Test.Hspec

spec :: Spec
spec = do
  describe "GoldenSpeakerConversionDto ToJSON (M-GRV-6 / ADR-012)" $ do
    let passDto =
          GoldenSpeakerConversionDto
            { goldenAudioBase64 = Just (Text.pack "UklGRg=="),
              goldenQualityGatePassed = True,
              goldenWithholdReason = Nothing,
              goldenTargetVoice = Text.pack "p225"
            }
        encoded = LBS8.unpack (encode passDto)
    it "emits audioBase64 / qualityGatePassed / withholdReason / targetVoice" $ do
      encoded `shouldContain` "audioBase64"
      encoded `shouldContain` "qualityGatePassed"
      encoded `shouldContain` "withholdReason"
      encoded `shouldContain` "\"targetVoice\":\"p225\""

  describe "GoldenSpeakerConversionDto FromJSON (golden service contract)" $ do
    it "parses a passed conversion (audioBase64 present, gate passed)" $ do
      let body =
            "{\"audioBase64\":\"UklGRg==\",\"qualityGatePassed\":true,\"withholdReason\":null,\"targetVoice\":\"p225\"}"
          parsed = decode (LBS8.pack body) :: Maybe GoldenSpeakerConversionDto
      fmap goldenQualityGatePassed parsed `shouldBe` Just True
      fmap goldenTargetVoice parsed `shouldBe` Just (Text.pack "p225")
    it "parses a withheld conversion (audioBase64 null, reason set)" $ do
      let body =
            "{\"audioBase64\":null,\"qualityGatePassed\":false,\"withholdReason\":\"quality_gate_failed\",\"targetVoice\":\"p225\"}"
          parsed = decode (LBS8.pack body) :: Maybe GoldenSpeakerConversionDto
      fmap goldenQualityGatePassed parsed `shouldBe` Just False
      fmap goldenAudioBase64 parsed `shouldBe` Just Nothing
      fmap goldenWithholdReason parsed `shouldBe` Just (Just (Text.pack "quality_gate_failed"))
