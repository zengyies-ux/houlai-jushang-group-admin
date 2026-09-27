import type { FastifyInstance, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import { parsed, Problem, now } from './http';

export const isLocal = (req: FastifyRequest) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
const key = 'workbench_session';
export function registerAuth(app: FastifyInstance, db: Database.Database) {
  const attempts = new Map<string, { count: number; until: number }>();
  const get = (name: string) =>
    (
      db.prepare('SELECT value FROM settings WHERE key=?').get(name) as
        { value: string } | undefined
    )?.value;
  const set = (name: string, value: string) =>
    db
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(name, value);
  const addresses = () =>
    Object.values(networkInterfaces())
      .flatMap((xs) => xs || [])
      .filter((x) => x.family === 'IPv4' && !x.internal)
      .map((x) => x.address);
  const trustedHost = (host: string) => {
    try {
      const parsed = new URL(`http://${host}`);
      return ['localhost', '127.0.0.1', '[::1]', ...addresses()].includes(parsed.hostname);
    } catch {
      return false;
    }
  };
  const session = (req: FastifyRequest) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${key}=`))
      ?.slice(key.length + 1);
    if (!token) return false;
    const hash = createHash('sha256').update(token).digest('hex');
    return !!db
      .prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?')
      .get(hash, now());
  };
  app.addHook('onRequest', async (req, reply) => {
    if (!trustedHost(req.headers.host || ''))
      return reply.code(403).send({ error: '此访问地址未获准' });
    if (isLocal(req)) return;
    if (get('lan_enabled') !== '1' || !get('access_hash'))
      return reply.code(403).send({ error: '局域网访问尚未启用' });
    if (
      req.url.startsWith('/api/auth/') ||
      req.url === '/api/health' ||
      !req.url.startsWith('/api/')
    )
      return;
    if (!session(req)) return reply.code(401).send({ error: '请输入主机访问口令' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      try {
        if (!origin || new URL(origin).host !== req.headers.host)
          return reply.code(403).send({ error: '请求来源未获准' });
      } catch {
        return reply.code(403).send({ error: '请求来源未获准' });
      }
    }
  });
  app.get('/api/auth/status', async (req) => ({
    local: isLocal(req),
    authenticated: isLocal(req) || session(req),
    lanEnabled: get('lan_enabled') === '1',
    passwordSet: !!get('access_hash'),
    addresses: isLocal(req) ? addresses() : [],
  }));
  app.post('/api/auth/login', async (req, reply) => {
    const x = parsed(z.object({ password: z.string().min(1) }), req.body, reply);
    if (!x) return;
    const record = attempts.get(req.ip);
    if (record && record.until > Date.now() && record.count >= 5)
      return reply.code(429).send({ error: '尝试过多，请稍后再试' });
    const stored = get('access_hash');
    if (!stored) return reply.code(403).send({ error: '主机尚未设置口令' });
    const [salt, hash] = stored.split(':');
    const actual = scryptSync(x.password, salt, 32);
    const valid = hash && timingSafeEqual(actual, Buffer.from(hash, 'hex'));
    if (!valid) {
      attempts.set(req.ip, {
        count: (record && record.until > Date.now() ? record.count : 0) + 1,
        until: Date.now() + 15 * 60_000,
      });
      return reply.code(401).send({ error: '口令错误' });
    }
    attempts.delete(req.ip);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      createHash('sha256').update(token).digest('hex'),
      new Date(Date.now() + 24 * 3600_000).toISOString(),
      now(),
    );
    reply.header('set-cookie', `${key}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
    return { ok: true };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${key}=`))
      ?.slice(key.length + 1);
    if (token)
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(
        createHash('sha256').update(token).digest('hex'),
      );
    reply.header('set-cookie', `${key}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });
  app.put('/api/settings/access', async (req, reply) => {
    if (!isLocal(req)) throw new Problem(403, '请在主机本机操作');
    const x = parsed(
      z.object({ password: z.string().min(8).max(200), enableLan: z.boolean() }),
      req.body,
      reply,
    );
    if (!x) return;
    const salt = randomBytes(16).toString('hex');
    set('access_hash', `${salt}:${scryptSync(x.password, salt, 32).toString('hex')}`);
    set('lan_enabled', x.enableLan ? '1' : '0');
    db.prepare('DELETE FROM sessions').run();
    return { ok: true, restartRequired: true, addresses: addresses() };
  });
  app.get('/api/settings/access', async (req) => ({
    local: isLocal(req),
    lanEnabled: get('lan_enabled') === '1',
    passwordSet: !!get('access_hash'),
    addresses: isLocal(req) ? addresses() : [],
  }));
}
