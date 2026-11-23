import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmOf, confirmScores, nextTarget, pick, remaining, serve, stagesOf, toMarkdown, type Session } from "./engine.ts";

const base = (p: Partial<Session> = {}): Session => ({
  id: "t", idea: "중고거래 앱", createdAt: "2026-11-22T00:00:00Z", stage: 0,
  scores: {}, contradictions: [], unknown: [], qa: [], status: "running", ...p,
});
const sc = (score: number) => ({ score, reason: "" });

test("asks the lowest item until the stage passes", () => {
  const s = base({ scores: { "0.0": sc(0.9), "0.1": sc(0.2), "0.2": sc(0.5) } });
  assert.equal(nextTarget(s), "0.1");
  s.scores["0.1"] = sc(0.9); s.scores["0.2"] = sc(0.7); // avg 0.83 ≥ 0.8
  assert.equal(nextTarget(s), null);
});

test("stops after 4 questions and carries failed items to 남은 질문", () => {
  const qa = Array.from({ length: 4 }, () => ({ stage: 0, target: "0.1", question: "q", answer: "a" }));
  const s = base({ qa, scores: { "0.0": sc(0.9), "0.1": sc(0.3), "0.2": sc(0.9) } });
  assert.equal(nextTarget(s), null);
  s.stage = 1;
  assert.deepEqual(remaining(s), ["문제: 지금은 어떻게 해결하고 있나"]);
});

test("잘 모르겠어요 items are not asked again", () => {
  const s = base({ unknown: ["0.1"], scores: { "0.0": sc(0.9), "0.1": sc(0), "0.2": sc(0.6) } });
  assert.equal(nextTarget(s), "0.2");
});

test("confirm stage asks contradictions, then items below 0.6, max 3", () => {
  const s = base({ stage: 5, contradictions: ["A vs B"], scores: { "0.0": sc(0.5), "1.0": sc(0.7) } });
  assert.equal(nextTarget(s), "A vs B");
  s.contradictions = [];
  assert.equal(nextTarget(s), "0.0");
  s.qa = Array.from({ length: 3 }, () => ({ stage: 5, target: "x", question: "q", answer: "a" }));
  assert.equal(nextTarget(s), null);
  assert.equal(confirmScores(s)["5.1"].score, 0.5);
});

test("markdown keeps the fixed structure", () => {
  const s = base({ stage: 6, qa: [{ stage: 0, target: "0.0", question: "누구?", answer: "나|너" }] });
  const md = toMarkdown(s, { title: "중고", summary: "요약", sections: ["a", "b", "c", "d", "e"], decisions: [{ decision: "d", reason: "r" }] }, "초안");
  for (const h of ["# 중고 Pre-PRD", "- **모호도:**", "## 1. 문제", "## 5. 경계", "## 6. 확인된 결정", "## 7. 남은 질문", "## 부록: 인터뷰 원문 요약"]) assert.ok(md.includes(h), h);
  assert.ok(md.includes("나\\|너"));
});

test("pick serves prepared questions, skipping asked, 잘 모르겠어요 and already-passed items", () => {
  const q = (target: string, question: string) => ({ stage: 0, target, question, header: "h", options: [] });
  const s = base({ prepared: { 0: [q("0.0", "A"), q("0.1", "B"), q("0.2", "C"), q("0.1", "B2")] } });
  assert.equal(pick(s)?.question, "A");
  s.qa.push({ stage: 0, target: "0.0", question: "A", answer: "a" });
  s.unknown.push("0.1");
  assert.equal(pick(s)?.question, "C");
  s.scores = { "0.0": sc(0.9), "0.1": sc(0), "0.2": sc(0.9) };
  assert.equal(pick(s), null, "0.1 is 잘 모르겠어요 and the rest passed");
  s.unknown = []; s.scores["0.0"] = sc(0.5);
  assert.equal(pick(s)?.question, "B");
  s.scores = { "0.0": sc(0.9), "0.1": sc(0.8), "0.2": sc(0.9) };
  assert.equal(pick(s), null, "stage average passed");
});

test("serve moves into the prepared next stage (확인 included) without waiting for scoring", () => {
  const q = (stage: number, target: string) => ({ stage, target, question: target, header: "h", options: [] });
  const s = base({ status: "running", scores: { "0.0": sc(0.9), "0.1": sc(0.9), "0.2": sc(0.9) }, prepared: { 0: [q(0, "0.0")] } });
  serve(s);
  assert.equal(s.status, "running", "next stage not prepared yet: loading");
  s.prepared![1] = [q(1, "1.0")];
  serve(s);
  assert.equal(s.stage, 1);
  assert.equal(s.pending?.target, "1.0");
  assert.equal(s.status, "waiting");
  const t = base({ stage: 4, status: "running", scores: { "4.0": sc(0.9), "4.1": sc(0.9) }, prepared: { 4: [] } });
  serve(t);
  assert.equal(t.stage, 4, "확인 not prepared yet: wait");
  t.prepared![5] = [q(5, "A vs B")];
  serve(t);
  assert.equal(t.stage, 5);
  assert.equal(t.pending?.target, "A vs B", "provisional 확인 question served even before contradictions are rescored");
});

test("maintenance: 6 interview stages + 확인, confirm keys and stage limits follow the kind", () => {
  const m = base({ kind: "maintenance" });
  assert.equal(stagesOf(m).length, 7);
  assert.equal(confirmOf(m), 6);
  assert.equal(confirmOf(base()), 5, "sessions without a kind stay 새 아이디어");
  assert.deepEqual(Object.keys(confirmScores({ ...m, scores: { "0.0": sc(0.9) } })), ["6.0", "6.1"]);
  m.stage = 5; m.scores = { "5.0": sc(0.2), "5.1": sc(0.9) };
  assert.equal(nextTarget(m), "5.0", "stage 5 is still an interview stage (잘 됐는지 어떻게 아나요?)");
  m.stage = 6; m.contradictions = ["A vs B"];
  assert.equal(nextTarget(m), "A vs B");
});

test("maintenance markdown uses the question-form sections and keeps the tail", () => {
  const s = base({ kind: "maintenance", stage: 7, idea: "주문 취소 표시", qa: [{ stage: 0, target: "0.0", question: "지금은?", answer: "안 보임" }] });
  const md = toMarkdown(s, { title: "취소 주문 표시", summary: "요약", sections: ["a", "b", "c", "d", "e", "f"], decisions: [] }, "초안");
  const heads = md.split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(heads, [
    "# 취소 주문 표시 유지보수 Pre-PRD",
    "## 1. 무엇이 바뀌나요?", "## 2. 왜 이 기능이 필요한가요?", "## 3. 요청자는 무엇이 필요한가요?",
    "## 4. 고객은 어떤 점이 좋아지나요?", "## 5. 이번에 안 하는 것", "## 6. 잘 됐는지 어떻게 아나요?",
    "## 7. 확인된 결정", "## 8. 남은 질문", "## 부록: 인터뷰 원문 요약",
  ]);
  assert.ok(md.includes("| 시작 | 요청 | 주문 취소 표시 |"));
  assert.ok(md.includes("| 바뀌는 것 | 지금은? | 안 보임 |"));
});
