module NativeTrace.Worker.ApplicationSpec (
  spec,
)
where

import NativeTrace.Worker.Application (application)
import Network.HTTP.Types (methodPost)
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Wai (get, matchStatus, request, shouldRespondWith, with)

spec :: Spec
spec = with (pure application) $ do
  describe "GET /health" $ do
    it "returns ok status" $ do
      get "/health" `shouldRespondWith` "{\"status\":\"ok\"}" {matchStatus = 200}

  describe "GET /version" $ do
    it "returns version metadata" $ do
      get "/version" `shouldRespondWith` 200

  describe "POST /v1/pronunciation-assessments" $ do
    it "is not implemented yet" $ do
      request methodPost "/v1/pronunciation-assessments" [("Content-Type", "application/json")] "{}"
        `shouldRespondWith` 501
