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
      <h1>prd-interview</h1>
      <p className="muted">한두 줄 적으면, 쉬운 질문으로 Pre-PRD 한 장을 만들어 드려요.</p>
      <div className="card">
        <fieldset className="row" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
          <legend style={{ marginBottom: 8 }}>문서 종류</legend>
          {(Object.keys(KIND_COPY) as Kind[]).map((k) => (
            <label key={k} className="option" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span><strong>{KIND_LABEL[k]}</strong> <span className="muted">— {KIND_COPY[k].hint}</span></span>
            </label>
          ))}
        </fieldset>
        <label htmlFor="idea">{KIND_COPY[kind].label}</label>
        <textarea id="idea" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={KIND_COPY[kind].placeholder} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={busy || !idea.trim()} onClick={start}>시작하기</button>
          {err && <span role="alert" style={{ color: "var(--warn)" }}>{err}</span>}
        </div>
      </div>
      {list.length > 0 && (
        <div className="card">
          <strong>이어하기</strong>
          {list.map((s) => (
            <div key={s.id} className="item">
              <a href={`/?id=${s.id}`}>{s.idea}</a>{" "}
              <span className="muted">· {KIND_LABEL[s.kind ?? "new"]} · {s.status === "done" ? "완료" : `${stagesOf(s)[Math.min(s.stage, confirmOf(s))].name} 단계`}</span>
            </div>
          ))}
        </div>
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

  const send = async (action: string, t?: string) => {
    setBusy(true); setErr("");
    try { setS(await call(`/api/sessions/${id}`, { action, text: t })); setText(""); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!s) return <p className="muted">{err || "불러오는 중…"}</p>;
  const STAGES = stagesOf(s), C = confirmOf(s);
  const stage = Math.min(s.stage, C);
  const avg = stageAvg(s, stage);
  const rem = remaining(s);

  return (
    <>
      <a href="/">← 처음으로</a>
      <h1 style={{ marginTop: 12 }}>{s.idea}</h1>
      <p className="muted">질문 {s.qa.length}개 답함 · 저장 위치 data/{s.id}/</p>

      <div className="steps" aria-label="진행 단계">
        {STAGES.map((st, i) => (
          <div key={st.name} className={`step ${i < s.stage ? "done" : i === s.stage ? "now" : ""}`} aria-current={i === s.stage ? "step" : undefined}>
            {i + 1}. {st.name}
          </div>
        ))}
      </div>

      {s.stage <= C && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{STAGES[stage].name} 단계 모호도 점수</strong>
            <span>{avg === undefined ? "채점 전" : `${avg.toFixed(2)} / 통과 ${PASS}`}</span>
          </div>
          {STAGES[stage].items.map((t, i) => {
            const sc = s.scores[key(stage, i)];
            const v = sc?.score ?? 0;
            return (
              <div key={t} className="item">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{t}</span><span>{sc ? v.toFixed(1) : "–"}</span>
                </div>
                <div className="bar"><i style={{ width: `${v * 100}%`, background: v >= PASS ? "var(--ok)" : "var(--warn)" }} /></div>
                {sc?.reason && <div className="muted">{sc.reason}</div>}
              </div>
            );
          })}
        </div>
      )}

      {s.status === "running" && <div className="card muted" role="status">Claude가 답을 살펴보고 다음 질문을 고르는 중…</div>}

      {s.status === "waiting" && s.pending && (
        <div className="card">
          <div className="muted">{s.pending.header}</div>
          <p style={{ fontSize: "1.1rem", margin: "4px 0 12px" }}><strong>{s.pending.question}</strong></p>
          {s.pending.options.map((o) => (
            <button key={o.label} className="option" disabled={busy} onClick={() => send("answer", o.label)}>
              {o.label}<small>{o.description}</small>
            </button>
          ))}
          <label htmlFor="free" className="muted">직접 적기</label>
          <div className="row">
            <input id="free" type="text" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }}
              onKeyDown={(e) => e.key === "Enter" && text.trim() && !e.nativeEvent.isComposing && send("answer", text)} />
            <button className="primary" disabled={busy || !text.trim()} onClick={() => send("answer", text)}>보내기</button>
            <button disabled={busy} onClick={() => send("answer", UNKNOWN)} title="이 질문은 남은 질문으로 넘겨요">넘기기</button>
          </div>
        </div>
      )}

      {(s.status === "preview" || s.status === "done") && (
        <div className="card">
          <strong>{s.status === "done" ? `확정됨 — data/${s.id}/pre-prd.md 에 저장했어요` : "Pre-PRD 미리보기"}</strong>
          <pre className="md">{s.markdown}</pre>
          {s.status === "preview" && (
            <>
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => send("confirm")}>확정</button>
              </div>
              <label htmlFor="edit" className="muted">이 부분 수정</label>
              <textarea id="edit" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 경계에 '결제 기능은 안 함'을 넣어 주세요" />
              <button disabled={busy || !text.trim()} onClick={() => send("revise", text)} style={{ marginTop: 8 }}>{busy ? "고치는 중…" : "수정 반영"}</button>
            </>
          )}
        </div>
      )}

      {s.status === "error" && <div className="card" role="alert" style={{ color: "var(--warn)" }}>오류: {s.error}</div>}
      {err && <div role="alert" style={{ color: "var(--warn)" }}>{err}</div>}

      {rem.length > 0 && (
        <div className="card">
          <strong>남은 질문</strong>
          <ul>{rem.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </>
  );
}
