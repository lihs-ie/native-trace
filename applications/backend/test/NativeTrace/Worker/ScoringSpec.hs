module NativeTrace.Worker.ScoringSpec (spec) where

import Data.Text qualified as Text
import NativeTrace.Worker.Scoring (generateFindings)
import NativeTrace.Worker.Types (
  AssessmentFinding (..),
  AssessmentScores (..),
  TextRange (..),
 )
import Test.Hspec

scores :: AssessmentScores
scores =
  AssessmentScores
    { overall = 65,
      accuracy = 70,
      nativeLikeness = 60,
      pronunciation = 55,
      connectedSpeech = 72,
      prosody = 68
    }

bodyText :: Text.Text
bodyText = "I am honored to be with you today at your commencement from one of the finest universities"

-- Show/Eq の無いドメイン型を直接比較しないよう、textRange を Int タプルへ射影する。
rangeTuples :: [AssessmentFinding] -> [(Int, Int)]
rangeTuples = map ((\r -> (startChar r, endChar r)) . findingTextRange)

spec :: Spec
spec = describe "generateFindings" $ do
  it "produces at least one finding for non-empty body text" $ do
    length (generateFindings bodyText 9000 scores) `shouldSatisfy` (>= 1)

  it "is deterministic for the same input" $ do
    rangeTuples (generateFindings bodyText 9000 scores)
      `shouldBe` rangeTuples (generateFindings bodyText 9000 scores)

  it "places every textRange within the body text bounds and on a non-empty slice" $ do
    let len = Text.length bodyText
    let ranges = rangeTuples (generateFindings bodyText 9000 scores)
    all (\(s, e) -> s >= 0 && e <= len && s < e) ranges `shouldBe` True

  it "fills messageJa with a non-empty string" $ do
    let findings = generateFindings bodyText 9000 scores
    not (any (Text.null . findingMessageJa) findings) `shouldBe` True

  it "returns no findings for blank body text" $ do
    length (generateFindings "   " 9000 scores) `shouldBe` 0
