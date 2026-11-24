"use client";
import { useCallback, useEffect, useState } from "react";
import { KIND_LABEL, PASS, UNKNOWN, confirmOf, key, remaining, stageAvg, stagesOf, type Kind, type Session } from "@/lib/engine.ts";

type View = Session & { markdown: string };
type Summary = Pick<Session, "id" | "kind" | "idea" | "status" | "stage">;

const KIND_COPY: Record<Kind, { label: string; hint: string; placeholder: string }> = {
  new: { label: "어떤 걸 만들고 싶으세요?", hint: "처음 만드는 서비스나 기능", placeholder: "예: 동네 중고거래 앱 만들고 싶어" },
  maintenance: { label: "무엇을 바꾸고 싶으세요?", hint: "이미 있는 서비스를 고치거나 바꾸는 요청", placeholder: "예: 주문 목록에서 취소한 주문도 보이게 해 주세요" },
};

async function call(url: string, body?: object) {
  const r = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

export default function Page() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(location.search).get("id")), []);
  return <main>{id ? <Interview id={id} /> : <Home />}</main>;
}

function Home() {
  const [idea, setIdea] = useState("");
  const [kind, setKind] = useState<Kind>("new");
  const [list, setList] = useState<Summary[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { call("/api/sessions").then(setList).catch((e) => setErr(e.message)); }, []);
  const start = async () => {
    setBusy(true);
    try { location.href = `/?id=${(await call("/api/sessions", { idea, kind })).id}`; } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <>
      <p className="brand">prd-interview</p>
      <h1>한두 줄 적으면, 질문에 답하며 Pre-PRD 한 장을 완성해요</h1>
      <p className="lead">문제, 사람, 장면, 핵심, 경계 순서로 쉬운 질문을 드려요. 모르는 질문은 넘기면 돼요.</p>
      <div className="card question">
        <fieldset className="kind">
          <legend>문서 종류</legend>
          {(Object.keys(KIND_COPY) as Kind[]).map((k) => (
            <label key={k}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span><strong>{KIND_LABEL[k]}</strong><span className="muted">{KIND_COPY[k].hint}</span></span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="idea" className="field-label">{KIND_COPY[kind].label}</label>
        <div className="composer">
          <textarea id="idea" rows={5} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={KIND_COPY[kind].placeholder} />
          <div className="composer-foot">
            {err ? <span role="alert" className="error">{err}</span> : <span className="muted">한두 줄이면 충분해요</span>}
            <button className="primary" disabled={busy || !idea.trim()} onClick={start}>질문 시작</button>
          </div>
        </div>
      </div>
      {list.length > 0 && (
        <section className="section">
          <h2>이어서 답하기</h2>
          <ul className="resume">
            {list.map((s) => (
              <li key={s.id}>
                <a href={`/?id=${s.id}`}>{s.idea}</a>
                <span className="meta muted"><span>{KIND_LABEL[s.kind ?? "new"]}</span><span>{s.status === "done" ? "완료" : `${stagesOf(s)[Math.min(s.stage, confirmOf(s))].name} 단계`}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Interview({ id }: { id: string }) {
  const [s, setS] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => call(`/api/sessions/${id}`).then(setS).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if ((s?.status !== "running" && s?.status !== "waiting") || busy) return; // waiting: scores keep updating in the background
    const t = setInterval(refresh, 500);
    return () => clearInterval(t);
  }, [s?.status, busy, refresh]);

  // Going back: an answer that was typed (not picked) returns to the input to be edited.
  const asked = s?.pending, previous = asked && s.undone?.[asked.question];
  const typed = previous && !asked.options.some((o) => o.label.trim() === previous) ? previous : undefined;
  useEffect(() => { if (typed) setText(typed); }, [asked?.question, typed]);

  const send = async (action: string, t?: string) => {
    setBusy(true); setErr("");
    try { setS(await call(`/api/sessions/${id}`, { action, text: t, question: s?.pending?.question })); setText(""); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!s) return <p className="muted">{err || "불러오는 중…"}</p>;
  const STAGES = stagesOf(s), C = confirmOf(s);
  const stage = Math.min(s.stage, C);
  const avg = stageAvg(s, stage);
  const rem = remaining(s);
  const backButton = s.qa.length > 0 && <button className="prev" disabled={busy} onClick={() => (!text.trim() || text === typed || window.confirm("적던 내용이 지워져요. 이전 질문으로 갈까요?")) && send("back")}>이전 질문</button>;

  return (
    <>
      <a href="/" className="back">처음 화면으로</a>
      <h1>{s.idea}</h1>
      <p className="muted">답한 질문 {s.qa.length}개, data/{s.id}/ 에 저장돼요</p>

      <ol className="steps" aria-label="진행 단계">
        {STAGES.map((st, i) => (
          <li key={st.name} className={`step ${i < s.stage ? "done" : i === s.stage ? "now" : ""}`} aria-current={i === s.stage ? "step" : undefined}>
            <span>{i + 1}. {st.name}</span>
          </li>
        ))}
      </ol>

      {s.stage <= C && (
        <section className="section" style={{ "--pass": PASS } as React.CSSProperties}>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>{STAGES[stage].name} 단계 모호도</h2>
            <span className="num muted">{avg === undefined ? "채점 전" : `평균 ${avg.toFixed(2)}, 통과 기준 ${PASS}`}</span>
          </div>
          {STAGES[stage].items.map((t, i) => {
            const sc = s.scores[key(stage, i)];
            const v = sc?.score ?? 0;
            return (
              <div key={t} className="item">
                <div className="row spread">
                  <span>{t}</span><span className="num">{sc ? v.toFixed(1) : "채점 전"}</span>
                </div>
                <div className="bar"><i style={{ width: `${v * 100}%`, background: v >= PASS ? "var(--ok)" : "var(--warn)" }} /></div>
                {sc?.reason && <div className="muted">{sc.reason}</div>}
              </div>
            );
          })}
        </section>
      )}

      {s.status === "running" && <div className="status" role="status">Claude가 답을 살펴보고 다음 질문을 고르는 중… {backButton}</div>}

      {s.status === "waiting" && s.pending && (
        <div className="card question">
          {backButton}
          <div className="muted">{s.pending.header}</div>
          <p className="question-text">{s.pending.question}</p>
          {s.pending.options.map((o) => (
            <button key={o.label} className="option" disabled={busy} onClick={() => send("answer", o.label)}>
              {o.label}{o.label.trim() === previous && <span className="picked">전에 고른 답</span>}<small>{o.description}</small>
            </button>
          ))}
          <label htmlFor="free" className="muted" style={{ display: "block", marginTop: 16 }}>직접 적기</label>
          <div className="row">
            <input id="free" type="text" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && text.trim() && !e.nativeEvent.isComposing && send("answer", text)} />
            <button className="primary" disabled={busy || !text.trim()} onClick={() => send("answer", text)}>보내기</button>
            <button disabled={busy} onClick={() => send("answer", UNKNOWN)} title="이 질문은 남은 질문으로 넘겨요">넘기기</button>
          </div>
        </div>
      )}

      {(s.status === "preview" || s.status === "done") && (
        <div className="card question">
          <h2>{s.status === "done" ? `확정했어요. data/${s.id}/pre-prd.md 에 저장돼 있어요` : "Pre-PRD 미리보기"}</h2>
          <pre className="md">{s.markdown}</pre>
          {s.status === "preview" && (
            <>
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => send("confirm")}>확정</button>
                {backButton}
              </div>
              <label htmlFor="edit" className="muted" style={{ display: "block", marginTop: 20 }}>고칠 부분</label>
              <textarea id="edit" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 경계에 '결제 기능은 안 함'을 넣어 주세요" />
              <button disabled={busy || !text.trim()} onClick={() => send("revise", text)} style={{ marginTop: 8 }}>{busy ? "고치는 중…" : "수정 반영"}</button>
            </>
          )}
        </div>
      )}

      {s.status === "error" && <div className="card error" role="alert">진행이 멈췄어요: {s.error}</div>}
      {err && <div role="alert" className="error">{err}</div>}

      {rem.length > 0 && (
        <section className="section">
          <h2>남은 질문</h2>
          <ul>{rem.map((r) => <li key={r} className="muted">{r}</li>)}</ul>
        </section>
      )}
    </>
  );
}
