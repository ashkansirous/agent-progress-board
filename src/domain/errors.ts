/** A rule of the domain broken by what a client sent; the API answers 400 with its message. */
export class DomainError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}
