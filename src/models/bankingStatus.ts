// Where banking answers come from, as one chip and one sentence for every screen outside the Test stage (Build ›
// Tools, Settings, Release). Pure. Banking works in both Live and Sandbox; what changes is where the answers come
// from, and every screen says it: the bank's real systems, or the mock bank's test data.
import { bankingSourceLabel, isMockBank, type BankingSource } from '../api/gateway';

export interface BankingStatus {
  /** Answers are test data from the mock bank, not the bank's real systems. */
  mock: boolean;
  chip: string;
  tone: 'warning' | 'success' | 'info';
  /** The sentence: where answers come from, and in Live on the mock bank, why. */
  text: string;
}

/** Said in Live when there is no gateway on the bank's real systems, so banking runs on the mock bank. */
export const LIVE_MOCK_BANK =
  'No banking gateway on the bank’s real systems is connected, so banking in Live uses the mock bank: test data and test logins, never a real customer’s accounts.';

export function bankingStatus(source: BankingSource): BankingStatus {
  if (!isMockBank(source)) return { mock: false, chip: 'Bank’s real systems', tone: 'success', text: bankingSourceLabel(source) };
  if (source.studio === 'live') return { mock: true, chip: 'Mock bank · test data', tone: 'warning', text: `${bankingSourceLabel(source)}. ${LIVE_MOCK_BANK}` };
  return { mock: true, chip: 'Sandbox · test data', tone: 'info', text: bankingSourceLabel(source) };
}

/** What deploying a banking agent needs on the Agent Builder server, said plainly. */
export const BANKING_DEPLOY_NEEDS =
  'The Agent Builder server needs the secret BANKING_GATEWAY_TOKEN, and the banking gateway must be reachable from the agent runtime at the address in banking_gateway_url. Without them every banking tool fails.';
