// Step 1: does query() run on the local Claude Code subscription login without an API key?
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;
let ok = false;
for await (const m of query({ prompt: "한 단어로만 답해: 안녕", options: { maxTurns: 1, tools: [] } })) {
  if (m.type === "system" && m.subtype === "init") console.log("apiKeySource:", (m as any).apiKeySource, "model:", (m as any).model);
  if (m.type === "result") { ok = m.subtype === "success"; console.log("result:", m.subtype, (m as any).result); }
}
process.exit(ok ? 0 : 1);
