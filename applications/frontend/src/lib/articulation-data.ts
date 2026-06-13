/**
 * 高優先音素 11件の調音指導コンテンツ
 *
 * design §06 / M-ARTIC-b 準拠。
 * IPA記号・調音手順（日本語）・名称・お手本語を含む静的データ。
 * 本番指導コンテンツ（mock でない固定データ）。
 */

export type ArticulationEntry = {
  /** IPA 記号（スラッシュなし、例: "r" "l" "æ"） */
  phoneme: string;
  /** スラッシュ付き表記（例: "/r/"） */
  ipaDisplay: string;
  /** 音素名（日本語） */
  nameJa: string;
  /** 音素名（英語） */
  nameEn: string;
  /** 調音手順（日本語、3ステップ以上） */
  steps: string[];
  /** お手本単語（TTS に渡す）  */
  exampleWord: string;
};

/** 高優先音素セット（IPA スラッシュ付き）— M-ARTIC-b 11音素 */
export const HIGH_PRIORITY_PHONEME_SET = new Set([
  "/r/",
  "/l/",
  "/æ/",
  "/ʌ/",
  "/iː/",
  "/ɪ/",
  "/θ/",
  "/ð/",
  "/v/",
  "/f/",
  "/ə/",
]);

/** 高優先音素の調音エントリ一覧 */
export const ARTICULATION_DATA: ArticulationEntry[] = [
  {
    phoneme: "r",
    ipaDisplay: "/r/",
    nameJa: "後退舌近似音",
    nameEn: "retroflex approximant",
    steps: [
      "舌先を口蓋に**触れないまま**後ろへ引き、舌の中ほどを盛り上げる（retroflexまたはbunched）。",
      "唇をわずかに丸め、「ウ」に近い口の形を作る。",
      "そのまま「rrr」と声を出す。舌が歯茎や口蓋に触れると日本語の弾き音になってしまうので注意。",
      "right / run / very で練習する。語頭・語中・語末すべてで同じ舌の形を維持する。",
    ],
    exampleWord: "right",
  },
  {
    phoneme: "l",
    ipaDisplay: "/l/",
    nameJa: "歯茎側面接近音",
    nameEn: "alveolar lateral",
    steps: [
      "舌先を上前歯のすぐ裏、歯茎の盛り上がり（歯茎隆起）に当てる。",
      "舌先は当てたまま、舌の両脇を下げて息の通り道を作る。",
      "声を出しながら「lllll」と伸ばす。舌先が離れたらラ行（弾き音）に戻っている合図。",
      "light → late → feel → call の順で練習。語末では母音を添えず舌先を当てたまま終える。",
    ],
    exampleWord: "light",
  },
  {
    phoneme: "æ",
    ipaDisplay: "/æ/",
    nameJa: "前舌広母音",
    nameEn: "near-open front vowel",
    steps: [
      "口を縦に広く開ける。「ア」よりも大きく、あごを下げるイメージ。",
      "舌を前方（上の歯の裏側の方向）へ押し出しながら、舌の前部を低く保つ。",
      "「エ」と「ア」の中間の響きで「aaaæ」と声を出す。日本語の「ア」よりも明るい音色になる。",
      "cat / bad / man で練習。舌が後退すると /ɑ/ になるので、前への意識を保つ。",
    ],
    exampleWord: "cat",
  },
  {
    phoneme: "ʌ",
    ipaDisplay: "/ʌ/",
    nameJa: "後退舌中低母音",
    nameEn: "open-mid back unrounded vowel",
    steps: [
      "口を軽く開け、舌を中央〜後方のやや低い位置に置く。",
      "唇は丸めず平らに保ち、短くはっきり「ア」に近い音を出す。",
      "日本語の「ア」よりも短く、強く弾くような感覚。",
      "cup / but / love で練習。弱形（schwa /ə/）より明るく強い音。",
    ],
    exampleWord: "cup",
  },
  {
    phoneme: "iː",
    ipaDisplay: "/iː/",
    nameJa: "前舌狭長母音",
    nameEn: "close front vowel (long)",
    steps: [
      "口角を横に引き、「イ」より口を広げてにっこり微笑むような形を作る。",
      "舌の前部を高く上げ、上の歯茎の近くに寄せる。",
      "「iiii」と長く伸ばす。日本語の「イ」より緊張感があり、より長く保つ。",
      "see / beat / feel で練習。/ɪ/ と比べて唇の引きと舌の高さで差をつける。",
    ],
    exampleWord: "see",
  },
  {
    phoneme: "ɪ",
    ipaDisplay: "/ɪ/",
    nameJa: "前舌狭め短母音",
    nameEn: "near-close near-front vowel",
    steps: [
      "/iː/ より口角の引きを弱め、顎をわずかに下げてリラックスした「イ」を出す。",
      "舌の高さも /iː/ より少し低く、緊張を抜いた状態で発音する。",
      "短く弱く、曖昧な「イ」というイメージ。",
      "bit / ship / give で練習。/iː/ と /ɪ/ を交互に比較して聞き取る。",
    ],
    exampleWord: "bit",
  },
  {
    phoneme: "θ",
    ipaDisplay: "/θ/",
    nameJa: "歯間摩擦音（無声）",
    nameEn: "voiceless dental fricative",
    steps: [
      "舌先を上の歯と下の歯の間に軽く挟む（または上の歯の裏に当てる）。",
      "その隙間から息を摩擦させて「sss」ではなく「fff」に似た音を出す（声帯は振動させない）。",
      "舌先が歯の間から少しだけ見えるのが正しい位置。",
      "think / three / bath で練習。/s/ や /f/ と混同しないよう、舌先の位置を鏡で確認する。",
    ],
    exampleWord: "think",
  },
  {
    phoneme: "ð",
    ipaDisplay: "/ð/",
    nameJa: "歯間摩擦音（有声）",
    nameEn: "voiced dental fricative",
    steps: [
      "/θ/ と同じ舌の位置（歯の間または上の歯の裏）で、今度は声帯を振動させる。",
      "喉に手を当てて振動を感じながら「ðððð」と出す。",
      "日本語話者は /z/ に近い音を出しがちなので、舌先が歯に触れている感覚を確認する。",
      "the / this / breathe で練習。機能語（the, this, that）は速い会話で弱化することが多い。",
    ],
    exampleWord: "this",
  },
  {
    phoneme: "v",
    ipaDisplay: "/v/",
    nameJa: "唇歯摩擦音（有声）",
    nameEn: "voiced labiodental fricative",
    steps: [
      "上の歯を下唇の内側に軽く当てる。",
      "声帯を振動させながら息を摩擦させて「vvvv」と出す。",
      "唇同士を合わせると /b/ になってしまうので、必ず上の歯と下唇の接触を確認する。",
      "very / voice / have で練習。語末 /v/ は特に日本語話者が /b/ に置き換えやすい。",
    ],
    exampleWord: "very",
  },
  {
    phoneme: "f",
    ipaDisplay: "/f/",
    nameJa: "唇歯摩擦音（無声）",
    nameEn: "voiceless labiodental fricative",
    steps: [
      "上の歯を下唇の内側に軽く当てる。",
      "声帯を振動させずに息を摩擦させて「ffff」と出す。",
      "/v/ の無声版。上歯・下唇の接触位置は /v/ と同じ。",
      "feel / off / life で練習。/h/ との混同に注意 — /f/ は歯と唇の摩擦が必要。",
    ],
    exampleWord: "feel",
  },
  {
    phoneme: "ə",
    ipaDisplay: "/ə/",
    nameJa: "中央中段母音（シュワー）",
    nameEn: "mid central vowel (schwa)",
    steps: [
      "口と舌を完全にリラックスさせ、中間の位置で力を抜く。",
      "「ア」でも「イ」でも「ウ」でもない、最も力の抜けた中性的な音を出す。",
      "アクセントのない音節で自然に現れる英語最頻の母音。強く発音しようとしない。",
      "about（a-）/ problem（-em）/ teacher（-er）の弱音節で練習。",
    ],
    exampleWord: "about",
  },
];
