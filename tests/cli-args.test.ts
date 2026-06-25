import { describe, expect, it } from 'vitest';
import { extractActionArgs } from '../src/cli-args.js';

describe('Commander action argument extraction', () => {
  it('keeps variadic positional values and drops option/command objects', () => {
    const command = { optsWithGlobals: () => ({}) };

    expect(extractActionArgs([['208226111002'], { codes: '208326133201' }, command])).toEqual(['208226111002']);
  });

  it('keeps normal positional values', () => {
    const command = { optsWithGlobals: () => ({}) };

    expect(extractActionArgs(['208326133201', { limit: '5' }, command])).toEqual(['208326133201']);
  });
});
