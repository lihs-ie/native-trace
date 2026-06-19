/**
 * RuleBased ImprovementMessageGenerator。
 * acl 層の実装。phenomenon + カタログ駆動で 3 層フィードバック文と messageJa を生成する。
 * 固定文は廃止し、phenomenon × catalogId × wordPair × 位置でメッセージが変わる。
 * クラス構文禁止。factory + plain object パターン。
 */

import {
  type ImprovementMessageGenerator,
  type ImprovementMessageGeneratorInput,
  type FeedbackLayersOutput,
} from "../../../usecase/port/improvement-message-generator";
import { type AcousticEvidenceDto } from "../../../lib/api-types";
import {
  findCatalogEntryById,
  findCatalogEntry,
  findStepsForSubstitute,
} from "../../../domain/error-catalog";

/**
 * expected/detected から表示用テキストを取得する。
 * text が非 null なら text、null なら ipa、両方 null なら null。
 */
const resolveDisplayText = (
  evidence: Readonly<{ text: string | null; ipa: string | null }>,
): string | null => evidence.text ?? evidence.ipa ?? null;

/**
 * 位置ラベルを日本語に変換する。
 */
const resolvePositionLabel = (wordPositionLabel: string | null): string => {
  switch (wordPositionLabel) {
    case "initial":
      return "語頭";
    case "medial":
      return "語中";
    case "final":
      return "語末";
    default:
      return "";
  }
};

/**
 * M-APD-16 (ADR-018 D6): acousticEvidence の方向ラベル → 日本語 articulatory 文。
 * 9 ラベル全てに対応。null / 全ラベル "ok" のとき null を返す（既存 howJa を維持）。
 * ADR D6 例: tongueHeight="tooLow" + /iː/ →「舌をもっと高く、口蓋に近づけてください…」
 */
const resolveAcousticHowJa = (
  acousticEvidence: AcousticEvidenceDto | null | undefined,
): string | null => {
  if (acousticEvidence == null) return null;

  const parts: string[] = [];

  // tongueHeight: F1 偏差 → 舌の高低方向
  if (acousticEvidence.tongueHeight === "tooLow") {
    parts.push(
      "舌をもっと高く、口蓋に近づけてください（英語の前舌高母音は日本語のイより舌が高い位置にあります）",
    );
  } else if (acousticEvidence.tongueHeight === "tooHigh") {
    parts.push(
      "舌を少し下げて口を開き気味にしてください（舌が高すぎて目標母音より閉じた音になっています）",
    );
  }

  // tongueBackness: F2 偏差 → 舌の前後方向
  if (acousticEvidence.tongueBackness === "tooFront") {
    parts.push(
      "舌をやや後方に引いてください（舌が前に出すぎており、より後ろ寄りの母音になる必要があります）",
    );
  } else if (acousticEvidence.tongueBackness === "tooBack") {
    parts.push(
      "舌を前方に押し出してください（舌が奥に引きすぎており、より前寄りの母音になる必要があります）",
    );
  }

  // rhoticity: F3 偏差 → /r/ 音性・後退性
  if (acousticEvidence.rhoticity === "insufficient") {
    parts.push(
      "舌先を口蓋に触れさせずに後退させ、/r/ の巻き舌性（rhoticity）を出してください" +
        "（F3 が高く、日本語のラ行に近い弾き音（tap）になっている可能性があります）",
    );
  } else if (acousticEvidence.rhoticity === "overRetroflex") {
    parts.push(
      "舌先を後ろに引きすぎています。/l/ の発音では舌先を上前歯の裏に軽く当て、" +
        "巻き舌にならないようにしてください（F3 が低くなりすぎています）",
    );
  }

  // sibilantPlace: スペクトル重心 → /s/ vs /ʃ/ 調音位置
  if (acousticEvidence.sibilantPlace === "tooPalatal") {
    parts.push(
      "舌先を歯茎（上前歯の裏）に近づけ、/s/ の調音位置を前に出してください" +
        "（現在は /ɕ/（シュ）寄りの口蓋音になっています）",
    );
  } else if (acousticEvidence.sibilantPlace === "tooAlveolar") {
    parts.push(
      "舌を少し後ろに引いて口唇を丸めてください（/ʃ/ は歯茎より後ろの口蓋歯茎音で、" +
        "現在は /s/ 寄りの前寄り調音になっています）",
    );
  }

  // vowelLength: 母音長 → 長短
  if (acousticEvidence.vowelLength === "tooShort") {
    parts.push(
      "母音をもっと長く伸ばしてください（tense 母音 /iː/・/uː/ は対応する lax 母音より" +
        "明確に長く発音する必要があります）",
    );
  }

  if (parts.length === 0) return null;

  return parts.join("。また、");
};

/**
 * 3 層フィードバック文を生成する。
 * ① what: 観測（期待/検出/位置）
 * ② why: 原因（カタログの l1MechanismJa、なければ phenomenon + contrast）
 * ③ how: 修正（カタログの articulation.stepsJa 要約）
 */
const generateFeedbackLayersFromInput = (
  input: ImprovementMessageGeneratorInput,
): FeedbackLayersOutput => {
  const expectedDisplay = resolveDisplayText(input.expected);
  const detectedDisplay = resolveDisplayText(input.detected);
  const positionLabel = resolvePositionLabel(input.wordPositionLabel ?? null);

  // カタログエントリを取得（catalogId 優先、なければ phenomenon + contrast で検索）
  const catalogEntry = (input.catalogId ?? null) ? findCatalogEntryById(input.catalogId!) : null;
  const fallbackEntry = catalogEntry ?? findCatalogEntry(input.phenomenon, detectedDisplay);

  // ① what: 観測層（期待/検出/位置）
  let whatJa: string;
  switch (input.phenomenon) {
    case "substitution": {
      if (expectedDisplay !== null && detectedDisplay !== null) {
        const positionSuffix = positionLabel ? `（${positionLabel}）` : "";
        whatJa = `「${expectedDisplay}」の音${positionSuffix}が「${detectedDisplay}」に置き換わっています`;
      } else if (expectedDisplay !== null) {
        whatJa = `「${expectedDisplay}」の音が正しく発音できていません`;
      } else {
        whatJa = "子音・母音の置換が検出されました";
      }
      break;
    }
    case "omission": {
      if (expectedDisplay !== null) {
        const positionSuffix = positionLabel ? `（${positionLabel}）` : "";
        whatJa = `「${expectedDisplay}」の音${positionSuffix}が抜けています`;
      } else {
        whatJa = "音の脱落が検出されました";
      }
      break;
    }
    case "insertion": {
      if (detectedDisplay !== null) {
        whatJa = `「${detectedDisplay}」に余分な音が挿入されています`;
      } else {
        whatJa = "余分な音の挿入が検出されました";
      }
      break;
    }
    case "epenthesis": {
      const targetWord = expectedDisplay ?? detectedDisplay;
      if (input.insertedVowel != null) {
        // 挿入母音が同定されている場合: 母音と位置を明示する
        const positionPhrase = positionLabel ? `の${positionLabel}に` : "に";
        whatJa =
          targetWord !== null
            ? `「${targetWord}」${positionPhrase}母音 /${input.insertedVowel}/ が挿入されています（カタカナ読み混入の傾向があります）`
            : `母音 /${input.insertedVowel}/ が挿入されています（カタカナ読み混入の傾向があります）`;
      } else {
        // 挿入母音が未同定の場合: 単語を「母音」として名指さない汎用位置メッセージ
        whatJa =
          targetWord !== null
            ? `「${targetWord}」に余分な母音が入っています（カタカナ読み混入の傾向があります）`
            : "子音間への母音挿入（カタカナ読み混入）が検出されました";
      }
      break;
    }
    case "connectedSpeech":
    case "linking":
    case "weakForm":
    case "assimilation":
    case "reduction": {
      if ((input.wordPair ?? null) != null) {
        const first = input.wordPair!.first;
        const second = input.wordPair!.second;
        const expected = input.expectedPronunciation ?? null;
        if (expected !== null) {
          whatJa = `「${first} ${second}」の境界音が連結・弱形化されていません（期待発音: ${expected}）`;
        } else {
          whatJa = `「${first} ${second}」の境界での連結・弱形化が検出されていません`;
        }
      } else {
        whatJa = "連結・弱形・同化などの連続音変化が適用されていません";
      }
      break;
    }
    case "lexicalStress": {
      if (expectedDisplay !== null) {
        whatJa = `「${expectedDisplay}」の語強勢位置が正しくありません`;
      } else {
        whatJa = "語強勢の位置が正しくありません";
      }
      break;
    }
    case "flap": {
      whatJa = "フラップ音（北米英語の /t/ → /ɾ/）が適用されていません";
      break;
    }
    default: {
      whatJa = "発音に改善の余地があります";
      break;
    }
  }

  // ② why: 原因層（カタログの l1MechanismJa を優先）
  let whyJa: string;
  if (fallbackEntry !== null) {
    whyJa = fallbackEntry.l1MechanismJa;
  } else {
    switch (input.phenomenon) {
      case "epenthesis":
        whyJa = "日本語の音節構造（CV型）の影響で、子音の後に自動的に母音を補う傾向があります";
        break;
      case "connectedSpeech":
      case "linking":
      case "weakForm":
      case "assimilation":
      case "reduction":
        whyJa =
          "日本語は連続音変化が少ないため、英語の連結・弱形・同化のパターンが習得しにくいです";
        break;
      case "lexicalStress":
        whyJa = "日本語は拍リズム（モーラ）が基本のため、英語の語強勢パターンが習得しにくいです";
        break;
      case "flap":
        whyJa = "日本語に北米英語のフラップ音に相当する音素がないため、/t/ として発音しがちです";
        break;
      default:
        whyJa = "日本語と英語の音素体系の違いにより、この音の生成が難しい場合があります";
        break;
    }
  }

  // ③ how: 修正層（ADR-020 D2: findStepsForSubstitute で detectedTopCandidate ベース分岐）
  let howJa: string;
  if (fallbackEntry !== null && fallbackEntry.articulation !== null) {
    // findStepsForSubstitute: detectedTopCandidate=null → stepsJa（後方互換）、
    // canonical 一致 → substituteVariants バリアント steps
    const steps = findStepsForSubstitute(fallbackEntry, input.detectedTopCandidate ?? null);
    if (steps.length > 0) {
      howJa = steps.slice(0, 3).join("。") + (steps.length > 3 ? "。…" : "");
    } else {
      howJa = fallbackEntry.articulation.mannerJa;
    }
  } else {
    switch (input.phenomenon) {
      case "epenthesis":
        howJa = "まず音声を先に聞いて模倣してください。子音のみで終わる感覚を身につけましょう";
        break;
      case "connectedSpeech":
      case "linking":
      case "weakForm":
      case "assimilation":
      case "reduction":
        howJa = "ネイティブ音声をゆっくり再生して連結部分を耳で確認し、そのまま模倣してください";
        break;
      case "lexicalStress":
        howJa = "強勢のある音節を長く・高く・大きく発音し、弱音節は短く曖昧にします";
        break;
      default:
        howJa = "ネイティブ音声を繰り返し聞いて、音のパターンを模倣してください";
        break;
    }
  }

  // M-APD-16 (ADR-018 D6): acousticEvidence 方向ラベルがある場合は howJa を articulatory テキストで上書き。
  // null / 全ラベル "ok" のとき既存 howJa を維持（後方互換）。
  const acousticHowJa = resolveAcousticHowJa(input.acousticEvidence);
  if (acousticHowJa !== null) {
    howJa = acousticHowJa;
  }

  return { whatJa, whyJa, howJa };
};

/**
 * phenomenon ごとの日本語改善メッセージを生成する（3 層から whatJa を主体に連結）。
 */
const generateMessage = (input: ImprovementMessageGeneratorInput): string => {
  const layers = generateFeedbackLayersFromInput(input);
  return layers.whatJa;
};

/**
 * createRuleBasedImprovementMessageGenerator — ファクトリ関数。
 * 依存なし。呼び出しごとに同一の plain object を返す。
 */
export const createRuleBasedImprovementMessageGenerator = (): ImprovementMessageGenerator => ({
  generate: generateMessage,
  generateFeedbackLayers: generateFeedbackLayersFromInput,
});
