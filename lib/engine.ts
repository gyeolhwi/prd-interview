// Pure interview rules: stages, pass/next-question decisions, markdown assembly. No I/O.

export const PASS = 0.8;
export const LOW = 0.6;
export const MAX_Q = 4;
export const MAX_CONFIRM_Q = 3;
export const UNKNOWN = "잘 모르겠어요";

type Stage = { name: string; title?: string; items: readonly string[] };

/** 새 아이디어: 문제 → 사람 → 장면 → 핵심 → 경계 → 확인. Stage = document section, 1:1. */
export const STAGES: readonly Stage[] = [
  { name: "문제", items: ["누가 겪는 불편인가", "지금은 어떻게 해결하고 있나", "그 방법이 왜 불편한가"] },
  { name: "사람", items: ["처음 쓸 사람을 구체적으로 묘사", "언제·어디서·어떤 기기로 쓰나", "사람 유형이 여럿이면 누가 먼저인가"] },
  { name: "장면", items: ["시작부터 끝까지 흐름 1개 이상", "끝났을 때 사용자가 얻는 것", "막히거나 실패하는 순간"] },
  { name: "핵심", items: ["딱 하나만 된다면 그게 무엇인가", "성공했다고 눈으로 확인할 기준"] },
  { name: "경계", items: ["이번에 안 할 것 1개 이상", "제약(예산·일정·기기·플랫폼)"] },
  { name: "확인", items: ["단계끼리 모순이 없다", "0.6점 미만 항목이 없다"] },
];

/** 유지보수(기존 서비스 변경): short names for screens, question-form titles for the document. */
export const MAINT_STAGES: readonly Stage[] = [
  { name: "바뀌는 것", title: "무엇이 바뀌나요?", items: ["지금까지 어떻게 동작하나", "앞으로 어떻게 바뀌나", "바뀌는 화면·기능이 어디인가"] },
  { name: "이유", title: "왜 이 기능이 필요한가요?", items: ["지금 어떤 문제가 생기고 있나", "안 바꾸면 무엇이 계속 손해인가"] },
  { name: "요청자", title: "요청자는 무엇이 필요한가요?", items: ["누가 요청했나", "요청자에게 꼭 필요한 것"] },
  { name: "고객", title: "고객은 어떤 점이 좋아지나요?", items: ["영향받는 고객은 누구인가", "고객이 체감할 변화"] },
  { name: "안 하는 것", title: "이번에 안 하는 것", items: ["이번에 안 할 것 1개 이상", "제약(일정·영향 범위)"] },
  { name: "성공 확인", title: "잘 됐는지 어떻게 아나요?", items: ["눈으로 확인할 성공 기준", "확인 방법·시점"] },
  { name: "확인", items: ["단계끼리 모순이 없다", "0.6점 미만 항목이 없다"] },
];

export type Kind = "new" | "maintenance";
export const KIND_LABEL: Record<Kind, string> = { new: "새 아이디어", maintenance: "유지보수" };
/** Sessions saved before kinds existed have none and are 새 아이디어. */
export const stagesOf = (s: { kind?: Kind }) => (s.kind === "maintenance" ? MAINT_STAGES : STAGES);
/** Index of 확인, the last stage; stages before it are interviewed, one past it means interviewing is over. */
export const confirmOf = (s: { kind?: Kind }) => stagesOf(s).length - 1;

export type Score = { score: number; reason: string };
export type QA = { stage: number; target: string; question: string; answer: string };
export type Pending = { stage?: number; target: string; question: string; header: string; options: { label: string; description: string }[] };
export type Status = "running" | "waiting" | "preview" | "done" | "error";
export type Session = {
  id: string;
  kind?: Kind;
  idea: string;
  createdAt: string;
  stage: number; // 0..confirmOf(s) interviewing, one more = finished interviewing (preview/done)
  scores: Record<string, Score>; // key "stage.item", e.g. "0.2"
  contradictions: string[];
  unknown: string[]; // targets the user answered 잘 모르겠어요
  qa: QA[];
  pending?: Pending;
  prepared?: Record<number, Pending[]>; // questions made ahead per stage, so answering never waits on Claude
  scoredAt?: string; // "<rev>:<qa count>:<stage>" the scores were computed for
  rev?: number; // +1 per back() or changed answer: background work started on an older rev is thrown away
  undone?: Record<string, string>; // question → answer taken back, shown again when the question returns
  status: Status;
  error?: string;
  doc?: DocParts;
};
export type DocParts = {
  title: string;
  summary: string;
  sections: string[]; // markdown bodies, one per interview stage
  decisions: { decision: string; reason: string }[];
};

export const key = (stage: number, item: number) => `${stage}.${item}`;
export const itemText = (s: { kind?: Kind }, k: string) => {
  const [st, i] = k.split(".").map(Number);
  return `${stagesOf(s)[st].name}: ${stagesOf(s)[st].items[i]}`;
};

export function stageAvg(s: Pick<Session, "scores" | "kind">, stage: number): number | undefined {
  const xs = stagesOf(s)[stage].items.map((_, i) => s.scores[key(stage, i)]?.score);
  if (xs.some((x) => x === undefined)) return undefined;
  return (xs as number[]).reduce((a, b) => a + b, 0) / xs.length;
}

/** Item keys from interview stages (before 확인) that already scored. */
const interviewKeys = (s: Pick<Session, "scores" | "kind">) => Object.keys(s.scores).filter((k) => Number(k.split(".")[0]) < confirmOf(s));

/** Confirm-stage scores are derived, not asked: ① from contradictions, ② share of items ≥ LOW. */
export function confirmScores(s: Pick<Session, "scores" | "contradictions" | "kind">): Record<string, Score> {
  const C = confirmOf(s);
  const ks = interviewKeys(s);
  const ok = ks.filter((k) => s.scores[k].score >= LOW).length;
  return {
    [key(C, 0)]: { score: s.contradictions.length ? 0 : 1, reason: s.contradictions.length ? s.contradictions.join(" / ") : "모순 없음" },
    [key(C, 1)]: { score: ks.length ? ok / ks.length : 1, reason: `${ks.length}개 중 ${ok}개가 ${LOW} 이상` },
  };
}

/** What to ask next in the current stage, or null to move on. Derived from state so it survives restarts. */
export function nextTarget(s: Session): string | null {
  const asked = s.qa.filter((q) => q.stage === s.stage).length;
  if (s.stage === confirmOf(s)) {
    if (asked >= MAX_CONFIRM_Q) return null;
    const c = s.contradictions.find((t) => !s.unknown.includes(t));
    if (c) return c;
    return lowest(s, interviewKeys(s), LOW);
  }
  if (asked >= MAX_Q || (stageAvg(s, s.stage) ?? 0) >= PASS) return null;
  return lowest(s, stagesOf(s)[s.stage].items.map((_, i) => key(s.stage, i)), PASS);
}

/** Next prepared question for the current stage, or null when the stage is done or nothing usable is prepared. */
export function pick(s: Session): Pending | null {
  const C = confirmOf(s);
  if (s.stage > C) return null;
  // 확인 questions are made ahead from a provisional check, so only the count limits them here; fresh scoring can still end 확인.
  if (s.stage === C ? s.qa.filter((q) => q.stage === C).length >= MAX_CONFIRM_Q : nextTarget(s) === null) return null;
  const asked = new Set(s.qa.filter((q) => q.stage === s.stage).map((q) => q.question));
  return (s.prepared?.[s.stage] ?? []).find((p) => !asked.has(p.question) && !s.unknown.includes(p.target)
    && (s.stage === C || (s.scores[p.target]?.score ?? 0) < PASS)) ?? null;
}

/** Put the next prepared question on screen without waiting on Claude: when this stage looks done and the next
 *  stage is already prepared, move into it now (scoring catches up in the background). */
export function serve(s: Session) {
  s.pending ??= pick(s) ?? undefined;
  if (!s.pending && s.stage < confirmOf(s) && nextTarget(s) === null && s.prepared?.[s.stage + 1]) {
    s.stage++;
    s.pending = pick(s) ?? undefined;
  }
  s.status = s.pending ? "waiting" : "running";
}

/** Take back the last answer and show its question again. Everything derived from that answer is dropped. */
export function back(s: Session) {
  const q = s.qa.pop();
  if (!q) throw new Error("돌아갈 질문이 없습니다");
  (s.undone ??= {})[q.question] = q.answer;
  if (!s.qa.some((x) => x.target === q.target && x.answer.trim() === UNKNOWN)) s.unknown = s.unknown.filter((t) => t !== q.target);
  // Keep a still-open question from a made-ahead list: it stays in prepared and comes back after this one.
  s.pending = s.prepared?.[q.stage]?.find((p) => p.question === q.question)
    ?? { stage: q.stage, target: q.target, question: q.question, header: "", options: [{ label: UNKNOWN, description: "남은 질문으로 넘겨요" }] };
  s.stage = q.stage;
  s.status = "waiting";
  s.rev = (s.rev ?? 0) + 1;
  s.doc = undefined;
  delete s.scores[q.target];
  // One answer can score several items of its stage, so the whole stage is rescored (확인 only re-derives its own).
  for (const k of Object.keys(s.scores)) if (Number(k.split(".")[0]) >= q.stage) delete s.scores[k];
  if (q.stage < confirmOf(s)) { // 확인 was based on answers that may now change
    s.contradictions = [];
    delete s.prepared?.[confirmOf(s)];
  }
}

function lowest(s: Session, keys: string[], below: number): string | null {
  const open = keys.filter((k) => !s.unknown.includes(k) && (s.scores[k]?.score ?? 0) < below);
  open.sort((a, b) => (s.scores[a]?.score ?? 0) - (s.scores[b]?.score ?? 0));
  return open[0] ?? null;
}

/** 남은 질문: anything the user didn't know, any finished item still below PASS, unresolved contradictions. */
export function remaining(s: Session): string[] {
  const out = new Set<string>();
  for (const k of interviewKeys(s)) {
    if (Number(k.split(".")[0]) < s.stage && (s.unknown.includes(k) || s.scores[k].score < PASS)) out.add(itemText(s, k));
  }
  for (const c of s.contradictions) out.add(`모순: ${c}`);
  return [...out];
}

export function toMarkdown(s: Session, d: DocParts, status: string): string {
  const stages = stagesOf(s), C = confirmOf(s);
  const avgs = stages.map((st, i) => ({ name: st.name, v: stageAvg(s, i) ?? 0 }));
  const mean = avgs.reduce((a, b) => a + b.v, 0) / avgs.length;
  const rem = remaining(s);
  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `# ${d.title} ${s.kind === "maintenance" ? "유지보수 " : ""}Pre-PRD`,
    "",
    `- **한 줄 요약:** ${d.summary}`,
    `- **모호도:** ${avgs.map((a) => `${a.name} ${a.v.toFixed(1)}`).join(" · ")} (평균 ${mean.toFixed(2)})`,
    `- **작성일:** ${s.createdAt.slice(0, 10)}`,
    `- **상태:** ${status}`,
    "",
    ...stages.slice(0, C).flatMap((st, i) => [`## ${i + 1}. ${st.title ?? st.name}`, "", d.sections[i]?.trim() ?? "", ""]),
    `## ${C + 1}. 확인된 결정`,
    "",
    "| 결정 | 이유 |",
    "|---|---|",
    ...d.decisions.map((x) => `| ${cell(x.decision)} | ${cell(x.reason)} |`),
    "",
    `## ${C + 2}. 남은 질문`,
    "",
    ...(rem.length ? rem.map((r, i) => `${i + 1}. ${r}`) : ["- 없음"]),
    "",
    "## 부록: 인터뷰 원문 요약",
    "",
    "| 단계 | 질문 | 답 |",
    "|---|---|---|",
    `| 시작 | ${s.kind === "maintenance" ? "요청" : "아이디어"} | ${cell(s.idea)} |`,
    ...s.qa.map((q) => `| ${stages[q.stage].name} | ${cell(q.question)} | ${cell(q.answer)} |`),
    "",
  ].join("\n");
}
