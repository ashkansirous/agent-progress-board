export const DEFAULT_PORT = 4173;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** E2E_PORT unset keeps the default; any set value must be a whole port number, else config load fails. */
export function resolvePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`E2E_PORT must be a whole number from ${MIN_PORT} to ${MAX_PORT}, got "${raw}"`);
  }
  return port;
}
