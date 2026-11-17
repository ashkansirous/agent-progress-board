import { describe, expect, it } from "vitest";
import { SESSION_STALE_AFTER_MINUTES } from "../src/domain/stale";
import { StepState } from "../src/domain/stepTypes";
import { HEARTBEAT_MINUTES, SERVER_INSTRUCTIONS } from "../src/mcp/instructions";
import { postMcp, WRITE_TOKEN } from "./helpers";

const MAX_CHARACTERS = 2000;

describe("server instructions", () => {
  it("sends the reporting rules in the initialize result", async () => {
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      WRITE_TOKEN,
    );
    const json = (await response.json()) as { result: { instructions?: string } };
    expect(json.result.instructions).toBe(SERVER_INSTRUCTIONS);
    expect(json.result.instructions).toContain("report_progress");
    expect(json.result.instructions).toContain("background agent");
    expect(json.result.instructions).toContain("mark_done");
  });

  it("heartbeats well inside the stale window", () => {
    expect(HEARTBEAT_MINUTES).toBeLessThan(SESSION_STALE_AFTER_MINUTES);
  });

  it("names the step states the server accepts", () => {
    for (const state of Object.values(StepState)) expect(SERVER_INSTRUCTIONS).toContain(`"${state}"`);
  });

  it("stays short", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(MAX_CHARACTERS);
  });
});
