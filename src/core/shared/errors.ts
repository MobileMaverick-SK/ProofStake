export type DomainErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'ILLEGAL_TRANSITION'
  | 'CONFLICT'
  | 'DEADLINE_PASSED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_NOT_APPROVED'
  | 'AMOUNT_MISMATCH';

/** The only error type the core throws on purpose. API routes map `code` to an HTTP status. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/**
 * Use this instead of `instanceof` outside the core: a bundler may load this
 * module more than once, and then two DomainError classes exist.
 */
export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    error.name === 'DomainError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

export const notFound = (what: string, id: string) => new DomainError('NOT_FOUND', `${what} ${id} not found`);
