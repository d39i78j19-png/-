/**
 * ルールベースのスカウトメール生成（ANTHROPIC_API_KEY 未設定時のフォールバック）。
 *
 * ペルソナの重み上位軸と候補者の実記述から差し込む文を選ぶため、
 * テンプレートでも「なぜあなたに送ったか」が空文句にならないようにしている。
 */

import type {
  Candidate,
  Persona,
  PositionInfo,
  ScoutEmail,
  WeightKey,
} from "./schema";
import { WEIGHT_LABELS, WEIGHT_KEYS } from "./schema";
import { extractExtras, stripParen, truncateChars, truncatePlain } from "./text";
import { normalizeWeights } from "./weights";

/** 候補者の記述から「あなたに送った理由」に使える具体的な一節を取り出す。 */
function pickHook(candidate: Candidate, persona: Persona): string {
  const extras = [...extractExtras(candidate.extracurriculars, candidate.resume_text)];
  const personaSkills = new Set(
    persona.example_profiles.flatMap((p) => p.skills ?? []).map((s) => s.toLowerCase()),
  );
  const sharedSkill = (candidate.skills ?? []).find((s) =>
    personaSkills.has(s.toLowerCase()),
  );

  if (candidate.resume_text) {
    const firstSentence = candidate.resume_text.split(/[。\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 8) {
      return `プロフィールに書かれていた「${truncateChars(firstSentence, 40)}」という経験`;
    }
  }
  if (sharedSkill) return `${sharedSkill}を実際に使ってこられた経験`;
  if (extras.length > 0) return `${extras[0]}での取り組み`;
  if (candidate.major) return `${candidate.major}での学び`;
  return "これまでのご経験";
}

/**
 * 件名に差し込む短い話題語。
 * 経歴文をそのまま切ると語の途中で切れて不自然になるため、
 * 単語として成立するものだけを候補にする。
 */
function shortTopic(candidate: Candidate, persona: Persona): string {
  const personaSkills = new Set(
    persona.example_profiles.flatMap((p) => p.skills ?? []).map((s) => s.toLowerCase()),
  );
  const sharedSkill = (candidate.skills ?? []).find((s) =>
    personaSkills.has(s.toLowerCase()),
  );
  if (sharedSkill) return sharedSkill;

  const extras = [...extractExtras(candidate.extracurriculars, candidate.resume_text)];
  if (extras.length > 0) return extras[0];
  if (candidate.major) return candidate.major;
  return "ご経験";
}

/** 重み上位2軸から「何を魅力として訴求するか」を決める。 */
function topAxes(persona: Persona): WeightKey[] {
  const w = normalizeWeights(persona.weights);
  return [...WEIGHT_KEYS].sort((a, b) => w[b] - w[a]).slice(0, 2);
}

const AXIS_PITCH: Record<WeightKey, string> = {
  skills:
    "入社後は早い段階から実際の開発・実務に入っていただく想定で、手を動かしながら力をつけられる環境です",
  culture:
    "チームで議論しながら物事を決めていく文化があり、価値観の合う仲間と働けるかを大事にしています",
  major:
    "学生時代の専門性をそのまま活かせるテーマがあり、学びの延長線上でキャリアを描けます",
  location:
    "勤務地や働き方については柔軟に相談できる体制があり、生活と両立しやすい環境です",
  extracurricular:
    "学生時代にご自身で動かしてきた経験がそのまま評価される、裁量の大きいポジションです",
};

function signature(position: PositionInfo, companyName: string): string {
  const team = position.team ? `${position.team} / ` : "";
  return `---\n${companyName} 採用担当\n${team}${position.position} 採用担当\n`;
}

export function generateEmailsByRules(
  persona: Persona,
  candidate: Candidate,
  position: PositionInfo,
  companyName = "弊社",
): ScoutEmail[] {
  const hook = pickHook(candidate, persona);
  const topic = shortTopic(candidate, persona);
  // 「（新卒）」などの括弧書きを落として件名に収まる長さにする
  const shortPosition = truncatePlain(stripParen(position.position), 16);
  const axes = topAxes(persona);
  const pitch1 = AXIS_PITCH[axes[0]];
  const pitch2 = AXIS_PITCH[axes[1]];
  const teamLine = position.team ? `配属を想定しているのは${position.team}です。` : "";
  const linkLine = position.apply_link
    ? `\n詳細はこちらをご覧ください: ${position.apply_link}`
    : "";
  const sign = signature(position, companyName);
  const axisLabel = `${WEIGHT_LABELS[axes[0]]}と${WEIGHT_LABELS[axes[1]]}`;

  const formal: ScoutEmail = {
    tone: "丁寧・フォーマル",
    subject: truncatePlain(`${shortPosition}のご紹介とカジュアル面談のお願い`, 30),
    body:
      `${candidate.name}様\n\n` +
      `突然のご連絡失礼いたします。${companyName}で${position.position}の採用を担当しております。\n\n` +
      `${hook}を拝見し、ぜひ一度お話ししたいと思いご連絡いたしました。${persona.label}として活躍いただけるのではないかと考えております。\n\n` +
      `${pitch1}。${teamLine}また、${pitch2}。\n\n` +
      `まずは選考とは関係のないカジュアル面談として、30分ほどオンラインでお話しできませんでしょうか。現時点で就職活動の方向性が固まっていない段階でも問題ありません。情報収集の一環としてご活用いただければと思います。${linkLine}\n\n` +
      `ご検討いただけますと幸いです。\n\n${sign}`,
    recommended_send_time:
      "火〜木の19〜21時（授業やアルバイト後に落ち着いて読まれやすい時間帯）",
    one_line_reason: `${axisLabel}を重視するペルソナで、初回接触時に丁寧さを求める層に最も安全に届くトーンです。`,
  };

  const friendly: ScoutEmail = {
    tone: "フランク・親近感",
    subject: truncatePlain(`${topic}について一度お話しできませんか`, 30),
    body:
      `${candidate.name}さん、はじめまして！\n\n` +
      `${companyName}で${position.position}の採用をしている担当です。${hook}が目に留まり、思わずご連絡しました。\n\n` +
      `${pitch1}。${teamLine}\n\n` +
      `もしよければ、30分ほどオンラインで雑談ベースでお話しできませんか。志望度が固まっていなくても大歓迎で、「話を聞いてみたら違った」でまったく問題ありません。逆に${candidate.name}さんが今気になっていることを聞かせてもらえると嬉しいです。${linkLine}\n\n` +
      `ご返信お待ちしています。\n\n${sign}`,
    recommended_send_time:
      "金曜の20〜22時 / 日曜の21〜22時（就職活動をまとめて考える時間帯に当たりやすい）",
    one_line_reason:
      "課外活動や個人開発の記述が具体的な候補者は、堅いスカウトより人が見えるトーンで返信率が上がりやすいです。",
  };

  const direct: ScoutEmail = {
    tone: "要点重視・短文",
    subject: truncatePlain(`${shortPosition}／30分面談のご相談`, 30),
    body:
      `${candidate.name}さん\n\n` +
      `${companyName}の${position.position}採用担当です。${hook}を拝見してご連絡しました。\n\n` +
      `・お話ししたいこと: ${position.position}での具体的な任せ方\n` +
      `・${pitch1.slice(0, 40)}\n` +
      `・所要時間: オンラインで30分、選考とは無関係です\n${linkLine}\n\n` +
      `ご都合が合えば候補日を2つほどお送りします。\n\n${sign}`,
    recommended_send_time:
      "平日の12〜13時（移動や休憩中に短時間で判断されやすい）",
    one_line_reason:
      "情報量を絞ることで多忙な候補者でも判断しやすく、長文が読まれにくい層への再アプローチに向きます。",
  };

  return [formal, friendly, direct];
}
