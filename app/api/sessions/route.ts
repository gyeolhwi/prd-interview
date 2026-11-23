import { create, list } from "@/lib/interview.ts";

export async function GET() {
  return Response.json(await list());
}

export async function POST(req: Request) {
  const { idea, kind = "new" } = await req.json().catch(() => ({}));
  if (typeof idea !== "string" || !idea.trim() || idea.length > 2000) return Response.json({ error: "내용을 1~2000자로 적어 주세요" }, { status: 400 });
  if (kind !== "new" && kind !== "maintenance") return Response.json({ error: "알 수 없는 문서 종류" }, { status: 400 });
  return Response.json(await create(idea.trim(), kind));
}
