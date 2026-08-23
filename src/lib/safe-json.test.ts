/** @jest-environment node */

import { readErrorMessage, serializeForInlineScript } from './safe-json';

describe('serializeForInlineScript', () => {
  it('escapes script-closing input without changing parsed data', () => {
    const input = { value: '</script><script>alert(1)</script>' };
    const serialized = serializeForInlineScript(input);

    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual(input);
  });

  it('escapes JavaScript line separator characters', () => {
    const serialized = serializeForInlineScript({ value: '\u2028\u2029' });

    expect(serialized).toContain('\\u2028');
    expect(serialized).toContain('\\u2029');
  });
});

describe('readErrorMessage', () => {
  it('prefers JSON error text even on 401', async () => {
    const response = new Response(JSON.stringify({ error: '權限不足' }), {
      status: 401,
    });
    await expect(readErrorMessage(response)).resolves.toBe('權限不足');
  });

  it('falls back to login-expired copy for plain Unauthorized', async () => {
    const response = new Response('Unauthorized', { status: 401 });
    await expect(readErrorMessage(response)).resolves.toBe(
      '登入已過期，請重新登入'
    );
  });
});
