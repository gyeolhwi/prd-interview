// Pure interview rules: stages, pass/next-question decisions, markdown assembly. No I/O.

export const PASS = 0.8;
export const LOW = 0.6;
export const MAX_Q = 4;
export const MAX_CONFIRM_Q = 3;
export const UNKNOWN = "잘 모르겠어요";

export const STAGES = [
  { name: "문제", items: ["누가 겪는 불편인가", "지금은 어떻게 해결하고 있나", "그 방법이 왜 불편한가"] },
  { name: "사람", items: ["처음 쓸 사람을 구체적으로 묘사", "언제·어디서·어떤 기기로 쓰나", "사람 유형이 여럿이면 누가 먼저인가"] },
  { name: "장면", items: ["시작부터 끝까지 흐름 1개 이상", "끝났을 때 사용자가 얻는 것", "막히거나 실패하는 순간"] },
  { name: "핵심", items: ["딱 하나만 된다면 그게 무엇인가", "성공했다고 눈으로 확인할 기준"] },
  { name: "경계", items: ["이번에 안 할 것 1개 이상", "제약(예산·일정·기기·플랫폼)"] },
  { name: "확인", items: ["단계끼리 모순이 없다", "0.6점 미만 항목이 없다"] },
] as const;
export const CONFIRM = 5;

export type Score = { score: number; reason: string };
export type QA = { stage: number; target: string; question: string; answer: string };
export type Pending = { stage?: number; target: string; question: string; header: string; options: { label: string; description: string }[] };
export type Status = "running" | "waiting" | "preview" | "done" | "error";
export type Session = {
  id: string;
  idea: string;
  createdAt: string;
  stage: number; // 0..5 interviewing, 6 = finished interviewing (preview/done)
  scores: Record<string, Score>; // key "stage.item", e.g. "0.2"
  contradictions: string[];
  unknown: string[]; // targets the user answered 잘 모르겠어요
  qa: QA[];
  pending?: Pending;
  prepared?: Record<number, Pending[]>; // questions made ahead per stage, so answering never waits on Claude
  scoredAt?: string; // "<qa count>:<stage>" the scores were computed for
  status: Status;
  error?: string;
  doc?: DocParts;
};
export type DocParts = {
  title: string;
  summary: string;
  sections: string[]; // markdown bodies for 1..5
  decisions: { decision: string; reason: string }[];
};

export const key = (stage: number, item: number) => `${stage}.${item}`;
export const itemText = (k: string) => {
  const [s, i] = k.split(".").map(Number);
  return `${STAGES[s].name}: ${STAGES[s].items[i]}`;
};

export function stageAvg(s: Pick<Session, "scores">, stage: number): number | undefined {
  const xs = STAGES[stage].items.map((_, i) => s.scores[key(stage, i)]?.score);
  if (xs.some((x) => x === undefined)) return undefined;
  return (xs as number[]).reduce((a, b) => a + b, 0) / xs.length;
}

/** Item keys from interview stages (0..4) that already scored. */
const interviewKeys = (s: Pick<Session, "scores">) => Object.keys(s.scores).filter((k) => Number(k.split(".")[0]) < CONFIRM);

/** Confirm-stage scores are derived, not asked: ① from contradictions, ② share of items ≥ LOW. */
export function confirmScores(s: Pick<Session, "scores" | "contradictions">): Record<string, Score> {
  const ks = interviewKeys(s);
  const ok = ks.filter((k) => s.scores[k].score >= LOW).length;
  return {
    [key(CONFIRM, 0)]: { score: s.contradictions.length ? 0 : 1, reason: s.contradictions.length ? s.contradictions.join(" / ") : "모순 없음" },
    [key(CONFIRM, 1)]: { score: ks.length ? ok / ks.length : 1, reason: `${ks.length}개 중 ${ok}개가 ${LOW} 이상` },
  };
}

/** What to ask next in the current stage, or null to move on. Derived from state so it survives restarts. */
export function nextTarget(s: Session): string | null {
  const asked = s.qa.filter((q) => q.stage === s.stage).length;
  if (s.stage === CONFIRM) {
    if (asked >= MAX_CONFIRM_Q) return null;
    const c = s.contradictions.find((t) => !s.unknown.includes(t));
    if (c) return c;
    return lowest(s, interviewKeys(s), LOW);
  }
  if (asked >= MAX_Q || (stageAvg(s, s.stage) ?? 0) >= PASS) return null;
  return lowest(s, STAGES[s.stage].items.map((_, i) => key(s.stage, i)), PASS);
}

/** Next prepared question for the current stage, or null when the stage is done or nothing usable is prepared. */
export function pick(s: Session): Pending | null {
  if (s.stage > CONFIRM || nextTarget(s) === null) return null;
  const asked = new Set(s.qa.filter((q) => q.stage === s.stage).map((q) => q.question));
  return (s.prepared?.[s.stage] ?? []).find((p) => !asked.has(p.question) && !s.unknown.includes(p.target)
    && (s.stage === CONFIRM || (s.scores[p.target]?.score ?? 0) < PASS)) ?? null;
}

/** Put the next prepared question on screen without waiting on Claude: when this stage looks done and the next
 *  interview stage is already prepared, move into it now (scoring catches up in the background). 확인 always waits for scoring. */
export function serve(s: Session) {
  s.pending ??= pick(s) ?? undefined;
  if (!s.pending && s.stage + 1 < CONFIRM && nextTarget(s) === null && s.prepared?.[s.stage + 1]) {
    s.stage++;
    s.pending = pick(s) ?? undefined;
  }
  s.status = s.pending ? "waiting" : "running";
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
    if (Number(k.split(".")[0]) < s.stage && (s.unknown.includes(k) || s.scores[k].score < PASS)) out.add(itemText(k));
  }
  for (const c of s.contradictions) out.add(`모순: ${c}`);
  return [...out];
}

export function toMarkdown(s: Session, d: DocParts, status: string): string {
  const avgs = STAGES.map((st, i) => ({ name: st.name, v: stageAvg(s, i) ?? 0 }));
  const mean = avgs.reduce((a, b) => a + b.v, 0) / avgs.length;
  const rem = remaining(s);
  const cell = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `# ${d.title} Pre-PRD`,
    "",
    `- **한 줄 요약:** ${d.summary}`,
    `- **모호도:** ${avgs.map((a) => `${a.name} ${a.v.toFixed(1)}`).join(" · ")} (평균 ${mean.toFixed(2)})`,
    `- **작성일:** ${s.createdAt.slice(0, 10)}`,
    `- **상태:** ${status}`,
    "",
    ...STAGES.slice(0, CONFIRM).flatMap((st, i) => [`## ${i + 1}. ${st.name}`, "", d.sections[i]?.trim() ?? "", ""]),
    "## 6. 확인된 결정",
    "",
    "| 결정 | 이유 |",
    "|---|---|",
    ...d.decisions.map((x) => `| ${cell(x.decision)} | ${cell(x.reason)} |`),
    "",
    "## 7. 남은 질문",
    "",
    ...(rem.length ? rem.map((r, i) => `${i + 1}. ${r}`) : ["- 없음"]),
    "",
    "## 부록: 인터뷰 원문 요약",
    "",
    "| 단계 | 질문 | 답 |",
    "|---|---|---|",
    `| 시작 | 아이디어 | ${cell(s.idea)} |`,
    ...s.qa.map((q) => `| ${STAGES[q.stage].name} | ${cell(q.question)} | ${cell(q.answer)} |`),
    "",
  ].join("\n");
}
