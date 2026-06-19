module NativeTrace.Worker.Api (
  WorkerApi,
  workerApi,
)
where

import Data.Proxy (Proxy (..))
import NativeTrace.Worker.Types (
  AssessmentResponse,
  GoldenSpeakerConversionDto,
  GopDeltaRequest,
  GopDeltaResponse,
  HealthResponse,
  ShadowingLagDto,
  VersionResponse,
 )
import Servant.API (Get, JSON, Post, ReqBody, (:<|>), (:>))
import Servant.Multipart (Mem, MultipartData, MultipartForm)

type WorkerApi =
  "health" :> Get '[JSON] HealthResponse
    :<|> "version" :> Get '[JSON] VersionResponse
    :<|> "v1"
      :> "pronunciation-assessments"
      :> MultipartForm Mem (MultipartData Mem)
      :> Post '[JSON] AssessmentResponse
    :<|> "v1"
      :> "pronunciation-assessments"
      :> "shadowing"
      :> MultipartForm Mem (MultipartData Mem)
      :> Post '[JSON] ShadowingLagDto
    :<|> "golden-speaker"
      :> "convert"
      :> MultipartForm Mem (MultipartData Mem)
      :> Post '[JSON] GoldenSpeakerConversionDto
    :<|> "v1"
      :> "gop-delta"
      :> ReqBody '[JSON] GopDeltaRequest
      :> Post '[JSON] GopDeltaResponse

workerApi :: Proxy WorkerApi
workerApi = Proxy
