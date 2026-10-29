// Domain vocabulary for the Business Banking voice/chat agent. Legacy IVR terms are kept in comments so the mapping
// back to the Avaya call-flow deck (BBCSC v47) stays traceable.

/** The runtime's channel types (agent-config-guide §3.15). SMS, e-mail and WhatsApp are not served: they cannot show a secure keypad. */
export type Channel = 'sip_voice' | 'web_voice' | 'web_chat' | 'custom';
export type Language = 'en' | 'zh';

/** How the caller proved who they are. Deck p33/p34: "P + T" (PhoneCode + T-PIN) or "A + I" (account + NRIC) + SMS OTP. */
export type AuthMethod = 'phonecode_pin' | 'account_nric_otp';

/**
 * Role of an OTP-authenticated user, as returned by the CRM. The deck writes "AS" and "AC"; we read them as
 * Authorised Signatory and Authorised Contact. OPEN DECISION: the business owner must confirm this reading.
 */
export type UserRole = 'AS' | 'AC';

/** Deck: CA = current account, ACU = foreign-currency (Asian Currency Unit) account; "ACU-CHQ" = ACU with cheques. */
export type AccountType = 'CA' | 'ACU' | 'ACU_CHQ' | 'ACU_CALL';

export interface Money {
  /** Integer amount in the currency's minor unit (cents). Never a float. */
  readonly minor: number;
  readonly currency: string;
}

export interface Account {
  readonly number: string; // full 12-digit number; server-side only, never sent to the model
  readonly type: AccountType;
  readonly currencies: readonly string[];
  readonly dormant: boolean;
  readonly omnibus: boolean;
}

export interface CustomerProfile {
  readonly customerId: string; // CIF
  readonly displayName: string;
  readonly segment: 'business' | 'personal';
  readonly role: UserRole | null; // null for PhoneCode users
  /** Deck p3: "BC = BizConn indicator"; gates the FD & Loan branch. */
  readonly bizConn: boolean;
  readonly accounts: readonly Account[];
  readonly firstOtpLogin: boolean;
}

/** Services the agent can offer. Each maps to a legacy service id (8-digit node number in the deck). */
export type ServiceId =
  | 'account_balance' // 11000000
  | 'incoming_funds' // 12000000
  | 'recent_activity' // 13000000
  | 'statement_request' // 14000000
  | 'pin_change' // 15000000
  | 'fd_loan' // service code 328
  | 'cheque_deposit_status' // 21000000
  | 'cheque_issued_status' // 22000000
  | 'chequebook_status' // 23000000
  | 'chequebook_request' // 24000000
  | 'stop_cheque' // 25000000
  | 'appointment' // 44000000
  | 'rates' // 51000000
  | 'branch_locator'
  | 'forms' // 53000000
  | 'lost_card' // 60000000 (Lost Card page)
  | 'callback';

/** A write the caller must explicitly confirm before it reaches a host system. */
export interface PreparedTransaction {
  readonly id: string;
  readonly service: 'statement_request' | 'chequebook_request' | 'stop_cheque' | 'appointment_book' | 'appointment_cancel';
  /** Plain-language summary the agent reads back. Contains no full account numbers. */
  readonly summary: string;
  readonly charge: Money | null;
  /** Everything the host call needs. Server-side only. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly preparedAt: number;
  readonly expiresAt: number;
}

/** A host failure, already decoded from the host's response code. */
export interface HostFailure {
  readonly system: 'as400' | 'siebel' | 'cmm' | 'soa' | 'otp';
  readonly code: string;
  readonly retryable: boolean;
}
