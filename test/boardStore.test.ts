import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardResponse } from "../src/api/boardDto";
import { createBoardStore } from "../web/src/boardStore";

const SLOW_MS = 500;

function fakeBoard(): BoardResponse {
  return { working_count: 2, config: {} } as unknown as BoardResponse;
}

function setup() {
  const pending: Array<{ resolve: (b: BoardResponse) => void; signal: AbortSignal }> = [];
  const fetchBoard = vi.fn(
    (signal: AbortSignal) => new Promise<BoardResponse>((resolve) => pending.push({ resolve, signal })),
  );
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const startPolling = vi.fn(() => {
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
  const store = createBoardStore({ fetchBoard, startPolling, slowAfterMs: SLOW_MS });
  return { store, fetchBoard, startPolling, stops, pending };
}

describe("the shared board store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the read and the polling when the last page leaves and the next subscribes in the same tick", () => {
    const { store, fetchBoard, startPolling, stops, pending } = setup();
    const off = store.subscribe(() => {});
    off();
    store.subscribe(() => {});
    vi.advanceTimersByTime(0);
    expect(pending[0]!.signal.aborted).toBe(false);
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    expect(startPolling).toHaveBeenCalledTimes(1);
    expect(stops[0]).not.toHaveBeenCalled();
  });

  it("loads and polls once for several pages, and stops polling when the last one leaves", () => {
    const { store, fetchBoard, startPolling, stops } = setup();
    const offA = store.subscribe(() => {});
    const offB = store.subscribe(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    expect(startPolling).toHaveBeenCalledTimes(1);
    offA();
    expect(stops[0]).not.toHaveBeenCalled();
    offB();
    vi.advanceTimersByTime(0);
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it("aborts the read nobody waits for and drops its slow flag", async () => {
    vi.useFakeTimers();
    try {
      const { store, pending } = setup();
      const off = store.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(SLOW_MS);
      expect(store.getState()).toMatchObject({ loading: true, slow: true });
      off();
      await vi.advanceTimersByTimeAsync(0);
      expect(pending[0]!.signal.aborted).toBe(true);
      // A first load with nothing to show stays "loading" (Slice 47 1c): the next page does not paint an empty body.
      expect(store.getState()).toMatchObject({ loading: true, slow: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a success: loading and slow end, the data is kept, no error, listeners hear it", async () => {
    const { store, pending } = setup();
    const notify = vi.fn();
    store.subscribe(notify);
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    notify.mockClear();
    pending[0]!.resolve(fakeBoard());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ loading: false, slow: false, error: null });
    expect(store.getState().data?.working_count).toBe(2);
    expect(notify).toHaveBeenCalled();
  });

  it("settles a failure: loading and slow end, the error is set, listeners hear it", async () => {
    const { store, fetchBoard } = setup();
    fetchBoard.mockImplementationOnce(() => Promise.reject(new Error("down")));
    const notify = vi.fn();
    store.subscribe(notify);
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(store.getState()).toMatchObject({ loading: false, slow: false, error: { status: null } });
    expect(notify).toHaveBeenCalled();
  });

  it("settles an abort after a successful load: the data stays, there is no error, and a reload keeps it", async () => {
    const { store, pending } = setup();
    const off = store.subscribe(() => {});
    pending[0]!.resolve(fakeBoard());
    await vi.advanceTimersByTimeAsync(0);
    store.refresh().catch(() => {});
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(store.getState()).toMatchObject({ loading: true, slow: true });
    off();
    await vi.advanceTimersByTimeAsync(0);
    expect(pending[1]!.signal.aborted).toBe(true);
    expect(store.getState()).toMatchObject({ loading: false, slow: false, error: null });
    expect(store.getState().data?.working_count).toBe(2);
  });

  it("lets a later passive reader see loading false after an abort, and never a late slow flag", async () => {
    const { store, fetchBoard } = setup();
    const off = store.subscribe(() => {});
    off();
    await vi.advanceTimersByTimeAsync(0);
    store.subscribePassive(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(store.getState()).toMatchObject({ loading: true, slow: true });
  });

  it("keeps loading true (never a blank first frame) after the last reader aborts a first load with nothing read (Slice 47 1c)", async () => {
    const { store } = setup();
    const off = store.subscribe(() => {});
    off();
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(store.getState()).toMatchObject({ loading: true, slow: false, data: null, error: null });
  });

  it("does not turn a throwing listener into a failed load (Slice 47 1b)", async () => {
    const { store, pending } = setup();
    const heard = vi.fn();
    store.subscribe(() => {
      throw new Error("listener fault");
    });
    store.subscribe(heard);
    pending[0]!.resolve(fakeBoard());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ loading: false, error: null });
    expect(store.getState().data?.working_count).toBe(2);
    expect(heard).toHaveBeenCalled();
  });

  it("lets the first page carry on a load a passive reader already started instead of repeating it (Slice 47 1d)", async () => {
    const { store, fetchBoard, pending } = setup();
    store.subscribePassive(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    store.subscribe(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    expect(pending[0]!.signal.aborted).toBe(false);
    pending[0]!.resolve(fakeBoard());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().data?.working_count).toBe(2);
    expect(store.getState().settles).toBe(1);
  });

  it("keeps the last answer for the next page and reloads it once", async () => {
    const { store, fetchBoard, pending } = setup();
    const off = store.subscribe(() => {});
    pending[0]!.resolve(fakeBoard());
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().data?.working_count).toBe(2);
    off();
    vi.advanceTimersByTime(0);
    store.subscribe(() => {});
    expect(store.getState().data?.working_count).toBe(2);
    expect(fetchBoard).toHaveBeenCalledTimes(2);
  });

  it("reloads on a page switch when the cached answer is old, so an item the cache lacks can open (Slice 47 1a)", async () => {
    const { store, fetchBoard, pending } = setup();
    const off = store.subscribe(() => {});
    pending[0]!.resolve(fakeBoard());
    await vi.advanceTimersByTimeAsync(0);
    off();
    vi.setSystemTime(Date.now() + 60_000);
    store.subscribe(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(2);
    expect(store.getState().data?.working_count).toBe(2);
  });

  it("reloads on every page switch, even when the cached answer is a second old (Slice 47 review #2)", async () => {
    const { store, fetchBoard, pending } = setup();
    const off = store.subscribe(() => {});
    pending[0]!.resolve(fakeBoard());
    await vi.advanceTimersByTimeAsync(0);
    off();
    vi.setSystemTime(Date.now() + 1000);
    store.subscribe(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(2);
  });

  it("reloads on a page switch right after a failed load, and counts failures as settled loads (Slice 47 review #1)", async () => {
    const fetchBoard = vi.fn(() => Promise.reject(new Error("down")));
    const store = createBoardStore({ fetchBoard, startPolling: () => () => {}, slowAfterMs: SLOW_MS });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ error: { status: null }, settles: 1 });
    off();
    store.subscribe(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(2);
  });

  it("does not count an aborted load as settled (Slice 47 review #1)", () => {
    const { store } = setup();
    const off = store.subscribe(() => {});
    off();
    vi.advanceTimersByTime(0);
    expect(store.getState().settles).toBe(0);
  });

  it("lets a passive reader load once, without polling, and only while nothing was read", () => {
    const { store, fetchBoard, startPolling } = setup();
    store.subscribePassive(() => {});
    store.subscribePassive(() => {});
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    expect(startPolling).not.toHaveBeenCalled();
  });

  it("lets a load a passive reader started finish when the last page leaves", async () => {
    const { store, pending } = setup();
    store.subscribePassive(() => {});
    const off = store.subscribe(() => {});
    off();
    vi.advanceTimersByTime(0);
    expect(pending[0]!.signal.aborted).toBe(false);
    pending[0]!.resolve(fakeBoard());
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().data?.working_count).toBe(2);
  });

  it("aborts the load when the last passive reader leaves too", () => {
    const { store, pending } = setup();
    const offPassive = store.subscribePassive(() => {});
    const off = store.subscribe(() => {});
    off();
    offPassive();
    vi.advanceTimersByTime(0);
    expect(pending[0]!.signal.aborted).toBe(true);
  });
});
