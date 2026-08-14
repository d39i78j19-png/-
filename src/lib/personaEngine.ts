/**
 * ルールベースのペルソナ生成（ANTHROPIC_API_KEY 未設定時のフォールバック）。
 *
 * company_info のキーワードから「狙う母集団のクラスタ」を選び、
 * クラスタごとに定義した重み・想定専攻・想定スキルを company_info の語で
 * 上書きして組み立てる。Claude 出力と同じ JSON 契約を返すので、
 * UI と /api/match 以降は生成元を区別しなくて済む。
 */

import type { CompanyInfo, ExampleProfile, Persona, Weights } from "./schema";
import { norm } from "./text";

interface Cluster {
  key: string;
  label: string;
  triggers: string[];
  /** 正規化前の重み。normalizeWeights で 1.0 に揃える。 */
  weights: Weights;
  roles: string[];
  majors: string[];
  baseSkills: string[];
  interests: string[];
  extras: string[];
  universityLevels: string[];
  /** description の骨格。{company} {values} を置換する。 */
  summary: string;
  snippets: string[];
}

const CLUSTERS: Cluster[] = [
  {
    key: "engineering",
    label: "プロダクト志向エンジニア",
    triggers: [
      "エンジニア", "開発", "プログラミング", "ソフトウェア", "実装", "技術",
      "react", "python", "javascript", "typescript", "インフラ", "バックエンド",
      "フロントエンド", "アプリ", "システム",
    ],
    weights: {
      skills: 0.5,
      culture: 0.2,
      major: 0.1,
      location: 0.1,
      extracurricular: 0.1,
    },
    roles: ["フロントエンド", "バックエンド", "プロダクト開発"],
    majors: ["情報系", "情報工学", "数学"],
    baseSkills: ["プログラミング基礎", "Git", "JavaScript"],
    interests: ["プロダクト開発", "UI/UX", "技術選定"],
    extras: ["ハッカソン", "個人開発", "インターン"],
    universityLevels: ["国立大学（情報系学部）", "私立大学（理工系学部）", "難関国立大学"],
    summary:
      "自分の手でプロダクトを動かすことに強い動機を持つ学生。授業や個人開発で実際に手を動かした経験があり、技術を目的ではなく課題解決の手段として捉えている。{values}を重視する{company}の開発現場で、早期からコードを書いて価値を出したいと考えるタイプ",
    snippets: [
      "学内のWebアプリ開発プロジェクトでフロント実装を担当し、ユーザーヒアリングをもとに画面設計から作り直しました",
      "個人開発で作った学習管理アプリを公開し、利用者のフィードバックを受けて機能を継続的に改善しています",
      "長期インターンでバックエンドのAPI実装を任され、レビューを受けながら設計の考え方を学びました",
    ],
  },
  {
    key: "product_design",
    label: "ユーザー起点のプロダクト志向",
    triggers: [
      "デザイン", "ux", "ui", "ユーザー", "顧客体験", "プロダクト", "リサーチ",
      "設計", "ユーザ中心",
    ],
    weights: {
      skills: 0.3,
      culture: 0.35,
      major: 0.1,
      location: 0.1,
      extracurricular: 0.15,
    },
    roles: ["プロダクト企画", "UXデザイン", "ディレクション"],
    majors: ["デザイン", "情報系", "心理学"],
    baseSkills: ["UX設計", "Figma", "ユーザーインタビュー"],
    interests: ["ユーザーリサーチ", "情報設計", "サービス改善"],
    extras: ["学生団体", "ハッカソン", "インターン"],
    universityLevels: ["私立大学（デザイン・情報系）", "国立大学（人文・情報系）", "美術・芸術系大学"],
    summary:
      "「誰のどんな困りごとを解くのか」から考えることが自然にできる学生。ユーザーに話を聞いて仮説を立て、形にして反応を見る動き方を学生時代に経験している。{values}を掲げる{company}のプロダクトづくりに、作り手と使い手の間をつなぐ役割で関わりたいと考えるタイプ",
    snippets: [
      "サークルの新歓サイトを作り直す際、新入生20人にヒアリングして導線を全面的に設計し直しました",
      "ハッカソンでチームのリサーチ担当としてユーザー像を整理し、プロトタイプの改善方針をまとめました",
      "インターンでサービスの解約理由を分析し、オンボーディング画面の改善案を提案しました",
    ],
  },
  {
    key: "business",
    label: "顧客接点の事業推進志向",
    triggers: [
      "営業", "セールス", "事業", "顧客", "提案", "マーケティング", "グロース",
      "パートナー", "コンサル", "折衝", "総合職",
    ],
    weights: {
      skills: 0.2,
      culture: 0.35,
      major: 0.05,
      location: 0.15,
      extracurricular: 0.25,
    },
    roles: ["事業開発", "セールス", "カスタマーサクセス"],
    majors: ["経済学", "経営学", "社会学"],
    baseSkills: ["論理的思考", "資料作成", "Excel"],
    interests: ["事業成長", "顧客折衝", "マーケティング"],
    extras: ["インターン", "学生団体", "サークル"],
    universityLevels: ["国立大学（社会科学系）", "私立大学（経済・経営系）", "難関私立大学"],
    summary:
      "人と向き合って物事を前に進めた経験がある学生。学生団体やインターンで目標を持って動き、断られてからどう組み立て直すかを体感している。{values}を大切にする{company}で、顧客の課題を一次情報として持ち帰り事業に反映させる役割に手応えを感じるタイプ",
    snippets: [
      "学生団体で企業への協賛営業を担当し、断られた理由を記録して提案内容を作り直した結果、前年比で協賛社数を増やしました",
      "長期インターンでインサイドセールスを担当し、架電スクリプトを自分で改善して商談化率を上げました",
      "サークルのイベント運営でスポンサー折衝と当日運営を兼任し、100人規模の集客を達成しました",
    ],
  },
  {
    key: "data",
    label: "データで意思決定を支える志向",
    triggers: [
      "データ", "分析", "機械学習", "統計", "定量", "sql", "ai", "研究",
      "データサイエンス", "検証", "仮説",
    ],
    weights: {
      skills: 0.45,
      culture: 0.15,
      major: 0.25,
      location: 0.05,
      extracurricular: 0.1,
    },
    roles: ["データ分析", "機械学習エンジニア", "事業企画"],
    majors: ["情報系", "統計学", "数学"],
    baseSkills: ["Python", "SQL", "統計解析"],
    interests: ["データ分析", "機械学習", "意思決定支援"],
    extras: ["研究", "インターン", "ハッカソン"],
    universityLevels: ["国立大学（理工系）", "大学院（修士）", "難関国立大学"],
    summary:
      "感覚ではなく数字で確かめてから動くことを好む学生。研究やゼミでデータを扱い、前処理の泥臭さも含めて経験している。{values}を掲げる{company}で、意思決定の材料をつくる側として事業に関わりたいと考えるタイプ。分析を出すだけで終わらせず示唆まで持っていく姿勢を重視する",
    snippets: [
      "研究室で実験データの前処理から可視化までを担当し、Pythonで分析パイプラインを整備しました",
      "インターンでユーザー行動ログをSQLで集計し、離脱が起きている画面を特定して改善提案につなげました",
      "データ分析コンペに参加し、特徴量設計を工夫して上位入賞しました",
    ],
  },
  {
    key: "corporate",
    label: "組織と仕組みを整える志向",
    triggers: [
      "人事", "採用", "労務", "経理", "財務", "法務", "コーポレート", "総務",
      "組織", "制度", "バックオフィス",
    ],
    weights: {
      skills: 0.2,
      culture: 0.4,
      major: 0.1,
      location: 0.2,
      extracurricular: 0.1,
    },
    roles: ["人事", "経営企画", "コーポレート"],
    majors: ["法学", "経営学", "社会学"],
    baseSkills: ["論理的思考", "資料作成", "調整力"],
    interests: ["組織づくり", "制度設計", "採用"],
    extras: ["学生団体", "サークル", "ボランティア"],
    universityLevels: ["国立大学（法・経済系）", "私立大学（社会科学系）", "難関私立大学"],
    summary:
      "人が働きやすい状態をつくることに関心がある学生。学生団体やサークルの運営側として、揉めごとの調整や引き継ぎの仕組みづくりを経験している。{values}を重視する{company}の組織づくりに、制度と運用の両面から関わりたいと考えるタイプ。地道な整備を面白がれる点が強み",
    snippets: [
      "サークルの代表として引き継ぎ資料と会計ルールを整備し、翌年以降の運営が回る状態をつくりました",
      "学生団体で50名のメンバーのシフト調整と新人育成を担当し、離脱率を下げました",
      "インターンで採用イベントの運営を任され、候補者アンケートをもとに進行を改善しました",
    ],
  },
];

function haystack(company: CompanyInfo): string {
  return norm(
    [
      company.description,
      company.mission ?? "",
      company.hiring_type ?? "",
      ...(company.values ?? []),
      ...(company.must_have_skills ?? []),
      ...(company.nice_to_have ?? []),
    ].join(" "),
  );
}

function rankClusters(company: CompanyInfo): Cluster[] {
  const hay = haystack(company);
  const scored = CLUSTERS.map((cluster) => ({
    cluster,
    score: cluster.triggers.filter((t) => hay.includes(norm(t))).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cluster);
}

/** company_info に出てくる具体スキル名をクラスタの想定スキルに混ぜる。 */
function mergeSkills(cluster: Cluster, company: CompanyInfo): string[] {
  const fromCompany = [
    ...(company.must_have_skills ?? []),
    ...(company.nice_to_have ?? []),
  ];
  const merged = [...cluster.baseSkills];
  for (const s of fromCompany) {
    if (merged.some((m) => norm(m) === norm(s))) continue;
    merged.push(s);
  }
  return merged.slice(0, 6);
}

function buildProfiles(cluster: Cluster, company: CompanyInfo): ExampleProfile[] {
  const skills = mergeSkills(cluster, company);
  return [0, 1, 2].map((i) => ({
    university_level: cluster.universityLevels[i % cluster.universityLevels.length],
    majors: [
      cluster.majors[i % cluster.majors.length],
      cluster.majors[(i + 1) % cluster.majors.length],
    ],
    skills: [
      ...skills.slice(0, 3),
      ...(i === 0 ? skills.slice(3, 5) : []),
    ].filter(Boolean),
    interests: cluster.interests,
    extracurriculars: [
      cluster.extras[i % cluster.extras.length],
      cluster.extras[(i + 1) % cluster.extras.length],
    ],
    resume_snippet: cluster.snippets[i % cluster.snippets.length],
  }));
}

function buildDescription(cluster: Cluster, company: CompanyInfo): string {
  const values =
    company.values && company.values.length > 0
      ? company.values.slice(0, 3).join("・")
      : "ユーザー志向とチーム協働";
  return cluster.summary
    .replace("{values}", values)
    .replace("{company}", company.name);
}

/**
 * ルールベースでペルソナ配列を生成する。
 * 返り値は sanitizePersonas に通す前の「素案」で、文字数調整はそちらで行う。
 */
export function generatePersonasByRules(
  company: CompanyInfo,
  count: number,
): unknown[] {
  const ranked = rankClusters(company);
  const out: unknown[] = [];

  for (let i = 0; i < count; i += 1) {
    const cluster = ranked[i % ranked.length];
    const round = Math.floor(i / ranked.length);
    const label =
      round === 0 ? cluster.label : `${cluster.label}（第${round + 1}群）`;

    // 2周目以降は重みを少しずらして同一ペルソナの複製にならないようにする
    const weights: Weights = { ...cluster.weights };
    if (round > 0) {
      weights.culture += 0.1 * round;
      weights.skills = Math.max(0.05, weights.skills - 0.05 * round);
    }

    out.push({
      id: `persona-${i + 1}`,
      label,
      description: buildDescription(cluster, company),
      weights,
      priority_roles: cluster.roles,
      example_profiles: buildProfiles(cluster, company),
    });
  }
  return out;
}
