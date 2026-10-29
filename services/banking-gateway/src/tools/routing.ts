import type { ServiceId } from '../domain/types.ts';

// Where a caller goes when they press "0" / ask for a person, and how the Siebel SR is categorised. Taken from the
// red "Note : 0 - Transfer to …" boxes on each deck page. The transfer *target* (queue number / SIP URI) is runtime
// config (`telephony.transfers`, kept in secrets); the gateway only returns the route key.

export interface Route {
  readonly skillset: string;
  readonly type: string;
  readonly category: string;
  readonly subCategory: string | null;
  readonly priority: 'normal' | 'high';
}

const QK = 'QUICKKILL';

export const ROUTES: Readonly<Record<ServiceId | 'general' | 'investigation' | 'trade', Route>> = {
  account_balance: { skillset: 'bi_single', type: QK, category: 'ACCOUNT SERVICES', subCategory: 'ACCOUNT BALANCES', priority: 'normal' },
  incoming_funds: { skillset: 'bi_single', type: QK, category: 'INWARD REMITTANCE', subCategory: 'STATUS OF INCOMING FUNDS', priority: 'normal' },
  recent_activity: { skillset: 'bi_segment', type: QK, category: 'ACCOUNT SERVICES', subCategory: 'DEBIT/CREDIT TXN', priority: 'normal' },
  statement_request: { skillset: 'bi_segment', type: QK, category: 'ACCOUNT SERVICES', subCategory: 'COPY OF STATEMENT (C/P/I)', priority: 'normal' },
  pin_change: { skillset: 'bi_segment', type: QK, category: 'PHONEBANKING', subCategory: 'T-PIN RESET', priority: 'normal' },
  fd_loan: { skillset: 'bc_fd_loans', type: QK, category: 'FIXED DEPOSIT', subCategory: 'TRANSACTION (NEW)', priority: 'normal' },
  cheque_deposit_status: { skillset: 'bi_segment', type: QK, category: 'LOCAL CHEQUE CLEARING', subCategory: 'STATUS OF CHEQUE DEPOSIT', priority: 'normal' },
  cheque_issued_status: { skillset: 'bi_segment', type: QK, category: 'LOCAL CHEQUE CLEARING', subCategory: 'STATUS OF CHEQUE ISSUED', priority: 'normal' },
  chequebook_status: { skillset: 'bi_segment', type: QK, category: 'CHEQUE BOOK', subCategory: 'CHEQUE BOOK ENQUIRY', priority: 'normal' },
  chequebook_request: { skillset: 'bi_segment', type: QK, category: 'CHEQUE BOOK', subCategory: 'CHEQUE BOOK REQ - NORMAL', priority: 'normal' },
  stop_cheque: { skillset: 'bi_segment', type: QK, category: 'CHEQUE BOOK', subCategory: 'STOP PAYMENT INSTRUCTIONS', priority: 'normal' },
  appointment: { skillset: 'bi_segment', type: QK, category: 'ACCOUNT SERVICES', subCategory: 'FOREIGN WORKER ACC OPENING (NEW)', priority: 'normal' },
  rates: { skillset: 'bi_segment', type: QK, category: 'FOREIGN EXCHANGE', subCategory: 'INDICATIVE FX RATES (<S$40K)', priority: 'normal' },
  branch_locator: { skillset: 'non_customer', type: '', category: '', subCategory: null, priority: 'normal' },
  forms: { skillset: 'non_customer', type: '', category: '', subCategory: null, priority: 'normal' },
  lost_card: { skillset: 'card_ops', type: QK, category: 'CARDS', subCategory: 'LOST CARD', priority: 'high' },
  callback: { skillset: 'bi_segment', type: '', category: '', subCategory: null, priority: 'normal' },
  general: { skillset: 'bi_general', type: '', category: '', subCategory: null, priority: 'normal' },
  investigation: { skillset: 'bi_investigate', type: '', category: '', subCategory: null, priority: 'normal' },
  trade: { skillset: 'trade_hotline', type: '', category: '', subCategory: null, priority: 'normal' },
};
