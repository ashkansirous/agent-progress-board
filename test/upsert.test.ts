import { describe, expect, it } from "vitest";
import { ItemStatus, ItemType, Priority } from "../src/domain/item";
import { StepState } from "../src/domain/stepTypes";
import { DomainError, newItem } from "../src/domain/upsert";

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

  it("trims steps, agent and model itself, and refuses two active steps", () => {
    const row = newItem({ ...base, agent: "  ", model: " m ", steps: [{ label: " A ", state: StepState.Active }] }, T1);
    expect(row).toMatchObject({ agent: null, model: "m", steps: [{ label: "A", state: "active", note: null }] });
    const twice = [{ label: "A", state: StepState.Active }, { label: "B", state: StepState.Active }];
    expect(() => newItem({ ...base, steps: twice }, T1)).toThrow(DomainError);
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
