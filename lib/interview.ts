// Server-only: drives the interview with the Agent SDK and persists data/<id>/session.json.
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONFIRM, LOW, MAX_CONFIRM_Q, PASS, STAGES, UNKNOWN, confirmScores, itemText, key, nextTarget, serve, toMarkdown,
  type DocParts, type Pending, type Session,
} from "./engine.ts";

const DATA = path.join(process.cwd(), "data");
// Survive Next dev hot reloads: one background worker and one save queue per session.
const g = globalThis as unknown as { live?: Set<string>; locks?: Map<string, Promise<unknown>> };
const live = (g.live ??= new Set());
const locks = (g.locks ??= new Map());

const SYSTEM =
  "너는 비전문가가 아이디어를 요구사항으로 정리하도록 돕는 인터뷰어다. 항상 쉬운 한국어로 말하고, 전문 용어(기능, 범위, KPI 등)를 피한다.";
// settingSources: [] keeps the user's global hooks/CLAUDE.md out; auth still comes from the local Claude login.
const base: Options = { settingSources: [], persistSession: false, systemPrompt: SYSTEM };

export const validId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id);
const file = (id: string, name: string) => path.join(DATA, id, name);

export async function load(id: string): Promise<Session> {
  return JSON.parse(await readFile(file(id, "session.json"), "utf8"));
}
async function save(s: Session) {
  await mkdir(path.join(DATA, s.id), { recursive: true });
  const f = file(s.id, "session.json");
  await writeFile(`${f}.tmp`, JSON.stringify(s, null, 2));
  await rename(`${f}.tmp`, f); // atomic: readers never see a half-written file
}

/** Load-modify-save in a per-session queue so the worker and answers never overwrite each other. */
function update(id: string, fn: (s: Session) => void): Promise<Session> {
  const next = (locks.get(id) ?? Promise.resolve()).then(async () => {
    const s = await load(id);
    fn(s);
    await save(s);
    return s;
  });
  locks.set(id, next.catch(() => {}));
  return next;
}

export async function list() {
  const ids = await readdir(DATA).catch(() => [] as string[]);
  const all = await Promise.all(ids.filter(validId).map((id) => load(id).catch(() => null)));
  return all.filter((s): s is Session => !!s).map(({ id, idea, status, stage, createdAt }) => ({ id, idea, status, stage, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function create(idea: string) {
  const id = `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const s: Session = { id, idea, createdAt: new Date().toISOString(), stage: 0, scores: {}, contradictions: [], unknown: [], qa: [], status: "running" };
  await save(s);
  void run(id);
  return s;
}

/** Load and, if the server restarted, resume the background worker. */
export async function get(id: string) {
  const s = await load(id);
  if ((s.status === "running" || s.status === "waiting") && !live.has(id)) void run(id);
  return s;
}

export async function answer(id: string, text: string) {
  // Show the next prepared question right away; scoring and preparing continue in run().
  await update(id, (s) => {
    if (!s.pending) throw new Error("대기 중인 질문이 없습니다");
    record(s, text);
    serve(s);
  });
  void run(id);
}

function record(s: Session, text: string) {
  const p = s.pending!;
  s.qa.push({ stage: p.stage ?? s.stage, target: p.target, question: p.question, answer: text });
  if (text.trim() === UNKNOWN) s.unknown.push(p.target);
  s.pending = undefined;
}

/** Background worker: keeps scores current, advances stages, and keeps the next questions prepared. */
async function run(id: string) {
  if (live.has(id)) return;
  live.add(id);
  try {
    while (await step(id));
  } catch (e) {
    await update(id, (s) => { s.status = "error"; s.error = String(e instanceof Error ? e.message : e); });
  } finally {
    live.delete(id);
  }
}

/** One unit of work, false when idle. Claude calls run on a snapshot outside the queue; results merge into the latest state. */
async function step(id: string): Promise<boolean> {
  const s = await load(id);
  if (s.status !== "running" && s.status !== "waiting") return false;
  if (!s.pending && s.prepared?.[s.stage]) { // a question may be servable right now; never make the user wait on scoring
    const x = await update(id, serve);
    if (x.pending) return true;
  }
  // Preparing questions comes before scoring: answers arrive faster than scoring, and a missing question is what the user waits on.
  if (s.stage < CONFIRM && !s.prepared?.[s.stage]) {
    const qs = await prepare(s, s.stage);
    await update(id, (x) => { (x.prepared ??= {})[s.stage] ??= qs; serve(x); });
    return true;
  }
  if (s.stage + 1 < CONFIRM && !s.prepared?.[s.stage + 1]) { // get the next stage ready while the user answers
    const qs = await prepare(s, s.stage + 1);
    await update(id, (x) => { (x.prepared ??= {})[s.stage + 1] ??= qs; });
    return true;
  }
  const at = `${s.qa.length}:${s.stage}`;
  if (s.scoredAt !== at) {
    const r = await score(s);
    await update(id, (x) => { applyScores(x, r); x.scoredAt = at; });
    return true;
  }
  if (s.stage <= CONFIRM && nextTarget(s) === null) {
    await update(id, (x) => { if (x.stage === s.stage) x.stage++; });
    return true;
  }
  if (s.stage > CONFIRM) {
    if (s.pending) return false; // let the user finish the question on screen; answer() restarts the worker
    const doc = await writeDoc(s);
    await update(id, (x) => { x.doc = doc; x.status = "preview"; });
    return false;
  }
  if (!s.prepared?.[s.stage]) { // 확인: needs fresh scores (contradictions), so it is prepared after scoring
    const qs = await prepare(s, s.stage);
    await update(id, (x) => { (x.prepared ??= {})[s.stage] ??= qs; serve(x); });
    return true;
  }
  if (!s.pending) { // prepared ran out but the stage is still open: one more about the weakest item
    const qs = await prepare(s, s.stage, [nextTarget(s)!], 1);
    await update(id, (x) => { x.prepared![s.stage].push(...qs); serve(x); });
    return true;
  }
  return false;
}

async function structured<T>(label: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const t = Date.now();
  const q = query({ prompt, options: { ...base, tools: [], outputFormat: { type: "json_schema", schema } } });
  // Manual iteration: `for await` + return would wait ~0.8s for the CLI process to exit; close it in the background.
  for (let r = await q.next(); !r.done; r = await q.next()) {
    const m = r.value;
    if (m.type === "result") {
      q.return(undefined).catch(() => {});
      console.log(`[interview] ${label} ${Date.now() - t}ms`);
      if (m.subtype !== "success") throw new Error(`Claude 호출 실패: ${m.subtype}`);
      return m.structured_output as T;
    }
  }
  throw new Error("Claude 응답이 없습니다");
}

const transcript = (s: Session) =>
  [`아이디어: ${s.idea}`, ...s.qa.map((q) => `[${STAGES[q.stage].name}] Q: ${q.question}\nA: ${q.answer}`)].join("\n");

type Scored = { scores: { key: string; score: number; reason: string }[]; contradictions: string[] };

function score(s: Session) {
  const upto = Math.min(s.stage, CONFIRM - 1);
  const items = STAGES.slice(0, upto + 1).flatMap((st, si) => st.items.map((t, ii) => `${key(si, ii)} ${st.name}: ${t}`));
  return structured<Scored>(
    "score",
    `아래 인터뷰 내용만 근거로 각 항목이 얼마나 구체적으로 채워졌는지 0~1로 채점하라.
0 = 정보 없음, 0.5 = 막연함, 0.8 = 개발자가 되묻지 않을 정도, 1 = 아주 구체적. 추측으로 점수를 주지 말라. reason 은 한 문장.
${s.stage >= CONFIRM ? "contradictions 에는 단계끼리 서로 모순되는 부분을 한 문장씩 적어라(없으면 빈 배열)." : "contradictions 는 빈 배열로 둬라."}

[항목]
${items.join("\n")}

[인터뷰]
${transcript(s)}`,
    {
      type: "object", required: ["scores", "contradictions"],
      properties: {
        scores: { type: "array", items: { type: "object", required: ["key", "score", "reason"], properties: { key: { type: "string" }, score: { type: "number" }, reason: { type: "string" } } } },
        contradictions: { type: "array", items: { type: "string" } },
      },
    },
  );
}

function applyScores(s: Session, r: Scored) {
  for (const x of r.scores) if (/^[0-4]\.\d$/.test(x.key)) s.scores[x.key] = { score: Math.max(0, Math.min(1, x.score)), reason: x.reason };
  s.contradictions = s.stage >= CONFIRM ? r.contradictions : [];
  if (s.stage >= CONFIRM) Object.assign(s.scores, confirmScores(s));
}

/** Questions for a stage in one call: per target a main question and, if per = 2, a deeper follow-up. Mains come first. */
async function prepare(s: Session, stage: number, targets = defaultTargets(s, stage), per = stage === CONFIRM ? 1 : 2): Promise<Pending[]> {
  if (!targets.length) return [];
  const label = (t: string) => (/^\d\.\d$/.test(t) ? itemText(t) : `모순 풀기: ${t}`);
  const r = await structured<{ questions: { target: string; question: string; header: string; options: { label: string; description: string }[] }[] }>(
    "prepare",
    `아래 항목마다 질문을 ${per}개씩 만들어라.${per > 1 ? " 첫 번째는 기본 질문, 두 번째는 첫 답이 막연할 때 더 구체적으로 파고드는 후속 질문이다." : ""}
- target 에는 항목 번호(T1, T2 …)를 그대로 적는다.
- 이미 답한 내용은 다시 묻지 말고, 질문끼리도 겹치지 않게 한다. 비전문가가 바로 고를 수 있게 짧고 쉽게 묻는다.
- options 는 이 아이디어에 맞춘 구체적인 예시 2~3개(label 은 짧은 답, description 은 한 줄 설명). "잘 모르겠어요"와 "기타"는 넣지 마라(화면이 자동으로 붙인다).
- header 는 12자 이내.

[항목]
${targets.map((t, i) => `T${i + 1}: ${label(t)}`).join("\n")}

[지금까지의 인터뷰]
${transcript(s)}`,
    {
      type: "object", required: ["questions"],
      properties: {
        questions: {
          type: "array", minItems: 1,
          items: {
            type: "object", required: ["target", "question", "header", "options"],
            properties: {
              target: { type: "string" },
              question: { type: "string" },
              header: { type: "string" },
              options: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", required: ["label", "description"], properties: { label: { type: "string" }, description: { type: "string" } } } },
            },
          },
        },
      },
    },
  );
  const byTarget = targets.map((t, i) => r.questions.filter((q) => q.target.trim() === `T${i + 1}`).slice(0, per)
    .map((q): Pending => ({ stage, target: t, question: q.question, header: q.header, options: [...q.options.slice(0, 3), { label: UNKNOWN, description: "남은 질문으로 넘겨요" }] })));
  return Array.from({ length: per }, (_, round) => byTarget.flatMap((qs) => qs[round] ?? [])).flat();
}

/** Items still worth asking: open items of an interview stage (weakest first), or contradictions + low items for 확인. */
function defaultTargets(s: Session, stage: number): string[] {
  const sc = (k: string) => s.scores[k]?.score ?? 0;
  if (stage === CONFIRM) {
    const low = Object.keys(s.scores).filter((k) => Number(k.split(".")[0]) < CONFIRM && sc(k) < LOW).sort((a, b) => sc(a) - sc(b));
    return [...s.contradictions, ...low].filter((t) => !s.unknown.includes(t)).slice(0, MAX_CONFIRM_Q);
  }
  return STAGES[stage].items.map((_, i) => key(stage, i)).filter((k) => !s.unknown.includes(k) && sc(k) < PASS).sort((a, b) => sc(a) - sc(b));
}

const DOC_SCHEMA = {
  type: "object", required: ["title", "summary", "sections", "decisions"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    sections: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } },
    decisions: { type: "array", items: { type: "object", required: ["decision", "reason"], properties: { decision: { type: "string" }, reason: { type: "string" } } } },
  },
};

async function writeDoc(s: Session, edit?: string): Promise<DocParts> {
  return structured<DocParts>(
    "writeDoc",
    `인터뷰 내용으로 Pre-PRD 본문을 써라. 인터뷰에 없는 내용은 지어내지 말라.
- title: 제품 이름(짧게, "Pre-PRD"는 붙이지 말 것)
- summary: 한 줄 요약
- sections: 5개 마크다운 본문(제목 줄 없이). 순서대로
  1 문제: 불릿. 누가 겪는 불편, 지금 해결 방법, 왜 불편한지
  2 사람: "- **유형:** 설명" 불릿, 마지막에 우선순위
  3 장면: 번호 목록으로 처음부터 끝까지 흐름, 실패 순간도 포함
  4 핵심: "- **이것만 되면 성공:** ..." 와 "- **성공 판단 기준:** ..." 불릿
  5 경계: "**MVP에서 하지 않을 것**" 불릿 목록, 빈 줄, "**제약**" 불릿 목록
- decisions: 인터뷰에서 확정된 결정과 이유
${edit ? `\n[이전 초안]\n${JSON.stringify(s.doc)}\n\n[사용자 수정 요청 — 반영하라]\n${edit}\n` : ""}
[인터뷰]
${transcript(s)}`,
    DOC_SCHEMA,
  );
}

export const preview = (s: Session) => (s.doc ? toMarkdown(s, s.doc, s.status === "done" ? "확정" : "초안") : "");

export async function revise(id: string, edit: string) {
  const s = await load(id);
  if (s.status !== "preview") throw new Error("미리보기 단계가 아닙니다");
  s.doc = await writeDoc(s, edit);
  await save(s);
  return s;
}

export async function confirm(id: string) {
  const s = await load(id);
  if (s.status !== "preview") throw new Error("미리보기 단계가 아닙니다");
  s.status = "done";
  await save(s);
  await writeFile(file(id, "pre-prd.md"), preview(s));
  return s;
}
