import { describe, expect, it } from 'vitest';
import {
  buildNewTargetEndpoint,
  findCdpTarget,
  normalizeLoginProbe,
  selectCdpTarget
} from '../src/cdp.js';

describe('CDP target selection', () => {
  it('selects the logged-in Semir cloud drive tab by URL prefix', () => {
    const target = selectCdpTarget([
      { id: 'other', type: 'page', title: 'Other', url: 'https://example.com', webSocketDebuggerUrl: 'ws://other' },
      { id: 'semir', type: 'page', title: '森马云盘', url: 'https://fmp.semirapp.com/web/index#/home/file/mount/2023', webSocketDebuggerUrl: 'ws://semir' }
    ], 'https://fmp.semirapp.com');

    expect(target.id).toBe('semir');
  });

  it('throws a helpful error when no page matches', () => {
    expect(() => selectCdpTarget([], 'https://fmp.semirapp.com')).toThrow(/No Chrome tab/);
  });

  it('can report no matching target so callers may open the login page', () => {
    expect(findCdpTarget([], 'https://fmp.semirapp.com')).toBeNull();
  });

  it('builds the Chrome /json/new endpoint for opening Semir in the 9222 browser', () => {
    expect(buildNewTargetEndpoint('http://127.0.0.1:9222/', 'https://fmp.semirapp.com/web/index#/home/file')).toBe(
      'http://127.0.0.1:9222/json/new?https%3A%2F%2Ffmp.semirapp.com%2Fweb%2Findex%23%2Fhome%2Ffile'
    );
  });

  it('normalizes account/mount login probe responses without exposing cookies', () => {
    expect(normalizeLoginProbe({ status: 200, ok: true, json: { list: [{ mount_id: 2023 }] }, href: 'https://fmp.semirapp.com/web/index#/home/file' })).toMatchObject({
      loggedIn: true,
      status: 200
    });
    expect(normalizeLoginProbe({ status: 401, ok: false, text: '请先登录', href: 'https://fmp.semirapp.com/login' })).toMatchObject({
      loggedIn: false,
      onLoginPage: true
    });
  });
});
