/**
 * RuleBased ImprovementMessageGenerator。
 * acl 層の実装。phenomenon ごとの固定日本語テンプレートで messageJa を生成する。
 * クラス構文禁止。factory + plain object パターン。
 */

import {
  type ImprovementMessageGenerator,
  type ImprovementMessageGeneratorInput,
} from "../../../usecase/port/improvement-message-generator";

/**
 * expected/detected から表示用テキストを取得する。
 * text が非 null なら text、null なら ipa、両方 null なら null。
 */
const resolveDisplayText = (
  evidence: Readonly<{ text: string | null; ipa: string | null }>,
): string | null => evidence.text ?? evidence.ipa ?? null;

/**
 * phenomenon ごとの日本語改善メッセージを生成する。
 * expected/detected の text が null なら ipa で代替し、両方 null ならフォールバック文を返す。
 */
const generateMessage = (input: ImprovementMessageGeneratorInput): string => {
  const expectedDisplay = resolveDisplayText(input.expected);
  const detectedDisplay = resolveDisplayText(input.detected);

  switch (input.phenomenon) {
    case "substitution": {
      if (expectedDisplay !== null && detectedDisplay !== null) {
        return `「${expectedDisplay}」の音が「${detectedDisplay}」に置き換わっています`;
      }
      if (expectedDisplay !== null) {
        return `「${expectedDisplay}」の音が正しく発音できていません`;
      }
      return "発音に改善の余地があります";
    }
    case "omission": {
      if (expectedDisplay !== null) {
        return `「${expectedDisplay}」の音が抜けています`;
      }
      return "音が抜けています";
    }
    case "insertion": {
      return "余分な音が入っています";
    }
    case "connectedSpeech": {
      return "ここは連結・弱形にするとネイティブらしくなります";
    }
    default: {
      return "発音に改善の余地があります";
    }
  }
};

/**
 * createRuleBasedImprovementMessageGenerator — ファクトリ関数。
 * 依存なし。呼び出しごとに同一の plain object を返す。
 */
export const createRuleBasedImprovementMessageGenerator = (): ImprovementMessageGenerator => ({
  generate: generateMessage,
});
