import type { NextConfig } from "next";

// The SDK spawns the bundled Claude Code binary; keep it out of the bundler.
export default { serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"] } satisfies NextConfig;
