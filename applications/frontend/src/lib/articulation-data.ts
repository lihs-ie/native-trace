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
  /**
   * 調音断面図 SVG のパス（例: "/assets/sagittal/l.svg"）。
   * M-HOW-8: 配置済み音素のみ設定。未配置は省略し ArticulationCard が placeholder にフォールバックする。
   */
  sagittalSvgPath?: string;
  /**
   * 目標調音の目安位置 — ADR-019 D6 正式契約 floor フィールド。
   *
   * x, y は sagittal-wrap ボックス内のパーセント座標（0–100）。
   * SVG は右向き断面図（前歯・唇が左、咽頭が右、鼻腔が上）で、
   * 各 SVG の解剖学的テキストラベルやアーティキュレータ経路座標から導出した目安値。
   * 10進数のパーセント座標で、決定論的な静的 floor データ。ML 推定ではない。
   * S-AAI-5(b) キャリブレーション（EMA→矢状断面 SVG 写像校正）で精緻化する。
   */
  targetArticulation?: {
    /** sagittal-wrap 左端からのパーセント（前→後 方向） */
    x: number;
    /** sagittal-wrap 上端からのパーセント（上→下 方向） */
    y: number;
    /** 目標調音の主アーティキュレータ説明（日本語） */
    label: string;
  };
  /**
   * ミニマルペア（弁別対）— ADR-019 D6 chrome（presentation-only floor data）。
   * japanese-l1-catalog.json の confusionSet 由来（drill-content.ts と同源）。新規スコアリング経路なし。
   * 対象語→対比語を順次 TTS 再生する弁別ボタンに使う。対立が機能しない音素は省略。
   */
  minimalPair?: { targetWord: string; contrastWord: string; contrastIpaDisplay: string };
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
    sagittalSvgPath: "/assets/sagittal/r.svg",
    // SVG 舌体 bunched 頂点 ~(200,160)/320 = (62%,50%)。接触なし表示位置より中後方。
    targetArticulation: { x: 62, y: 50, label: "舌中央を盛り上げ・舌先は接触させない" },
    // r-substitution: minimalPairs[0] から verbatim (drill-content.ts l.99)
    minimalPair: { targetWord: "right", contrastWord: "light", contrastIpaDisplay: "/l/" },
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
    sagittalSvgPath: "/assets/sagittal/l.svg",
    // SVG 接触円 (175,132)/320 = (54.7%,41.3%)。接触ラベル "接触" 付近。
    targetArticulation: { x: 55, y: 41, label: "舌先を歯茎に接触" },
    // l-r-substitution: design HTML:105 "light" に対応するペア (drill-content.ts l.53)
    minimalPair: { targetWord: "light", contrastWord: "right", contrastIpaDisplay: "/r/" },
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
    sagittalSvgPath: "/assets/sagittal/ae.svg",
    // SVG 舌前部低位 ~(143-158,150-154)/320 = (約42%,48%)。ラベル "舌前部・低位"。
    targetArticulation: { x: 42, y: 49, label: "舌前部を低く・口を大きく" },
    // ae-a-substitution: minimalPairs[0] から verbatim (drill-content.ts l.171)
    minimalPair: { targetWord: "cat", contrastWord: "cut", contrastIpaDisplay: "/ʌ/" },
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
    sagittalSvgPath: "/assets/sagittal/a.svg",
    // SVG 舌中央～後部低位 ~(185,162)/320 = (57.8%,50.6%)。ラベル "舌中央～後部・低位"。
    targetArticulation: { x: 58, y: 52, label: "舌を低く・やや後ろへ" },
    // minimalPair 省略（/ɪ/・/ʌ/・/ð/・/f/・/ə/ は対立が機能しないかコントラスト側）
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
    sagittalSvgPath: "/assets/sagittal/i.svg",
    // SVG 舌前部高位 ~(182,148)/320 = (56.9%,46.3%)。ラベル "舌前部・高位（口蓋に近い）"。
    targetArticulation: { x: 55, y: 45, label: "舌前部を高く（口蓋に近づける）" },
    // iː-ɪ-substitution: minimalPairs[0] から verbatim (drill-content.ts l.201)
    minimalPair: { targetWord: "seat", contrastWord: "sit", contrastIpaDisplay: "/ɪ/" },
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
    sagittalSvgPath: "/assets/sagittal/i.svg",
    // /iː/ より僅かに低く・後方（/iː/ と同 SVG 共用、位置を微差で分離）。
    targetArticulation: { x: 56, y: 47, label: "舌前部をやや高く（/iː/ より緩める）" },
    // minimalPair 省略（/ɪ/ はコントラスト側であり対立ボタンを表示しない）
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
    sagittalSvgPath: "/assets/sagittal/theta.svg",
    // SVG 舌先接触円 (147,140)/320 = (45.9%,43.8%)。歯間位置。
    targetArticulation: { x: 46, y: 44, label: "舌先を上下の歯の間に" },
    // theta-s-substitution: minimalPairs[0] から verbatim (drill-content.ts l.140)
    minimalPair: { targetWord: "think", contrastWord: "sink", contrastIpaDisplay: "/s/" },
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
    sagittalSvgPath: "/assets/sagittal/eth.svg",
    // /θ/ と同じ歯間接触点 (147,140)/320 = (45.9%,43.8%)。有声。
    targetArticulation: { x: 46, y: 44, label: "舌先を上下の歯の間に（有声）" },
    // minimalPair 省略（/ð/ は対立が機能しない音素）
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
    sagittalSvgPath: "/assets/sagittal/v.svg",
    // SVG 唇歯接触円 (156,148)/320 = (48.75%,46.25%)。有声。
    targetArticulation: { x: 49, y: 46, label: "下唇を上の前歯に（有声）" },
    // v-b-substitution: minimalPairs[0] から verbatim (drill-content.ts l.109)
    minimalPair: { targetWord: "van", contrastWord: "ban", contrastIpaDisplay: "/b/" },
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
    sagittalSvgPath: "/assets/sagittal/f.svg",
    // /v/ と同じ唇歯接触円 (156,148)/320 = (48.75%,46.25%)。無声。
    targetArticulation: { x: 49, y: 46, label: "下唇を上の前歯に" },
    // minimalPair 省略（/f/ は対立が機能しない音素）
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
    sagittalSvgPath: "/assets/sagittal/schwa.svg",
    // SVG 中央・中段ラベル線 終点 ~(188,175)/320 = (58.75%,54.7%)。中性舌位。
    targetArticulation: { x: 55, y: 50, label: "舌は中央・脱力（中性位）" },
    // minimalPair 省略（/ə/ は機能的ミニマルペア対立なし、catalog contrast:null）
  },
];
