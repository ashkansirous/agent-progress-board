import { describe, expect, it } from "vitest";
// @ts-expect-error Vite's ?raw import has no type declaration in this project's tsconfig.
import skillText from "../plugin/skills/agent-board/SKILL.md?raw";
// @ts-expect-error Vite's ?raw import has no type declaration in this project's tsconfig.
import pluginJsonText from "../plugin/.claude-plugin/plugin.json?raw";
// @ts-expect-error Vite's ?raw import has no type declaration in this project's tsconfig.
import mcpJsonText from "../plugin/.mcp.json?raw";
import { SERVER_INSTRUCTIONS } from "../src/mcp/instructions";

const RULES_BEGIN = "<!-- BEGIN RULES -->";
const RULES_END = "<!-- END RULES -->";

function rulesOf(skill: string): string {
  const start = skill.indexOf(RULES_BEGIN);
  const end = skill.indexOf(RULES_END);
  if (start < 0 || end < start) return "";
  return skill.slice(start + RULES_BEGIN.length, end).trim();
}

describe("plugin skill rules", () => {
  it("holds the same rules text as the server's instructions", () => {
    const rules = rulesOf(String(skillText).replace(/\r\n/g, "\n"));
    expect(rules).toBe(SERVER_INSTRUCTIONS);
  });

  it("finds no rules in a skill whose markers are missing", () => {
    expect(rulesOf("no markers here")).toBe("");
  });

  it("declares the two options the MCP entry uses", () => {
    const manifest = JSON.parse(String(pluginJsonText)) as { userConfig: Record<string, { sensitive?: boolean }> };
    const mcp = String(mcpJsonText);
    expect(Object.keys(manifest.userConfig).sort()).toEqual(["board_token", "board_url"]);
    expect(manifest.userConfig.board_token?.sensitive).toBe(true);
    expect(mcp).toContain("${user_config.board_url}/mcp");
    expect(mcp).toContain("Bearer ${user_config.board_token}");
  });

  it("holds no version, so every commit reaches clients", () => {
    const manifest = JSON.parse(String(pluginJsonText)) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("version");
  });
});
