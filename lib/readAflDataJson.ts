import fs from 'fs';

export type ReadAflDataJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'missing' | 'corrupt' | 'parse' };

/** Read a committed AFL data JSON file; detect stash-pop conflict markers before parse. */
export function readAflDataJsonFile<T>(filePath: string): ReadAflDataJsonResult<T> {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.includes('<<<<<<< ')) return { ok: false, reason: 'corrupt' };
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return { ok: false, reason: 'parse' };
  }
}
