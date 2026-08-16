/**
 * ペルソナ属性 → 写真プロンプトへの翻訳。
 *
 * 画質の大半はここで決まる。「21歳の男性」とだけ書いたプロンプトは、誰でもない
 * 平均顔を返す。欲しいのは「その人だと思い浮かべられる顔」なので、属性は必ず
 * 「写真に写ったときに実際に見えるもの」（皮膚・姿勢・視線・服の質感）に翻訳する。
 *
 * プロンプトは 固定ブロック と 可変ブロック に分かれる。
 *   固定ブロック … セット全員で一字一句同じ。ライティングと画角が揃い、
 *                  グリッドに並べたときの「寄せ集め感」が消える。
 *   可変ブロック … 人物ごと。髪・服・表情・視線・背景・小道具をずらし、
 *                  「同じ人が複数いる」ように見えるのを防ぐ。
 *
 * 可変部の振り分けはペルソナIDから決まる決定的な値を使う。同じペルソナを
 * 作り直しても同じ見た目に寄る（＝キャッシュが効く）ようにするため。
 */

"use strict";

/* ===================== 固定ブロック（全員共通・変更禁止） =====================
   ここを人物ごとに言い換えると光も画角もバラバラになる。文言を変えるときは
   セット全体を作り直すこと。 */

const FIXED_SHOT = "A photorealistic candid headshot photograph,";

const FIXED_LIGHTING =
  "Soft diffused natural window light from camera-left with a gentle fill on the " +
  "shadow side, no harsh shadows, neutral colour grade, true-to-life skin tones.";

const FIXED_CAMERA =
  "Shot at eye level on a full-frame mirrorless camera with an 85mm portrait lens " +
  "at f/2.0, shallow depth of field, sharp focus on the eyes, head and shoulders " +
  "framing, subject centred.";

/* 実写らしさの肝。これを外すと全員が美容修正済みのモデル顔になり、
   ペルソナとして機能しなくなる。 */
const FIXED_REALISM =
  "Natural skin texture with visible pores and fine flyaway hairs, slight natural " +
  "facial asymmetry, unretouched, no beauty filter, not glamorous, not a fashion model.";

const FIXED_NEGATIVE =
  "No text, no logos, no watermark, no captions, no on-screen graphics, no extra " +
  "people in focus, no distorted hands, no illustration, no 3D render, no CGI.";

/* ===================== 年齢：数字ではなく皮膚と姿勢で書く =====================
   数字だけ書いても反映されにくい。対象は就活生（20〜23歳）が中心だが、
   中途採用ペルソナにも使えるよう 20代後半以降も持たせておく。 */

const AGE_LOOK = [
  [0, 20, "in {poss} very early 20s, smooth complexion, a soft jawline, a slightly uncertain posture"],
  [21, 21, "in {poss} early 20s, smooth complexion, a soft jawline, an open unguarded expression"],
  [22, 23, "in {poss} early 20s, smooth clear skin, a lightly defined jawline, a composed but young bearing"],
  [24, 29, "in {poss} late 20s, clear skin, a defined jawline, a relaxed confident posture"],
  [30, 39, "in {poss} 30s, faint smile lines at the corners of the eyes, a slightly heavier brow, well-groomed"],
  [40, 49, "in {poss} 40s, visible expression lines on the forehead, a settled steady bearing"],
  [50, 999, "in {poss} 50s, laugh lines around the eyes, a few grey hairs at the temples, a composed presence"],
];

function ageLook(age, poss) {
  const n = Number.parseInt(age, 10);
  const a = Number.isFinite(n) ? n : 21;
  const row = AGE_LOOK.find(([lo, hi]) => a >= lo && a <= hi) || AGE_LOOK[1];
  return row[2].replace(/\{poss\}/g, poss);
}

/* ===================== 髪：セット内で似た顔にならないよう散らす =====================
   日本人の学生は染髪も普通なので、黒一色にすると逆に不自然になる。 */

const HAIR = {
  male: [
    "short straight black hair, neatly cut",
    "short dark brown hair with a natural side part",
    "slightly tousled short black hair",
    "short black hair cropped close at the sides",
    "soft short dark brown hair falling loosely over the forehead",
  ],
  female: [
    "shoulder-length straight black hair",
    "shoulder-length softly highlighted brown hair",
    "dark brown hair tied back neatly",
    "chin-length straight dark brown hair",
    "long black hair with a blunt fringe",
  ],
};

/* ===================== 服装 =====================
   recruit … 就活生のリクルートスーツ。新卒採用の文脈ではこれが既定。
   casual  … 私服。スーツ一色より個体差が出るので、写真としてのリアルさは上。
   志望業界がやわらかい業界なら recruit でもノーネクタイに崩す。 */

const WARDROBE = {
  recruit: {
    male: [
      "wearing a plain black recruit suit with a white shirt and a plain dark navy tie",
      "wearing a plain dark navy recruit suit with a white shirt and a plain charcoal tie",
      "wearing a plain charcoal recruit suit with a white shirt and a subtle dark burgundy tie",
    ],
    female: [
      "wearing a plain black recruit suit jacket over a white blouse",
      "wearing a plain dark navy recruit suit jacket over a soft off-white blouse",
      "wearing a plain charcoal recruit suit jacket over a pale grey blouse",
    ],
  },
  recruitSoft: {
    male: [
      "wearing a plain dark navy recruit suit with a white shirt and no tie",
      "wearing a plain charcoal suit jacket over a white open-collar shirt",
      "wearing a dark navy jacket over a plain white shirt, no tie",
    ],
    female: [
      "wearing a plain dark navy recruit suit jacket over a white blouse, no scarf",
      "wearing a soft charcoal jacket over an off-white blouse",
      "wearing a plain black jacket over a pale grey blouse",
    ],
  },
  casual: {
    male: [
      "wearing a plain dark navy jacket over a white crew-neck t-shirt",
      "wearing a plain charcoal crew-neck knit sweater",
      "wearing a plain white open-collar shirt",
      "wearing a light grey hooded sweatshirt",
      "wearing a plain black shirt over a white t-shirt",
    ],
    female: [
      "wearing a plain cream collarless blouse",
      "wearing a soft white shirt with a relaxed collar",
      "wearing a plain light beige knit sweater",
      "wearing a plain white blouse under a navy cardigan",
      "wearing a soft light grey knit top",
    ],
  },
};

/* やわらかい業界＝ネクタイを締めていない写真の方が実態に近い */
const SOFT_INDUSTRY = ["IT", "ソフトウェア", "広告", "メディア", "小売", "サービス", "ゲーム", "web", "Web"];

/* ===================== 背景 =====================
   全員を同じ背景にすると誰が誰か分からなくなる。「その人が普段いる場所」に散らす。 */

const SETTINGS = {
  student: [
    "in a bright university building corridor, glass and daylight softly blurred behind",
    "on a university campus walkway, trees softly blurred behind",
    "in a quiet university library, shelving softly blurred behind",
    "at a job-fair venue, company booths softly blurred behind",
    "in a bright seminar room, rows of chairs softly blurred behind",
    "in a café near campus, a window and warm daylight softly blurred behind",
  ],
  office: [
    "in a modern open-plan office, monitors softly blurred behind",
    "in a bright meeting room with a glass partition softly blurred behind",
    "in an office lounge with green plants softly blurred behind",
    "by a large office window with daylight and city buildings softly blurred behind",
  ],
};

/* ===================== 表情 =====================
   笑顔一択にしないこと。ここが「その人だと分かる顔」の核心。 */

const EXPRESSIONS = {
  serious: "Serious and unsmiling, a steady direct gaze, squared shoulders.",
  evaluating:
    "A neutral expression with slight tension around the brows, an evaluating gaze.",
  bright: "An open genuine smile showing teeth, bright engaged eyes.",
  hesitant: "A slightly hesitant smile, an attentive posture, leaning very slightly forward.",
  gentle: "A gentle closed-mouth smile, relaxed eyes, a slight tilt of the head.",
  tired:
    "Composed but visibly tired, faint shadows under the eyes, a small polite smile " +
    "that does not quite reach the eyes.",
  calm: "A calm closed-mouth smile with relaxed, attentive eyes.",
};

const EXPRESSION_WHY = {
  serious: "現場のプロ・職人気質",
  evaluating: "慎重・分析的",
  bright: "前向き・挑戦志向",
  hesitant: "若手・学習中",
  gentle: "面倒見が良い・協調的",
  tired: "課題を抱えている・疲弊",
  calm: "既定",
};

/* ペルソナ本文（日本語）から表情を決める。先に当たったものを採用する。
   全文を includes() で舐めると全員同じ表情になり、並べたとき同一人物に見える。 */
const EXPRESSION_RULES = [
  ["serious", ["体育会", "ストレス耐性", "泥臭", "職人", "現場", "根性", "やり抜く"]],
  ["evaluating", ["論理", "分析", "慎重", "データ", "研究", "課題解決", "見極め", "比較"]],
  ["bright", ["挑戦", "成長", "海外", "グローバル", "起業", "リーダー", "前向き", "インターン"]],
  ["gentle", ["傾聴", "共感", "誠実", "チーム", "協調", "面倒見", "社会貢献", "支え"]],
  ["hesitant", ["安定", "ワークライフ", "地元", "不安", "自信がな", "迷"]],
  ["tired", ["疲弊", "消耗", "板挟み", "疲れ"]],
];

function expressionFor(persona) {
  const blob = [
    persona.personality,
    persona.summary,
    ...(persona.values || []),
    ...(persona.orientation || []),
    ...(persona.job_axis || []),
    ...(persona.pain_points || []),
  ]
    .filter(Boolean)
    .join(" ");

  for (const [key, words] of EXPRESSION_RULES) {
    const hit = words.find((w) => blob.includes(w));
    if (hit) {
      return { key, text: EXPRESSIONS[key], why: `「${hit}」→ ${EXPRESSION_WHY[key]}` };
    }
  }
  return { key: "calm", text: EXPRESSIONS.calm, why: EXPRESSION_WHY.calm };
}

/* ===================== 視線 =====================
   全員がカメラ目線＝証明写真の並びになる。実際の人物写真は視線が散っている。
   ここを散らすだけでストックフォト感がかなり抜ける。 */

const GAZE = [
  "Looking directly at the camera.",
  "Looking slightly off-camera to the left, in three-quarter view.",
  "Looking directly at the camera.",
  "Looking slightly upward and past the camera, in three-quarter view.",
  "Looking directly at the camera, head turned very slightly.",
];

/* ===================== 小道具 =====================
   1人1つまで。全員に持たせると散らかるし、手が写ると崩れやすい。 */

const PROPS = {
  smartphone: "Holding a smartphone at chest height.",
  document: "Holding a printed document.",
  laptop: "One hand resting on an open laptop.",
  none: "Arms relaxed at {poss} sides, holding nothing.",
};

function propFor(persona, index) {
  const blob = [...(persona.info_channels || []), ...(persona.job_axis || [])].join(" ");
  const candidates = [];
  if (/研究|論文|ゼミ/.test(blob)) candidates.push("document");
  if (/プログラ|開発|エンジニア|IT/.test(blob)) candidates.push("laptop");
  if (/SNS|スマホ|アプリ|スカウト/.test(blob)) candidates.push("smartphone");
  candidates.push("none", "none"); // 何も持たせない方が破綻しにくいので厚めに
  return candidates[index % candidates.length];
}

/* ===================== 決定的な種 =====================
   同じペルソナからは常に同じ見た目が出るようにする（キャッシュを効かせるため）。 */

function seedOf(persona, index) {
  const s = String(persona.id || "") + String(persona.name || "") + String(index);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const pick = (arr, n) => arr[n % arr.length];

/* ===================== 日本人らしさ =====================
   `Japanese` とだけ書くと、西洋顔に日本人名が付いた画像が返ることがある。
   主語の直後に East Asian features / natural Japanese complexion を併記する。 */

function subjectPhrase(persona, look, hair, wardrobe) {
  const noun = persona.gender === "female" ? "woman" : "man";
  return (
    `of a Japanese ${noun} ${look}, East Asian features, natural Japanese ` +
    `complexion, ${hair}, ${wardrobe}.`
  );
}

/**
 * ペルソナ1人分のプロンプトを組み立てる。
 *
 * @param {object} persona  サーバー側ペルソナ（id/name/gender/age/summary/... ）
 * @param {number} index    セット内の並び順。可変部の振り分けに使う
 * @param {object} [opts]
 * @param {"recruit"|"casual"|"auto"} [opts.wardrobe="auto"] 服装モード
 * @param {"student"|"office"} [opts.scene="student"]        背景の系統
 * @param {string} [opts.industry]                           志望業界（服装の崩しに使う）
 * @param {boolean} [opts.hasReference]                      参照画像を併送するか
 * @returns {{prompt:string, variable:object, fixed:object}}
 */
function buildPortraitPrompt(persona = {}, index = 0, opts = {}) {
  const wardrobeMode = opts.wardrobe || "auto";
  const scene = opts.scene === "office" ? "office" : "student";
  const gender = persona.gender === "female" ? "female" : "male";
  const poss = gender === "female" ? "her" : "his";
  const subj = gender === "female" ? "She" : "He";

  const seed = seedOf(persona, index);
  const look = ageLook(persona.age, poss);
  const hair = pick(HAIR[gender], seed);

  const soft = SOFT_INDUSTRY.some((w) => String(opts.industry || "").includes(w));
  let wardrobeSet;
  if (wardrobeMode === "casual") wardrobeSet = WARDROBE.casual[gender];
  else if (wardrobeMode === "recruit") wardrobeSet = WARDROBE[soft ? "recruitSoft" : "recruit"][gender];
  else wardrobeSet = WARDROBE[soft ? "recruitSoft" : "recruit"][gender]; // auto
  const wardrobe = pick(wardrobeSet, index);

  const setting = pick(SETTINGS[scene], index);
  const expression = expressionFor(persona);
  const gaze = pick(GAZE, index);
  const propKey = propFor(persona, index);
  const prop = PROPS[propKey].replace(/\{poss\}/g, poss);

  const parts = [
    `${FIXED_SHOT} ${subjectPhrase(persona, look, hair, wardrobe)}`,
    expression.text,
    gaze,
    prop,
    `${subj} is ${setting}.`,
    FIXED_LIGHTING,
    FIXED_CAMERA,
    FIXED_REALISM,
    FIXED_NEGATIVE,
  ];

  /* 同一人物で別カットを作る場合。これを書かないと参照画像が
     単なる雰囲気の参考として扱われ、顔が変わってしまう。 */
  if (opts.hasReference) {
    parts.push(
      "The same person as in the reference image. Keep the facial features, hair, " +
        "and skin tone completely unchanged.",
    );
  }

  const rationale =
    `年齢${persona.age || 21}歳の見た目 ／ 表情：${expression.why} ／ ` +
    `背景：${scene === "office" ? "オフィス" : "大学・就活シーン"}を候補ごとに変更 ／ ` +
    `服装：${wardrobeMode === "casual" ? "私服" : soft ? "リクルート（ノーネクタイ）" : "リクルートスーツ"}`;

  return {
    prompt: parts.join(" "),
    variable: { hair, wardrobe, setting, gaze, prop: propKey, expression: expression.key, rationale },
    fixed: {
      shot: FIXED_SHOT,
      lighting: FIXED_LIGHTING,
      camera: FIXED_CAMERA,
      realism: FIXED_REALISM,
      negative: FIXED_NEGATIVE,
    },
  };
}

module.exports = { buildPortraitPrompt, EXPRESSIONS, SETTINGS, HAIR, WARDROBE };
