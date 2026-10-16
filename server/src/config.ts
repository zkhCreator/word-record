import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const config = {
  port: Number(process.env.WR_PORT ?? 5178),
  host: process.env.WR_HOST ?? '127.0.0.1',
  dbPath: process.env.WR_DB ?? path.join(root, 'data', 'word-record.db'),
  webDist: path.join(root, 'web', 'dist'),
  magpie: {
    baseUrl: process.env.WR_MAGPIE_URL ?? 'http://127.0.0.1:3425/v1',
    model: process.env.WR_MODEL ?? 'claude/claude-haiku-5-5',
    apiKey: process.env.WR_MAGPIE_KEY ?? '',
    timeoutMs: Number(process.env.WR_MAGPIE_TIMEOUT ?? 45000),
  },
};
