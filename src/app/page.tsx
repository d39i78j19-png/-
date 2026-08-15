"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandidateTable } from "@/components/CandidateTable";
import { EmailCard } from "@/components/EmailCard";
import { PersonaCard } from "@/components/PersonaCard";
import { ProjectBar } from "@/components/ProjectBar";
import { FinalScore, ScoreBars } from "@/components/ScoreBars";
import { SettingsPanel } from "@/components/SettingsPanel";
import {
  EngineBadge,
  Field,
  Grid,
  JsonBlock,
  Notice,
  Section,
} from "@/components/ui";
import type { ScoreTrace } from "@/lib/matchEngine";
import {
  buildProjectFile,
  parseProjectFile,
  type ProjectFile,
  type ScoredCandidate,
} from "@/lib/project";
import type {
  Candidate,
  CompanyInfo,
  EngineMeta,
  Match,
  Persona,
  PositionInfo,
  ScoutEmail,
} from "@/lib/schema";

/* ---------- フォームの状態（文字列ベース） ---------- */

interface CompanyForm {
  name: string;
  description: string;
  mission: string;
  values: string;
  must_have_skills: string;
  nice_to_have: string;
  locations: string;
  hiring_type: string;
  target_grad_years: string;
}

interface CandidateForm {
  id: string;
  name: string;
  university: string;
  grad_year: string;
  major: string;
  skills: string;
  resume_text: string;
  location: string;
  extracurriculars: string;
  remote_ok: boolean;
}

const SAMPLE_COMPANY: CompanyForm = {
  name: "株式会社サンプル",
  description:
    "ソフトウェアとデザインを軸にプロダクトを作るスタートアップ。ユーザ中心設計とチーム協働を重視。",
  mission: "世界中の学びを簡単にする",
  values: "ユーザー志向, スピード, チームワーク",
  must_have_skills: "プログラミング基礎, 論理的思考",
  nice_to_have: "React, UX設計",
  locations: "東京（渋谷）, リモート可",
  hiring_type: "新卒（総合職）",
  target_grad_years: "2026, 2027",
};

const SAMPLE_CANDIDATE: CandidateForm = {
  id: "cand-123",
  name: "山田 太郎",
  university: "東京大学",
  grad_year: "2026",
  major: "情報工学",
  skills: "JavaScript, React, Python",
  resume_text:
    "学部での研究はフロントエンドとUX改善に関するプロジェクト。ハッカソンで最優秀賞。",
  location: "東京都渋谷区",
  extracurriculars: "ハッカソン, インターン（スタートアップ）",
  remote_ok: true,
};

const SAMPLE_POSITION: PositionInfo = {
  position: "フロントエンドエンジニア（新卒）",
  team: "プロダクト開発チーム",
  apply_link: "https://example.com/careers/frontend-newgrad",
};

/* ---------- 変換ヘルパ ---------- */

function csv(value: string): string[] {
  return value
    .split(/[,、\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function toCompanyInfo(form: CompanyForm): CompanyInfo {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    mission: form.mission.trim() || undefined,
    values: csv(form.values),
    must_have_skills: csv(form.must_have_skills),
    nice_to_have: csv(form.nice_to_have),
    locations: csv(form.locations),
    hiring_type: form.hiring_type.trim() || undefined,
    target_grad_years: csv(form.target_grad_years),
  };
}

function fromCompanyInfo(info: CompanyInfo): CompanyForm {
  return {
    name: info.name ?? "",
    description: info.description ?? "",
    mission: info.mission ?? "",
    values: (info.values ?? []).join(", "),
    must_have_skills: (info.must_have_skills ?? []).join(", "),
    nice_to_have: (info.nice_to_have ?? []).join(", "),
    locations: (info.locations ?? []).join(", "),
    hiring_type: info.hiring_type ?? "",
    target_grad_years: (info.target_grad_years ?? []).join(", "),
  };
}

function toCandidate(form: CandidateForm): Candidate {
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    university: form.university.trim() || undefined,
    grad_year: form.grad_year.trim() || undefined,
    major: form.major.trim() || undefined,
    skills: csv(form.skills),
    resume_text: form.resume_text.trim() || undefined,
    location: form.location.trim() || undefined,
    extracurriculars: csv(form.extracurriculars),
    remote_ok: form.remote_ok,
  };
}

const STORAGE_KEY = "persona-studio:project:v1";

/** これ以上の長さが貼られたら掲載文とみなして自動で読み取る。 */
const AUTO_EXTRACT_MIN = 40;

const FIELD_LABELS: [keyof CompanyInfo, string][] = [
  ["name", "会社名"],
  ["description", "事業内容"],
  ["mission", "ミッション"],
  ["values", "バリュー"],
  ["must_have_skills", "必須スキル"],
  ["nice_to_have", "歓迎スキル"],
  ["locations", "勤務地"],
  ["hiring_type", "採用区分"],
  ["target_grad_years", "対象卒業年度"],
];

/** 読み取りで実際に埋まった項目のラベルを返す。 */
function filledFieldLabels(info: CompanyInfo): string[] {
  return FIELD_LABELS.filter(([key]) => {
    const value = info[key];
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  }).map(([, label]) => label);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(json.error?.message ?? `リクエストが失敗しました (${response.status})`);
  }
  return json;
}

/* ---------- ページ本体 ---------- */

export default function Page() {
  const [company, setCompany] = useState<CompanyForm>(SAMPLE_COMPANY);
  const [personaCount, setPersonaCount] = useState(3);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaMeta, setPersonaMeta] = useState<EngineMeta | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaError, setPersonaError] = useState<string | null>(null);

  const [sourceText, setSourceText] = useState("");
  const [extractMeta, setExtractMeta] = useState<EngineMeta | null>(null);
  const [extractMissing, setExtractMissing] = useState<string[]>([]);
  const [extractFilled, setExtractFilled] = useState<string[]>([]);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [candidate, setCandidate] = useState<CandidateForm>(SAMPLE_CANDIDATE);
  const [match, setMatch] = useState<Match | null>(null);
  const [trace, setTrace] = useState<ScoreTrace | null>(null);
  const [matchMeta, setMatchMeta] = useState<EngineMeta | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  const [position, setPosition] = useState<PositionInfo>(SAMPLE_POSITION);
  const [emails, setEmails] = useState<ScoutEmail[]>([]);
  const [emailMeta, setEmailMeta] = useState<EngineMeta | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [scored, setScored] = useState<ScoredCandidate[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // 復元が終わるまで自動保存を走らせない（初期値で上書きしてしまうため）
  const hydrated = useRef(false);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selectedId) ?? null,
    [personas, selectedId],
  );

  const applyProject = useCallback((project: ProjectFile) => {
    setCompany(fromCompanyInfo(project.company_info));
    setPersonaCount(project.persona_count);
    setPersonas(project.personas);
    setSelectedId(
      project.selected_persona_id ?? project.personas[0]?.id ?? null,
    );
    setPosition(project.position_info);
    setScored(project.scored_candidates);
    setEmails(project.emails);
    setMatch(null);
    setTrace(null);
  }, []);

  const buildProject = useCallback(
    (): ProjectFile =>
      buildProjectFile({
        company_info: toCompanyInfo(company),
        persona_count: personaCount,
        personas,
        selected_persona_id: selectedId,
        position_info: position,
        scored_candidates: scored,
        emails,
        now: new Date().toISOString(),
      }),
    [company, personaCount, personas, selectedId, position, scored, emails],
  );

  // 起動時に前回の作業を復元する
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) applyProject(parseProjectFile(JSON.parse(raw)));
    } catch {
      // 壊れた保存データは黙って捨てる（作業開始を妨げない）
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      hydrated.current = true;
    }
  }, [applyProject]);

  // 変更のたびに自動保存する（アプリを閉じても続きから再開できるように）
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      try {
        const project = buildProject();
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSavedAt(
          new Date(project.saved_at).toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      } catch {
        // 容量超過などで保存できなくても操作は続けられるようにする
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [buildProject]);

  /** 貼り付けた掲載文を企業情報フォームに展開する。既存の入力は上書きする。 */
  async function runExtract(text = sourceText) {
    const source = text.trim();
    if (!source) return;

    setExtractLoading(true);
    setExtractError(null);
    setExtractFilled([]);
    try {
      const result = await postJson<{
        company_info: CompanyInfo;
        missing_fields: string[];
        _meta: EngineMeta;
      }>("/api/extract", { source_text: source });
      setCompany(fromCompanyInfo(result.company_info));
      setExtractMissing(result.missing_fields);
      setExtractMeta(result._meta);
      // 「反映されたのか分からない」を防ぐため、埋まった項目名を明示する
      setExtractFilled(filledFieldLabels(result.company_info));
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : String(error));
    } finally {
      setExtractLoading(false);
    }
  }

  /**
   * 掲載文が貼られたら、ボタンを押さなくてもその場で読み取る。
   * どちらの入力欄に貼られても同じ挙動にする（貼り先を間違えても迷わせない）。
   */
  function handlePasteSource(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ): void {
    const text = event.clipboardData.getData("text");
    if (text.trim().length < AUTO_EXTRACT_MIN) return;
    event.preventDefault();
    setSourceText(text);
    void runExtract(text);
  }

  async function generatePersonas() {
    setPersonaLoading(true);
    setPersonaError(null);
    try {
      const result = await postJson<{ personas: Persona[]; _meta: EngineMeta }>(
        "/api/personas",
        {
          company_info: toCompanyInfo(company),
          persona_count: personaCount,
        },
      );
      setPersonas(result.personas);
      setPersonaMeta(result._meta);
      setSelectedId(result.personas[0]?.id ?? null);
      // ペルソナが変わったら下流の結果は無効化する
      setMatch(null);
      setTrace(null);
      setEmails([]);
    } catch (error) {
      setPersonaError(error instanceof Error ? error.message : String(error));
    } finally {
      setPersonaLoading(false);
    }
  }

  async function runMatch() {
    if (!selectedPersona) return;
    setMatchLoading(true);
    setMatchError(null);
    try {
      const result = await postJson<{
        match: Match;
        _trace: ScoreTrace;
        _meta: EngineMeta;
      }>("/api/match", {
        persona: selectedPersona,
        candidate: toCandidate(candidate),
        company_info: toCompanyInfo(company),
      });
      setMatch(result.match);
      setTrace(result._trace);
      setMatchMeta(result._meta);

      // 同じ候補者 × 同じペルソナの再採点は上書きする
      const entry: ScoredCandidate = {
        candidate: toCandidate(candidate),
        match: result.match,
        trace: result._trace,
        persona_id: selectedPersona.id,
        persona_label: selectedPersona.label,
        scored_at: new Date().toISOString(),
      };
      setScored((prev) => [
        ...prev.filter(
          (r) =>
            !(
              r.candidate.id === entry.candidate.id &&
              r.persona_id === entry.persona_id
            ),
        ),
        entry,
      ]);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : String(error));
    } finally {
      setMatchLoading(false);
    }
  }

  async function generateEmails() {
    if (!selectedPersona) return;
    setEmailLoading(true);
    setEmailError(null);
    try {
      const result = await postJson<{ emails: ScoutEmail[]; _meta: EngineMeta }>(
        "/api/emails",
        {
          persona: selectedPersona,
          candidate: toCandidate(candidate),
          position_info: position,
          company_info: toCompanyInfo(company),
        },
      );
      setEmails(result.emails);
      setEmailMeta(result._meta);
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : String(error));
    } finally {
      setEmailLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "28px 20px 72px",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "0.01em" }}>
          新卒採用ペルソナ設計スタジオ
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--text-muted)",
            maxWidth: 720,
          }}
        >
          採用サイトやマイナビの掲載内容を企業情報として入れると、狙う学生像（ペルソナ）を生成し、
          候補者ごとのマッチ度を 0〜100 で数値化して、そのペルソナに合わせたスカウトメールまで作成します。
          各ステップの JSON はそのままコピーして他システムに渡せます。
        </p>
      </header>

      <SettingsPanel />

      <ProjectBar
        buildProject={buildProject}
        onImport={applyProject}
        personaCount={personas.length}
        scoredCount={scored.length}
        savedAt={savedAt}
      />

      {/* ---------- Step 1: 企業情報 → ペルソナ ---------- */}
      <Section
        step={1}
        title="企業情報を入れてペルソナを生成する"
        description="採用サイト・マイナビの原稿をそのまま貼り付ける想定。事業内容と求める人物像が入っているほど精度が上がります。"
        right={
          <button
            type="button"
            className="btn"
            onClick={() => setCompany(SAMPLE_COMPANY)}
          >
            サンプルを入れ直す
          </button>
        }
      >
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-2)",
            padding: "12px 14px",
            marginBottom: 16,
          }}
        >
          <Field
            label="① まずここに掲載文を貼り付けてください"
            hint="貼り付けた瞬間に読み取って、下の各項目が自動で埋まります"
          >
            <textarea
              rows={6}
              placeholder={
                "採用サイトやマイナビの掲載ページを全選択してコピーし、そのまま貼り付けてください。\n" +
                "「事業内容」「求める人材」「勤務地」などの見出しが残っているほど正確に読み取れます。"
              }
              value={sourceText}
              onPaste={handlePasteSource}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </Field>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void runExtract()}
              disabled={extractLoading || sourceText.trim().length === 0}
            >
              {extractLoading ? "読み取り中…" : "掲載文を読み取ってフォームに反映"}
            </button>
            {sourceText.trim().length > 0 ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSourceText("");
                  setExtractMeta(null);
                  setExtractMissing([]);
                  setExtractError(null);
                }}
              >
                貼り付けをクリア
              </button>
            ) : null}
            {extractMeta ? (
              <EngineBadge engine={extractMeta.engine} model={extractMeta.model} />
            ) : null}
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              読み取り結果は下の欄で手直しできます
            </span>
          </div>

          {extractFilled.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <Notice>
                <strong>{extractFilled.length}項目に反映しました</strong>（
                {extractFilled.join("・")}）。下の欄を確認してください。
              </Notice>
            </div>
          ) : null}
          {extractError ? (
            <div style={{ marginTop: 10 }}>
              <Notice tone="bad">{extractError}</Notice>
            </div>
          ) : null}
          {extractMissing.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <Notice tone="warn">
                掲載文から読み取れなかった項目があります（
                {extractMissing.join("・")}）。下の欄に直接入力してください。
              </Notice>
            </div>
          ) : null}
          {extractMeta?.warnings?.length ? (
            <div style={{ marginTop: 10 }}>
              <Notice tone="warn">{extractMeta.warnings.join(" / ")}</Notice>
            </div>
          ) : null}
          {extractMeta?.note ? (
            <div style={{ marginTop: 10 }}>
              <Notice>{extractMeta.note}</Notice>
            </div>
          ) : null}
        </div>

        <Grid min={260}>
          <Field label="会社名" hint="必須">
            <input
              type="text"
              value={company.name}
              onChange={(e) => setCompany({ ...company, name: e.target.value })}
            />
          </Field>
          <Field label="ミッション">
            <input
              type="text"
              value={company.mission}
              onChange={(e) =>
                setCompany({ ...company, mission: e.target.value })
              }
            />
          </Field>
        </Grid>

        <Field
          label="事業内容・求める人物像"
          hint="必須。上の読み取り結果が入ります。ここに直接貼り付けても読み取ります"
        >
          <textarea
            rows={4}
            value={company.description}
            onPaste={handlePasteSource}
            onChange={(e) =>
              setCompany({ ...company, description: e.target.value })
            }
          />
        </Field>

        <Grid min={240}>
          <Field label="バリュー・価値観" hint="カンマ区切り">
            <input
              type="text"
              value={company.values}
              onChange={(e) =>
                setCompany({ ...company, values: e.target.value })
              }
            />
          </Field>
          <Field label="必須スキル" hint="カンマ区切り">
            <input
              type="text"
              value={company.must_have_skills}
              onChange={(e) =>
                setCompany({ ...company, must_have_skills: e.target.value })
              }
            />
          </Field>
          <Field label="歓迎スキル" hint="カンマ区切り">
            <input
              type="text"
              value={company.nice_to_have}
              onChange={(e) =>
                setCompany({ ...company, nice_to_have: e.target.value })
              }
            />
          </Field>
          <Field label="勤務地" hint="カンマ区切り。「リモート可」も認識します">
            <input
              type="text"
              value={company.locations}
              onChange={(e) =>
                setCompany({ ...company, locations: e.target.value })
              }
            />
          </Field>
          <Field label="採用区分">
            <input
              type="text"
              value={company.hiring_type}
              onChange={(e) =>
                setCompany({ ...company, hiring_type: e.target.value })
              }
            />
          </Field>
          <Field label="対象卒業年度" hint="カンマ区切り">
            <input
              type="text"
              value={company.target_grad_years}
              onChange={(e) =>
                setCompany({ ...company, target_grad_years: e.target.value })
              }
            />
          </Field>
        </Grid>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 4,
          }}
        >
          <div style={{ width: 150 }}>
            <Field label="生成するペルソナ数">
              <input
                type="number"
                min={1}
                max={8}
                value={personaCount}
                onChange={(e) =>
                  setPersonaCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))
                }
              />
            </Field>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={generatePersonas}
            disabled={personaLoading || !company.name || !company.description}
            style={{ marginBottom: 12 }}
          >
            {personaLoading ? "生成中…" : "ペルソナを生成"}
          </button>
        </div>

        {personaError ? <Notice tone="bad">{personaError}</Notice> : null}
        {personaMeta?.note ? <Notice>{personaMeta.note}</Notice> : null}
        {personaMeta?.warnings?.length ? (
          <Notice tone="warn">
            <strong>自動補正:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {personaMeta.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {personas.length > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "14px 0 10px",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 14 }}>
                生成されたペルソナ {personas.length} 件
              </h3>
              {personaMeta ? (
                <EngineBadge engine={personaMeta.engine} model={personaMeta.model} />
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {personas.map((p) => (
                <PersonaCard
                  key={p.id}
                  persona={p}
                  selected={p.id === selectedId}
                  onSelect={() => {
                    setSelectedId(p.id);
                    setMatch(null);
                    setTrace(null);
                    setEmails([]);
                  }}
                />
              ))}
            </div>
            <JsonBlock label="POST /api/personas のレスポンス JSON" value={{ personas }} />
          </>
        ) : null}
      </Section>

      {/* ---------- Step 2: 候補者 → マッチスコア ---------- */}
      <Section
        step={2}
        title="候補者とのマッチ度を数値化する"
        description="スキル・カルチャー・専攻・勤務地・課外活動の5軸を 0〜100 で採点し、ペルソナの重みで加重平均して総合点を出します。"
        right={
          <button
            type="button"
            className="btn"
            onClick={() => setCandidate(SAMPLE_CANDIDATE)}
          >
            サンプル候補者
          </button>
        }
      >
        {!selectedPersona ? (
          <Notice tone="warn">
            まず Step 1 でペルソナを生成し、採点に使うペルソナを選んでください。
          </Notice>
        ) : (
          <Notice>
            採点対象ペルソナ: <strong>{selectedPersona.label}</strong>（
            {selectedPersona.id}）
          </Notice>
        )}

        <Grid min={200}>
          <Field label="候補者ID" hint="必須">
            <input
              type="text"
              value={candidate.id}
              onChange={(e) => setCandidate({ ...candidate, id: e.target.value })}
            />
          </Field>
          <Field label="氏名" hint="必須">
            <input
              type="text"
              value={candidate.name}
              onChange={(e) =>
                setCandidate({ ...candidate, name: e.target.value })
              }
            />
          </Field>
          <Field label="大学">
            <input
              type="text"
              value={candidate.university}
              onChange={(e) =>
                setCandidate({ ...candidate, university: e.target.value })
              }
            />
          </Field>
          <Field label="卒業年度">
            <input
              type="text"
              value={candidate.grad_year}
              onChange={(e) =>
                setCandidate({ ...candidate, grad_year: e.target.value })
              }
            />
          </Field>
          <Field label="専攻">
            <input
              type="text"
              value={candidate.major}
              onChange={(e) =>
                setCandidate({ ...candidate, major: e.target.value })
              }
            />
          </Field>
          <Field label="居住地" hint="例: 東京都渋谷区">
            <input
              type="text"
              value={candidate.location}
              onChange={(e) =>
                setCandidate({ ...candidate, location: e.target.value })
              }
            />
          </Field>
        </Grid>

        <Field label="スキル" hint="カンマ区切り。ペルソナ想定スキルとの Jaccard 係数で採点">
          <input
            type="text"
            value={candidate.skills}
            onChange={(e) =>
              setCandidate({ ...candidate, skills: e.target.value })
            }
          />
        </Field>
        <Field label="課外活動" hint="カンマ区切り">
          <input
            type="text"
            value={candidate.extracurriculars}
            onChange={(e) =>
              setCandidate({ ...candidate, extracurriculars: e.target.value })
            }
          />
        </Field>
        <Field
          label="経歴テキスト"
          hint="カルチャー適合の判定に使います。ES やプロフィール文をそのまま貼り付け"
        >
          <textarea
            rows={3}
            value={candidate.resume_text}
            onChange={(e) =>
              setCandidate({ ...candidate, resume_text: e.target.value })
            }
          />
        </Field>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          <input
            type="checkbox"
            checked={candidate.remote_ok}
            onChange={(e) =>
              setCandidate({ ...candidate, remote_ok: e.target.checked })
            }
          />
          リモート勤務を希望している
        </label>

        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={runMatch}
            disabled={matchLoading || !selectedPersona || !candidate.id || !candidate.name}
          >
            {matchLoading ? "採点中…" : "マッチスコアを算出"}
          </button>
        </div>

        {matchError ? (
          <Notice tone="bad" >
            {matchError}
          </Notice>
        ) : null}

        {match ? (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <FinalScore score={match.final_score} />
              {matchMeta ? (
                <EngineBadge engine={matchMeta.engine} model={matchMeta.model} />
              ) : null}
            </div>

            {matchMeta?.note ? <Notice>{matchMeta.note}</Notice> : null}
            {matchMeta?.warnings?.length ? (
              <Notice tone="warn">{matchMeta.warnings.join(" / ")}</Notice>
            ) : null}

            <ScoreBars
              breakdown={match.breakdown}
              weights={match.weight_used}
              trace={trace ?? undefined}
            />

            <div style={{ marginTop: 14 }}>
              <span className="field-label">notes</span>
              <p style={{ margin: 0, fontSize: 13 }}>{match.notes}</p>
            </div>

            <JsonBlock label="POST /api/match のレスポンス JSON" value={{ match }} />
          </div>
        ) : null}

        <CandidateTable
          rows={scored}
          onRemove={(candidateId, personaId) =>
            setScored((prev) =>
              prev.filter(
                (r) =>
                  !(r.candidate.id === candidateId && r.persona_id === personaId),
              ),
            )
          }
        />
      </Section>

      {/* ---------- Step 3: スカウトメール ---------- */}
      <Section
        step={3}
        title="ペルソナに合わせたスカウトメールを作る"
        description="選んだペルソナの重み上位軸と、候補者の実際の記述をもとに、トーン違いで3通生成します。"
      >
        <Grid min={220}>
          <Field label="募集ポジション" hint="必須">
            <input
              type="text"
              value={position.position}
              onChange={(e) =>
                setPosition({ ...position, position: e.target.value })
              }
            />
          </Field>
          <Field label="配属チーム">
            <input
              type="text"
              value={position.team ?? ""}
              onChange={(e) => setPosition({ ...position, team: e.target.value })}
            />
          </Field>
          <Field label="応募リンク">
            <input
              type="text"
              value={position.apply_link ?? ""}
              onChange={(e) =>
                setPosition({ ...position, apply_link: e.target.value })
              }
            />
          </Field>
        </Grid>

        <button
          type="button"
          className="btn btn-primary"
          onClick={generateEmails}
          disabled={emailLoading || !selectedPersona || !position.position}
        >
          {emailLoading ? "作成中…" : "スカウトメールを生成"}
        </button>

        {!selectedPersona ? (
          <Notice tone="warn">
            Step 1 でペルソナを選ぶと生成できます。
          </Notice>
        ) : null}
        {emailError ? <Notice tone="bad">{emailError}</Notice> : null}
        {emailMeta?.note ? <Notice>{emailMeta.note}</Notice> : null}
        {emailMeta?.warnings?.length ? (
          <Notice tone="warn">{emailMeta.warnings.join(" / ")}</Notice>
        ) : null}

        {emails.length > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                margin: "16px 0 10px",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 14 }}>生成された文面 {emails.length} 通</h3>
              {emailMeta ? (
                <EngineBadge engine={emailMeta.engine} model={emailMeta.model} />
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {emails.map((email, i) => (
                <EmailCard key={i} email={email} />
              ))}
            </div>
            <JsonBlock label="POST /api/emails のレスポンス JSON" value={{ emails }} />
          </>
        ) : null}
      </Section>

      <footer
        style={{
          fontSize: 11.5,
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border)",
          paddingTop: 14,
        }}
      >
        スコアは設計した重みに基づく参考値です。最終的な合否判断は必ず人が行ってください。
        学歴・性別・年齢などの属性そのものを評価軸にしない設計にしています。
      </footer>
    </main>
  );
}
