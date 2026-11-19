import { describe, expect, it } from "vitest";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { StepState } from "../src/domain/stepTypes";
import { checkReport, DomainError, MAX_OUTCOME, newItem } from "../src/domain/upsert";

const T1 = "2026-11-15T10:00:00.000Z";

const base = {
  key: "demo-app/slice-1",
  project: "demo-app",
  type: ItemType.Slice,
  title: "Sample slice",
};

describe("newItem", () => {
  it("fills defaults for a new row", () => {
    expect(newItem({ ...base, parent: "Wave 3" }, T1)).toMatchObject({
      status: ItemStatus.Open,
      priority: Priority.P2,
      parent: "Wave 3",
      created_at: T1,
      updated_at: T1,
      heartbeat_at: T1,
      done_at: null,
      links: [],
    });
  });

  it("trims steps, agent and model itself, stamps the steps, and accepts two active steps", () => {
    const row = newItem({ ...base, agent: "  ", model: " m ", steps: [{ label: " A ", state: StepState.Active }] }, T1);
    expect(row).toMatchObject({ agent: null, model: "m", steps: [{ id: "A", label: "A", state: "active", note: null, started_at: T1 }] });
    const twice = [{ label: "A", state: StepState.Active }, { label: "B", state: StepState.Active }];
    expect(newItem({ ...base, steps: twice }, T1).steps).toHaveLength(2);
    expect(() => newItem({ ...base, steps: [{ label: "", state: StepState.Active }] }, T1)).toThrow(DomainError);
  });

  it("stores a trimmed outcome (blank is null) and refuses one over 200 characters", () => {
    expect(newItem({ ...base, outcome: "Code merged to main" }, T1).outcome).toBe("Code merged to main");
    expect(newItem({ ...base, outcome: "  " }, T1).outcome).toBeNull();
    expect(newItem(base, T1).outcome).toBeNull();
    expect(() => checkReport({ ...base, outcome: "x".repeat(MAX_OUTCOME + 1) })).toThrow(expect.objectContaining({ field: "outcome" }) as DomainError);
    expect(checkReport({ ...base, outcome: " Plan " }).outcome).toBe("Plan");
  });

  it("sets done_at when created done", () => {
    expect(newItem({ ...base, status: ItemStatus.Done }, T1).done_at).toBe(T1);
  });

  it("names the missing field when creating", () => {
    expect(() => newItem({ key: "k", project: "p", type: ItemType.Bug }, T1)).toThrow(
      expect.objectContaining({ field: "title" }) as DomainError,
    );
  });
});
