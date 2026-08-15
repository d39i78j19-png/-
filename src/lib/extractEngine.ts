/**
 * 採用サイト・マイナビの掲載文から company_info を組み立てるルールベース抽出器。
 *
 * 掲載原稿は「■事業内容」「求める人材／〜」のようにラベルと本文が交互に並ぶ形が
 * ほとんどなので、ラベル辞書で本文を区切ってから各項目を取り出す。
 * ラベルが1つも無い自由記述でも、社名の正規表現・語彙辞書・卒業年度の正規表現で
 * 拾えるところまで埋める（空欄はフォームで手直しする前提）。
 *
 * API キーがある場合は src/app/api/extract/route.ts が Claude の読み取り結果を
 * 優先し、Claude が埋められなかった項目だけをこの抽出器で補完する。
 */

import type { CompanyInfo } from "./schema";
import {
  CULTURE_LEXICON,
  PREFECTURES,
  norm,
  stripParen,
  truncateChars,
  truncatePlain,
} from "./text";

/* ---------- ラベル辞書 ---------- */

type SectionKey =
  | "name"
  | "business"
  | "mission"
  | "values"
  | "wanted"
  | "nice"
  | "location"
  | "job"
  | "hiring";

const SECTION_LABELS: ReadonlyArray<readonly [SectionKey, readonly string[]]> = [
  ["name", ["会社名", "企業名", "社名", "法人名", "商号", "企業情報"]],
  [
    "business",
    [
      "事業内容",
      "事業概要",
      "会社概要",
      "企業概要",
      "会社紹介",
      "企業紹介",
      "私たちの仕事",
      "仕事内容",
      "業務内容",
      "どんな会社",
      "事業",
    ],
  ],
  [
    "mission",
    [
      "企業理念",
      "経営理念",
      "ミッション",
      "ビジョン",
      "パーパス",
      "私たちの想い",
      "私たちの思い",
      "理念",
    ],
  ],
  [
    "values",
    [
      "行動指針",
      "大切にしていること",
      "大切にしている価値観",
      "バリュー",
      "価値観",
      "カルチャー",
      "社風",
      "クレド",
      "働く環境",
    ],
  ],
  [
    "wanted",
    [
      "求める人物像",
      "求める人材",
      "こんな人と働きたい",
      "こんな方を求めています",
      "求めている人",
      "対象となる方",
      "応募資格",
      "応募条件",
      "必須要件",
      "必須スキル",
      "求める人",
    ],
  ],
  [
    "nice",
    [
      "歓迎するスキル",
      "歓迎スキル",
      "歓迎要件",
      "歓迎条件",
      "あれば尚可",
      "活かせる経験",
      "尚可",
      "歓迎",
    ],
  ],
  [
    "location",
    [
      "勤務予定地",
      "勤務地詳細",
      "勤務地",
      "勤務場所",
      "就業場所",
      "本社所在地",
      "所在地",
    ],
  ],
  ["job", ["募集職種", "採用職種", "募集コース", "職種", "コース"]],
  ["hiring", ["雇用形態", "採用形態", "採用区分", "募集対象", "募集人数"]],
];

/** 長いラベルを先に判定する（「事業内容」を「事業」で取りこぼさないため）。 */
const LABEL_INDEX = SECTION_LABELS.flatMap(([key, terms]) =>
  terms.map((term) => ({ key, term })),
).sort((a, b) => b.term.length - a.term.length);

/** 行頭の装飾記号（■●【 など）と箇条書き記号。 */
const LEAD_DECORATION = /^[\s　]*[■●▼◆◇○◎▶▷＞>#＃*＊\-–—|｜【〈「[]*[\s　]*/u;
/**
 * 見出しに使われる装飾（箇条書き専用の ・- は含めない）。
 * 「・教育業界の理念に共感できる方」のような箇条書き項目を見出しと誤判定しないため。
 */
const HEADING_DECORATION = /^[\s　]*[■●▼◆◇○◎▶▷#＃【〈「[]+[\s　]*/u;
const BULLET = /^[\s　]*[・･◦○●▪□■＊*＋+\-–—>＞]+[\s　]*/u;
const NUMBERING = /^[0-9０-９]{1,2}[.．)）:：][\s　]*/u;
/** ラベルと本文の区切りに使われる記号。 */
const LABEL_SEPARATOR = /^[\s　]*[】〉」\]]?[\s　]*[:：/／|｜・>＞\-–—]*[\s　]*/u;

const REMOTE_WORDS = /(フルリモート|リモート|在宅|テレワーク|remote)/i;

/**
 * 掲載文でスキルとして扱う語。プロセ文からも拾えるように辞書照合する。
 * 表記は company_info にそのまま入る形で持つ（マッチ採点側で normSkill される）。
 */
const SKILL_LEXICON = [
  "JavaScript", "TypeScript", "React", "Vue", "Next.js", "Node.js", "Python",
  "Java", "Kotlin", "Swift", "Go", "Ruby", "PHP", "C++", "C#", "SQL", "HTML",
  "CSS", "Figma", "Git", "GitHub", "AWS", "GCP", "Azure", "Docker",
  "Kubernetes", "Linux", "Excel", "PowerPoint", "Tableau", "SPSS",
  "機械学習", "データ分析", "統計", "アルゴリズム", "UX設計", "UIデザイン",
  "グラフィックデザイン", "動画編集", "簿記", "TOEIC", "英語", "中国語",
  "プログラミング基礎", "論理的思考", "課題解決力", "コミュニケーション力",
  "主体性", "リーダーシップ", "チームワーク", "プレゼンテーション",
  "マーケティング", "企画力", "営業", "法人営業", "経理", "財務", "人事",
];

/* ---------- 前処理 ---------- */

const AFTER_LABEL = /^[\s　】〉」\]:：/／|｜・>＞\-–—]/u;
/** 見出しの前に付く修飾（「私たちが」「当社の」）として許す長さ。 */
const HEADING_PREFIX_MAX = 8;

/** ラベル行を判定する。戻り値の inline は同じ行に書かれた本文。 */
function detectLabel(line: string): { key: SectionKey; inline: string } | null {
  const stripped = line.replace(LEAD_DECORATION, "");

  for (const { key, term } of LABEL_INDEX) {
    if (!stripped.startsWith(term)) continue;
    const after = stripped.slice(term.length);
    // 「事業内容説明会」のようにラベルの直後に文字が続く行はラベルとみなさない
    if (after.length > 0 && !AFTER_LABEL.test(after)) continue;
    return { key, inline: after.replace(LABEL_SEPARATOR, "").trim() };
  }

  // 「■私たちが大切にしている価値観」のように前置きが付く見出しを拾う。
  // 装飾記号か行末のコロンがある短い行に限り、かつラベルが行末に来る場合だけ認める。
  const decorated = HEADING_DECORATION.test(line) || /[:：][\s　]*$/u.test(stripped);
  if (!decorated) return null;
  if ([...stripped].length > 30 || /[。！？!?]/u.test(stripped)) return null;

  const head = stripped.replace(/[:：][\s　]*$/u, "");
  for (const { key, term } of LABEL_INDEX) {
    const idx = head.indexOf(term);
    if (idx <= 0 || idx > HEADING_PREFIX_MAX) continue;
    if (idx + term.length !== head.length) continue;
    return { key, inline: "" };
  }
  return null;
}

/**
 * ラベル行で本文を区切る。空行では区切らない
 * （掲載文は1つの見出しの下に段落が複数続くことが多いため）。
 */
function splitSections(text: string): Map<SectionKey, string[]> {
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const hit = detectLabel(line);
    if (hit) {
      current = hit.key;
      const bucket = sections.get(current) ?? [];
      if (hit.inline) bucket.push(hit.inline);
      sections.set(current, bucket);
      continue;
    }
    if (current) sections.get(current)?.push(line);
  }
  return sections;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = norm(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** 文末表現。項目ではなく説明文の断片と判断する材料にする。 */
const SENTENCE_TAIL = /(です|ます|ません|でした|ください|ましょう|でしょう|います|ですが)$/u;

/**
 * 項目の体裁を整える。
 * 区切り記号で切った結果、括弧の対応が壊れることがあるので閉じ直す
 * （「東京都渋谷区（本社」→「東京都渋谷区」）。
 */
function tidyItem(value: string): string {
  let v = value.trim().replace(/^[※＊*]+[\s　]*/u, "").replace(/[。.、,]+$/u, "");
  const open = (v.match(/[（(]/gu) ?? []).length;
  const close = (v.match(/[）)]/gu) ?? []).length;
  if (open > close) v = v.replace(/[（(][^）)]*$/u, "");
  else if (close > open) v = v.replace(/[）)]/u, "");
  return v.trim();
}

/** 箇条書き・記号区切りの行から項目を取り出す。散文の行は項目化しない。 */
function toItems(lines: string[] | undefined, maxItemLength = 24): string[] {
  const out: string[] = [];
  for (const line of lines ?? []) {
    const hadBullet = BULLET.test(line) || NUMBERING.test(line);
    const cleaned = line.replace(BULLET, "").replace(NUMBERING, "").trim();
    if (!cleaned) continue;
    // 40 文字を超える行は説明文とみなし、区切り記号で切ると意味が壊れるので飛ばす
    if ([...cleaned].length > 40) continue;
    // 箇条書き記号が無く文として終わっている行は説明文（「〜を求めています。」）
    if (!hadBullet && (/[。！？]/u.test(cleaned) || SENTENCE_TAIL.test(cleaned))) {
      continue;
    }

    for (const part of cleaned.split(/[、,，・･／/｜|]+/u)) {
      const v = tidyItem(part);
      if (!v) continue;
      if ([...v].length > maxItemLength) continue;
      // 「〜な方」「〜できる人」のような文末表現だけの断片は落とす
      if (/^(方|人|人材|など|等|以上|不問)$/u.test(v)) continue;
      if (SENTENCE_TAIL.test(v)) continue;
      out.push(v);
    }
  }
  return unique(out);
}

/** 辞書に載っている語を本文から拾う。 */
function lexiconHits(text: string, lexicon: readonly string[], cap: number): string[] {
  const haystack = norm(text);
  return lexicon
    .filter((term) => haystack.includes(norm(term)))
    .sort((a, b) => b.length - a.length)
    .slice(0, cap);
}

function joinSection(lines: string[] | undefined): string {
  return (lines ?? []).join("\n");
}

/* ---------- 各項目の抽出 ---------- */

const CORP_TYPE = "株式会社|合同会社|有限会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人";
/** 「株式会社◯◯」型。社名に使われない記号で止める。 */
const CORP_HEAD = new RegExp(
  `(?:${CORP_TYPE})[^\\s、。,，･・／/|｜「」『』（）()\\n]{1,20}`,
  "u",
);
/**
 * 「◯◯株式会社」型。直前が平仮名の場合は社名の一部ではない可能性が高いので
 * 平仮名を含めない（「私たち株式会社」を社名と誤認しないため）。
 */
const CORP_TAIL = new RegExp(
  `[ァ-ヶー一-龠A-Za-z0-9＆&・]{1,20}(?:${CORP_TYPE})`,
  "u",
);
const TRAILING_PARTICLE = /(?:は|が|を|に|へ|と|も|の|で|や)$/u;

/** 「株式会社ソラミチ商事は」のように文中で助詞まで拾った場合に落とす。 */
function trimParticles(value: string): string {
  let v = value;
  for (let i = 0; i < 2 && [...v].length > 5 && TRAILING_PARTICLE.test(v); i += 1) {
    v = v.replace(TRAILING_PARTICLE, "");
  }
  return v;
}

function extractName(sections: Map<SectionKey, string[]>, text: string): string {
  const labeled = sections.get("name")?.[0]?.trim();
  if (labeled) return truncatePlain(labeled, 40);

  const matched = text.match(CORP_HEAD) ?? text.match(CORP_TAIL);
  if (matched) return trimParticles(matched[0].trim());

  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim();
  if (firstLine && [...firstLine].length <= 40) return firstLine;
  return "";
}

const DESCRIPTION_MAX_CHARS = 400;

function extractDescription(
  sections: Map<SectionKey, string[]>,
  text: string,
): string {
  // 事業内容と求める人物像はどちらもペルソナ生成の材料になるので両方入れる
  const parts = [
    joinSection(sections.get("business")),
    joinSection(sections.get("wanted")),
  ].filter((p) => p.trim().length > 0);

  const joined = parts.length > 0 ? parts.join("\n") : text;
  const flat = joined
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, "").trim())
    .filter((l) => l.length > 0)
    .join(" ");
  return truncateChars(flat, DESCRIPTION_MAX_CHARS);
}

function extractMission(sections: Map<SectionKey, string[]>): string | undefined {
  const raw = joinSection(sections.get("mission")).trim();
  if (!raw) return undefined;
  const sentence =
    raw
      .split(/\r?\n/)
      .map((l) => l.replace(BULLET, "").trim())
      .find((l) => l.length > 0) ?? "";
  // 「学びたい」に手が届く社会へ のように途中に閉じ括弧が来る理念があるので、
  // 全体が括弧で囲まれている場合だけ外す
  const cleaned = sentence
    .replace(/^「(.+)」$/u, "$1")
    .replace(/^『(.+)』$/u, "$1")
    .replace(/。$/u, "")
    .trim();
  return cleaned ? truncatePlain(cleaned, 60) : undefined;
}

function extractValues(
  sections: Map<SectionKey, string[]>,
  text: string,
): string[] {
  const listed = toItems(sections.get("values"), 20);
  if (listed.length > 0) return listed.slice(0, 8);

  // バリュー欄が無い掲載文は、理念・事業説明からカルチャー語彙を拾う
  const source = [
    joinSection(sections.get("mission")),
    joinSection(sections.get("values")),
    joinSection(sections.get("business")),
  ].join("\n");
  return lexiconHits(source || text, CULTURE_LEXICON, 5);
}

function extractSkills(
  sections: Map<SectionKey, string[]>,
  key: "wanted" | "nice",
): string[] {
  const section = sections.get(key);
  // スキルは候補者スキルとの一致判定に使うので、注釈の括弧は落として素の語にする
  // （「プログラミング基礎（言語は問いません）」→「プログラミング基礎」）
  const listed = unique(
    toItems(section, 24)
      .map((item) => stripParen(item) || item)
      .filter((item) => item.length > 0),
  );
  // 箇条書きで拾えた語を辞書側で重ねない（「React」と「Reactを使った開発経験」の重複を防ぐ）
  const fromLexicon = lexiconHits(joinSection(section), SKILL_LEXICON, 6).filter(
    (term) => !listed.some((item) => norm(item).includes(norm(term))),
  );
  return unique([...listed, ...fromLexicon]).slice(0, 8);
}

/** 「東京都渋谷区」「大阪（本社）」などの勤務地表記を拾う。 */
function extractLocations(
  sections: Map<SectionKey, string[]>,
  text: string,
): string[] {
  const found: string[] = [];
  const section = sections.get("location");

  for (const item of toItems(section, 30)) {
    if (PREFECTURES.some((p) => item.includes(p) || item.includes(p.replace(/[都道府県]$/u, "")))) {
      found.push(item);
    } else if (REMOTE_WORDS.test(item)) {
      found.push(item);
    }
  }

  if (found.length === 0) {
    // 勤務地欄が無い／表記が拾えない場合は本文から都道府県名だけ拾う
    const haystack = joinSection(section) || text;
    for (const pref of PREFECTURES) {
      if (haystack.includes(pref)) found.push(pref);
    }
  }

  if (REMOTE_WORDS.test(text) && !found.some((f) => REMOTE_WORDS.test(f))) {
    found.push("リモート可");
  }
  return unique(found).slice(0, 6);
}

function extractHiringType(
  sections: Map<SectionKey, string[]>,
  text: string,
): string | undefined {
  const labeled = toItems(sections.get("hiring"), 24)[0];
  if (labeled) return labeled;

  const job = toItems(sections.get("job"), 24)[0];
  if (/新卒|新規学卒/u.test(text)) {
    return job ? `新卒（${job}）` : "新卒";
  }
  return job;
}

/** 「2027年3月卒業見込」「27卒」などから対象卒業年度を集める。 */
function extractGradYears(text: string): string[] {
  const years = new Set<string>();

  for (const m of text.matchAll(/(20\d{2})\s*年(?:\s*\d{1,2}\s*月)?\s*(?:卒業見込|卒業予定|卒業|卒)/gu)) {
    years.add(m[1]);
  }
  for (const m of text.matchAll(/(?:^|[^\d])(\d{2})\s*卒/gu)) {
    years.add(`20${m[1]}`);
  }
  return [...years].sort().slice(0, 4);
}

/* ---------- 公開関数 ---------- */

export interface ExtractResult {
  company_info: CompanyInfo;
  /** 掲載文から読み取れなかった項目のラベル（UI で手入力を促すために使う）。 */
  missing: string[];
}

export const EXTRACT_FIELD_LABELS: Record<string, string> = {
  name: "会社名",
  description: "事業内容・求める人物像",
  mission: "ミッション",
  values: "バリュー・価値観",
  must_have_skills: "必須スキル",
  nice_to_have: "歓迎スキル",
  locations: "勤務地",
  hiring_type: "採用区分",
  target_grad_years: "対象卒業年度",
};

/** 掲載文（採用サイト / マイナビ原稿）を company_info に変換する。 */
export function extractCompanyByRules(sourceText: string): ExtractResult {
  const text = sourceText.replace(/　/gu, " ").trim();
  const sections = splitSections(text);

  const company: CompanyInfo = {
    name: extractName(sections, text),
    description: extractDescription(sections, text),
    mission: extractMission(sections),
    values: extractValues(sections, text),
    must_have_skills: extractSkills(sections, "wanted"),
    nice_to_have: extractSkills(sections, "nice"),
    locations: extractLocations(sections, text),
    hiring_type: extractHiringType(sections, text),
    target_grad_years: extractGradYears(text),
  };

  return { company_info: company, missing: listMissing(company) };
}

/** 空のままになっている項目のラベル一覧を返す。 */
export function listMissing(company: CompanyInfo): string[] {
  const missing: string[] = [];
  const check: [keyof CompanyInfo, unknown][] = [
    ["name", company.name],
    ["description", company.description],
    ["mission", company.mission],
    ["values", company.values],
    ["must_have_skills", company.must_have_skills],
    ["nice_to_have", company.nice_to_have],
    ["locations", company.locations],
    ["hiring_type", company.hiring_type],
    ["target_grad_years", company.target_grad_years],
  ];
  for (const [key, value] of check) {
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);
    if (empty) missing.push(EXTRACT_FIELD_LABELS[key] ?? String(key));
  }
  return missing;
}

/**
 * Claude が埋められなかった項目をルールベースの結果で補う。
 * Claude 側の値があればそちらを優先する（文脈判断のほうが精度が高いため）。
 */
export function fillGaps(primary: CompanyInfo, fallback: CompanyInfo): CompanyInfo {
  const str = (a: string | undefined, b: string | undefined) =>
    a && a.trim().length > 0 ? a : b;
  const arr = (a: string[] | undefined, b: string[] | undefined) =>
    a && a.length > 0 ? a : (b ?? []);

  return {
    name: str(primary.name, fallback.name) ?? "",
    description: str(primary.description, fallback.description) ?? "",
    mission: str(primary.mission, fallback.mission),
    values: arr(primary.values, fallback.values),
    must_have_skills: arr(primary.must_have_skills, fallback.must_have_skills),
    nice_to_have: arr(primary.nice_to_have, fallback.nice_to_have),
    locations: arr(primary.locations, fallback.locations),
    hiring_type: str(primary.hiring_type, fallback.hiring_type),
    target_grad_years: arr(primary.target_grad_years, fallback.target_grad_years),
  };
}
