import { toDecimalString, type Money } from '@/core/shared';

export const formatMoney = (money: Money) => `$${toDecimalString(money)}`;
