// Server-only: drives the interview with the Agent SDK and persists data/<id>/session.json.
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LOW, MAX_CONFIRM_Q, PASS, UNKNOWN, confirmOf, confirmScores, itemText, key, nextTarget, serve, stagesOf, toMarkdown,
  type DocParts, type Kind, type Pending, type Session,
} from "./engine.ts";

const DATA = path.join(process.cwd(), "data");
// Survive Next dev hot reloads: two background lanes (score, prep) and one save queue per session.
const g = globalThis as unknown as { live?: Set<string>; wake?: Set<string>; locks?: Map<string, Promise<unknown>> };
const live = (g.live ??= new Set());
const wake = (g.wake ??= new Set());
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
  return all.filter((s): s is Session => !!s).map(({ id, kind, idea, status, stage, createdAt }) => ({ id, kind, idea, status, stage, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function create(idea: string, kind: Kind = "new") {
  const id = `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const s: Session = { id, kind, idea, createdAt: new Date().toISOString(), stage: 0, scores: {}, contradictions: [], unknown: [], qa: [], status: "running" };
  await save(s);
  run(id);
  return s;
}

/** Load and, if the server restarted, resume the background worker. */
export async function get(id: string) {
  const s = await load(id);
  if (active(s) && !live.has(`${id}:score`)) run(id);
  return s;
}

export async function answer(id: string, text: string) {
  // Show the next prepared question right away; scoring and preparing continue in run().
  await update(id, (s) => {
    if (!s.pending) throw new Error("대기 중인 질문이 없습니다");
    record(s, text);
    serve(s);
  });
  run(id);
}

function record(s: Session, text: string) {
  const p = s.pending!;
  s.qa.push({ stage: p.stage ?? s.stage, target: p.target, question: p.question, answer: text });
  if (text.trim() === UNKNOWN) s.unknown.push(p.target);
  s.pending = undefined;
}

/** Wake both background lanes. Scoring and question preparing run side by side so neither waits on the other. */
function run(id: string) {
  void lane(id, "score", scoreStep);
  void lane(id, "prep", prepStep);
}

async function lane(id: string, name: string, step: (id: string) => Promise<boolean>) {
  const k = `${id}:${name}`;
  wake.add(k);
  if (live.has(k)) return; // the running loop sees the wake flag and goes around once more
  live.add(k);
  try {
    while (wake.delete(k)) while (await step(id)) run(id); // progress in one lane may unblock the other
  } catch (e) {
    await update(id, (s) => { s.status = "error"; s.error = String(e instanceof Error ? e.message : e); });
  } finally {
    live.delete(k);
  }
}

const active = (s: Session) => s.status === "running" || s.status === "waiting";
// After 확인 the scoring prompt no longer changes with the stage, so stage 6 reuses stage 5's scores.
const scoreKey = (s: Session) => `${s.qa.length}:${Math.min(s.stage, confirmOf(s))}`;
const fresh = (s: Session) => s.scoredAt === scoreKey(s);

/** Score lane: keep scores current, advance finished stages, write the doc at the end. Claude calls run on a snapshot outside the save queue. */
async function scoreStep(id: string): Promise<boolean> {
  const s = await load(id);
  if (!active(s)) return false;
  if (!fresh(s)) {
    const at = scoreKey(s);
    const r = await score(s);
    await update(id, (x) => { applyScores(x, r); x.scoredAt = at; });
    return true;
  }
  if (s.stage <= confirmOf(s) && nextTarget(s) === null) {
    await update(id, (x) => { if (x.stage === s.stage) { x.stage++; serve(x); } });
    return true;
  }
  if (s.stage > confirmOf(s) && s.doc && !s.pending) await update(id, (x) => { x.status = "preview"; }); // doc comes from the prep lane
  return false;
}

/** Prep lane: keep a question on screen and the next stage's questions ready, so answering never waits on Claude. */
async function prepStep(id: string): Promise<boolean> {
  const s = await load(id);
  if (!active(s)) return false;
  const C = confirmOf(s);
  if (s.stage > C) { // the doc needs only the transcript, so it is written while the last scoring runs
    if (s.pending || s.doc) return false; // a question still on screen is answered first; answer() wakes the lanes again
    const doc = await writeDoc(s);
    await update(id, (x) => { x.doc = doc; });
    return true;
  }
  if (!s.pending && s.prepared?.[s.stage]) {
    const x = await update(id, serve);
    if (x.pending) return true;
  }
  const add = (stage: number, qs: Pending[]) => update(id, (x) => { (x.prepared ??= {})[stage] ??= qs; serve(x); });
  if (s.stage < C && !s.prepared?.[s.stage]) return add(s.stage, await prepare(s, s.stage)).then(() => true);
  if (s.stage + 1 < C && !s.prepared?.[s.stage + 1]) return add(s.stage + 1, await prepare(s, s.stage + 1)).then(() => true);
  if (s.stage === C - 1 && !s.prepared?.[C]) { // 확인 ahead of time: provisional contradiction check on the answers so far
    const t: Session = structuredClone({ ...s, stage: C });
    applyScores(t, await score(t));
    // Stage 4 is still being answered, so its items are not 확인 material yet.
    const targets = defaultTargets(t, C).filter((k) => !k.startsWith(`${C - 1}.`));
    return add(C, await prepare(t, C, targets)).then(() => true);
  }
  if (s.stage === C && !s.prepared?.[C] && fresh(s)) return add(C, await prepare(s, C)).then(() => true);
  if (!s.pending && fresh(s) && nextTarget(s)) { // prepared ran out but the stage is still open: one more about the weakest item
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
  [`${s.kind === "maintenance" ? "유지보수 요청(이미 있는 서비스를 바꾸는 일)" : "아이디어"}: ${s.idea}`,
    ...s.qa.map((q) => `[${stagesOf(s)[q.stage].name}] Q: ${q.question}\nA: ${q.answer}`)].join("\n");

type Scored = { scores: { key: string; score: number; reason: string }[]; contradictions: string[] };

function score(s: Session) {
  const C = confirmOf(s);
  const upto = Math.min(s.stage, C - 1);
  const items = stagesOf(s).slice(0, upto + 1).flatMap((st, si) => st.items.map((t, ii) => `${key(si, ii)} ${st.name}: ${t}`));
  return structured<Scored>(
    "score",
    `아래 인터뷰 내용만 근거로 각 항목이 얼마나 구체적으로 채워졌는지 0~1로 채점하라.
0 = 정보 없음, 0.5 = 막연함, 0.8 = 개발자가 되묻지 않을 정도, 1 = 아주 구체적. 추측으로 점수를 주지 말라. reason 은 한 문장.
${s.stage >= C ? "contradictions 에는 단계끼리 서로 모순되는 부분을 한 문장씩 적어라(없으면 빈 배열)." : "contradictions 는 빈 배열로 둬라."}

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
  const C = confirmOf(s);
  const valid = (k: string) => { const [st, i] = k.split(".").map(Number); return st < C && i < (stagesOf(s)[st]?.items.length ?? 0); };
  for (const x of r.scores) if (/^\d+\.\d+$/.test(x.key) && valid(x.key)) s.scores[x.key] = { score: Math.max(0, Math.min(1, x.score)), reason: x.reason };
  if (s.stage >= C) s.contradictions = r.contradictions;
  if (s.stage >= C) Object.assign(s.scores, confirmScores(s));
}

/** Questions for a stage in one call: per target a main question and, if per = 2, a deeper follow-up. Mains come first. */
async function prepare(s: Session, stage: number, targets = defaultTargets(s, stage), per = stage === confirmOf(s) ? 1 : 2): Promise<Pending[]> {
  if (!targets.length) return [];
  const label = (t: string) => (/^\d\.\d$/.test(t) ? itemText(s, t) : `모순 풀기: ${t}`);
  const r = await structured<{ questions: { target: string; question: string; header: string; options: { label: string; description: string }[] }[] }>(
    "prepare",
    `아래 항목마다 질문을 ${per}개씩 만들어라.${per > 1 ? " 첫 번째는 기본 질문, 두 번째는 첫 답이 막연할 때 더 구체적으로 파고드는 후속 질문이다." : ""}
- target 에는 항목 번호(T1, T2 …)를 그대로 적는다.
- 이미 답한 내용은 다시 묻지 말고, 질문끼리도 겹치지 않게 한다. 비전문가가 바로 고를 수 있게 짧고 쉽게 묻는다.
- options 는 이 아이디어(또는 요청)에 맞춘 구체적인 예시 2~3개(label 은 짧은 답, description 은 한 줄 설명). "잘 모르겠어요"와 "기타"는 넣지 마라(화면이 자동으로 붙인다).
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
  const C = confirmOf(s);
  if (stage === C) {
    const low = Object.keys(s.scores).filter((k) => Number(k.split(".")[0]) < C && sc(k) < LOW).sort((a, b) => sc(a) - sc(b));
    return [...s.contradictions, ...low].filter((t) => !s.unknown.includes(t)).slice(0, MAX_CONFIRM_Q);
  }
  return stagesOf(s)[stage].items.map((_, i) => key(stage, i)).filter((k) => !s.unknown.includes(k) && sc(k) < PASS).sort((a, b) => sc(a) - sc(b));
}

const docSchema = (n: number) => ({
  type: "object", required: ["title", "summary", "sections", "decisions"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    sections: { type: "array", minItems: n, maxItems: n, items: { type: "string" } },
    decisions: { type: "array", items: { type: "object", required: ["decision", "reason"], properties: { decision: { type: "string" }, reason: { type: "string" } } } },
  },
});

/** What to write per section, in stage order; the heading itself comes from toMarkdown(). */
const SECTION_GUIDE: Record<Kind, { title: string; sections: string[] }> = {
  new: {
    title: "제품 이름",
    sections: [
      "문제: 불릿. 누가 겪는 불편, 지금 해결 방법, 왜 불편한지",
      "사람: \"- **유형:** 설명\" 불릿, 마지막에 우선순위",
      "장면: 번호 목록으로 처음부터 끝까지 흐름, 실패 순간도 포함",
      "핵심: \"- **이것만 되면 성공:** ...\" 와 \"- **성공 판단 기준:** ...\" 불릿",
      "경계: \"**MVP에서 하지 않을 것**\" 불릿 목록, 빈 줄, \"**제약**\" 불릿 목록",
    ],
  },
  maintenance: {
    title: "바꾸는 내용의 이름",
    sections: [
      "무엇이 바뀌나요?: \"- **지금까지:** ...\", \"- **앞으로:** ...\", \"- **바뀌는 곳:** ...\" 불릿",
      "왜 이 기능이 필요한가요?: 불릿. 지금 생기는 문제, 안 바꾸면 계속되는 손해",
      "요청자는 무엇이 필요한가요?: \"- **요청자:** ...\" 와 \"- **꼭 필요한 것:** ...\" 불릿",
      "고객은 어떤 점이 좋아지나요?: \"- **영향받는 고객:** ...\" 와 \"- **좋아지는 점:** ...\" 불릿",
      "이번에 안 하는 것: 안 하는 것 불릿 목록, 빈 줄, \"**제약**\" 불릿 목록",
      "잘 됐는지 어떻게 아나요?: \"- **성공 기준:** ...\" 와 \"- **확인 방법·시점:** ...\" 불릿",
    ],
  },
};

async function writeDoc(s: Session, edit?: string): Promise<DocParts> {
  const g = SECTION_GUIDE[s.kind ?? "new"];
  return structured<DocParts>(
    "writeDoc",
    `인터뷰 내용으로 Pre-PRD 본문을 써라. 인터뷰에 없는 내용은 지어내지 말라.
- title: ${g.title}(짧게, "Pre-PRD"는 붙이지 말 것)
- summary: 한 줄 요약
- sections: ${g.sections.length}개 마크다운 본문(제목 줄 없이). 순서대로
${g.sections.map((t, i) => `  ${i + 1} ${t}`).join("\n")}
- decisions: 인터뷰에서 확정된 결정과 이유
${edit ? `\n[이전 초안]\n${JSON.stringify(s.doc)}\n\n[사용자 수정 요청 — 반영하라]\n${edit}\n` : ""}
[인터뷰]
${transcript(s)}`,
    docSchema(g.sections.length),
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
