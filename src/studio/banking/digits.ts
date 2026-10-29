/**
 * Context-aware numeric normalization for spoken and typed banking inputs.
 * Normalizes spoken digit sequences, account numbers, phone codes, and verification inputs
 * while distinguishing them from natural language phrases and monetary amounts.
 */

export interface NormalizeDigitOptions {
  /** If specified, only extract digits when the sequence matches one of these expected lengths. */
  expectedLength?: number | number[];
  /**
   * When 'digit_sequence', interprets input expecting numbers (e.g. Phone Code, PIN, account).
   * When 'general', ignores ambiguous words (e.g. 'to', 'for', 'won', 'ate') unless adjacent to numbers.
   */
  context?: 'digit_sequence' | 'general';
}

export type IdentifierType = 'phone_code' | 'account_number';

export interface ExtractedIdentifier {
  value: string;
  type: IdentifierType;
}

// Single-digit word mappings, including phonetics and common variations
const SINGLE_DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  nil: '0',
  nought: '0',
  naught: '0',
  null: '0',
  one: '1',
  won: '1',
  two: '2',
  to: '2',
  too: '2',
  three: '3',
  tree: '3',
  four: '4',
  for: '4',
  fore: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  ate: '8',
  nine: '9',
  niner: '9',
};

// Words that are homophones of digits or ambiguous in natural conversation
const AMBIGUOUS_WORDS = new Set(['to', 'too', 'for', 'fore', 'won', 'ate', 'o']);

// Two-digit / teen words
const TEEN_WORDS: Record<string, string> = {
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
};

// Tens words
const TENS_WORDS: Record<string, string> = {
  twenty: '20',
  thirty: '30',
  forty: '40',
  fourty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
};

const TENS_PREFIX: Record<string, string> = {
  twenty: '2',
  thirty: '3',
  forty: '4',
  fourty: '4',
  fifty: '5',
  sixty: '6',
  seventy: '7',
  eighty: '8',
  ninety: '9',
};

// Multipliers
const MULTIPLIERS: Record<string, number> = {
  double: 2,
  triple: 3,
  quad: 4,
  quadruple: 4,
};

/** Normalizes raw string: lowercase, cleans apostrophes, keeps alphanumeric and basic punctuation. */
export function cleanSpokenText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s.,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a spoken or typed digit sequence into continuous digits (e.g. "1234567").
 * Preserves leading zeros ("zero zero one" -> "001").
 * Handles spoken words, multipliers ("double three" -> "33"), grouped numbers ("twenty five" -> "25"),
 * and strips pauses/punctuation.
 */
export function normalizeDigitSequence(text: string, options: NormalizeDigitOptions = {}): string {
  if (!text || !text.trim()) return '';

  const { context = 'general', expectedLength } = options;
  const cleaned = cleanSpokenText(text);

  // Split tokens on whitespace, commas, hyphens, periods (as pauses)
  const rawTokens = cleaned.split(/[\s,.-]+/).filter(Boolean);
  if (!rawTokens.length) return '';

  // First pass: token classification
  const tokens: string[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i];
    if (raw) tokens.push(raw);
  }

  let out = '';
  let multiplier = 1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    // Check multipliers: "double", "triple", "quadruple"
    const mult = MULTIPLIERS[token];
    if (mult !== undefined) {
      multiplier = mult;
      continue;
    }

    // Direct numeric string: e.g. "123", "0012"
    if (/^\d+$/.test(token)) {
      if (multiplier > 1) {
        // e.g. "double 5" -> "55", "double 12" -> "1212"
        out += token.repeat(multiplier);
        multiplier = 1;
      } else {
        out += token;
      }
      continue;
    }

    // Tens + single digit combo (e.g., "twenty five" -> "25")
    if (TENS_WORDS[token] && i + 1 < tokens.length) {
      const nextToken = tokens[i + 1];
      const singleDigit = nextToken ? SINGLE_DIGIT_WORDS[nextToken] : undefined;
      if (singleDigit && /^[1-9]$/.test(singleDigit) && nextToken && !AMBIGUOUS_WORDS.has(nextToken)) {
        const combined = `${TENS_PREFIX[token]}${singleDigit}`;
        out += multiplier > 1 ? combined.repeat(multiplier) : combined;
        multiplier = 1;
        i++; // skip next token
        continue;
      }
    }

    // Standalone Tens word: "twenty" -> "20"
    const tensVal = TENS_WORDS[token];
    if (tensVal !== undefined) {
      out += multiplier > 1 ? tensVal.repeat(multiplier) : tensVal;
      multiplier = 1;
      continue;
    }

    // Teen words: "eleven" -> "11"
    const teenVal = TEEN_WORDS[token];
    if (teenVal !== undefined) {
      out += multiplier > 1 ? teenVal.repeat(multiplier) : teenVal;
      multiplier = 1;
      continue;
    }

    // Single digit words: "zero", "one", "two", etc.
    const digit = SINGLE_DIGIT_WORDS[token];
    if (digit !== undefined) {
      // Ambiguity check in 'general' context
      if (context === 'general' && AMBIGUOUS_WORDS.has(token)) {
        // Only accept ambiguous words if:
        // 1. We already have extracted some digits, OR
        // 2. The next token is also a clear digit or digit word
        const next = i + 1 < tokens.length ? tokens[i + 1] : undefined;
        const nextIsDigit =
          next !== undefined &&
          (/^\d+$/.test(next) ||
            (SINGLE_DIGIT_WORDS[next] !== undefined && !AMBIGUOUS_WORDS.has(next)) ||
            TEEN_WORDS[next] !== undefined ||
            TENS_WORDS[next] !== undefined);
        const prevIsDigit = out.length > 0;

        if (!prevIsDigit && !nextIsDigit) {
          // It's a natural language word, e.g. "I want to", "for you", "we won"
          multiplier = 1;
          continue;
        }
      }

      out += digit.repeat(multiplier);
      multiplier = 1;
      continue;
    }

    // Non-digit word resets any dangling multiplier
    multiplier = 1;
  }

  // Length filtering if specified
  if (expectedLength !== undefined) {
    const lengths = Array.isArray(expectedLength) ? expectedLength : [expectedLength];
    if (!lengths.includes(out.length)) {
      // Return empty if length does not match expected length
      return '';
    }
  }

  return out;
}

/**
 * Extracts a Phone Code (7 digits) or Business Account Number (12 digits) from spoken or typed input.
 * Respects explicit caller hints ("phone code ...", "account number ...").
 */
export function extractIdentifier(text: string): ExtractedIdentifier | null {
  if (!text || !text.trim()) return null;

  const lower = text.toLowerCase();
  const prefersPhone = /\b(phone ?code|phone|code|pc)\b/.test(lower) && !/\baccount\b/.test(lower);
  const prefersAccount = /\b(account ?number|account|acct|acc)\b/.test(lower) && !/\bphone\b/.test(lower);

  // Normalize all digits in the text
  const digits = normalizeDigitSequence(text, { context: 'digit_sequence' });

  // Check 7 digits (Phone Code)
  if (digits.length === 7) {
    return { value: digits, type: 'phone_code' };
  }

  // Check 12 digits (Account Number)
  if (digits.length === 12) {
    return { value: digits, type: 'account_number' };
  }

  // If longer string contains a 7 or 12 digit block
  if (prefersPhone) {
    const m = digits.match(/\d{7}/);
    if (m) return { value: m[0], type: 'phone_code' };
  }

  if (prefersAccount) {
    const m = digits.match(/\d{12}/);
    if (m) return { value: m[0], type: 'account_number' };
  }

  // Fallback pattern match in raw text if mixed with spaces/dashes
  const rawClean = text.replace(/[^\d]/g, '');
  if (rawClean.length === 7) return { value: rawClean, type: 'phone_code' };
  if (rawClean.length === 12) return { value: rawClean, type: 'account_number' };

  return null;
}

/** Privacy-safe masking for identifiers (phone codes, account numbers). */
export function maskIdentifier(identifier: string, keep = 4): string {
  if (!identifier) return '';
  const clean = String(identifier).trim();
  if (clean.length <= keep) return '•'.repeat(clean.length);
  return `${'•'.repeat(Math.max(1, clean.length - keep))}${clean.slice(-keep)}`;
}
