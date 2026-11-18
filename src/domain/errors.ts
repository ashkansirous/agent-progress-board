/** A rule of the domain broken by what a client sent; the API answers 400 with its message. */
export class DomainError extends Error {
  constructor(
    readonly field: string,
    message: string,
    /** True when the same report may work if sent again (nothing was saved); false for a caller error. */
    readonly retryable = false,
  ) {
    super(message);
  }
}
