import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db';
import { createApp } from './app';

describe('阶段 0：SQLite 与同源 API', () => {
  it('写入后重启保留记录，未知 API 不被页面兜底', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-test-'));
    try {
      let db = openDatabase(join(process.cwd(), 'drizzle'), dir);
      let app = createApp(db);
      const write = await app.inject({
        method: 'POST',
        url: '/api/groups',
        payload: { name: '测试小组' },
      });
      expect(write.statusCode).toBe(201);
      expect((await app.inject('/api/missing')).statusCode).toBe(404);
      await app.close();
      db.close();
      db = openDatabase(join(process.cwd(), 'drizzle'), dir);
      app = createApp(db);
      const read = await app.inject('/api/groups');
      expect(read.json()).toMatchObject([{ name: '测试小组' }]);
      await app.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
