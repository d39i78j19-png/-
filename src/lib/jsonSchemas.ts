/**
 * Claude の Structured Outputs（output_config.format）に渡す JSON Schema。
 *
 * 仕様書の output_schema をベースにしているが、Structured Outputs の制約に合わせて
 * 2点だけ調整している:
 *   1. すべての object に "additionalProperties": false を付与（必須）
 *   2. すべての property を "required" に列挙（Structured Outputs は部分的な
 *      required を許容しないため、任意項目も必須化して常に埋めさせる）
 * minLength / maxLength / minimum などの数値・長さ制約はサポート外なので
 * スキーマには入れず、プロンプト指示 + src/lib/validate.ts のコード検証で担保する。
 */

const str = { type: "string" } as const;
const strArray = { type: "array", items: { type: "string" } } as const;

export const PERSONA_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    personas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: str,
          label: str,
          description: str,
          weights: {
            type: "object",
            properties: {
              skills: { type: "number" },
              culture: { type: "number" },
              major: { type: "number" },
              location: { type: "number" },
              extracurricular: { type: "number" },
            },
            required: [
              "skills",
              "culture",
              "major",
              "location",
              "extracurricular",
            ],
            additionalProperties: false,
          },
          priority_roles: strArray,
          example_profiles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                university_level: str,
                majors: strArray,
                skills: strArray,
                interests: strArray,
                extracurriculars: strArray,
                resume_snippet: str,
              },
              required: [
                "university_level",
                "majors",
                "skills",
                "interests",
                "extracurriculars",
                "resume_snippet",
              ],
              additionalProperties: false,
            },
          },
        },
        required: [
          "id",
          "label",
          "description",
          "weights",
          "priority_roles",
          "example_profiles",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["personas"],
  additionalProperties: false,
} as const;

export const MATCH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    match: {
      type: "object",
      properties: {
        candidate_id: str,
        persona_id: str,
        final_score: { type: "integer" },
        breakdown: {
          type: "object",
          properties: {
            skills: { type: "integer" },
            culture: { type: "integer" },
            major: { type: "integer" },
            location: { type: "integer" },
            extras: { type: "integer" },
          },
          required: ["skills", "culture", "major", "location", "extras"],
          additionalProperties: false,
        },
        weight_used: {
          type: "object",
          properties: {
            skills: { type: "number" },
            culture: { type: "number" },
            major: { type: "number" },
            location: { type: "number" },
            extracurricular: { type: "number" },
          },
          required: [
            "skills",
            "culture",
            "major",
            "location",
            "extracurricular",
          ],
          additionalProperties: false,
        },
        notes: str,
      },
      required: [
        "candidate_id",
        "persona_id",
        "final_score",
        "breakdown",
        "weight_used",
        "notes",
      ],
      additionalProperties: false,
    },
  },
  required: ["match"],
  additionalProperties: false,
} as const;

/** extras_score の文脈判断のみを Claude に委譲するための小さなスキーマ。 */
export const EXTRAS_JUDGEMENT_SCHEMA = {
  type: "object",
  properties: {
    extras_score: { type: "integer" },
    reason: str,
  },
  required: ["extras_score", "reason"],
  additionalProperties: false,
} as const;

export const EMAIL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    emails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tone: str,
          subject: str,
          body: str,
          recommended_send_time: str,
          one_line_reason: str,
        },
        required: [
          "tone",
          "subject",
          "body",
          "recommended_send_time",
          "one_line_reason",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["emails"],
  additionalProperties: false,
} as const;

/* ---------- 入力スキーマ（リクエストの検証用に保持） ---------- */

export const PERSONA_INPUT_SCHEMA = {
  type: "object",
  properties: {
    company_info: {
      type: "object",
      properties: {
        name: str,
        description: str,
        mission: str,
        values: strArray,
        must_have_skills: strArray,
        nice_to_have: strArray,
        locations: strArray,
        hiring_type: str,
        target_grad_years: strArray,
      },
      required: ["name", "description"],
    },
    persona_count: { type: "integer", minimum: 1 },
  },
  required: ["company_info"],
} as const;
