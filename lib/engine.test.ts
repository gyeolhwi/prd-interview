import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTarget, remaining, toMarkdown, confirmScores, type Session } from "./engine.ts";

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
