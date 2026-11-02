// A small, strict, dependency-free schema layer. One declaration gives three things:
//   1. the TypeScript type of a tool's arguments (Infer<typeof schema>),
//   2. run-time validation of whatever the model sent (never trust model output),
//   3. the JSON Schema the agent runtime shows the model (tool `parameters`).
// Objects reject unknown keys, so a model cannot smuggle extra fields into a host call.

export interface Issue {
  readonly path: string;
  readonly message: string;
}

export interface JsonSchema {
  readonly [key: string]: unknown;
}

export interface Schema<T> {
  readonly parse: (value: unknown, path: string, issues: Issue[]) => T | undefined;
  readonly toJson: () => JsonSchema;
  /** Sensitive values are replaced with "[redacted]" in audit logs. */
  readonly sensitive: boolean;
  /** Identifiers are masked to their last four characters in audit logs. */
  readonly identifier: boolean;
  /** Phantom field for type inference only. */
  readonly _type?: T;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

interface StringOptions {
  readonly description?: string;
  readonly minLength?: number;
  readonly maxLength: number;
  readonly pattern?: RegExp;
  readonly patternHint?: string;
  readonly sensitive?: boolean;
  readonly identifier?: boolean;
}

// Control and bidi-override characters can hide text from a reviewer or a log viewer, so they are refused.
// eslint-disable-next-line no-control-regex -- matching control characters is the point of this pattern
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;

export function string(options: StringOptions): Schema<string> {
  return {
    sensitive: options.sensitive ?? false,
    identifier: options.identifier ?? false,
    parse(value, path, issues) {
      if (typeof value !== 'string') {
        issues.push({ path, message: 'must be text' });
        return undefined;
      }
      const text = value.trim().normalize('NFC');
      if (CONTROL_CHARS.test(text)) {
        issues.push({ path, message: 'contains control characters' });
        return undefined;
      }
      if (text.length < (options.minLength ?? 1)) issues.push({ path, message: 'is required' });
      else if (text.length > options.maxLength) issues.push({ path, message: `must be at most ${options.maxLength} characters` });
      else if (options.pattern && !options.pattern.test(text)) issues.push({ path, message: options.patternHint ?? 'has the wrong format' });
      else return text;
      return undefined;
    },
    toJson: () => ({
      type: 'string',
      ...(options.description ? { description: options.description } : {}),
      minLength: options.minLength ?? 1,
      maxLength: options.maxLength,
      ...(options.pattern ? { pattern: options.pattern.source } : {}),
    }),
  };
}

/**
 * A number the caller reads out or keys in. Spaces and dashes are removed first, because a model transcribing
 * "5012 3456 7890" may keep the grouping.
 */
export function digits(length: number | { min: number; max: number }, description: string, flags: { sensitive?: boolean; identifier?: boolean } = {}): Schema<string> {
  const min = typeof length === 'number' ? length : length.min;
  const max = typeof length === 'number' ? length : length.max;
  const hint = min === max ? `must be exactly ${min} digits` : `must be ${min} to ${max} digits`;
  return {
    sensitive: flags.sensitive ?? false,
    identifier: flags.identifier ?? false,
    parse(value, path, issues) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        issues.push({ path, message: 'must be a number given as digits' });
        return undefined;
      }
      const text = String(value).replace(/[\s-]/g, '');
      if (!/^\d+$/.test(text) || text.length < min || text.length > max) {
        issues.push({ path, message: hint });
        return undefined;
      }
      return text;
    },
    toJson: () => ({ type: 'string', description: description, pattern: `^[0-9 -]{${min},${max + Math.ceil(max / 3)}}$` }),
  };
}

export function oneOf<const T extends readonly string[]>(values: T, description?: string): Schema<T[number]> {
  return {
    sensitive: false,
    identifier: false,
    parse(value, path, issues) {
      if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T[number];
      issues.push({ path, message: `must be one of: ${values.join(', ')}` });
      return undefined;
    },
    toJson: () => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) }),
  };
}

export function integer(options: { min: number; max: number; description?: string }): Schema<number> {
  return {
    sensitive: false,
    identifier: false,
    parse(raw, path, issues) {
      // The runtime builds request bodies from text templates ("{{args.page}}"), so "2" is accepted as 2.
      const value = typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        issues.push({ path, message: 'must be a whole number' });
        return undefined;
      }
      if (value < options.min || value > options.max) {
        issues.push({ path, message: `must be between ${options.min} and ${options.max}` });
        return undefined;
      }
      return value;
    },
    toJson: () => ({ type: 'integer', minimum: options.min, maximum: options.max, ...(options.description ? { description: options.description } : {}) }),
  };
}

/** YYYY-MM-DD, checked to be a real calendar date. */
export function isoDate(description: string): Schema<string> {
  const base = string({ maxLength: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, patternHint: 'must be a date as YYYY-MM-DD', description });
  return {
    ...base,
    parse(value, path, issues) {
      const text = base.parse(value, path, issues);
      if (text === undefined) return undefined;
      const date = new Date(`${text}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        issues.push({ path, message: 'is not a real date' });
        return undefined;
      }
      return text;
    },
  };
}

type Shape = Readonly<Record<string, Schema<unknown>>>;
type ObjectOf<P extends Shape, R extends keyof P> = { [K in R]: Infer<P[K]> } & { [K in Exclude<keyof P, R>]?: Infer<P[K]> };

export function object<P extends Shape, R extends keyof P & string = never>(
  properties: P,
  required: readonly R[] = [],
): Schema<ObjectOf<P, R>> & { readonly properties: P } {
  return {
    properties,
    sensitive: false,
    identifier: false,
    parse(value, path, issues) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push({ path: path || '(arguments)', message: 'must be an object' });
        return undefined;
      }
      const input = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const before = issues.length;
      for (const key of Object.keys(input)) {
        if (!Object.hasOwn(properties, key)) issues.push({ path: join(path, key), message: 'is not an allowed field' });
      }
      for (const [key, schema] of Object.entries(properties)) {
        const raw = input[key];
        if (raw === undefined || raw === null || raw === '') {
          if ((required as readonly string[]).includes(key)) issues.push({ path: join(path, key), message: 'is required' });
          continue;
        }
        const parsed = schema.parse(raw, join(path, key), issues);
        if (parsed !== undefined) out[key] = parsed;
      }
      return issues.length === before ? (out as ObjectOf<P, R>) : undefined;
    },
    toJson: () => ({
      type: 'object',
      properties: Object.fromEntries(Object.entries(properties).map(([k, s]) => [k, s.toJson()])),
      required: [...required],
      additionalProperties: false,
    }),
  };
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

export const empty = () => object({});

export function validate<T>(schema: Schema<T>, value: unknown): { ok: true; value: T } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed = schema.parse(value ?? {}, '', issues);
  return parsed === undefined || issues.length ? { ok: false, issues } : { ok: true, value: parsed };
}
