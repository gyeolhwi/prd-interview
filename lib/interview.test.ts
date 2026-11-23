import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "./engine.ts";

test("answer() records the answer and shows the next prepared question right away", async () => {
  process.chdir(await mkdtemp(path.join(tmpdir(), "prd-")));
  // Pretend a runner is already live so answer()'s run() returns without calling Claude.
  (globalThis as unknown as { live?: Set<string> }).live = new Set(["s1"]);
  const { answer, load } = await import("./interview.ts"); // DATA is resolved from cwd at import
  const s: Session = {
    id: "s1", idea: "앱", createdAt: "2026-11-23T00:00:00Z", stage: 0, scores: {}, contradictions: [], unknown: [], qa: [],
    status: "waiting", pending: { stage: 0, target: "0.0", question: "누구?", header: "대상", options: [] },
    prepared: { 0: [{ stage: 0, target: "0.0", question: "누구?", header: "대상", options: [] }, { stage: 0, target: "0.1", question: "지금은?", header: "현재", options: [] }] },
  };
  await mkdir("data/s1", { recursive: true });
  await writeFile("data/s1/session.json", JSON.stringify(s));

  await answer("s1", "학생");
  const after = await load("s1");
  assert.equal(after.status, "waiting");
  assert.equal(after.pending?.question, "지금은?");
  assert.deepEqual(after.qa.map((q) => q.answer), ["학생"]);

  await answer("s1", "단톡방"); // nothing prepared left: loading until the worker prepares more
  const last = await load("s1");
  assert.equal(last.status, "running");
  assert.equal(last.pending, undefined);
  await assert.rejects(answer("s1", "단톡방"), /대기 중인 질문이 없습니다/); // a second click is rejected, not recorded twice
});
