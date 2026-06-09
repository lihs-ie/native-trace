module NativeTrace.Worker.Api (
  WorkerApi,
  workerApi,
)
where

import Data.Aeson (Value)
import Data.Proxy (Proxy (..))
import NativeTrace.Worker.Types (HealthResponse, VersionResponse)
import Servant.API (Get, JSON, Post, ReqBody, (:<|>), (:>))

type WorkerApi =
  "health" :> Get '[JSON] HealthResponse
    :<|> "version" :> Get '[JSON] VersionResponse
    :<|> "v1" :> "pronunciation-assessments" :> ReqBody '[JSON] Value :> Post '[JSON] Value

workerApi :: Proxy WorkerApi
workerApi = Proxy
