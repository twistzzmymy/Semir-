import { describe, expect, it } from 'vitest';
import { listCapabilities, runCapability } from '../src/capabilities.js';

describe('capability registry', () => {
  it('lists atomic capabilities for agent composition', () => {
    const names = listCapabilities().map((capability) => capability.name);

    expect(names).toEqual(expect.arrayContaining([
      'session.probe',
      'path.parse',
      'codes.normalize',
      'mount.resolve',
      'files.search',
      'files.info',
      'urls.download',
      'downloads.plan-images',
      'shenhui.classify-asset',
      'shenhui.plan-package'
    ]));
  });

  it('runs pure capabilities without a browser client', async () => {
    await expect(runCapability('path.parse', {
      cloudPath: '巴拉营运BU-商品//巴拉货控/02 产品上新模块/'
    })).resolves.toMatchObject({
      capability: 'path.parse',
      ok: true,
      data: {
        mountName: '巴拉营运BU-商品',
        relativePath: '巴拉货控/02 产品上新模块'
      }
    });

    await expect(runCapability('codes.normalize', {
      codes: '208226111002，208226111002-00316；208226111002'
    })).resolves.toMatchObject({
      ok: true,
      data: { codes: ['208226111002', '208226111002-00316'] }
    });
  });

  it('runs client-backed capabilities through the supplied context', async () => {
    const client = {
      async resolveMount(mountName: string) {
        return { mountId: 2023, mountName };
      }
    };

    await expect(runCapability('mount.resolve', { mountName: '巴拉营运BU-商品' }, { client })).resolves.toMatchObject({
      ok: true,
      data: { mountId: 2023, mountName: '巴拉营运BU-商品' }
    });
  });

  it('returns a structured unknown-capability result', async () => {
    await expect(runCapability('missing.capability', {})).resolves.toMatchObject({
      ok: false,
      capability: 'missing.capability',
      error: expect.stringMatching(/Unknown capability/)
    });
  });
});
