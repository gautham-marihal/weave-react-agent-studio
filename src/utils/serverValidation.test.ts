import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, ValidationReport } from '../types/studio';
import { api } from '../api/client';
import { checkValidation, getValidation, putValidation, resetValidation, viewOf } from './serverValidation';

const ok: ValidationReport = { valid: true, errors: [], warnings: [], secrets_required: ['OPENAI_API_KEY'], unsupported: [] };
const bad: ValidationReport = { valid: false, errors: [{ path: ['persona', 'name'], message: "'name' is a required property" }], warnings: [], secrets_required: [], unsupported: [] };
const a: AgentConfig = { persona: { name: 'A' } };
const b: AgentConfig = { persona: { name: 'B' } };
const json = (c: AgentConfig) => JSON.stringify(c);

afterEach(() => {
  vi.restoreAllMocks();
  resetValidation();
});

describe('viewOf: what the server said about this exact config', () => {
  it('nothing asked yet', () => {
    expect(viewOf(undefined, json(a)).status).toBe('unknown');
  });

  it('checked: the report for this config', () => {
    const v = viewOf({ json: json(a), checking: false, error: null, report: bad, reportJson: json(a) }, json(a));
    expect(v).toEqual({ status: 'checked', report: bad, previous: null, error: null });
  });

  it('a report about an earlier config is never shown as this config’s, only as the previous one', () => {
    const v = viewOf({ json: json(b), checking: true, error: null, report: ok, reportJson: json(a) }, json(b));
    expect(v.status).toBe('checking');
    expect(v.report).toBeNull();
    expect(v.previous).toBe(ok);
  });

  it('failed: the reason, and no report claimed', () => {
    const v = viewOf({ json: json(a), checking: false, error: 'The Agent Builder API is not responding.', report: null, reportJson: '' }, json(a));
    expect(v.status).toBe('failed');
    expect(v.report).toBeNull();
    expect(v.error).toBe('The Agent Builder API is not responding.');
  });
});

describe('checkValidation: one POST /validate per config', () => {
  it('asks once and stores the answer', async () => {
    const spy = vi.spyOn(api, 'validate').mockResolvedValue(ok);
    await checkValidation('k', a);
    await checkValidation('k', a);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(viewOf(getValidation('k'), json(a)).report).toBe(ok);
  });

  it('asks again when the config changed', async () => {
    const spy = vi.spyOn(api, 'validate').mockResolvedValueOnce(ok).mockResolvedValueOnce(bad);
    await checkValidation('k', a);
    await checkValidation('k', b);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(viewOf(getValidation('k'), json(b)).report).toBe(bad);
  });

  it('keeps the server’s failure message instead of inventing a result', async () => {
    vi.spyOn(api, 'validate').mockRejectedValue(new Error('Could not reach the Agent Builder API.'));
    await checkValidation('k', a);
    const v = viewOf(getValidation('k'), json(a));
    expect(v.status).toBe('failed');
    expect(v.error).toBe('Could not reach the Agent Builder API.');
  });

  it('the report Save returned counts as checked, without asking again', async () => {
    const spy = vi.spyOn(api, 'validate').mockResolvedValue(ok);
    putValidation('k', a, bad);
    await checkValidation('k', a);
    expect(spy).not.toHaveBeenCalled();
    expect(viewOf(getValidation('k'), json(a)).report).toBe(bad);
  });
});
