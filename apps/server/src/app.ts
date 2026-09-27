import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { registerTeam } from './team';
import { Problem } from './http';
import { registerTasks } from './tasks';
import { registerViews } from './views';
import { registerAuth } from './auth';
import { registerMaintenance } from './maintenance';
import { registerMedia } from './media';

export function createApp(
  db: Database.Database,
  webDir = join(process.cwd(), 'dist/web'),
  switchDatabase?: (next: Database.Database) => void,
) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof Problem) return reply.code(error.status).send({ error: error.message });
    console.error(error);
    return reply.code(500).send({ error: '服务器处理失败' });
  });
  registerAuth(app, db);
  const maintenance = registerMaintenance(app, db, switchDatabase);
  app.decorate('maintenance', maintenance);
  app.get('/api/health', async () => ({ ok: true, version: '0.3.2', schemaVersion: 5 }));
  registerTeam(app, db);
  registerMedia(app, db);
  registerTasks(app, db);
  registerViews(app, db);
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在' });
    if (existsSync(join(webDir, 'index.html')))
      return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: '页面未构建' });
  });
  if (existsSync(webDir)) app.register(fastifyStatic, { root: webDir, prefix: '/' });
  return app;
}
