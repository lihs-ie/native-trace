"""espeak-ng を使った g2p（grapheme-to-phoneme）変換インフラ実装。"""

import subprocess

from python_analyzer.domain.phoneme import IpaSequence, PhonemeLabel

# generalAmerican アクセントの espeak-ng 言語コード
_ACCENT_LANGUAGE_MAP: dict[str, str] = {
    "generalAmerican": "en-us",
    "britishRP": "en-gb",
}

_DEFAULT_LANGUAGE = "en-us"


class EspeakG2P:
    """espeak-ng を subprocess 経由で呼び出す g2p 実装。

    espeak-ng -v <lang> --ipa -q でテキストを IPA 変換する。
    """

    def convert(self, text: str, accent: str) -> IpaSequence:
        """テキストを IPA 音素列に変換する。

        Args:
            text: 変換対象のテキスト。
            accent: アクセント指定（例: "generalAmerican"）。

        Returns:
            IpaSequence。
        """
        language = _ACCENT_LANGUAGE_MAP.get(accent, _DEFAULT_LANGUAGE)
        # espeak-ng で IPA 文字列を取得する
        ipa_raw = self._run_espeak(text, language)
        # 空白区切りで音素に分割し IpaSequence を構築する
        phonemes = self._parse_ipa(ipa_raw)
        return IpaSequence(phonemes=phonemes)

    def _run_espeak(self, text: str, language: str) -> str:
        """espeak-ng subprocess を実行して IPA 文字列を返す。"""
        result = subprocess.run(
            ["espeak-ng", "-v", language, "--ipa", "-q", "--", text],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def _parse_ipa(self, ipa_raw: str) -> tuple[PhonemeLabel, ...]:
        """espeak-ng の IPA 出力を音素ラベル列に変換する。

        espeak-ng の出力形式: 'həˈloʊ wɜːld' のような文字列。
        wav2vec2-lv-60-espeak-cv-ft のラベルに合わせて分解する。
        """
        # 行を統合し、アクセント記号・単語境界記号を除去して音素を抽出する
        cleaned = ipa_raw.replace("\n", " ")
        # wav2vec2 espeak ラベルに合わせて IPA 文字を個別音素に分割する
        phoneme_strings = self._split_ipa_to_phonemes(cleaned)
        return tuple(PhonemeLabel(p) for p in phoneme_strings if p)

    def _split_ipa_to_phonemes(self, ipa_string: str) -> list[str]:
        """IPA 文字列を wav2vec2 espeak ラベルに対応した音素リストに分割する。

        espeak-ng の出力はスペース区切りではなく連続した IPA 文字列になるため、
        多文字音素（dɪ, eɪ 等）を認識しながら分割する。
        """
        # まず空白で単語に分割し、各単語を音素に分解する
        result: list[str] = []
        for word in ipa_string.split():
            # アクセント記号・境界マーカーを除去する
            word_clean = word.replace("ˈ", "").replace("ˌ", "").replace("ˑ", "")
            # 二重母音・破擦音などの多文字音素を優先して認識する
            result.extend(self._tokenize_ipa_word(word_clean))
        return result

    def _tokenize_ipa_word(self, word: str) -> list[str]:
        """1 単語の IPA 文字列を音素トークンリストに変換する。

        wav2vec2-lv-60-espeak-cv-ft のボキャブラリに合わせて
        2 文字音素を優先して認識する。
        """
        # wav2vec2 espeak モデルが認識する主要な 2 文字以上の音素
        two_char_phonemes = {
            "dʒ",
            "tʃ",
            "aɪ",
            "aʊ",
            "eɪ",
            "oʊ",
            "ɔɪ",
            "iː",
            "uː",
            "ɜː",
            "ɔː",
            "eː",
            "ɪə",
            "eə",
            "ʊə",
        }
        tokens: list[str] = []
        index = 0
        while index < len(word):
            # 2 文字を先読みして 2 文字音素かチェックする
            if index + 1 < len(word) and word[index : index + 2] in two_char_phonemes:
                tokens.append(word[index : index + 2])
                index += 2
            else:
                char = word[index]
                # 無音記号・括弧等は除外する
                if char not in "()[]{}|_":
                    tokens.append(char)
                index += 1
        return tokens
