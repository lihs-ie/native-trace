/**
 * DrillContentAdapter — 産出ドリルコンテンツの本番データと DrillContentRepository 実装
 *
 * 設計の正: docs/specs/training-screen.md (M-TR-4, REQ-123)
 *          adr/007-training-context-bounded-context.md (識別子のみ参照)
 *
 * 各 contrast に対して:
 *   - ミニマルペア (minimalPair): 対象音素の差のみで意味が変わる語ペア
 *   - 例文 (exampleSentence): 対象音素を含む練習文
 *   - 対象音素 IPA (targetPhonemes): 例文中で評価対象となる音素 IPA 系列
 *   - catalogId: japanese-l1-catalog.json の id フィールドに対応
 *
 * japanese-l1-catalog.json の confusionSet 由来でミニマルペアを生成。
 * モックではなく本番指導コンテンツとして使用する（agent-policy: 本番モック禁止）。
 *
 * 収録対象対立:
 *   /l/-/r/ (max FL): l-r-substitution
 *   /r/-/l/ (max FL): r-substitution
 *   /v/-/b/ (high FL): v-b-substitution
 *   /θ/-/s/ (low FL): theta-s-substitution
 *   /æ/-/ʌ/ (high FL): ae-a-substitution
 *   /iː/-/ɪ/ (high FL): iː-ɪ-substitution
 */

import {
  type DrillContent,
  type DrillContentRepository,
} from "../../usecase/port/drill-content-repository";

// ---- ドリルコンテンツ本番データ ----

/**
 * DRILL_CONTENTS — 対立別産出ドリルコンテンツ
 *
 * ミニマルペアは japanese-l1-catalog.json confusionSet 由来。
 * 例文は対象音素を複数箇所に含む自然な英文。
 * hintJa は日本語話者向け指導ポイント。
 */
const DRILL_CONTENTS: ReadonlyArray<DrillContent> = [
  // ---- /l/-/r/ (max FL) ----
  {
    catalogId: "l-r-substitution",
    contrast: "/l/-/r/",
    targetPhonemes: ["/l/"],
    minimalPairs: [
      {
        targetWord: "lake",
        contrastWord: "rake",
        targetPhonemeIpa: "l",
        contrastPhonemeIpa: "r",
      },
      {
        targetWord: "light",
        contrastWord: "right",
        targetPhonemeIpa: "l",
        contrastPhonemeIpa: "r",
      },
      {
        targetWord: "long",
        contrastWord: "wrong",
        targetPhonemeIpa: "l",
        contrastPhonemeIpa: "r",
      },
    ],
    exampleSentence: "Please collect all the blue leaves.",
    exampleTargetPhonemeIpas: ["l", "l", "l", "l"],
    hintJa:
      "舌先を歯茎（上前歯の裏）に当て、舌の左右から息を流してください。舌先が歯茎に触れていることを確認してから声を出します。",
  },

  // ---- /r/-/l/ (max FL) ----
  {
    catalogId: "r-substitution",
    contrast: "/r/-/l/",
    targetPhonemes: ["/r/"],
    minimalPairs: [
      {
        targetWord: "right",
        contrastWord: "light",
        targetPhonemeIpa: "r",
        contrastPhonemeIpa: "l",
      },
      {
        targetWord: "red",
        contrastWord: "led",
        targetPhonemeIpa: "r",
        contrastPhonemeIpa: "l",
      },
      {
        targetWord: "room",
        contrastWord: "loom",
        targetPhonemeIpa: "r",
        contrastPhonemeIpa: "l",
      },
    ],
    exampleSentence: "The red roses grow really well here.",
    exampleTargetPhonemeIpas: ["r", "r", "r"],
    hintJa:
      "舌先を後ろに引き、口蓋には当てません。唇をわずかに丸め、舌全体をやや後方に引いて声を出します。舌先が歯茎に触れないよう注意してください。",
  },

  // ---- /v/-/b/ (high FL) ----
  {
    catalogId: "v-b-substitution",
    contrast: "/v/-/b/",
    targetPhonemes: ["/v/"],
    minimalPairs: [
      {
        targetWord: "van",
        contrastWord: "ban",
        targetPhonemeIpa: "v",
        contrastPhonemeIpa: "b",
      },
      {
        targetWord: "vine",
        contrastWord: "bine",
        targetPhonemeIpa: "v",
        contrastPhonemeIpa: "b",
      },
      {
        targetWord: "vote",
        contrastWord: "boat",
        targetPhonemeIpa: "v",
        contrastPhonemeIpa: "b",
      },
    ],
    exampleSentence: "Very brave volunteers visited the village.",
    exampleTargetPhonemeIpas: ["v", "v", "v"],
    hintJa:
      "上前歯を下唇に軽く当て、その状態で声を出しながら息を流します。唇を完全には閉じません（閉じると /b/ になります）。",
  },

  // ---- /θ/-/s/ (low FL) ----
  {
    catalogId: "theta-s-substitution",
    contrast: "/θ/-/s/",
    targetPhonemes: ["/θ/"],
    minimalPairs: [
      {
        targetWord: "think",
        contrastWord: "sink",
        targetPhonemeIpa: "θ",
        contrastPhonemeIpa: "s",
      },
      {
        targetWord: "thumb",
        contrastWord: "sum",
        targetPhonemeIpa: "θ",
        contrastPhonemeIpa: "s",
      },
      {
        targetWord: "thin",
        contrastWord: "sin",
        targetPhonemeIpa: "θ",
        contrastPhonemeIpa: "s",
      },
    ],
    exampleSentence: "I think three things are worth thanking for.",
    exampleTargetPhonemeIpas: ["θ", "θ", "θ", "θ"],
    hintJa:
      "舌先を上前歯の縁に軽く当て（または歯の間に軽く挟み）、息を細く流します。声帯は振動させません（無声音）。",
  },

  // ---- /æ/-/ʌ/ (high FL) ----
  {
    catalogId: "ae-a-substitution",
    contrast: "/æ/-/ʌ/",
    targetPhonemes: ["/æ/"],
    minimalPairs: [
      {
        targetWord: "cat",
        contrastWord: "cut",
        targetPhonemeIpa: "æ",
        contrastPhonemeIpa: "ʌ",
      },
      {
        targetWord: "bag",
        contrastWord: "bug",
        targetPhonemeIpa: "æ",
        contrastPhonemeIpa: "ʌ",
      },
      {
        targetWord: "cap",
        contrastWord: "cup",
        targetPhonemeIpa: "æ",
        contrastPhonemeIpa: "ʌ",
      },
    ],
    exampleSentence: "The black cat sat flat on the mat.",
    exampleTargetPhonemeIpas: ["æ", "æ", "æ", "æ"],
    hintJa:
      "口を大きく横に広げ、顎を下げて舌を前方低位に置きます。日本語の「ア」より口を横に引いて発音します。",
  },

  // ---- /iː/-/ɪ/ (high FL) ----
  {
    catalogId: "iː-ɪ-substitution",
    contrast: "/iː/-/ɪ/",
    targetPhonemes: ["/iː/"],
    minimalPairs: [
      {
        targetWord: "seat",
        contrastWord: "sit",
        targetPhonemeIpa: "iː",
        contrastPhonemeIpa: "ɪ",
      },
      {
        targetWord: "beat",
        contrastWord: "bit",
        targetPhonemeIpa: "iː",
        contrastPhonemeIpa: "ɪ",
      },
      {
        targetWord: "feet",
        contrastWord: "fit",
        targetPhonemeIpa: "iː",
        contrastPhonemeIpa: "ɪ",
      },
    ],
    exampleSentence: "Please feel free to see these trees.",
    exampleTargetPhonemeIpas: ["iː", "iː", "iː", "iː"],
    hintJa:
      "口を横に引き、舌を口蓋に近づけて長めに発音します。/ɪ/ より緊張感を持たせ、明確に長く伸ばします。",
  },
];

// ---- DrillContentRepository 実装 ----

/**
 * createDrillContentRepository — 本番データを持つ DrillContentRepository を返す。
 * infrastructure 層での組み立て。registry で Container に注入する。
 */
export const createDrillContentRepository = (): DrillContentRepository => ({
  findByCatalogId: (catalogId: string): DrillContent | null =>
    DRILL_CONTENTS.find((content) => content.catalogId === catalogId) ?? null,

  findByContrast: (contrast: string): DrillContent | null =>
    DRILL_CONTENTS.find((content) => content.contrast === contrast) ?? null,

  getAll: (): ReadonlyArray<DrillContent> => DRILL_CONTENTS,
});
