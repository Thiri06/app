import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '..', '.env'),
  path.resolve(sourceDir, '..', '..', '..', '.env'),
];

for (const file of candidates) {
  if (existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}

export const dataDir = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.resolve(sourceDir, '..', '..', '..', '.data');
