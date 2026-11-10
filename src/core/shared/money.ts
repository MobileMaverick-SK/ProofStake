/** Money is always integer cents. Decimal strings exist only at the PayPal boundary. */
export type Currency = 'USD';

export interface Money {
  readonly cents: number;
  readonly currency: Currency;
}

export function usd(cents: number): Money {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Money must be a non-negative integer number of cents, got ${cents}`);
  }
  return { cents, currency: 'USD' };
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.cents === b.cents && a.currency === b.currency;
}

/** 2050 -> "20.50". Use only when talking to PayPal or formatting for display. */
export function toDecimalString(money: Money): string {
  const whole = Math.floor(money.cents / 100);
  const fraction = String(money.cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** "20.50" -> 2050. Rejects anything that is not a plain decimal with at most 2 places. */
export function fromDecimalString(value: string, currency: Currency = 'USD'): Money {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Not a valid money amount: "${value}"`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return { cents: whole * 100 + fraction, currency };
}
