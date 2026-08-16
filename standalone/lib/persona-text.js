/**
 * ペルソナ本文と各種AI診断。
 *
 * テキスト側は Claude（ANTHROPIC_API_KEY）があれば AI で、無ければ同梱の
 * ルールベースで生成する。キーが無くても画面が一通り動くようにしておかないと、
 * 「顔写真だけ試したい」ときにパイプライン全体が止まってしまうため。
 *
 * 依存パッケージを足さないよう SDK は使わず Messages API を直接叩いている。
 */

"use strict";

const TEXT_MODEL = process.env.PERSONA_TEXT_MODEL || "claude-sonnet-5";
const ANTHROPIC_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") +
  "/v1/messages";

const hasTextKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Claude に JSON を返させる。tool を1つだけ渡して tool_choice で強制するのが
 * いちばん壊れにくい（プロンプトで「JSONだけ返せ」と頼む方式は前置きが混ざる）。
 */
async function callClaudeJson({ system, user, schema, maxTokens = 4096, timeoutMs = 120000 }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      signal: ctl.signal,
      body: JSON.stringify({
        model: TEXT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: "emit", description: "結果を返す", input_schema: schema }],
        tool_choice: { type: "tool", name: "emit" },
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const block = (json.content || []).find((c) => c.type === "tool_use");
    if (!block) throw new Error("Claude が JSON を返しませんでした");
    return block.input;
  } finally {
    clearTimeout(timer);
  }
}

/* ===================== ルールベースの素材 ===================== */

const SURNAMES = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤"];
const GIVEN = {
  male: ["拓海", "陸", "颯太", "健太", "悠斗", "翔", "大輝", "遥人"],
  female: ["結衣", "美咲", "陽菜", "彩花", "咲希", "花音", "遥", "莉子"],
};
const KANA = {
  佐藤: "さとう", 鈴木: "すずき", 高橋: "たかはし", 田中: "たなか", 伊藤: "いとう",
  渡辺: "わたなべ", 山本: "やまもと", 中村: "なかむら", 小林: "こばやし", 加藤: "かとう",
};
const UNIVERSITIES = [
  ["首都圏国立大学", "経済学部"], ["関西私立大学", "社会学部"], ["地方国立大学", "工学部"],
  ["首都圏私立大学", "商学部"], ["地方公立大学", "国際教養学部"], ["首都圏私立大学", "情報学部"],
];
const CHANNELS = [
  ["就活ナビサイト", "大学のキャリアセンター", "先輩からの口コミ"],
  ["逆求人型スカウトサイト", "SNS（X）", "OB訪問アプリ"],
  ["合同説明会", "企業の採用サイト", "口コミサイト"],
];
const ANTI_HOOKS = [
  "若手が活躍できる環境です", "アットホームな職場です", "風通しの良い社風です",
  "成長できる環境があります", "やりがいのある仕事です",
];

const seedRandom = (seed) => {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
const take = (arr, r) => arr[Math.floor(r() * arr.length)];

/**
 * 条件チェックからペルソナを組み立てる（AI未使用時）。
 * 人事が選んだ条件のラベルをそのまま本文に織り込むので、画面側の
 * マッチ度計算（ラベルが本文に現れた割合）が意味のある数字になる。
 */
function personasByRules({ company = {}, conditions = {}, count = 3 }) {
  const out = [];
  const stance = conditions.stance || [];
  const skill = conditions.skill || [];
  const axis = conditions.axis || [];
  const fear = conditions.fear || [];
  const info = conditions.info || [];

  for (let i = 0; i < count; i++) {
    const r = seedRandom(0x9e37 + i * 7919);
    const gender = i % 2 === 0 ? "male" : "female";
    const surname = SURNAMES[i % SURNAMES.length];
    const given = take(GIVEN[gender], r);
    const [university, faculty] = UNIVERSITIES[i % UNIVERSITIES.length];

    const myStance = stance.length ? [stance[i % stance.length], stance[(i + 1) % stance.length]].filter(Boolean) : ["誠実さ"];
    const mySkill = skill.length ? [skill[i % skill.length]] : ["課題解決力"];
    const myAxis = axis.length ? axis.slice(0, 3) : ["やりたい仕事ができる", "安定した会社"];
    const myFear = fear.length ? fear.slice(0, 3) : ["入社後のミスマッチ", "配属先が分からない"];

    out.push({
      id: `p${String(i + 1).padStart(2, "0")}`,
      name: `${surname} ${given}`,
      kana: `${KANA[surname] || ""} `,
      gender,
      age: 21 + (i % 2),
      grade: i % 3 === 2 ? "大学4年" : "大学3年",
      university,
      faculty,
      summary:
        `${company.name || "貴社"}が求める「${myStance.join("・")}」に近い学生。` +
        `${mySkill.join("・")}を学生時代に伸ばしてきたが、${myFear[0]}への不安から` +
        `応募をためらいやすい層。`,
      personality: `${myStance.join("・")}。${mySkill[0]}に自信がある一方、決めきる前に情報を集めたがる。`,
      values: myStance,
      orientation: mySkill,
      job_axis: myAxis,
      company_criteria: myAxis.map((a) => `${a}を、社員の実例で語れるかどうかで判断する`),
      pain_points: myFear,
      info_channels: info.length ? info : CHANNELS[i % CHANNELS.length],
      voices: [
        { text: `${myAxis[0]}とは書いてあるけれど、実際どうなのかが分からない。`, tag: "本音" },
        { text: `${myFear[0]}が一番こわい。入ってから違ったとなるのが嫌だ。`, tag: "不安" },
        { text: `${mySkill[0]}は伸ばしてきたつもりだけど、社会で通用するのかは自信がない。`, tag: "自己評価" },
      ],
      hooks: myFear.map((f) => ({ message: `${f}について、面談で判断材料を個別に開示する` })),
      anti_hooks: ANTI_HOOKS.slice(i % 2, (i % 2) + 3),
      fit_reason: `選択条件「${myStance.concat(mySkill).join("・")}」から構成（ルールベース）`,
    });
  }
  return out;
}

/* ===================== AI 経路 ===================== */

const PERSONA_SCHEMA = {
  type: "object",
  properties: {
    personas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, kana: { type: "string" },
          gender: { type: "string", enum: ["male", "female"] },
          age: { type: "integer" }, grade: { type: "string" },
          university: { type: "string" }, faculty: { type: "string" },
          summary: { type: "string" }, personality: { type: "string" },
          values: { type: "array", items: { type: "string" } },
          orientation: { type: "array", items: { type: "string" } },
          job_axis: { type: "array", items: { type: "string" } },
          company_criteria: { type: "array", items: { type: "string" } },
          pain_points: { type: "array", items: { type: "string" } },
          info_channels: { type: "array", items: { type: "string" } },
          voices: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, tag: { type: "string" } },
              required: ["text"],
            },
          },
          hooks: {
            type: "array",
            items: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
          },
          anti_hooks: { type: "array", items: { type: "string" } },
          fit_reason: { type: "string" },
        },
        required: ["id", "name", "gender", "age", "summary", "personality", "job_axis", "pain_points"],
      },
    },
  },
  required: ["personas"],
};

async function personasByAI({ company = {}, conditions = {}, count = 3, sourceText = "" }) {
  const system =
    "あなたは新卒採用のペルソナ設計を専門とする採用コンサルタントです。" +
    "実在の人物・実在の大学名は使わず、採用担当者が「この学生に届けたい」と" +
    "具体的に思い浮かべられる粒度で書いてください。" +
    "きれいごとではなく、迷いや不安を含む本音を書くこと。";

  const user =
    `# 企業情報\n${JSON.stringify(company, null, 2)}\n\n` +
    `# 人事が選んだ条件\n${JSON.stringify(conditions, null, 2)}\n\n` +
    (sourceText ? `# 採用ページから読み取った内容\n${sourceText.slice(0, 6000)}\n\n` : "") +
    `# 指示\n上記の条件に当てはまる学生ペルソナを ${count} 人分作ってください。\n` +
    `- id は p01, p02 … の形式\n` +
    `- gender は male / female のいずれか。セット内で偏らせない\n` +
    `- voices は学生が実際に口にしそうな一人称の言葉で 3 件\n` +
    `- anti_hooks には「この学生には刺さらない、ありがちなスカウト文言」を入れる\n` +
    `- 人物像は互いに十分に違うものにする`;

  const out = await callClaudeJson({ system, user, schema: PERSONA_SCHEMA, maxTokens: 8192 });
  return (out.personas || []).slice(0, count);
}

/* ===================== 採用要件の診断 ===================== */

const REQUIREMENT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string" },
    rarity: {
      type: "object",
      properties: { level: { type: "string", enum: ["低", "中", "高"] }, reason: { type: "string" } },
      required: ["level", "reason"],
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" } },
          why: { type: "string" }, suggestion: { type: "string" },
        },
        required: ["items", "why"],
      },
    },
    missing: {
      type: "array",
      items: {
        type: "object",
        properties: { point: { type: "string" }, why: { type: "string" } },
        required: ["point", "why"],
      },
    },
    emphasis: {
      type: "array",
      items: {
        type: "object",
        properties: { point: { type: "string" }, how: { type: "string" } },
        required: ["point", "how"],
      },
    },
    market_gap: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "rarity"],
};

async function analyzeRequirements(payload) {
  if (!hasTextKey()) return requirementsByRules(payload);
  return callClaudeJson({
    system:
      "あなたは新卒採用の要件定義をレビューする採用コンサルタントです。" +
      "耳あたりの良い評価ではなく、このまま母集団形成に進んだときに実際に起きる問題を指摘してください。",
    user:
      `# 採用要件\n${JSON.stringify(payload.input, null, 2)}\n\n` +
      `# 学生が企業を選ぶ基準（市場実勢）\n${JSON.stringify(payload.market, null, 2)}\n\n` +
      "条件同士の矛盾、抜けている観点、市場実勢とのズレを指摘してください。",
    schema: REQUIREMENT_SCHEMA,
  });
}

function requirementsByRules({ input = {} }) {
  const picked = []
    .concat(input.stance || [], input.skill || [], input.axis || [])
    .filter(Boolean);
  const many = picked.length >= 8;
  return {
    verdict: many
      ? "条件を絞り込めていません。全て満たす学生はほぼ存在しない想定で読んでください。"
      : "条件の数は現実的な範囲です。訴求内容の具体性を上げる余地があります。",
    rarity: {
      level: many ? "高" : picked.length >= 5 ? "中" : "低",
      reason: `選択された条件は ${picked.length} 件です。条件が増えるほど該当者は指数的に減ります。`,
    },
    conflicts: many
      ? [{
          items: picked.slice(0, 2),
          why: "両立させると母集団が極端に小さくなります。",
          suggestion: "どちらかを「歓迎条件」に落として必須から外してください。",
        }]
      : [],
    missing: [
      { point: "配属の決まり方", why: "学生の不安上位ですが、要件からは読み取れません。" },
      { point: "入社後1年の具体的な仕事", why: "抽象的な訴求では他社と区別がつきません。" },
    ],
    emphasis: [
      { point: "選んだ条件の裏付け", how: "社員の実例を1つ、固有名詞と数字つきで提示してください。" },
    ],
    market_gap:
      "学生が重視するのは「安定した会社」「転勤がない」が上位です。要件側がスキルに寄っている場合、訴求点とズレます。",
    risks: [
      "条件を満たす学生に届いても、訴求が抽象的だと開封されません。",
      "AI未使用のルールベース診断です。ANTHROPIC_API_KEY を設定するとAI診断になります。",
    ],
  };
}

/* ===================== スカウト文の添削 ===================== */

const SCOUT_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "integer" },
    one_line: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: { quote: { type: "string" }, problem: { type: "string" }, fix: { type: "string" } },
        required: ["quote", "problem", "fix"],
      },
    },
    rewrite_subject: { type: "string" },
    rewrite_opening: { type: "string" },
  },
  required: ["overall", "one_line"],
};

async function analyzeScout(payload) {
  if (!hasTextKey()) return scoutByRules(payload);
  return callClaudeJson({
    system:
      "あなたは新卒スカウトメールを添削する採用コピーライターです。" +
      "指摘は必ず本文からの引用とセットにし、書き換え案まで示してください。",
    user:
      `# 宛先ペルソナ\n${JSON.stringify(payload.persona, null, 2)}\n\n` +
      `# 件名\n${payload.subject}\n\n# 本文\n${payload.body}`,
    schema: SCOUT_SCHEMA,
  });
}

function scoutByRules({ subject = "", body = "" }) {
  const issues = [];
  for (const w of ANTI_HOOKS) {
    if (body.includes(w)) {
      issues.push({
        quote: w,
        problem: "どの企業も書いている定型句で、読み飛ばされます。",
        fix: "同じことを、社員の実例と数字に置き換えてください。",
      });
    }
  }
  if (subject.length > 28) {
    issues.push({
      quote: subject.slice(0, 28) + "…",
      problem: "スマートフォンでは件名が途中で切れます。",
      fix: "28文字以内に収め、前半に相手固有の情報を置いてください。",
    });
  }
  return {
    overall: Math.max(3, 8 - issues.length),
    one_line: issues.length
      ? "定型句が残っています。相手固有の情報に置き換えると読まれます。"
      : "大きな問題は見つかりませんでした（ルールベース判定）。",
    strengths: ["本文の長さは読み切れる範囲です。"],
    issues,
    rewrite_subject: "",
    rewrite_opening: "",
  };
}

/* ===================== 企業ページの読み取り ===================== */

const COMPANY_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" }, industry: { type: "string" }, job: { type: "string" },
    area: { type: "string" }, size: { type: "string" }, strength: { type: "string" },
  },
};

async function analyzeCompany({ url, text, choices = {} }) {
  let source = text || "";
  let via = "貼り付けテキスト";

  if (!source && url) {
    // ブラウザからは CORS で取れないので、サーバー側で取得するのが本来の経路。
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; persona-studio/0.1)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`ページを取得できませんでした（HTTP ${res.status}）`);
    const html = await res.text();
    source = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    via = "サーバー取得";
  }
  if (!source) throw new Error("読み取り対象がありません");

  if (!hasTextKey()) {
    const hit = (list) => (list || []).find((x) => source.includes(x)) || "";
    return {
      name: (source.match(/(?:株式会社|有限会社)[^\s、。|｜]{1,20}/) || [""])[0],
      industry: hit(choices.industries),
      job: hit(choices.jobs),
      area: "",
      size: hit(choices.sizes),
      strength: source.slice(0, 120),
      _via: `${via}・ルールベース抽出`,
    };
  }

  const out = await callClaudeJson({
    system: "採用ページから企業情報を抽出します。書かれていない項目は空文字にし、推測で埋めないでください。",
    user:
      `# 選択肢（この中の文字列に合わせて返す）\n${JSON.stringify(choices, null, 2)}\n\n` +
      `# ページ本文\n${source.slice(0, 12000)}`,
    schema: COMPANY_SCHEMA,
    maxTokens: 1024,
  });
  return { ...out, _via: via };
}

module.exports = {
  hasTextKey,
  TEXT_MODEL,
  personasByRules,
  personasByAI,
  analyzeRequirements,
  analyzeScout,
  analyzeCompany,
};
