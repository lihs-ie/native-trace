/**
 * phenomenon アイコン・ラベル変換ヘルパ（純関数）
 * workspace-v2.html の `.hl-ico` / `.phen` に対応する。
 * M-CODE: phenomenon は色を割り当てず、アイコン + ラベルのみで識別する。
 */

import type { FindingPhenomenon } from "./api-types";

/** phenomenon → `.hl-ico` に表示するアイコン文字 */
export const PHENOMENON_ICONS: Record<FindingPhenomenon, string> = {
  substitution: "⇄",
  omission: "∅",
  insertion: "+",
  connectedSpeech: "‿",
  weakForm: "ə",
  linking: "‿",
  flap: "ɾ",
  assimilation: "≈",
  reduction: "↓",
  epenthesis: "‸",
  lexicalStress: "ˈ",
};

/** phenomenon → `.phen .pe` に表示する英語ラベル */
export const PHENOMENON_LABELS_EN: Record<FindingPhenomenon, string> = {
  substitution: "substitution",
  omission: "omission",
  insertion: "insertion",
  connectedSpeech: "connected speech",
  weakForm: "weak form",
  linking: "linking",
  flap: "flap",
  assimilation: "assimilation",
  reduction: "reduction",
  epenthesis: "epenthesis",
  lexicalStress: "lexical stress",
};

/** phenomenon → `.phen` に表示する日本語ラベル */
export const PHENOMENON_LABELS_JA: Record<FindingPhenomenon, string> = {
  substitution: "置換",
  omission: "脱落",
  insertion: "挿入",
  connectedSpeech: "連結",
  weakForm: "弱形",
  linking: "連結",
  flap: "フラップ",
  assimilation: "同化",
  reduction: "縮約",
  epenthesis: "母音挿入",
  lexicalStress: "語強勢",
};

export const getPhenomenonIcon = (phenomenon: FindingPhenomenon | null): string => {
  if (!phenomenon) return "";
  return PHENOMENON_ICONS[phenomenon] ?? "";
};

export const getPhenomenonLabelJa = (phenomenon: FindingPhenomenon | null): string => {
  if (!phenomenon) return "";
  return PHENOMENON_LABELS_JA[phenomenon] ?? "";
};

export const getPhenomenonLabelEn = (phenomenon: FindingPhenomenon | null): string => {
  if (!phenomenon) return "";
  return PHENOMENON_LABELS_EN[phenomenon] ?? "";
};

/**
 * confidence 数値 (0–1) を 3 段階レベルに変換する。
 * M-108 準拠: high >= 0.75, mid >= 0.5, low < 0.5
 */
export const confidenceToLevel = (confidence: number): "high" | "mid" | "low" => {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "mid";
  return "low";
};

/**
 * 低信頼度の閾値（この値未満は .hedge/.fold に入れる）
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * 診断プロンプトの phenomenon（segmental/epenthesis/prosodic）→ 日本語ラベル。
 * 上記 FindingPhenomenon 用の PHENOMENON_LABELS_JA/EN とは異なる型のため別名で持つ。
 */
export const PHENOMENON_LABELS: Record<"segmental" | "epenthesis" | "prosodic", string> = {
  segmental: "分節音対立",
  epenthesis: "母音挿入",
  prosodic: "韻律・強勢",
};

/**
 * contrast 文字列のヒューリスティックから phenomenon アイコンを推定する
 * （診断結果画面: DiagnosticFocusSoundDto.contrast のような自由記述文字列向け）。
 */
export const getPhenomenonIconForContrast = (contrast: string): string => {
  if (contrast.includes("/") || contrast.includes("·")) return "⇄";
  if (contrast.toLowerCase().includes("epenthesis") || contrast.toLowerCase().includes("母音"))
    return "‸";
  if (
    contrast.toLowerCase().includes("stress") ||
    contrast.toLowerCase().includes("rhythm") ||
    contrast.toLowerCase().includes("prosod")
  )
    return "ˈ";
  return "⇄";
};
