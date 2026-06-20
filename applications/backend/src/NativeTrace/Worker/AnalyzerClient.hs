-- | python-analyzer への HTTP クライアント。
-- POST /v1/analyze を呼び出し AnalyzerResult を返す。
-- POST /v1/shadowing-lag を呼び出し AnalyzerShadowingLagResult を返す。
-- ANALYZER_URL 環境変数で接続先を変える（デフォルト: http://localhost:8788）。
module NativeTrace.Worker.AnalyzerClient (
  AnalyzerResult (..),
  PhonemeGop (..),
  NBestEntry (..),
  InterWordSilence (..),
  SchwaRealization (..),
  F0Contour (..),
  WordStress (..),
  Rhythm (..),
  WeakFormRealization (..),
  SyllableInfo (..),
  InsertedVowelInfo (..),
  PhonemeAcoustic (..),
  AnalyzerShadowingLagResult (..),
  analyzeAudio,
  analyzeShadowingLag,
)
where

import Control.Monad.IO.Class (liftIO)
import Data.Aeson (FromJSON (..), ToJSON (..), object, withObject, (.!=), (.:), (.:?), (.=))
import Data.Aeson qualified as Aeson
import Data.ByteString (ByteString)
import Data.ByteString.Lazy qualified as LBS
import Data.Text (Text)
import Data.Text qualified as Text
import Data.Text.Encoding qualified as TextEncoding
import NativeTrace.Worker.Types (PerSegmentLagEntry (..))
import Network.HTTP.Client (
  Request (..),
  RequestBody (..),
  httpLbs,
  newManager,
  parseRequest,
  responseBody,
  responseStatus,
  responseTimeoutMicro,
 )
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types (status200, status500)
import Servant (Handler, ServerError (..), err502, throwError)
import System.Environment (lookupEnv)
import Text.Read (readMaybe)

-- ---- レスポンス型 ----

-- | NBest 候補エントリ（C1-a）。
data NBestEntry = NBestEntry
  { nBestPhoneme :: Text,
    nBestConfidence :: Double
  }
  deriving (Show, Eq)

instance FromJSON NBestEntry where
  parseJSON = withObject "NBestEntry" $ \o -> do
    phoneme <- o .: "phoneme"
    confidence <- o .: "confidence"
    pure NBestEntry {nBestPhoneme = phoneme, nBestConfidence = confidence}

-- | 1 音素の GOP 計測値（C1-a: nBest 追加）。
data PhonemeGop = PhonemeGop
  { gopPhoneme :: Text,
    gopValue :: Double,
    gopStartMs :: Int,
    gopEndMs :: Int,
    -- | NBest 候補リスト（C1-a）。analyzer が返さない場合は空リスト。
    gopNBest :: [NBestEntry],
    -- | 音素の単語内位置（M-104R / C-A2W）。値は "initial" | "medial" | "final"。
    -- analyzer が返さない場合は Nothing。
    gopWordPosition :: Maybe Text
  }
  deriving (Show, Eq)

instance FromJSON PhonemeGop where
  parseJSON = withObject "PhonemeGop" $ \o -> do
    phoneme <- o .: "phoneme"
    gopVal <- o .: "gop"
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    nBest <- o .:? "nBest" .!= []
    wordPosition <- o .:? "wordPosition" .!= Nothing
    pure
      PhonemeGop
        { gopPhoneme = phoneme,
          gopValue = gopVal,
          gopStartMs = startMs,
          gopEndMs = endMs,
          gopNBest = nBest,
          gopWordPosition = wordPosition
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

-- | F0 輪郭データ（C1-b）。
data F0Contour = F0Contour
  { f0TimesMs :: [Int],
    f0ValuesHz :: [Double]
  }
  deriving (Show, Eq)

instance FromJSON F0Contour where
  parseJSON = withObject "F0Contour" $ \o -> do
    timesMs <- o .: "timesMs"
    valuesHz <- o .: "valuesHz"
    pure F0Contour {f0TimesMs = timesMs, f0ValuesHz = valuesHz}

-- | 語強勢データ（C1-c）。
data WordStress = WordStress
  { wordStressWord :: Text,
    wordStressWordIndex :: Int,
    wordStressStartMs :: Int,
    wordStressEndMs :: Int,
    wordStressExpected :: Int,
    wordStressPredicted :: Int
  }
  deriving (Show, Eq)

instance FromJSON WordStress where
  parseJSON = withObject "WordStress" $ \o -> do
    word <- o .: "word"
    wordIndex <- o .: "wordIndex"
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    expectedStress <- o .: "expectedStress"
    predictedStress <- o .: "predictedStress"
    pure
      WordStress
        { wordStressWord = word,
          wordStressWordIndex = wordIndex,
          wordStressStartMs = startMs,
          wordStressEndMs = endMs,
          wordStressExpected = expectedStress,
          wordStressPredicted = predictedStress
        }

-- | リズム指標（C1-d）。
data Rhythm = Rhythm
  { rhythmNpviVocalic :: Double,
    rhythmReferenceNpviVocalic :: Double
  }
  deriving (Show, Eq)

instance FromJSON Rhythm where
  parseJSON = withObject "Rhythm" $ \o -> do
    npvi <- o .: "npviVocalic"
    refNpvi <- o .: "referenceNpviVocalic"
    pure Rhythm {rhythmNpviVocalic = npvi, rhythmReferenceNpviVocalic = refNpvi}

-- | 弱形実現データ（C1-e）。
data WeakFormRealization = WeakFormRealization
  { weakFormWord :: Text,
    weakFormWordIndex :: Int,
    weakFormStartMs :: Int,
    weakFormEndMs :: Int,
    weakFormExpectedWeak :: Bool,
    weakFormRealizedWeak :: Bool
  }
  deriving (Show, Eq)

instance FromJSON WeakFormRealization where
  parseJSON = withObject "WeakFormRealization" $ \o -> do
    word <- o .: "word"
    wordIndex <- o .: "wordIndex"
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    expectedWeak <- o .: "expectedWeak"
    realizedWeak <- o .: "realizedWeak"
    pure
      WeakFormRealization
        { weakFormWord = word,
          weakFormWordIndex = wordIndex,
          weakFormStartMs = startMs,
          weakFormEndMs = endMs,
          weakFormExpectedWeak = expectedWeak,
          weakFormRealizedWeak = realizedWeak
        }

-- | 挿入母音情報（C1-f の insertedVowels 要素）。
data InsertedVowelInfo = InsertedVowelInfo
  { insertedVowelPositionMs :: Int,
    insertedVowelPhoneme :: Text
  }
  deriving (Show, Eq)

instance FromJSON InsertedVowelInfo where
  parseJSON = withObject "InsertedVowelInfo" $ \o -> do
    posMs <- o .: "positionMs"
    vowel <- o .: "vowel"
    pure InsertedVowelInfo {insertedVowelPositionMs = posMs, insertedVowelPhoneme = vowel}

-- | 音素ごとの音響計測値（ADR-018 D1）。analyzer が返す生 Hz / 母音長 / スペクトル重心。
-- 偏差判定・方向ラベル導出は worker Scoring.hs が行う（ADR-004 scoring policy 所有）。
data PhonemeAcoustic = PhonemeAcoustic
  { acousticPhoneme :: Text,
    acousticStartMs :: Int,
    acousticEndMs :: Int,
    -- | フォルマント F1 Hz。40ms 未満の区間では None（短区間 LPC 不安定ガード）。
    acousticF1Hz :: Maybe Double,
    -- | フォルマント F2 Hz。
    acousticF2Hz :: Maybe Double,
    -- | フォルマント F3 Hz。
    acousticF3Hz :: Maybe Double,
    -- | スペクトル重心 Hz。30ms 未満の区間では None。
    acousticSpectralCentroidHz :: Maybe Double,
    acousticDurationMs :: Int
  }
  deriving (Show, Eq)

instance FromJSON PhonemeAcoustic where
  parseJSON = withObject "PhonemeAcoustic" $ \o -> do
    phoneme <- o .: "phoneme"
    startMs <- o .: "startMs"
    endMs <- o .: "endMs"
    f1Hz <- o .:? "f1Hz"
    f2Hz <- o .:? "f2Hz"
    f3Hz <- o .:? "f3Hz"
    spectralCentroidHz <- o .:? "spectralCentroidHz"
    durationMs <- o .: "durationMs"
    pure
      PhonemeAcoustic
        { acousticPhoneme = phoneme,
          acousticStartMs = startMs,
          acousticEndMs = endMs,
          acousticF1Hz = f1Hz,
          acousticF2Hz = f2Hz,
          acousticF3Hz = f3Hz,
          acousticSpectralCentroidHz = spectralCentroidHz,
          acousticDurationMs = durationMs
        }

-- | 音節情報（C1-f）。
data SyllableInfo = SyllableInfo
  { syllableInfoWord :: Text,
    syllableInfoWordIndex :: Int,
    syllableInfoExpectedCount :: Int,
    syllableInfoActualCount :: Int,
    syllableInfoInsertedVowels :: [InsertedVowelInfo]
  }
  deriving (Show, Eq)

instance FromJSON SyllableInfo where
  parseJSON = withObject "SyllableInfo" $ \o -> do
    word <- o .: "word"
    wordIndex <- o .: "wordIndex"
    expectedCount <- o .: "expectedSyllableCount"
    actualCount <- o .: "actualSyllableCount"
    insertedVowels <- o .:? "insertedVowels" .!= []
    pure
      SyllableInfo
        { syllableInfoWord = word,
          syllableInfoWordIndex = wordIndex,
          syllableInfoExpectedCount = expectedCount,
          syllableInfoActualCount = actualCount,
          syllableInfoInsertedVowels = insertedVowels
        }

-- | python-analyzer の POST /v1/analyze レスポンス（C1 全フィールド対応）。
data AnalyzerResult = AnalyzerResult
  { analyzedExpectedIpa :: Text,
    analyzedDetectedIpa :: Text,
    analyzedPerPhonemeGop :: [PhonemeGop],
    analyzedInterWordSilences :: [InterWordSilence],
    analyzedSchwaRealizations :: [SchwaRealization],
    analyzedSpeechRatePhonemePerSecond :: Double,
    -- | 発話区間フレーム RMS の dBFS（代表的な発話ラウドネス）。python-analyzer が計測して付与する。
    -- ADR-015 D1 で全区間 RMS から発話区間 RMS（speech-active frame RMS）へ意味を移行した。
    -- wire 名 "meanDbfs" / 型 Double は変更なし。発話フレームなし（no-speech）時は -100.0 dBFS。
    analyzedMeanDbfs :: Double,
    -- | 実音声長（秒）。強制アライメントの非 blank フレームから計算する。
    analyzedSpeechDurationSeconds :: Double,
    -- | F0 輪郭（C1-b）。analyzer が返さない場合は Nothing。
    analyzedF0Contour :: Maybe F0Contour,
    -- | お手本 F0 輪郭（M-F0REF-b）。referenceText から TTS 合成・抽出した F0 輪郭。
    -- analyzer が返さない場合（旧 analyzer / 抽出失敗）は Nothing。
    analyzedReferenceF0Contour :: Maybe F0Contour,
    -- | 語強勢リスト（C1-c）。analyzer が返さない場合は空リスト。
    analyzedWordStress :: [WordStress],
    -- | リズム指標（C1-d）。analyzer が返さない場合は Nothing。
    analyzedRhythm :: Maybe Rhythm,
    -- | 弱形実現リスト（C1-e）。analyzer が返さない場合は空リスト。
    analyzedWeakFormRealizations :: [WeakFormRealization],
    -- | 音節情報リスト（C1-f）。analyzer が返さない場合は空リスト。
    analyzedSyllables :: [SyllableInfo],
    -- | 音素ごとの音響計測値リスト（ADR-018 D1）。analyzer が返さない場合は空リスト。
    analyzedPhonemeAcoustics :: [PhonemeAcoustic],
    -- | 話者性別（ADR-018 D2）。analyzer が返さない場合は "unknown"。値は "M" / "F" / "unknown"。
    analyzerSpeakerSex :: Text,
    -- | 推定 SNR（dB）。python-analyzer が計測して付与する（ADR-032 M-SNR-3）。
    -- 旧 analyzer イメージとのローリング再ビルド期間中は 0.0 にフォールバックする。
    analyzedEstimatedSnrDb :: Double
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
    f0Contour <- o .:? "f0Contour"
    referenceF0Contour <- o .:? "referenceF0Contour"
    wordStress <- o .:? "wordStress" .!= []
    rhythm <- o .:? "rhythm"
    weakFormRealizations <- o .:? "weakFormRealizations" .!= []
    syllables <- o .:? "syllables" .!= []
    phonemeAcoustics <- o .:? "phonemeAcoustics" .!= []
    speakerSex <- o .:? "speakerSex" .!= "unknown"
    estimatedSnrDb <- o .:? "estimatedSnrDb" .!= 0.0
    pure
      AnalyzerResult
        { analyzedExpectedIpa = expectedIpa,
          analyzedDetectedIpa = detectedIpa,
          analyzedPerPhonemeGop = perPhonemeGop,
          analyzedInterWordSilences = interWordSilences,
          analyzedSchwaRealizations = schwaRealizations,
          analyzedSpeechRatePhonemePerSecond = speechRate,
          analyzedMeanDbfs = meanDbfs,
          analyzedSpeechDurationSeconds = speechDuration,
          analyzedF0Contour = f0Contour,
          analyzedReferenceF0Contour = referenceF0Contour,
          analyzedWordStress = wordStress,
          analyzedRhythm = rhythm,
          analyzedWeakFormRealizations = weakFormRealizations,
          analyzedSyllables = syllables,
          analyzedPhonemeAcoustics = phonemeAcoustics,
          analyzerSpeakerSex = speakerSex,
          analyzedEstimatedSnrDb = estimatedSnrDb
        }

-- | python-analyzer の POST /v1/shadowing-lag レスポンス（M-SHL-3 / ADR-013）。
-- analyzer の生計測値をそのまま保持する。閾値判定は worker 側で行う。
data AnalyzerShadowingLagResult = AnalyzerShadowingLagResult
  { analyzerLagMilliseconds :: Double,
    analyzerPerSegmentLag :: [PerSegmentLagEntry],
    analyzerSpeechRateRatio :: Maybe Double,
    analyzerPauseCountLearner :: Maybe Int,
    analyzerPauseCountReference :: Maybe Int
  }
  deriving (Show, Eq)

instance FromJSON AnalyzerShadowingLagResult where
  parseJSON = withObject "AnalyzerShadowingLagResult" $ \o -> do
    lagMs <- o .: "lagMilliseconds"
    perSegmentLag <- o .:? "perSegmentLag" .!= []
    speechRateRatio <- o .:? "speechRateRatio"
    pauseCountLearner <- o .:? "pauseCountLearner"
    pauseCountReference <- o .:? "pauseCountReference"
    pure
      AnalyzerShadowingLagResult
        { analyzerLagMilliseconds = lagMs,
          analyzerPerSegmentLag = perSegmentLag,
          analyzerSpeechRateRatio = speechRateRatio,
          analyzerPauseCountLearner = pauseCountLearner,
          analyzerPauseCountReference = pauseCountReference
        }

-- ---- リクエスト型（multipart 組み立て用） ----

-- | analyzer に渡す metadata JSON。
-- S-APD-5: speakerSex は wire に乗せていない（AnalyzerMetadata に speakerSex フィールドを追加していない）。
-- M/F 活性化は UI 収集動線 + FE request-mapper + ここの Haskell 側 metadata 3 層の product 判断。
-- 現状は AnalyzerResult.analyzerSpeakerSex が analyzeAudio 応答の speakerSex echo から取得されるが、
-- リクエスト metadata 側には speakerSex を送っていないため analyzer 側は常に default "unknown" を返す。
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

-- | shadowing-lag エンドポイントに渡す metadata JSON。
data ShadowingMetadata = ShadowingMetadata
  { shadowingMetadataReferenceText :: Text,
    shadowingMetadataMimeType :: Text,
    shadowingMetadataDurationMilliseconds :: Int
  }

instance ToJSON ShadowingMetadata where
  toJSON meta =
    object
      [ "referenceText" .= shadowingMetadataReferenceText meta,
        "mimeType" .= shadowingMetadataMimeType meta,
        "durationMilliseconds" .= shadowingMetadataDurationMilliseconds meta
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
  timeoutSeconds <- resolveAnalyzerTimeoutSeconds
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
            requestHeaders = [contentTypeHeader],
            responseTimeout = responseTimeoutMicro (timeoutSeconds * 1000000)
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

-- | python-analyzer の POST /v1/shadowing-lag を呼び出し AnalyzerShadowingLagResult を取得する。
-- reference_audio + learner_audio + metadata を multipart/form-data で送信する（ADR-013）。
-- 5xx の場合は 502 に変換して上位に伝播する。
analyzeShadowingLag ::
  -- | お手本音声バイト列（Kokoro TTS 生成済み）
  ByteString ->
  -- | 学習者録音バイト列
  ByteString ->
  -- | 音声 MIME タイプ（両音声共通）
  Text ->
  -- | 参照テキスト
  Text ->
  -- | 音声長（ミリ秒）
  Int ->
  Handler AnalyzerShadowingLagResult
analyzeShadowingLag referenceAudioBytes learnerAudioBytes mimeType referenceText durationMilliseconds = do
  baseUrl <- resolveAnalyzerUrl
  timeoutSeconds <- resolveAnalyzerTimeoutSeconds
  let analyzerUrl = Text.unpack baseUrl <> "/v1/shadowing-lag"
  manager <- liftIO $ newManager tlsManagerSettings
  initialRequest <- liftIO $ parseRequest analyzerUrl
  let boundary = "native-trace-shadowing-boundary"
  let metadataJson =
        Aeson.encode
          ShadowingMetadata
            { shadowingMetadataReferenceText = referenceText,
              shadowingMetadataMimeType = mimeType,
              shadowingMetadataDurationMilliseconds = durationMilliseconds
            }
  let requestBody =
        buildShadowingMultipartBody
          boundary
          mimeType
          referenceAudioBytes
          learnerAudioBytes
          (LBS.toStrict metadataJson)
  let contentTypeHeader =
        ( "Content-Type",
          "multipart/form-data; boundary=" <> TextEncoding.encodeUtf8 boundary
        )
  let httpRequest =
        initialRequest
          { method = "POST",
            requestBody = RequestBodyBS requestBody,
            requestHeaders = [contentTypeHeader],
            responseTimeout = responseTimeoutMicro (timeoutSeconds * 1000000)
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
                    "shadowing-lag response parse error: " <> Text.pack decodeError
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
                      "unexpected shadowing-lag status: " <> Text.pack (show httpStatus)
              }

-- | ANALYZER_URL 環境変数を読む。未設定時は http://localhost:8788 を返す。
resolveAnalyzerUrl :: Handler Text
resolveAnalyzerUrl = do
  maybeUrl <- liftIO $ lookupEnv "ANALYZER_URL"
  pure $ maybe "http://localhost:8788" Text.pack maybeUrl

-- | ANALYZER_TIMEOUT_SECONDS 環境変数を読む。未設定/不正時は 120 秒を返す。
resolveAnalyzerTimeoutSeconds :: Handler Int
resolveAnalyzerTimeoutSeconds = do
  maybeRaw <- liftIO $ lookupEnv "ANALYZER_TIMEOUT_SECONDS"
  pure $ case maybeRaw >>= readMaybe of
    Just n | n > 0 -> n
    _ -> 120

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

-- | shadowing-lag 用 multipart body を組み立てる（reference_audio + learner_audio + metadata）。
-- analyzer の POST /v1/shadowing-lag が期待するフィールド名に合わせる（ADR-013）。
buildShadowingMultipartBody ::
  Text -> Text -> ByteString -> ByteString -> ByteString -> ByteString
buildShadowingMultipartBody boundary mimeType referenceBytes learnerBytes metadataBytes =
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
      referencePart =
        sep
          <> crlf
          <> TextEncoding.encodeUtf8 ("Content-Disposition: form-data; name=\"reference_audio\"; filename=\"reference." <> ext <> "\"\r\n")
          <> TextEncoding.encodeUtf8 ("Content-Type: " <> mimeType <> "\r\n")
          <> crlf
          <> referenceBytes
          <> crlf
      learnerPart =
        sep
          <> crlf
          <> TextEncoding.encodeUtf8 ("Content-Disposition: form-data; name=\"learner_audio\"; filename=\"learner." <> ext <> "\"\r\n")
          <> TextEncoding.encodeUtf8 ("Content-Type: " <> mimeType <> "\r\n")
          <> crlf
          <> learnerBytes
          <> crlf
      closing = sep <> "--\r\n"
   in metaPart <> referencePart <> learnerPart <> closing

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
