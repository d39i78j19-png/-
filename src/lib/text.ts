/**
 * 採点ロジックが依存する文字列正規化ユーティリティ。
 * すべての比較は NFKC 正規化 + 小文字化（case-insensitive）で行う。
 */

/** NFKC 正規化して小文字化し、空白と記号ゆらぎを吸収する。 */
export function norm(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[・･,、,.。／/\-‐-—_（）()［］[\]{}"'`]+/g, "");
}

/** 文字数カウント（句読点を含む・空白と改行は除く）。description の 150-200 文字判定に使う。 */
export function countChars(input: string): number {
  return [...input.replace(/[\s　]+/g, "")].length;
}

/** スキル名の表記ゆれを寄せる。 */
const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  "node.js": "nodejs",
  node: "nodejs",
  "react.js": "react",
  reactjs: "react",
  "vue.js": "vue",
  vuejs: "vue",
  py: "python",
  golang: "go",
  "c++": "cpp",
  "c#": "csharp",
  postgres: "postgresql",
  k8s: "kubernetes",
  ml: "機械学習",
  "machinelearning": "機械学習",
  ai: "機械学習",
  ux: "ux設計",
  uxデザイン: "ux設計",
  ui: "uiデザイン",
  uiデザイン: "uiデザイン",
  プログラミング: "プログラミング基礎",
  論理思考: "論理的思考",
  ロジカルシンキング: "論理的思考",
};

export function normSkill(input: string): string {
  const n = norm(input);
  return SKILL_ALIASES[n] ?? n;
}

/** Jaccard 係数（0-1）。両方空なら 0 を返す。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function toSet(values: string[] | undefined, fn = normSkill): Set<string> {
  return new Set((values ?? []).map(fn).filter((v) => v.length > 0));
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function pct(ratio: number): number {
  return clamp(Math.round(ratio * 100));
}

/**
 * 上限文字数で単純に切る（句点を足さない）。
 * 件名のように文でない文字列に使う。
 */
export function truncatePlain(input: string, max: number): string {
  const chars = [...input];
  return chars.length <= max ? input : chars.slice(0, max).join("");
}

/** 括弧書き（新卒）などを落として短い表記にする。 */
export function stripParen(input: string): string {
  return input.replace(/[（(][^）)]*[）)]/gu, "").trim();
}

/** 上限文字数で切って必要なら句点を足す。 */
export function truncateChars(input: string, max: number): string {
    const chars = [...input];
  if (chars.length <= max) return input;
  const cut = chars.slice(0, max - 1).join("");
  const lastStop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("、"));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1);
  return `${cut}。`;
}

/* ---------- 都道府県・市区町村 ---------- */

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** 「東京都」→「東京」のように接尾辞を落として比較用の語幹にする。 */
function stem(value: string): string {
  return value.replace(/(都|道|府|県|市|区|町|村)$/u, "");
}

export interface ParsedLocation {
  /** 都道府県の語幹（例: 東京）。判定できなければ null */
  pref: string | null;
  /** 市区町村の語幹（例: 渋谷）。判定できなければ null */
  city: string | null;
  /** リモート勤務を示す語を含むか */
  remote: boolean;
  raw: string;
}

const REMOTE_PATTERN = /(リモート|フルリモート|在宅|テレワーク|remote|wfh)/i;

/**
 * 「東京都渋谷区」「東京（渋谷）」「リモート可」などを緩く解析する。
 * 表記が多様なので、都道府県は語幹の部分一致で判定する。
 */
export function parseLocation(input: string | undefined | null): ParsedLocation {
  const raw = (input ?? "").normalize("NFKC");
  const result: ParsedLocation = {
    pref: null,
    city: null,
    remote: REMOTE_PATTERN.test(raw),
    raw,
  };
  if (!raw) return result;

  // 都道府県は語幹（東京 / 大阪 / 北海道…）の含有で判定する
  for (const p of PREFECTURES) {
    const s = stem(p);
    if (raw.includes(s)) {
      result.pref = s;
      break;
    }
  }

  // 市区町村: 明示的な接尾辞つきの語を優先
  const cityMatch = raw.match(
    /([一-龠ぁ-ゖァ-ヴー]{1,8}?)(市|区|町|村)(?![一-龠])/u,
  );
  if (cityMatch) {
    result.city = cityMatch[1];
  } else {
    // 「東京（渋谷）」のような括弧内の地名
    const paren = raw.match(/[（(]([^）)]+)[）)]/u);
    if (paren) {
      const inner = paren[1].trim();
      if (!REMOTE_PATTERN.test(inner)) result.city = stem(inner);
    }
  }

  // 都道府県名がそのまま市区町村を兼ねる場合（例: 京都）の誤検出を避ける
  if (result.city && result.pref && result.city === result.pref) {
    result.city = null;
  }
  return result;
}

/* ---------- 専攻の分野グルーピング ---------- */

export type MajorField =
  | "informatics"
  | "engineering"
  | "life"
  | "science"
  | "business"
  | "social"
  | "humanities"
  | "design"
  | "medical";

const MAJOR_KEYWORDS: Record<MajorField, string[]> = {
  informatics: [
    "情報", "コンピュータ", "計算機", "ソフトウェア", "システム", "データサイエンス",
    "知能", "機械学習", "電子情報", "it", "informatics", "computerscience",
  ],
  engineering: [
    "工学", "機械", "電気", "電子", "建築", "土木", "材料", "航空", "精密",
    "応用物理", "化学工", "engineering",
  ],
  // 生命科学系は science と medical の橋渡しになるので独立させる。
  // まとめてしまうと「数学」を想定するペルソナに看護学が関連判定されてしまう。
  life: [
    "生物", "生命", "生化学", "農学", "分子", "バイオ", "biology", "agriculture",
  ],
  science: [
    "理学", "数学", "物理", "化学", "地球", "統計", "science", "math", "physics",
  ],
  business: [
    "経済", "経営", "商学", "会計", "金融", "ビジネス", "economics", "business",
  ],
  social: [
    "法", "政治", "社会", "国際", "政策", "law", "sociology", "policy",
  ],
  humanities: [
    "文学", "言語", "心理", "教育", "歴史", "哲学", "人文", "外国語",
    "humanities", "psychology",
  ],
  design: [
    "デザイン", "芸術", "美術", "メディア", "造形", "design", "art",
  ],
  medical: [
    "医学", "薬学", "看護", "保健", "獣医", "医療", "medicine", "pharmacy",
  ],
};

/** 隣接分野（関連ありと見なすペア）。 */
const RELATED_FIELDS: Array<[MajorField, MajorField]> = [
  ["informatics", "engineering"],
  ["informatics", "science"],
  ["informatics", "design"],
  ["informatics", "business"],
  ["engineering", "science"],
  ["engineering", "design"],
  ["business", "social"],
  ["social", "humanities"],
  ["design", "humanities"],
  ["science", "life"],
  ["engineering", "life"],
  ["life", "medical"],
];

export function classifyMajor(input: string): MajorField | null {
  const n = norm(input);
  if (!n) return null;
  for (const [field, keywords] of Object.entries(MAJOR_KEYWORDS) as Array<
    [MajorField, string[]]
  >) {
    if (keywords.some((k) => n.includes(norm(k)))) return field;
  }
  return null;
}

export function isRelatedField(a: MajorField, b: MajorField): boolean {
  if (a === b) return true;
  return RELATED_FIELDS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

/* ---------- カルチャーキーワード辞書 ---------- */

/**
 * ペルソナ description から「重視するキーワード」を機械的に取り出すための語彙。
 * 日本語は分かち書きされないため、辞書との部分一致で抽出する。
 */
export const CULTURE_LEXICON = [
  "ユーザー志向", "顧客志向", "ユーザー中心", "顧客第一", "スピード", "スピード感",
  "チームワーク", "協働", "チーム", "主体性", "自走", "オーナーシップ", "当事者意識",
  "論理的思考", "課題解決", "問題解決", "仮説", "検証", "分析", "定量", "データ",
  "挑戦", "チャレンジ", "成長", "学習意欲", "好奇心", "探究", "誠実", "実行力",
  "やり切る", "粘り強", "継続", "泥臭", "現場", "提案", "折衝", "巻き込み",
  "リーダーシップ", "発信", "ドキュメント", "傾聴", "共感", "ホスピタリティ",
  "デザイン", "ux", "ui", "プロダクト", "改善", "品質", "設計", "実装", "技術",
  "アーキテクチャ", "インフラ", "セキュリティ", "自動化", "効率",
  "グローバル", "英語", "多様性", "裁量", "若手", "抜擢", "新規事業", "起業",
  "社会貢献", "社会課題", "地域", "環境", "教育", "医療", "金融", "製造", "物流",
  "小売", "営業", "マーケティング", "企画", "研究", "開発", "リモート", "フレックス",
  "安定", "ワークライフバランス", "目標達成", "数字", "育成", "メンター",
];

/** description から拾う語数の上限。 */
const DESCRIPTION_KEYWORD_CAP = 5;

/**
 * ペルソナが重視するキーワード集合を作る。
 * 仕様どおり「company values + persona description のキーワード」を組み合わせ、
 * 職種名（priority_roles）も判定材料に含める。
 *
 * description 由来の語は DESCRIPTION_KEYWORD_CAP 件で打ち切る。
 * culture_score は「マッチ数 ÷ キーワード総数」で正規化するため、
 * 上限を設けないと description が長いペルソナほど分母が膨らみ、
 * ペルソナ間でスコアを比較できなくなる（長文のペルソナが不利になる）。
 * 長い語のほうが具体性が高いので、文字数の降順で採用する。
 */
export function buildCultureKeywords(
  description: string,
  values: string[] | undefined,
  priorityRoles: string[] | undefined,
): string[] {
  const normDesc = norm(description);
  const fromDescription = CULTURE_LEXICON.filter((term) =>
    normDesc.includes(norm(term)),
  )
    .sort((a, b) => b.length - a.length)
    .slice(0, DESCRIPTION_KEYWORD_CAP);

  const found = new Set<string>();
  // 企業が明示した価値観と職種は必ず評価軸に入れる
  for (const v of values ?? []) if (v.trim()) found.add(v.trim());
  for (const r of priorityRoles ?? []) if (r.trim()) found.add(r.trim());
  for (const term of fromDescription) found.add(term);
  return [...found];
}

/* ---------- 課外活動 ---------- */

export const EXTRA_LEXICON: Record<string, string[]> = {
  ハッカソン: ["ハッカソン", "hackathon", "コンテスト", "コンペ", "kaggle"],
  インターン: ["インターン", "internship", "就業体験"],
  長期インターン: ["長期インターン", "1年以上", "半年以上"],
  研究: ["研究", "研究室", "ゼミ", "論文", "学会"],
  個人開発: ["個人開発", "自主制作", "サービスを作", "アプリを作", "oss", "github"],
  サークル: ["サークル", "部活", "体育会", "同好会"],
  学生団体: ["学生団体", "団体を運営", "実行委員"],
  ボランティア: ["ボランティア", "npo", "社会活動"],
  起業: ["起業", "創業", "法人設立", "学生起業"],
  留学: ["留学", "交換留学", "海外経験"],
  アルバイト: ["アルバイト", "バイト", "接客"],
  受賞: ["受賞", "最優秀", "優秀賞", "入賞", "優勝", "準優勝", "grandprix"],
};

/** 活動の「質」を示すシグナル。extras_score の加点に使う。 */
export const EXTRA_QUALITY_SIGNALS = [
  "最優秀", "優秀賞", "受賞", "入賞", "優勝", "全国", "代表", "リーダー", "部長",
  "責任者", "立ち上げ", "創設", "長期", "1年", "2年", "3年", "継続", "黒字",
  "売上", "1000人", "100人", "採用", "内定",
];

/** テキストと配列から課外活動タグを抽出する。 */
export function extractExtras(
  tags: string[] | undefined,
  freeText: string | undefined,
): Set<string> {
  const haystack = norm([...(tags ?? []), freeText ?? ""].join(" "));
  const found = new Set<string>();
  for (const [tag, synonyms] of Object.entries(EXTRA_LEXICON)) {
    if (synonyms.some((s) => haystack.includes(norm(s)))) found.add(tag);
  }
  return found;
}

export function countQualitySignals(freeText: string | undefined): number {
  if (!freeText) return 0;
  const haystack = norm(freeText);
  return EXTRA_QUALITY_SIGNALS.filter((s) => haystack.includes(norm(s))).length;
}
