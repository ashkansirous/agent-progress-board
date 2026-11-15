import { Scope } from "../domain/scope";

const BEARER_PREFIX = "Bearer ";
const encoder = new TextEncoder();

export interface TokenSecrets {
  BOARD_WRITE_TOKEN?: string;
  BOARD_READ_TOKEN?: string;
}

/** Returns the scope the request's bearer token grants, or null (401). */
export async function authenticate(request: Request, secrets: TokenSecrets): Promise<Scope | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const presented = header.slice(BEARER_PREFIX.length);
  if (await matches(presented, secrets.BOARD_WRITE_TOKEN)) return Scope.Write;
  if (await matches(presented, secrets.BOARD_READ_TOKEN)) return Scope.Read;
  return null;
}

async function matches(presented: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([digest(presented), digest(expected)]);
  return constantTimeEqual(a, b);
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
