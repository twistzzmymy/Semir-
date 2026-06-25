import { describe, expect, it } from 'vitest';
import { parseCapabilityInput } from '../src/run-input.js';

describe('capability JSON input protocol', () => {
  it('parses inline JSON object input', () => {
    expect(parseCapabilityInput('{"cloudPath":"巴拉营运BU-商品//巴拉货控"}')).toEqual({
      cloudPath: '巴拉营运BU-商品//巴拉货控'
    });
  });

  it('accepts empty input as an empty object', () => {
    expect(parseCapabilityInput('')).toEqual({});
  });

  it('rejects non-object JSON for capability input', () => {
    expect(() => parseCapabilityInput('"bad"')).toThrow(/must be a JSON object/);
  });
});
