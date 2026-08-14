/**
 * 候補者 × ペルソナ マッチングスコア算出エンジン。
 *
 * 仕様の採点ルール 1)〜6) をそのまま TypeScript で実装している。
 * 同じ入力なら常に同じ点数が出る（決定論的）ので、選考基準として説明可能。
 *
 * extras_score だけは「活動の質・頻度を簡易に文脈から判断」という
 * 判断を含むため、Claude による上書きを受け付ける口を用意している
 * （src/app/api/match/route.ts 参照）。
 */

import {
  SCORE_KEYS,
  SCORE_TO_WEIGHT,
  type Breakdown,
  type Candidate,
  type CompanyInfo,
  type Match,
  type Persona,
  type ScoreKey,
} from "./schema";
import {
  buildCultureKeywords,
  classifyMajor,
  clamp,
  countQualitySignals,
  extractExtras,
  isRelatedField,
  jaccard,
  norm,
  normSkill,
  parseLocation,
  pct,
  toSet,
  truncateChars,
} from "./text";
import { normalizeWeights } from "./weights";

export interface ScoreTrace {
  /** 各軸の算出根拠（UI で内訳を開いたときに見せる） */
  skills: { personaSkills: string[]; matched: string[]; jaccard: number };
  culture: { keywords: string[]; matched: string[] };
  major: { candidateField: string | null; personaFields: string[]; rule: string };
  location: { candidate: string; targets: string[]; rule: string };
  extras: { personaExtras: string[]; matched: string[]; qualitySignals: number; rule: string };
}

export interface ScoreResult {
  match: Match;
  trace: ScoreTrace;
}

/* ---------- 2) skills_score ---------- */

function scoreSkills(persona: Persona, candidate: Candidate) {
  // ペルソナ想定skills = example_profiles の skills の和集合
  const personaRaw = persona.example_profiles.flatMap((p) => p.skills ?? []);
  const personaSet = toSet(personaRaw);
  const candidateSet = toSet(candidate.skills);

  // 仕様: ペルソナの想定skillsが空の場合は 0
  if (personaSet.size === 0) {
    return {
      score: 0,
      trace: { personaSkills: [], matched: [], jaccard: 0 },
    };
  }

  const j = jaccard(candidateSet, personaSet);
  const matched = (candidate.skills ?? []).filter((s) =>
    personaSet.has(normSkill(s)),
  );
  return {
    score: pct(j),
    trace: {
      personaSkills: [...new Set(personaRaw)],
      matched,
      jaccard: Math.round(j * 1000) / 1000,
    },
  };
}

/* ---------- 3) culture_score ---------- */

function scoreCulture(
  persona: Persona,
  candidate: Candidate,
  company: CompanyInfo | undefined,
) {
  const keywords = buildCultureKeywords(
    persona.description,
    company?.values,
    persona.priority_roles,
  );

  // 照合対象は resume_text だけでなく候補者が自分の言葉で書いた欄すべて。
  // 価値観を示す語は課外活動名や専攻にも現れるため、resume_text 単独だと
  // 短いプロフィールの候補者が一律に低得点になってしまう。
  const haystack = norm(
    [
      candidate.resume_text ?? "",
      ...(candidate.extracurriculars ?? []),
      ...(candidate.skills ?? []),
      candidate.major ?? "",
    ].join(" "),
  );

  // 最大可能数 = 抽出したキーワード数。0 件なら割れないので 0。
  if (keywords.length === 0 || haystack.length === 0) {
    return { score: 0, trace: { keywords, matched: [] } };
  }

  const matched = keywords.filter((k) => haystack.includes(norm(k)));
  return {
    score: pct(matched.length / keywords.length),
    trace: { keywords, matched },
  };
}

/* ---------- 4) major_score ---------- */

function scoreMajor(persona: Persona, candidate: Candidate) {
  const personaMajors = [
    ...new Set(persona.example_profiles.flatMap((p) => p.majors ?? [])),
  ];
  const candidateMajor = (candidate.major ?? "").trim();

  // 仕様: 不明な場合は 50
  if (!candidateMajor || personaMajors.length === 0) {
    return {
      score: 50,
      trace: {
        candidateField: null,
        personaFields: personaMajors,
        rule: "専攻が不明のため 50",
      },
    };
  }

  // 完全一致（case-insensitive）なら 100
  const candidateNorm = norm(candidateMajor);
  if (personaMajors.some((m) => norm(m) === candidateNorm)) {
    return {
      score: 100,
      trace: {
        candidateField: candidateMajor,
        personaFields: personaMajors,
        rule: "想定専攻と完全一致",
      },
    };
  }

  // 関連分野なら 70
  const candidateField = classifyMajor(candidateMajor);
  const personaFields = personaMajors
    .map(classifyMajor)
    .filter((f): f is NonNullable<typeof f> => f !== null);

  if (
    candidateField &&
    personaFields.some((f) => isRelatedField(candidateField, f))
  ) {
    return {
      score: 70,
      trace: {
        candidateField,
        personaFields: personaMajors,
        rule: "関連分野として 70",
      },
    };
  }

  // 分野が判定できないものは「不明」扱いで 50、判定できて非関連なら 20
  if (!candidateField || personaFields.length === 0) {
    return {
      score: 50,
      trace: {
        candidateField,
        personaFields: personaMajors,
        rule: "分野を判定できないため 50",
      },
    };
  }

  return {
    score: 20,
    trace: {
      candidateField,
      personaFields: personaMajors,
      rule: "非関連分野として 20",
    },
  };
}

/* ---------- 5) location_score ---------- */

function scoreLocation(
  candidate: Candidate,
  company: CompanyInfo | undefined,
  personaLocations: string[] = [],
) {
  const targets = [...(company?.locations ?? []), ...personaLocations];
  const me = parseLocation(candidate.location);
  const parsedTargets = targets.map(parseLocation);

  const candidates: Array<{ score: number; rule: string }> = [
    { score: 20, rule: "勤務地の一致なし（20）" },
  ];

  if (me.city && parsedTargets.some((t) => t.city && t.city === me.city)) {
    candidates.push({ score: 100, rule: "同市区町村（100）" });
  }
  if (me.pref && parsedTargets.some((t) => t.pref && t.pref === me.pref)) {
    candidates.push({ score: 70, rule: "同都道府県（70）" });
  }
  // リモート可 かつ 候補者がリモート希望
  const companyRemote = parsedTargets.some((t) => t.remote);
  if (companyRemote && (candidate.remote_ok === true || me.remote)) {
    candidates.push({ score: 80, rule: "リモート可 × 候補者リモートOK（80）" });
  }

  const best = candidates.reduce((a, b) => (a.score >= b.score ? a : b));
  return {
    score: best.score,
    trace: { candidate: me.raw || "(未入力)", targets, rule: best.rule },
  };
}

/* ---------- 6) extras_score ---------- */

function scoreExtras(persona: Persona, candidate: Candidate) {
  const personaExtras = extractExtras(
    persona.example_profiles.flatMap((p) => p.extracurriculars ?? []),
    undefined,
  );
  const candidateExtras = extractExtras(
    candidate.extracurriculars,
    candidate.resume_text,
  );
  const quality = countQualitySignals(
    [candidate.resume_text, ...(candidate.extracurriculars ?? [])].join(" "),
  );
  // 質シグナルは 3 件で上限（0-1 に正規化）
  const qualityRatio = Math.min(1, quality / 3);

  if (candidateExtras.size === 0 && quality === 0) {
    return {
      score: 0,
      trace: {
        personaExtras: [...personaExtras],
        matched: [],
        qualitySignals: quality,
        rule: "課外活動の記載なし（0）",
      },
    };
  }

  if (personaExtras.size === 0) {
    // 想定活動が定義されていないので、候補者側の活動量と質だけで評価する
    const presence = Math.min(1, candidateExtras.size / 2);
    return {
      score: clamp(Math.round(presence * 40 + qualityRatio * 60)),
      trace: {
        personaExtras: [],
        matched: [...candidateExtras],
        qualitySignals: quality,
        rule: "ペルソナ側の想定活動が未定義のため候補者の活動量と質で評価",
      },
    };
  }

  const matched = [...candidateExtras].filter((e) => personaExtras.has(e));
  const overlap = matched.length / personaExtras.size;
  return {
    score: clamp(Math.round(overlap * 70 + qualityRatio * 30)),
    trace: {
      personaExtras: [...personaExtras],
      matched,
      qualitySignals: quality,
      rule: `想定活動との合致 ${matched.length}/${personaExtras.size} + 質シグナル ${quality}件`,
    },
  };
}

/* ---------- notes ---------- */

function buildNotes(breakdown: Breakdown, weights: ReturnType<typeof normalizeWeights>): string {
  const contributions = SCORE_KEYS.map((key) => ({
    key,
    label: key,
    points: weights[SCORE_TO_WEIGHT[key]] * breakdown[key],
    score: breakdown[key],
  })).sort((a, b) => b.points - a.points);

  const jp: Record<ScoreKey, string> = {
    skills: "スキル",
    culture: "カルチャー",
    major: "専攻",
    location: "勤務地",
    extras: "課外活動",
  };

  const top = contributions.slice(0, 2);
  const worst = contributions[contributions.length - 1];
  const positives = top
    .map((c) => `${jp[c.key]}${c.score}点`)
    .join("・");
  const note =
    `${positives}が加点の主因（重み上位軸で高スコア）。` +
    `一方 ${jp[worst.key]}は${worst.score}点で最も足を引いており、ここが伸びれば総合が上がる。`;
  return truncateChars(note, 200);
}

/* ---------- エントリポイント ---------- */

export interface ScoreOptions {
  company?: CompanyInfo;
  /** Claude が文脈判断した extras_score（0-100）。渡された場合はこちらを採用する。 */
  extrasOverride?: { score: number; reason: string };
}

export function scoreCandidate(
  persona: Persona,
  candidate: Candidate,
  options: ScoreOptions = {},
): ScoreResult {
  const weights = normalizeWeights(persona.weights);

  const skills = scoreSkills(persona, candidate);
  const culture = scoreCulture(persona, candidate, options.company);
  const major = scoreMajor(persona, candidate);
  const location = scoreLocation(candidate, options.company);
  const extrasRule = scoreExtras(persona, candidate);

  const extras = options.extrasOverride
    ? {
        score: clamp(Math.round(options.extrasOverride.score)),
        trace: {
          ...extrasRule.trace,
          rule: `Claude の文脈判断: ${options.extrasOverride.reason}`,
        },
      }
    : extrasRule;

  const breakdown: Breakdown = {
    skills: skills.score,
    culture: culture.score,
    major: major.score,
    location: location.score,
    extras: extras.score,
  };

  // final_score = round(Σ weights[axis] * axis_score)
  let weighted = 0;
  for (const key of SCORE_KEYS) {
    weighted += weights[SCORE_TO_WEIGHT[key]] * breakdown[key];
  }
  const finalScore = clamp(Math.round(weighted));

  return {
    match: {
      candidate_id: candidate.id,
      persona_id: persona.id,
      final_score: finalScore,
      breakdown,
      weight_used: weights,
      notes: buildNotes(breakdown, weights),
    },
    trace: {
      skills: skills.trace,
      culture: culture.trace,
      major: major.trace,
      location: location.trace,
      extras: extras.trace,
    },
  };
}

/** 総合点から S/A/B/C/D の記号を返す（UI 表示用。JSON 契約には含めない）。 */
export function gradeOf(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "D";
}
