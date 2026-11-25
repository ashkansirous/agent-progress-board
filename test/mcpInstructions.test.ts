import { describe, expect, it } from "vitest";
import { SESSION_STALE_AFTER_MINUTES } from "../src/domain/stale";
import { StepState } from "../src/domain/stepTypes";
import { HEARTBEAT_MINUTES, SERVER_INSTRUCTIONS } from "../src/mcp/instructions";
import { postMcp, WRITE_TOKEN } from "./helpers";

const MAX_CHARACTERS = 5000; // 4500 until Slice 55 added the process and counts rule;4150 until Slice 53 added the task-tools rule; 3650 until Slice 51 added the blocked state and the reported step times; 3400 until Slice 50 added the archive and batch rule; 3300 until the slice-card rule was spelled out (review of Slice 41); 2400 until Slice 39 added the step tree, under_step and step id rules; 2900 until Slice 41 added the task-with-outcome rule

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

  it("tells a question to carry its options, its work and a link, never a bare waiting", () => {
    expect(SERVER_INSTRUCTIONS).toContain("the question, its options and what each does");
    expect(SERVER_INSTRUCTIONS).toContain("the work it belongs to (slice, task) in the title");
    expect(SERVER_INSTRUCTIONS).toContain("a link to where the person acts");
    expect(SERVER_INSTRUCTIONS).toContain('never a card that only says "waiting"');
  });

  it("opens a card only for a task with an outcome: none for a plain chat or an orchestrator (Slice 41)", () => {
    expect(SERVER_INSTRUCTIONS).toContain("a card is a task with an outcome");
    expect(SERVER_INSTRUCTIONS).toContain("a plain chat");
    expect(SERVER_INSTRUCTIONS).toContain("an orchestrator");
    expect(SERVER_INSTRUCTIONS).toContain('"<project>/slice-<N>", with no type and no agent');
    expect(SERVER_INSTRUCTIONS).toContain('"<project>/task-<id>"');
    expect(SERVER_INSTRUCTIONS).toContain('"<project>/task-<id>"');
    expect(SERVER_INSTRUCTIONS).toContain("outcome = what it delivers");
    expect(SERVER_INSTRUCTIONS).not.toContain("at the start of every session or chat");
  });

  it("stays short", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(MAX_CHARACTERS);
  });
});
