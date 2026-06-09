module NativeTrace.Worker.Types (
  HealthResponse (..),
  VersionResponse (..),
)
where

import Data.Aeson (ToJSON (..), object, (.=))
import Data.Text (Text)

newtype HealthResponse = HealthResponse
  { healthStatus :: Text
  }

instance ToJSON HealthResponse where
  toJSON response = object ["status" .= healthStatus response]

data VersionResponse = VersionResponse
  { workerVersion :: Text,
    modelVersion :: Maybe Text,
    ruleSetVersion :: Maybe Text
  }

instance ToJSON VersionResponse where
  toJSON response =
    object
      [ "workerVersion" .= workerVersion response,
        "modelVersion" .= modelVersion response,
        "ruleSetVersion" .= ruleSetVersion response
      ]
