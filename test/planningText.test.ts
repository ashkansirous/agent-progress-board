import { describe, expect, it } from "vitest";
import type { BoardPartDto } from "../src/api/boardDto";
import { SliceState } from "../src/domain/boardGroups";
import { PartState } from "../src/domain/parts";
import { checksLine, nowLine, slicePlannedText, summaryText } from "../web/src/planningText";
import { translator } from "../web/src/strings";

const en = translator("en");
const de = translator("de");

function part(letter: string, state: PartState, title = `T${letter}`): BoardPartDto {
  return { key: `s/part-${letter}`, letter, title, state, step: null, steps_done: null, steps_total: null };
}

describe("summaryText", () => {
  it("puts needs you first and joins the pieces the mock lists", () => {
    const summary = { needs_you: 1, working: 3, planned: 3, built: 0, problems: 2, checks_not_tried: 30 };
    expect(summaryText(summary, en)).toBe("1 needs you · 3 working · 3 planned · 2 problems · 30 checks not tried");
  });

  it("counts built slices after planned, so a project with only built work shows them", () => {
    const summary = { needs_you: 0, working: 0, planned: 0, built: 4, problems: 0, checks_not_tried: 9 };
    expect(summaryText(summary, en)).toBe("nothing running · 4 built · 9 checks not tried");
    expect(summaryText(summary, de)).toBe("nichts läuft · 4 gebaut · 9 Prüfungen offen");
  });

  it("says nothing running and leaves out what is 0, with singular forms", () => {
    expect(summaryText({ needs_you: 0, working: 0, planned: 0, built: 0, problems: 1, checks_not_tried: 1 }, en)).toBe(
      "nothing running · 1 problem · 1 check not tried",
    );
    expect(summaryText({ needs_you: 1, working: 0, planned: 2, built: 0, problems: 0, checks_not_tried: 0 }, en)).toBe(
      "1 needs you · nothing running · 2 planned",
    );
  });

  it("uses the singular and plural forms of needs you and working with counts 1 and 2", () => {
    const one = { needs_you: 1, working: 1, planned: 0, built: 0, problems: 0, checks_not_tried: 0 };
    const two = { needs_you: 2, working: 2, planned: 0, built: 0, problems: 0, checks_not_tried: 0 };
    expect(summaryText(one, en)).toBe("1 needs you · 1 working");
    expect(summaryText(two, en)).toBe("2 need you · 2 working");
    expect(summaryText(one, de)).toBe("1 braucht dich · 1 arbeitet");
    expect(summaryText(two, de)).toBe("2 brauchen dich · 2 arbeiten");
  });

  it("is worded in German too", () => {
    expect(summaryText({ needs_you: 0, working: 0, planned: 2, built: 0, problems: 0, checks_not_tried: 0 }, de)).toBe("nichts läuft · 2 geplant");
  });
});

describe("nowLine", () => {
  const parts = [part("A", PartState.Done), part("B", PartState.Done), part("C", PartState.Active, "Fix the race"), part("D", PartState.Pending)];

  it("names the active part, with the stale suffix for a stale one", () => {
    expect(nowLine(parts, SliceState.InProgress, en)).toBe("Now: part C, Fix the race");
    const stale = [part("A", PartState.Done), part("B", PartState.Stale, "Slow")];
    expect(nowLine(stale, SliceState.InProgress, en)).toBe("Now: part B, Slow (stale)");
  });

  it("says Not started, Parked after part X, Next and All parts done", () => {
    expect(nowLine([part("A", PartState.Pending)], SliceState.Planned, en)).toBe("Not started");
    const parked = [part("A", PartState.Done), part("B", PartState.Pending)];
    expect(nowLine(parked, SliceState.Parked, en)).toBe("Parked after part A");
    expect(nowLine(parked, SliceState.InProgress, en)).toBe("Next: part B");
    expect(nowLine([part("A", PartState.Done)], SliceState.InProgress, en)).toBe("All parts done");
    expect(nowLine([part("A", PartState.Done)], SliceState.Built, en)).toBe("All parts done");
    expect(nowLine([part("A", PartState.Done), part("B", PartState.Pending)], SliceState.Built, en)).toBe("Next: part B");
  });

  it("is null for a slice with no parts", () => {
    expect(nowLine(null, SliceState.Planned, en)).toBeNull();
  });
});

describe("check and slice words", () => {
  it("words the check count and the slice chip", () => {
    expect(checksLine(0, en)).toBe("All checks tried");
    expect(checksLine(1, en)).toBe("1 check not tried on a device");
    expect(checksLine(3, en)).toBe("3 checks not tried on a device");
    expect(slicePlannedText({ number: 12 }, en)).toBe("Slice 12 planned");
    expect(slicePlannedText({ number: null }, en)).toBe("A slice is planned");
    expect(slicePlannedText(null, en)).toBe("No slice yet");
  });
});
