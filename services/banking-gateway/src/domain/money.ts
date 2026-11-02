import type { Money } from './types.ts';

// Minor-unit exponents. Amounts are integers of the minor unit so no float ever touches a balance.
const EXPONENT: Readonly<Record<string, number>> = { JPY: 0, IDR: 0 };
export const exponentOf = (currency: string): number => EXPONENT[currency] ?? 2;

const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  SGD: 'dollars',
  USD: 'US dollars',
  AUD: 'Australian dollars',
  CAD: 'Canadian dollars',
  NZD: 'New Zealand dollars',
  HKD: 'Hong Kong dollars',
  GBP: 'pounds sterling',
  EUR: 'euros',
  JPY: 'yen',
  IDR: 'rupiah',
};

export interface SpokenAmount {
  /** For chat: "SGD 1,234.05" or "-SGD 12.00". */
  readonly display: string;
  /**
   * For speech. Deck rules: SGD reads "X dollars and Y cents"; foreign currency reads "[dollar] point [cents]"; a
   * negative balance is announced as "in debit of" by the caller of this function, so this text is unsigned.
   */
  readonly spoken: string;
  readonly negative: boolean;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function speakAmount(money: Money): SpokenAmount {
  if (!Number.isSafeInteger(money.minor)) throw new RangeError('Money.minor must be a safe integer');
  const exp = exponentOf(money.currency);
  const negative = money.minor < 0;
  const abs = Math.abs(money.minor);
  const scale = 10 ** exp;
  const major = Math.floor(abs / scale);
  const minor = abs % scale;
  const minorText = exp > 0 ? String(minor).padStart(exp, '0') : '';
  const display = `${negative ? '-' : ''}${money.currency} ${group(String(major))}${exp > 0 ? `.${minorText}` : ''}`;
  const words = CURRENCY_WORDS[money.currency] ?? money.currency;

  let spoken: string;
  if (exp === 0) {
    spoken = `${group(String(major))} ${words}`;
  } else if (money.currency === 'SGD') {
    // "X dollars", "X cents", or "X dollars and X cents" (deck p5 note).
    if (major === 0) spoken = `${minor} cent${minor === 1 ? '' : 's'}`;
    else if (minor === 0) spoken = `${group(String(major))} dollar${major === 1 ? '' : 's'}`;
    else spoken = `${group(String(major))} dollar${major === 1 ? '' : 's'} and ${minor} cent${minor === 1 ? '' : 's'}`;
  } else {
    // "FCY will read as [dollar] point [cents]".
    spoken = minor === 0 ? `${group(String(major))} ${words}` : `${group(String(major))} point ${minorText} ${words}`;
  }
  return { display, spoken, negative };
}

/** Parses a decimal string from a host ("1234.5", "-0.07") into minor units without floating point. */
export function parseDecimal(text: string, currency: string): Money {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new RangeError(`Not a decimal amount: ${text}`);
  const exp = exponentOf(currency);
  const fraction = (match[3] ?? '').padEnd(exp, '0');
  if (fraction.length > exp && /[1-9]/.test(fraction.slice(exp))) {
    throw new RangeError(`Amount ${text} has more precision than ${currency} allows`);
  }
  const minor = Number(`${match[2]}${fraction.slice(0, exp)}`);
  return { minor: match[1] ? -minor : minor, currency };
}
