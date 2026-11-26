import { beforeEach, describe, expect, it } from "vitest";
import { callTool, resetBoard } from "./helpers";

const PROJECT = "demo-app";
const KEY = "demo-app/finding-over-budget-1a2b3c4d5e";

beforeEach(resetBoard);

describe("finding items (Slice 57)", () => {
  it("accepts a report of type finding, keeps its details and lists it open", async () => {
    const reply = await callTool("report_progress", {
      key: KEY, project: PROJECT, type: "finding", status: "open", priority: "P3", title: "test/suite: 3 of 9 runs over the 6-minute budget",
      why: "Estimated saving: time 40 min", details_md: "**Detector:** over-budget",
    });
    expect(reply.isError).toBeFalsy();
    const open = (await callTool("list_open", {})).data as { key: string; type: string; details_md: string }[];
    expect(open.find((item) => item.key === KEY)).toMatchObject({ type: "finding", details_md: "**Detector:** over-budget" });
  });

  it("refuses a type that is not an item type", async () => {
    const reply = await callTool("report_progress", { key: KEY, project: PROJECT, type: "findings", title: "x" });
    expect(reply.isError).toBe(true);
  });
});
