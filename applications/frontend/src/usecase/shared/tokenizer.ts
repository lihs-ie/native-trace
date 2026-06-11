/**
 * 英語本文向け軽量ルールベース・トークナイザー。
 * 設計書 §5.5 準拠。外部依存なし。
 * トークン列は保存せず決定的に計算する。
 */

export type SectionToken = Readonly<{
  tokenIndex: number;
  text: string;
  startChar: number;
  endChar: number;
}>;

export const TOKENIZER_VERSION = "v1";

/**
 * 短縮形パターン。優先して1トークンとして保持する。
 * 代表的な英語短縮形（アポストロフィを含む）。
 */
const CONTRACTION_PATTERN = /[a-zA-Z]+'[a-zA-Z]+/;

/**
 * 単語の開始位置から1トークンを読み取る。
 * 短縮形を優先し、それ以外はアルファベット・数字・ハイフン連続で1語とする。
 */
const readWordToken = (text: string, startChar: number): string => {
  let end = startChar;
  while (end < text.length) {
    const char = text[end];
    if (/[a-zA-Z0-9]/.test(char)) {
      end++;
      // アポストロフィの後にアルファベットが続く場合（短縮形）
      if (end < text.length && text[end] === "'" && end + 1 < text.length && /[a-zA-Z]/.test(text[end + 1])) {
        end++; // アポストロフィ
        while (end < text.length && /[a-zA-Z]/.test(text[end])) {
          end++;
        }
      }
      // ハイフン連結語（e.g. well-known）
      if (end < text.length && text[end] === "-" && end + 1 < text.length && /[a-zA-Z]/.test(text[end + 1])) {
        // ハイフンは語内扱いしない（別トークンにする）ため break
        break;
      }
    } else {
      break;
    }
  }
  return text.slice(startChar, end);
};

/**
 * 英語本文をトークン列に分解する。
 * - 空白区切りを基本とする
 * - 句読点は表示本文の文字オフセットを保持したまま分離する
 * - 短縮形（don't, I'm, can't 等）は1語として保持する
 */
export const tokenizeSectionBody = (bodyText: string): ReadonlyArray<SectionToken> => {
  const tokens: SectionToken[] = [];
  let tokenIndex = 0;
  let position = 0;
  const length = bodyText.length;

  while (position < length) {
    const char = bodyText[position];

    // 空白・改行・タブをスキップ
    if (/[\s]/.test(char)) {
      position++;
      continue;
    }

    // アルファベット・数字で始まる場合 → 単語トークン（短縮形含む）
    if (/[a-zA-Z0-9]/.test(char)) {
      const wordText = readWordToken(bodyText, position);
      tokens.push({
        tokenIndex,
        text: wordText,
        startChar: position,
        endChar: position + wordText.length,
      });
      tokenIndex++;
      position += wordText.length;
      continue;
    }

    // 単独のアポストロフィ（短縮形先頭にならない場合）→ 句読点として扱う
    // その他の句読点・記号 → 1文字で1トークン
    tokens.push({
      tokenIndex,
      text: char,
      startChar: position,
      endChar: position + 1,
    });
    tokenIndex++;
    position++;
  }

  return tokens;
};

// 短縮形パターンの型確認用（未使用変数エラー回避）
void CONTRACTION_PATTERN;
