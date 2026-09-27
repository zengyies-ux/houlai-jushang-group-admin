import type { FastifyReply } from 'fastify';
import { z } from 'zod';
export const date = z.iso.date();
export function parsed<T>(
  schema: z.ZodType<T>,
  input: unknown,
  reply: FastifyReply,
): T | undefined {
  const p = schema.safeParse(input);
  if (!p.success) {
    reply.code(400).send({ error: '输入无效', details: z.flattenError(p.error) });
    return;
  }
  return p.data;
}
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireRow<T>(row: T | undefined, label = '记录'): T {
  if (!row) throw new Problem(404, `${label}不存在`);
  return row;
}
export function now() {
  return new Date().toISOString();
}
