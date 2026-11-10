import { DomainError, isDomainError } from '../../core/shared';
import { logServerError } from '../server-log';
import { PayPalApiError, PayPalNotConfiguredError } from './client';

/**
 * Turns anything that went wrong while talking to PayPal into a typed domain
 * error with a message that is safe to show. The raw PayPal response is logged
 * on the server and goes no further.
 */
export function toDomainError(error: unknown, action: string): DomainError {
  if (isDomainError(error)) {
    logServerError('paypal', `${action} failed: ${error.code} ${error.message}`);
    return error;
  }
  if (error instanceof PayPalNotConfiguredError) {
    logServerError('paypal', `${action} failed: credentials are not configured`);
    return new DomainError('PAYMENT_FAILED', error.message);
  }

  if (error instanceof PayPalApiError) {
    logServerError('paypal', `${action} failed: ${error.message} (debug_id: ${error.debugId ?? 'none'})`);
    if (error.has('ORDER_NOT_APPROVED')) {
      return new DomainError('PAYMENT_NOT_APPROVED', 'The PayPal payment was not approved yet.');
    }
    if (error.has('INSTRUMENT_DECLINED') || error.has('PAYER_ACTION_REQUIRED')) {
      return new DomainError('PAYMENT_NOT_APPROVED', 'PayPal needs you to choose a different way to pay.');
    }
    if (error.status === 401) {
      return new DomainError('PAYMENT_FAILED', 'PayPal rejected the app credentials. Check the sandbox client ID and secret.');
    }
    if (error.status === 403) {
      // The credentials are fine; the PayPal app has not been given this feature.
      return new DomainError(
        'PAYMENT_FAILED',
        `PayPal does not allow this app to ${action} yet. The feature has to be switched on for the app in the PayPal developer dashboard.`,
      );
    }
    if (error.status === 404) return new DomainError('NOT_FOUND', 'PayPal does not know this payment.');
    return new DomainError('PAYMENT_FAILED', `PayPal could not ${action}. Nothing was changed; try again.`);
  }

  logServerError('paypal', `${action} failed: ${error instanceof Error ? error.message : String(error)}`);
  return new DomainError('PAYMENT_FAILED', `PayPal could not be reached to ${action}. Try again.`);
}
