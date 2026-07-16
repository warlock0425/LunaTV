import { serializeForInlineScript } from './safe-json';

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
