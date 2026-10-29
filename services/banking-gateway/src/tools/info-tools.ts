import { speakAmount } from '../domain/money.ts';
import { collapseRates, speakBand } from '../domain/rates.ts';
import { empty, object, oneOf, string } from '../schema/schema.ts';
import { defineTool, ok } from './define.ts';

// Public information: no verification needed (deck p20–p28, p44). Rates are decimal strings from the host.

export const FX_CURRENCIES = ['USD', 'CAD', 'GBP', 'AUD', 'NZD', 'EUR', 'JPY', 'HKD', 'IDR'] as const;

const point = (rate: string) => rate.replace('.', ' point ');

export const getFxRate = defineTool({
  name: 'get_fx_rate',
  agents: ['rates_info'],
  description: 'Indicative foreign exchange rates against the Singapore dollar for one currency: selling, buying, TT and OD rates. Rates are indicative only.',
  access: 'public',
  service: 'rates',
  effect: 'read',
  params: object({ currency: oneOf(FX_CURRENCIES, 'Currency code: USD, CAD, GBP, AUD, NZD, EUR, JPY, HKD or IDR.') }, ['currency']),
  llmFields: ['say', 'currency', 'unit', 'selling', 'buying'],
  timeoutMs: 6_000,
  legacy: 'p25 FX Rate (51300000) menu of 9 currencies, p26 FX Rate 2',
  async handler(ctx, args) {
    const r = await ctx.ports.core.fxRate(args.currency, ctx.signal);
    const per = r.unit === 1 ? `1 ${r.currency}` : `${r.unit} ${r.currency}`;
    return ok({
      say: `For ${per}: selling ${point(r.selling)}, buying ${point(r.buying)}. Selling TT or OD ${point(r.sellingTtOd)}. Buying TT ${point(r.buyingTt)}. Buying OD ${point(r.buyingOd)}. These rates are indicative.`,
      currency: r.currency,
      unit: r.unit,
      selling: r.selling,
      buying: r.buying,
    });
  },
});

export const getPrimeRate = defineTool({
  name: 'get_prime_rate',
  agents: ['rates_info'],
  description: 'The prevailing prime lending rate for the OCBC Bank group.',
  access: 'public',
  service: 'rates',
  effect: 'read',
  params: empty(),
  llmFields: ['say', 'rate'],
  timeoutMs: 6_000,
  legacy: 'p23 Prime Rate (51100000)',
  async handler(ctx) {
    const { rate } = await ctx.ports.core.primeRate(ctx.signal);
    return ok({ say: `The prevailing prime lending rate for the OCBC Bank group is ${point(rate)} percent.`, rate });
  },
});

export const getTimeDepositRates = defineTool({
  name: 'get_time_deposit_rates',
  agents: ['rates_info'],
  description: 'Singapore dollar time deposit rates by tenor, with tenors that share a rate grouped together, and the minimum deposit.',
  access: 'public',
  service: 'rates',
  effect: 'read',
  params: empty(),
  llmFields: ['say', 'bands', 'minimum_deposit'],
  timeoutMs: 6_000,
  legacy: 'p24 SGD TD Rate (51200000): collapse equal consecutive rates',
  async handler(ctx) {
    const { minimumDeposit, rates } = await ctx.ports.core.timeDepositRates(ctx.signal);
    const bands = collapseRates(rates);
    const minimum = speakAmount(minimumDeposit);
    return ok({ say: `Minimum deposit ${minimum.spoken}. ${bands.map(speakBand).join('. ')}.`, bands, minimum_deposit: minimum.display });
  },
});

export const findBranch = defineTool({
  name: 'find_branch',
  agents: ['rates_info', 'appointments'],
  description: 'Find branches by name or region (north, south, east, west, central). Returns name, operating hours and address. If several match, ask the caller to choose.',
  access: 'public',
  service: 'branch_locator',
  effect: 'read',
  params: object({
    query: string({ maxLength: 60, description: 'Part of the branch name, e.g. "Bukit Timah".' }),
    region: oneOf(['north', 'south', 'east', 'west', 'central'] as const),
  }),
  llmFields: ['branches', 'count'],
  timeoutMs: 4_000,
  legacy: 'p44 Branch Locator: speech first, region menu on recognition failure',
  async handler(ctx, args) {
    const all = await ctx.ports.content.branches(ctx.signal);
    const q = args.query?.toLowerCase();
    const matches = all.filter((b) => (!args.region || b.region === args.region) && (!q || b.name.toLowerCase().includes(q)));
    return ok({ count: matches.length, branches: matches.slice(0, 9).map((b) => ({ branch_id: b.id, name: b.name, region: b.region, hours: b.hours, address: b.address })) });
  },
});

export const getAnnouncements = defineTool({
  name: 'get_announcements',
  agents: ['rates_info'],
  description: 'Current promotions (at most 7) or the bank\'s GIRO and SWIFT code information, as configured by the contact centre.',
  access: 'public',
  service: 'forms',
  effect: 'read',
  params: object({ kind: oneOf(['promotions', 'giro_swift'] as const) }, ['kind']),
  llmFields: ['items', 'message'],
  timeoutMs: 4_000,
  legacy: 'p21 Promo - General (max 7), p20 option 5 GIRO & Swift code (CMM dynamic announcement)',
  async handler(ctx, args) {
    const items = (await ctx.ports.content.announcements(args.kind, ctx.signal)).slice(0, 7);
    return ok(items.length ? { items } : { items: [], message: 'Sorry, we do not have any promotions at the moment.' });
  },
});

export const INFO_TOOLS = [getFxRate, getPrimeRate, getTimeDepositRates, findBranch, getAnnouncements];
