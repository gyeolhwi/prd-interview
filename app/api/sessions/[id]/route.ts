import { answer, back, confirm, get, preview, revise, validId } from "@/lib/interview.ts";

type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  if (!validId(id)) return bad("잘못된 id", 404);
  const s = await get(id).catch(() => null);
  return s ? Response.json({ ...s, markdown: preview(s) }) : bad("없는 세션", 404);
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!validId(id)) return bad("잘못된 id", 404);
  const { action, text, question } = await req.json().catch(() => ({}));
  const t = typeof text === "string" ? text.trim().slice(0, 2000) : "";
  try {
    if (action === "answer" && t) await answer(id, t, typeof question === "string" ? question : undefined);
    else if (action === "revise" && t) await revise(id, t);
    else if (action === "back") await back(id);
    else if (action === "confirm") await confirm(id);
    else return bad("잘못된 요청");
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 409);
  }
  const s = await get(id);
  return Response.json({ ...s, markdown: preview(s) });
}
