import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session } from "./engine.ts";

test("answer() saves the answer before replying, so the client sees running", async () => {
  process.chdir(await mkdtemp(path.join(tmpdir(), "prd-")));
  const g = globalThis as unknown as { waiters?: Map<string, (a: string) => void> };
  const woke: string[] = [];
  g.waiters = new Map([["s1", (a: string) => void woke.push(a)]]); // a live ask() waiting for this session
  const { answer, load } = await import("./interview.ts"); // DATA is resolved from cwd at import
  const s: Session = {
    id: "s1", idea: "앱", createdAt: "2026-11-23T00:00:00Z", stage: 0, scores: {}, contradictions: [], unknown: [], qa: [],
    status: "waiting", pending: { target: "0.0", question: "누구?", header: "대상", options: [] },
  };
  await mkdir("data/s1", { recursive: true });
  await writeFile("data/s1/session.json", JSON.stringify(s));

  await answer("s1", "학생");
  const after = await load("s1");
  assert.equal(after.status, "running");
  assert.equal(after.pending, undefined);
  assert.deepEqual(after.qa.map((q) => q.answer), ["학생"]);
  assert.deepEqual(woke, ["학생"]);
  await assert.rejects(answer("s1", "학생"), /대기 중인 질문이 없습니다/); // a second click is rejected, not recorded twice
});
