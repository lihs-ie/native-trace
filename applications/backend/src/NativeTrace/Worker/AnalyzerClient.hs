-- | python-analyzer への HTTP クライアント。
-- POST /v1/analyze を呼び出し AnalyzerResult を返す。
-- ANALYZER_URL 環境変数で接続先を変える（デフォルト: http://localhost:8788）。
module NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  PhonemeGop (..),
  InterWordSilence (..),
  SchwaRealization (..),
  analyzeAudio,
)
where

import Control.Monad.IO.Class (liftIO)
import Data.Aeson (FromJSON (..), ToJSON (..), object, withObject, (.:), (.=))
import Data.Aeson qualified as Aeson
import Data.ByteString (ByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding qualified as TextEncoding
import Network.HTTP.Client (
  Request (..),
  RequestBody (..),
  httpLbs,
  newManager,
  parseRequest,
  responseBody,
  responseStatus,
 )
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types (status200, status500)
import Servant (Handler, ServerError (..), err502, throwError)
import System.Environment (lookupEnv)

-- ---- レスポンス型 ----

-- | 1 音素の GOP 計測値。
data PhonemeGop = PhonemeGop
  { gopPhoneme :: Text,
    gopValue :: Double,
    gopStartMs :: Int,
    gopEndMs :: Int
  }
  deriving (Show, Eq)

instance FromJSON PhonemeGop where
  parseJSON = withObject "PhonemeGop" $ \o -> do
    phoneme <- o .: "phoneme"
    gopVal <- o .: "gop"
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    pure
      PhonemeGop
        { gopPhoneme = phoneme,
          gopValue = gopVal,
          gopStartMs = startMs,
          gopEndMs = endMs
        }

-- | 単語間無音区間。
data InterWordSilence = InterWordSilence
  { silenceStartMs :: Int,
    silenceEndMs :: Int,
    silenceDurationMs :: Int
  }
  deriving (Show, Eq)

instance FromJSON InterWordSilence where
  parseJSON = withObject "InterWordSilence" $ \o -> do
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    durationMs <- o .: "durationMs"
    pure
      InterWordSilence
        { silenceStartMs = startMs,
          silenceEndMs = endMs,
          silenceDurationMs = durationMs
        }

-- | シュワ音実現。
data SchwaRealization = SchwaRealization
  { schwaPhoneme :: Text,
    schwaStartMs :: Int,
    schwaEndMs :: Int,
    schwaRealized :: Bool
  }
  deriving (Show, Eq)

instance FromJSON SchwaRealization where
  parseJSON = withObject "SchwaRealization" $ \o -> do
    phoneme <- o .: "phoneme"
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    realized <- o .: "realized"
    pure
      SchwaRealization
        { schwaPhoneme = phoneme,
          schwaStartMs = startMs,
          schwaEndMs = endMs,
          schwaRealized = realized
        }

-- | python-analyzer の POST /v1/analyze レスポンス。
data AnalyzerResult = AnalyzerResult
  { analyzedExpectedIpa :: Text,
    analyzedDetectedIpa :: Text,
    analyzedPerPhonemeGop :: [PhonemeGop],
    analyzedInterWordSilences :: [InterWordSilence],
    analyzedSchwaRealizations :: [SchwaRealization],
    analyzedSpeechRatePhonemePerSecond :: Double,
    -- | 音声の平均 dBFS（RMS）。python-analyzer が計測して付与する。
    analyzedMeanDbfs :: Double,
    -- | 実音声長（秒）。強制アライメントの非 blank フレームから計算する。
    analyzedSpeechDurationSeconds :: Double
  }
  deriving (Show, Eq)

instance FromJSON AnalyzerResult where
  parseJSON = withObject "AnalyzerResult" $ \o -> do
    expectedIpa <- o .: "expectedIpa"
    detectedIpa <- o .: "detectedIpa"
    perPhonemeGop <- o .: "perPhonemeGop"
    interWordSilences <- o .: "interWordSilences"
    schwaRealizations <- o .: "schwaRealizations"
    speechRate <- o .: "speechRatePhonemePerSecond"
    meanDbfs <- o .: "meanDbfs"
    speechDuration <- o .: "speechDurationSeconds"
    pure
      AnalyzerResult
        { analyzedExpectedIpa = expectedIpa,
          analyzedDetectedIpa = detectedIpa,
          analyzedPerPhonemeGop = perPhonemeGop,
          analyzedInterWordSilences = interWordSilences,
          analyzedSchwaRealizations = schwaRealizations,
          analyzedSpeechRatePhonemePerSecond = speechRate,
          analyzedMeanDbfs = meanDbfs,
          analyzedSpeechDurationSeconds = speechDuration
        }

-- ---- リクエスト型（multipart 組み立て用） ----

-- | analyzer に渡す metadata JSON。
data AnalyzerMetadata = AnalyzerMetadata
  { analyzerReferenceText :: Text,
    analyzerTargetAccent :: Text,
    analyzerMimeType :: Text,
    analyzerDurationMilliseconds :: Int
  }

instance ToJSON AnalyzerMetadata where
  toJSON meta =
    object
      [ "referenceText" .= analyzerReferenceText meta,
        "targetAccent" .= analyzerTargetAccent meta,
        "mimeType" .= analyzerMimeType meta,
        "durationMilliseconds" .= analyzerDurationMilliseconds meta
      ]

-- ---- HTTP クライアント ----

-- | python-analyzer に音声を送って AnalyzerResult を取得する。
-- 5xx の場合は 502 に変換して上位に伝播する（リトライ可能）。
analyzeAudio ::
  -- | 音声バイト列
  ByteString ->
  -- | 音声 MIME タイプ
  Text ->
  -- | 参照テキスト
  Text ->
  -- | 目標アクセント
  Text ->
  -- | 音声長（ミリ秒）
  Int ->
  Handler AnalyzerResult
analyzeAudio audioBytes mimeType referenceText targetAccent durationMilliseconds = do
  baseUrl <- resolveAnalyzerUrl
  let analyzerUrl = Text.unpack baseUrl <> "/v1/analyze"
  manager <- liftIO $ newManager tlsManagerSettings
  initialRequest <- liftIO $ parseRequest analyzerUrl
  let boundary = "native-trace-worker-boundary"
  let metadataJson =
        Aeson.encode
          AnalyzerMetadata
            { analyzerReferenceText = referenceText,
              analyzerTargetAccent = targetAccent,
              analyzerMimeType = mimeType,
              analyzerDurationMilliseconds = durationMilliseconds
            }
  let requestBody = buildMultipartBody boundary mimeType audioBytes (LBS.toStrict metadataJson)
  let contentTypeHeader =
        ( "Content-Type",
          "multipart/form-data; boundary=" <> TextEncoding.encodeUtf8 boundary
        )
  let httpRequest =
        initialRequest
          { method = "POST",
            requestBody = RequestBodyBS requestBody,
            requestHeaders = [contentTypeHeader]
          }
  response <- liftIO $ httpLbs httpRequest manager
  let httpStatus = responseStatus response
  if httpStatus == status200
    then case Aeson.eitherDecode (responseBody response) of
      Right result -> pure result
      Left decodeError ->
        throwError
          err502
            { errBody =
                LBS.fromStrict $
                  TextEncoding.encodeUtf8 $
                    "analyzer response parse error: " <> Text.pack decodeError
            }
    else
      if httpStatus >= status500
        then throwError err502 {errBody = responseBody response}
        else
          throwError
            err502
              { errBody =
                  LBS.fromStrict $
                    TextEncoding.encodeUtf8 $
                      "unexpected analyzer status: " <> Text.pack (show httpStatus)
              }

-- | ANALYZER_URL 環境変数を読む。未設定時は http://localhost:8788 を返す。
resolveAnalyzerUrl :: Handler Text
resolveAnalyzerUrl = do
  maybeUrl <- liftIO $ lookupEnv "ANALYZER_URL"
  pure $ maybe "http://localhost:8788" Text.pack maybeUrl

-- ---- multipart body 組み立て ----

-- | multipart/form-data ボディを組み立てる（audio + metadata）。
-- mimeType を audio パートの Content-Type と filename 拡張子に反映する。
buildMultipartBody :: Text -> Text -> ByteString -> ByteString -> ByteString
buildMultipartBody boundary mimeType audioBytes metadataBytes =
  let sep = TextEncoding.encodeUtf8 ("--" <> boundary)
      crlf = "\r\n"
      ext = mimeTypeToExtension mimeType
      metaPart =
        sep
          <> crlf
          <> "Content-Disposition: form-data; name=\"metadata\"\r\n"
          <> "Content-Type: application/json; charset=utf-8\r\n"
          <> crlf
          <> metadataBytes
          <> crlf
      audioPart =
        sep
          <> crlf
          <> TextEncoding.encodeUtf8 ("Content-Disposition: form-data; name=\"audio\"; filename=\"audio." <> ext <> "\"\r\n")
          <> TextEncoding.encodeUtf8 ("Content-Type: " <> mimeType <> "\r\n")
          <> crlf
          <> audioBytes
          <> crlf
      closing = sep <> "--\r\n"
   in metaPart <> audioPart <> closing

-- | MIME タイプから拡張子を返す。未知の場合は "bin"。
mimeTypeToExtension :: Text -> Text
mimeTypeToExtension mime
  | Text.isPrefixOf "audio/wav" mime = "wav"
  | Text.isPrefixOf "audio/webm" mime = "webm"
  | Text.isPrefixOf "audio/ogg" mime = "ogg"
  | Text.isPrefixOf "audio/mpeg" mime = "mp3"
  | Text.isPrefixOf "audio/mp4" mime = "m4a"
  | Text.isPrefixOf "audio/flac" mime = "flac"
  | otherwise = "bin"
