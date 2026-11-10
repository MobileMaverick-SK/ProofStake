import { NextResponse } from 'next/server';
import { isDomainError, type DomainErrorCode } from '@/core/shared';

const STATUS: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  ILLEGAL_TRANSITION: 409,
  CONFLICT: 409,
  DEADLINE_PASSED: 409,
  PAYMENT_FAILED: 502,
  PAYMENT_NOT_APPROVED: 402,
  AMOUNT_MISMATCH: 409,
};

const GENERIC = 'Something went wrong on our side. Try again.';

/** The message that is safe to show for any thrown value. Unknown errors are logged, not shown. */
export function messageFor(error: unknown): string {
  if (isDomainError(error)) return error.message;
  console.error('[app] unexpected error', error);
  return GENERIC;
}

export function errorResponse(error: unknown): NextResponse {
  const status = isDomainError(error) ? (STATUS[error.code] ?? 500) : 500;
  return NextResponse.json({ error: messageFor(error) }, { status });
}
