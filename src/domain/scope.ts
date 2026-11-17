export enum Scope {
  Read = "read",
  Write = "write",
  /** A caller signed in through claude.ai: the owner's own write tools, but no doc sync (Slice 16). */
  Owner = "owner",
}

/** What a tool needs from its caller. */
export enum Need {
  Read = "read",
  Write = "write",
  /** Only a static write token: sync_snapshot, since only a repo has plan documents. */
  Snapshot = "snapshot",
}

const ALLOWED: Record<Scope, Need[]> = {
  [Scope.Read]: [Need.Read],
  [Scope.Owner]: [Need.Read, Need.Write],
  [Scope.Write]: [Need.Read, Need.Write, Need.Snapshot],
};

/** The one rule for who may call what. A scope or need this list does not name is refused, never defaulted. */
export function allows(held: Scope, needed: Need): boolean {
  if (!Object.hasOwn(ALLOWED, held)) return false;
  return ALLOWED[held].includes(needed);
}
