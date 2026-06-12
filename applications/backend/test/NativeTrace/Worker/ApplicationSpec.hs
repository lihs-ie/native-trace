module NativeTrace.Worker.ApplicationSpec (
  spec,
)
where

import Data.Aeson (encode, object, (.=))
import Data.ByteString (ByteString)
import Data.ByteString qualified as BS
import Data.ByteString.Char8 qualified as BC
import Data.ByteString.Lazy qualified as LBS
import NativeTrace.Worker.Application (application)
import Network.HTTP.Types (methodPost)
import Test.Hspec (Spec, describe, it)
import Test.Hspec.Wai (
  get,
  matchStatus,
  request,
  shouldRespondWith,
  with,
 )

-- ---- Multipart builder ----

buildMultipart :: String -> LBS.ByteString -> LBS.ByteString -> String -> LBS.ByteString
buildMultipart boundary metadataBytes audioBytes audioCType =
  let sep = "--" <> BC.pack boundary
      crlf = "\r\n"
      metaPart =
        LBS.fromStrict sep
          <> crlf
          <> "Content-Disposition: form-data; name=\"metadata\"; filename=\"metadata.json\"\r\n"
          <> "Content-Type: application/json; charset=utf-8\r\n"
          <> crlf
          <> metadataBytes
          <> crlf
      audioPart =
        LBS.fromStrict sep
          <> crlf
          <> "Content-Disposition: form-data; name=\"audio\"; filename=\"audio.webm\"\r\n"
          <> "Content-Type: "
          <> LBS.fromStrict (BC.pack audioCType)
          <> "\r\n"
          <> crlf
          <> audioBytes
          <> crlf
      closing = LBS.fromStrict sep <> "--\r\n"
   in metaPart <> audioPart <> closing

contentTypeHeader :: String -> ByteString
contentTypeHeader boundary = BC.pack ("multipart/form-data; boundary=" <> boundary)

-- ---- Fixtures ----

-- | 8 バイトのダミー音声（byteLength と一致させる）。
dummyAudio :: LBS.ByteString
dummyAudio = "WEBMDATA"

validMetadataJson :: LBS.ByteString
validMetadataJson =
  encode $
    object
      [ "analysisJob" .= ("job_01JZ0000000000000000000000" :: String),
        "analysisRun" .= ("run_01JZ0000000000000000000000" :: String),
        "recordingAttempt" .= ("rec_01JZ0000000000000000000000" :: String),
        "section" .= ("sec_01JZ0000000000000000000000" :: String),
        "sectionBodyText" .= ("When I was nine years old I started to learn English." :: String),
        "expectedLanguage" .= ("en-US" :: String),
        "targetAccent" .= ("generalAmerican" :: String),
        "requestedMetrics"
          .= ( [ "overall",
                 "accuracy",
                 "nativeLikeness",
                 "pronunciation",
                 "connectedSpeech",
                 "prosody"
               ] ::
                 [String]
             ),
        "assessmentSchemaVersion" .= ("1" :: String),
        "tokenizerVersion" .= ("native-trace-tokenizer-v1" :: String),
        "audio"
          .= object
            [ "mimeType" .= ("audio/webm" :: String),
              "byteLength" .= (8 :: Int),
              "durationMilliseconds" .= (3000 :: Int)
            ]
      ]

validBody :: LBS.ByteString
validBody = buildMultipart "boundary123" validMetadataJson dummyAudio "audio/webm"

validContentType :: ByteString
validContentType = contentTypeHeader "boundary123"

-- ---- Specs ----

spec :: Spec
spec = with (pure application) $ do
  describe "GET /health" $ do
    it "returns ok status" $ do
      get "/health" `shouldRespondWith` "{\"status\":\"ok\"}" {matchStatus = 200}

  describe "GET /version" $ do
    it "returns version metadata" $ do
      get "/version" `shouldRespondWith` 200

  describe "POST /v1/pronunciation-assessments" $ do
    -- 200 ケースは analyzer（docker compose）なしでは 502 になるため統合テスト（commands.txt）で確認する。

    it "returns 400 when expectedLanguage is not en-US" $ do
      let badMeta =
            encode $
              object
                [ "analysisJob" .= ("job_01" :: String),
                  "analysisRun" .= ("run_01" :: String),
                  "recordingAttempt" .= ("rec_01" :: String),
                  "section" .= ("sec_01" :: String),
                  "sectionBodyText" .= ("Hello world." :: String),
                  "expectedLanguage" .= ("ja-JP" :: String),
                  "targetAccent" .= ("generalAmerican" :: String),
                  "requestedMetrics" .= (["overall"] :: [String]),
                  "assessmentSchemaVersion" .= ("1" :: String),
                  "tokenizerVersion" .= ("v1" :: String),
                  "audio"
                    .= object
                      [ "mimeType" .= ("audio/webm" :: String),
                        "byteLength" .= (8 :: Int),
                        "durationMilliseconds" .= (1000 :: Int)
                      ]
                ]
      let badBody = buildMultipart "b2" badMeta dummyAudio "audio/webm"
      request
        methodPost
        "/v1/pronunciation-assessments"
        [("Content-Type", contentTypeHeader "b2")]
        badBody
        `shouldRespondWith` 400

    it "returns 400 when audio duration is zero" $ do
      let badMeta =
            encode $
              object
                [ "analysisJob" .= ("job_01" :: String),
                  "analysisRun" .= ("run_01" :: String),
                  "recordingAttempt" .= ("rec_01" :: String),
                  "section" .= ("sec_01" :: String),
                  "sectionBodyText" .= ("Hello world." :: String),
                  "expectedLanguage" .= ("en-US" :: String),
                  "targetAccent" .= ("generalAmerican" :: String),
                  "requestedMetrics" .= (["overall"] :: [String]),
                  "assessmentSchemaVersion" .= ("1" :: String),
                  "tokenizerVersion" .= ("v1" :: String),
                  "audio"
                    .= object
                      [ "mimeType" .= ("audio/webm" :: String),
                        "byteLength" .= (8 :: Int),
                        "durationMilliseconds" .= (0 :: Int)
                      ]
                ]
      let badBody = buildMultipart "b3" badMeta dummyAudio "audio/webm"
      request
        methodPost
        "/v1/pronunciation-assessments"
        [("Content-Type", contentTypeHeader "b3")]
        badBody
        `shouldRespondWith` 400

    it "returns 400 when sectionBodyText is empty" $ do
      let badMeta =
            encode $
              object
                [ "analysisJob" .= ("job_01" :: String),
                  "analysisRun" .= ("run_01" :: String),
                  "recordingAttempt" .= ("rec_01" :: String),
                  "section" .= ("sec_01" :: String),
                  "sectionBodyText" .= ("" :: String),
                  "expectedLanguage" .= ("en-US" :: String),
                  "targetAccent" .= ("generalAmerican" :: String),
                  "requestedMetrics" .= (["overall"] :: [String]),
                  "assessmentSchemaVersion" .= ("1" :: String),
                  "tokenizerVersion" .= ("v1" :: String),
                  "audio"
                    .= object
                      [ "mimeType" .= ("audio/webm" :: String),
                        "byteLength" .= (8 :: Int),
                        "durationMilliseconds" .= (1000 :: Int)
                      ]
                ]
      let badBody = buildMultipart "b4" badMeta dummyAudio "audio/webm"
      request
        methodPost
        "/v1/pronunciation-assessments"
        [("Content-Type", contentTypeHeader "b4")]
        badBody
        `shouldRespondWith` 400
