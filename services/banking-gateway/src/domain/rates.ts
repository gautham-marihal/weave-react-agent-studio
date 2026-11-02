// Rates are decimal strings end to end ("5.25"), never floats.

export interface TenorRate {
  readonly months: number;
  readonly rate: string;
}

export interface RateBand {
  readonly fromMonths: number;
  readonly toMonths: number;
  readonly rate: string;
}

/**
 * Deck p24: "Collapse if there are same rates for different months". 1m 5%, 2m 5%, 3m 10% reads as
 * "1 to 2 months, 5%; 3 months, 10%". Only consecutive tenors with an equal rate are merged.
 */
export function collapseRates(rates: readonly TenorRate[]): RateBand[] {
  const sorted = [...rates].sort((a, b) => a.months - b.months);
  const bands: RateBand[] = [];
  for (const r of sorted) {
    const last = bands[bands.length - 1];
    if (last && last.rate === normalise(r.rate) && last.toMonths + 1 === r.months) {
      bands[bands.length - 1] = { ...last, toMonths: r.months };
    } else {
      bands.push({ fromMonths: r.months, toMonths: r.months, rate: normalise(r.rate) });
    }
  }
  return bands;
}

/** "5.250" → "5.25", "05" → "5": equal rates compare equal as text. */
function normalise(rate: string): string {
  if (!/^\d+(\.\d+)?$/.test(rate)) throw new RangeError(`Not a rate: ${rate}`);
  const [whole, fraction = ''] = rate.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${String(Number(whole))}${trimmed ? `.${trimmed}` : ''}`;
}

export function speakBand(band: RateBand): string {
  const span =
    band.fromMonths === band.toMonths
      ? `${band.fromMonths} month${band.fromMonths === 1 ? '' : 's'}`
      : `${band.fromMonths} to ${band.toMonths} months`;
  return `For ${span}, ${band.rate.replace('.', ' point ')} percent`;
}
