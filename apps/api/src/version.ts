import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The repo-wide version, stamped into this package.json by `pnpm release`. */
export const APP_VERSION: string = (
  JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
