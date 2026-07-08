-- | 日本語話者誤りカタログ（Haskell 側参照テーブル）。
-- frontend の japanese-l1-catalog.json と同一 id を使う。
-- Scoring.hs が NBest 照合・FL 重み付け・focusSounds 生成で参照する。
module NativeTrace.Worker.Catalog (
  FunctionalLoad (..),
  CatalogEntry (..),
  catalog,
  lookupByPhoneme,
  lookupByConfusion,
  flRank,
)
where

import Data.List (find)
import Data.Text (Text)

-- | Functional Load ランク（Brown 1988 準拠）。
data FunctionalLoad
  = FLMax
  | FLHigh
  | FLMid
  | FLLow
  deriving (Show, Eq, Ord)

-- | カタログエントリ（frontend JSON と同一 id を使用）。
data CatalogEntry = CatalogEntry
  { catalogIdentifier :: Text,
    -- | 対象音素（IPA）。
    catalogTargetPhoneme :: Text,
    -- | 混同候補音素リスト（IPA）。
    catalogConfusionSet :: [Text],
    -- | Functional Load ランク。
    catalogFunctionalLoad :: FunctionalLoad,
    -- | 現象種別（phenomenon 文字列）。
    catalogPhenomenon :: Text,
    -- | 優先度理由文（日本語、focusSounds.reasonJa に使用）。
    catalogReasonJa :: Text
  }
  deriving (Show, Eq)

-- | FL ランクを文字列に変換する（C3 JSON 出力用）。
flRank :: FunctionalLoad -> Text
flRank FLMax = "max"
flRank FLHigh = "high"
flRank FLMid = "mid"
flRank FLLow = "low"

-- | 対象音素で検索する。
lookupByPhoneme :: Text -> Maybe CatalogEntry
lookupByPhoneme phoneme = find (\e -> catalogTargetPhoneme e == phoneme) catalog

-- | 混同候補音素で検索する（NBest 照合用）。
-- 候補 IPA が confusionSet に含まれていれば対応エントリを返す。
lookupByConfusion :: Text -> Text -> Maybe CatalogEntry
lookupByConfusion expectedPhoneme detectedPhoneme =
  find
    ( \e ->
        catalogTargetPhoneme e == expectedPhoneme
          && detectedPhoneme `elem` catalogConfusionSet e
    )
    catalog

-- ---- カタログデータ（frontend japanese-l1-catalog.json と同期） ----

catalog :: [CatalogEntry]
catalog =
  [ CatalogEntry
      { catalogIdentifier = "l-r-substitution",
        catalogTargetPhoneme = "l",
        catalogConfusionSet = ["ɾ", "r"],
        catalogFunctionalLoad = FLMax,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "弾き音 [ɾ] への合流。別語に聞こえる最大要因。"
      },
    CatalogEntry
      { catalogIdentifier = "r-substitution",
        catalogTargetPhoneme = "r",
        catalogConfusionSet = ["ɾ", "l"],
        catalogFunctionalLoad = FLMax,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "弾き音 [ɾ] への合流。/l/ との区別が失われる。"
      },
    CatalogEntry
      { catalogIdentifier = "theta-s-substitution",
        catalogTargetPhoneme = "θ",
        catalogConfusionSet = ["s"],
        catalogFunctionalLoad = FLLow,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "/θ/ は日本語にない音。[s] への知覚同化が起きる。"
      },
    CatalogEntry
      { catalogIdentifier = "eth-z-substitution",
        catalogTargetPhoneme = "ð",
        catalogConfusionSet = ["z", "d"],
        catalogFunctionalLoad = FLLow,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "/ð/ は日本語にない音。[z] または [d] への知覚同化。"
      },
    CatalogEntry
      { catalogIdentifier = "v-b-substitution",
        catalogTargetPhoneme = "v",
        catalogConfusionSet = ["b"],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "唇歯摩擦音 /v/ を両唇破裂音 [b] で代替。"
      },
    CatalogEntry
      { catalogIdentifier = "s-sh-substitution",
        catalogTargetPhoneme = "s",
        catalogConfusionSet = ["ɕ"],
        catalogFunctionalLoad = FLMid,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "/i/ 前位置での /s/ が [ɕ]（日本語のシ）に口蓋化する。"
      },
    CatalogEntry
      { catalogIdentifier = "final-consonant-omission",
        catalogTargetPhoneme = "C#",
        catalogConfusionSet = [],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "omission",
        catalogReasonJa = "語末閉鎖音の省略。日本語の CV 音節構造の干渉。"
      },
    CatalogEntry
      { catalogIdentifier = "ae-a-substitution",
        catalogTargetPhoneme = "æ",
        catalogConfusionSet = ["a"],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "/æ/ と /ʌ/ がいずれも日本語 /a/ に収束。bat/but の区別に影響。"
      },
    CatalogEntry
      { catalogIdentifier = "iː-ɪ-substitution",
        catalogTargetPhoneme = "iː",
        catalogConfusionSet = ["iː", "i"],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "長短の音質差（緊張/弛緩）を長さだけで区別しようとする。"
      },
    CatalogEntry
      { catalogIdentifier = "schwa-substitution",
        catalogTargetPhoneme = "ə",
        catalogConfusionSet = ["a", "o", "u"],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "非強勢音節でシュワー化せず表記母音をそのまま読む。リズム硬直化の主因。"
      },
    CatalogEntry
      { catalogIdentifier = "vowel-length-substitution",
        catalogTargetPhoneme = "V:",
        catalogConfusionSet = [],
        catalogFunctionalLoad = FLMid,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "英語の長短対立は長さ+音質の両方で決まるが、長さのみで区別しようとする。"
      },
    CatalogEntry
      { catalogIdentifier = "alpha-a-substitution",
        catalogTargetPhoneme = "ɑ",
        catalogConfusionSet = ["a"],
        catalogFunctionalLoad = FLMid,
        catalogPhenomenon = "substitution",
        catalogReasonJa = "後舌低母音 /ɑ/ を日本語 /a/ で代替。hot/hat の区別が失われる。"
      },
    CatalogEntry
      { catalogIdentifier = "epenthesis",
        catalogTargetPhoneme = "C",
        catalogConfusionSet = ["ɯ", "o", "i"],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "epenthesis",
        catalogReasonJa = "子音連続への母音挿入（錯覚母音）。日本語 CV 音節構造の知覚干渉。"
      },
    CatalogEntry
      { catalogIdentifier = "lexical-stress-error",
        catalogTargetPhoneme = "σ",
        catalogConfusionSet = [],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "lexicalStress",
        catalogReasonJa = "語強勢の平板化。日本語ピッチアクセント習慣の干渉。"
      },
    CatalogEntry
      { catalogIdentifier = "weak-form-realization",
        catalogTargetPhoneme = "Fw",
        catalogConfusionSet = [],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "weakForm",
        catalogReasonJa = "機能語の強形読み。弱形の概念が日本語にないため英語リズムが破綻する。"
      },
    CatalogEntry
      { catalogIdentifier = "rhythm-npvi",
        catalogTargetPhoneme = "nPVI",
        catalogConfusionSet = [],
        catalogFunctionalLoad = FLHigh,
        catalogPhenomenon = "reduction",
        catalogReasonJa = "モーラ等時間リズム（日本語）。英語の強勢拍リズムと対立。"
      },
    CatalogEntry
      { catalogIdentifier = "connected-speech-linking",
        catalogTargetPhoneme = "linking",
        catalogConfusionSet = [],
        catalogFunctionalLoad = FLMid,
        catalogPhenomenon = "linking",
        catalogReasonJa = "語境界での連結欠如。日本語は各音節が独立するため連結が生じにくい。"
      }
  ]
