import { describe, expect, it } from 'vitest';
import { SemirYunpanClient } from '../src/client.js';
import type { PageFetcher } from '../src/client.js';

describe('SemirYunpanClient', () => {
  it('lists folders through the observed file ls endpoint', async () => {
    const calls: Array<{ path: string; init: unknown }> = [];
    const fetcher: PageFetcher = async (path, init) => {
      calls.push({ path, init });
      return {
        count: 1,
        list: [{ id: '1', mount_id: '2023', dir: '1', fullpath: '巴拉货控', filename: '巴拉货控' }]
      };
    };
    const client = new SemirYunpanClient(fetcher);

    const result = await client.list({ mountId: 2023, path: '', limit: 20 });

    expect(calls[0].path).toBe('/fengcloud/1/file/ls?order=filename+asc&size=20&start=0&fullpath=&mount_id=2023&current=1');
    expect(result.files[0]).toMatchObject({ mountId: 2023, isDir: true, fullpath: '巴拉货控' });
  });

  it('paginates search results until the requested limit is reached', async () => {
    const starts: number[] = [];
    const fetcher: PageFetcher = async (_path, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      starts.push(body.start);
      return {
        total: 3,
        count: 2,
        list: [
          { id: `row-${body.start}`, mount_id: '2023', dir: '0', filename: `${body.start}.jpg`, fullpath: `208326133201/${body.start}.jpg`, ext: 'jpg' },
          { id: `row-${body.start + 1}`, mount_id: '2023', dir: '0', filename: `${body.start + 1}.jpg`, fullpath: `208326133201/${body.start + 1}.jpg`, ext: 'jpg' }
        ]
      };
    };
    const client = new SemirYunpanClient(fetcher);

    const result = await client.search({ query: '208326133201', mountId: 2023, limit: 3, pageSize: 2 });

    expect(starts).toEqual([0, 2]);
    expect(result.total).toBe(3);
    expect(result.files.map((f) => f.id)).toEqual(['row-0', 'row-1', 'row-2']);
  });

  it('requests temporary URL fields without persisting secrets', async () => {
    const fetcher: PageFetcher = async () => ({
      mount_id: 2023,
      fullpath: 'a.jpg',
      filename: 'a.jpg',
      uri: 'https://signed-download.example/a.jpg'
    });
    const client = new SemirYunpanClient(fetcher);

    await expect(client.downloadUrl({ mountId: 2023, path: 'a.jpg' })).resolves.toBe('https://signed-download.example/a.jpg');
  });

  it('resolves a visible mount by exact normalized organization name', async () => {
    const fetcher: PageFetcher = async () => ({
      list: [
        { mount_id: '2023', org_name: '巴拉营运BU-商品' },
        { mount_id: '3283', org_name: '森马视觉' }
      ]
    });
    const client = new SemirYunpanClient(fetcher);

    await expect(client.resolveMount(' 森马视觉 ')).resolves.toEqual({ mountId: 3283, mountName: '森马视觉' });
  });
});
