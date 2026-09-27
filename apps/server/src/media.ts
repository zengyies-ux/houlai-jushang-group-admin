import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parsed, Problem, now } from './http';

type Image = { id: string; mime: string; bytes: Buffer };
const imageInput = z.object({ image: z.string().min(30).max(11_000_000) });
const isImage = (mime: string, bytes: Buffer) => {
  if (mime === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (mime === 'image/webp')
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
};
const decode = (source: string, limit: number) => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match) throw new Problem(400, '仅支持 PNG、JPEG 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > limit)
    throw new Problem(400, `图片大小不能超过 ${Math.round(limit / 1024 / 1024)} MB`);
  if (!isImage(match[1], bytes)) throw new Problem(400, '图片内容与格式不匹配');
  return { mime: match[1], bytes };
};

export function registerMedia(app: FastifyInstance, db: Database.Database) {
  const backgroundId = () =>
    (
      db.prepare("SELECT value FROM settings WHERE key='background_media_id'").get() as
        { value: string } | undefined
    )?.value || null;
  app.get('/api/appearance', async () => ({ backgroundMediaId: backgroundId() }));
  app.put('/api/appearance/background', { bodyLimit: 11 * 1024 * 1024 }, async (req, reply) => {
    const input = parsed(imageInput, req.body, reply);
    if (!input) return;
    const image = decode(input.image, 6 * 1024 * 1024);
    const id = randomUUID();
    db.transaction(() => {
      const old = backgroundId();
      db.prepare('INSERT INTO media (id,kind,mime,bytes,created_at) VALUES (?,?,?,?,?)').run(
        id,
        'background',
        image.mime,
        image.bytes,
        now(),
      );
      db.prepare(
        "INSERT INTO settings (key,value) VALUES ('background_media_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(id);
      if (old) db.prepare('DELETE FROM media WHERE id=?').run(old);
    })();
    return { backgroundMediaId: id };
  });
  app.delete('/api/appearance/background', async () => {
    db.transaction(() => {
      const old = backgroundId();
      db.prepare("DELETE FROM settings WHERE key='background_media_id'").run();
      if (old) db.prepare('DELETE FROM media WHERE id=?').run(old);
    })();
    return { backgroundMediaId: null };
  });
  app.put<{ Params: { id: string } }>(
    '/api/members/:id/avatar',
    { bodyLimit: 4 * 1024 * 1024 },
    async (req, reply) => {
      const input = parsed(imageInput, req.body, reply);
      if (!input) return;
      const image = decode(input.image, 2 * 1024 * 1024);
      let id = '';
      db.transaction(() => {
        const member = db.prepare('SELECT avatar_id FROM members WHERE id=?').get(req.params.id) as
          { avatar_id: string | null } | undefined;
        if (!member) throw new Problem(404, '成员不存在');
        id = randomUUID();
        db.prepare('INSERT INTO media (id,kind,mime,bytes,created_at) VALUES (?,?,?,?,?)').run(
          id,
          'avatar',
          image.mime,
          image.bytes,
          now(),
        );
        db.prepare('UPDATE members SET avatar_id=?,updated_at=? WHERE id=?').run(
          id,
          now(),
          req.params.id,
        );
        if (member.avatar_id) db.prepare('DELETE FROM media WHERE id=?').run(member.avatar_id);
      })();
      return { avatarId: id };
    },
  );
  app.delete<{ Params: { id: string } }>('/api/members/:id/avatar', async (req) => {
    db.transaction(() => {
      const member = db.prepare('SELECT avatar_id FROM members WHERE id=?').get(req.params.id) as
        { avatar_id: string | null } | undefined;
      if (!member) throw new Problem(404, '成员不存在');
      db.prepare('UPDATE members SET avatar_id=NULL,updated_at=? WHERE id=?').run(
        now(),
        req.params.id,
      );
      if (member.avatar_id) db.prepare('DELETE FROM media WHERE id=?').run(member.avatar_id);
    })();
    return { avatarId: null };
  });
  app.get<{ Params: { id: string } }>('/api/media/:id', async (req, reply) => {
    const image = db
      .prepare('SELECT id,kind,mime,bytes FROM media WHERE id=?')
      .get(req.params.id) as Image | undefined;
    if (!image) throw new Problem(404, '图片不存在');
    return reply
      .header('content-type', image.mime)
      .header('cache-control', 'private, no-store')
      .send(image.bytes);
  });
}
