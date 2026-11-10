import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProofStore } from '../../core/proof-intake';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const URL_PREFIX = '/api/proofs/';
/** Names are generated here, never taken from the uploader, so a stored name cannot escape the folder. */
const SAFE_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export class LocalDiskProofStore implements ProofStore {
  constructor(private readonly directory: string) {}

  async save(file: Buffer, mimeType: string): Promise<{ url: string }> {
    const extension = EXTENSIONS[mimeType];
    if (!extension) throw new Error(`Unsupported proof type: ${mimeType}`);
    await mkdir(this.directory, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    await writeFile(join(/* turbopackIgnore: true */ this.directory, name), file);
    return { url: `${URL_PREFIX}${name}` };
  }

  /** Reads a stored photo back by the URL (or bare file name) that `save` returned. */
  async read(urlOrName: string): Promise<{ file: Buffer; mimeType: string } | null> {
    const name = urlOrName.startsWith(URL_PREFIX) ? urlOrName.slice(URL_PREFIX.length) : urlOrName;
    if (!SAFE_NAME.test(name)) return null;
    try {
      const file = await readFile(join(/* turbopackIgnore: true */ this.directory, name));
      return { file, mimeType: MIME_TYPES[name.split('.').pop()!]! };
    } catch {
      return null;
    }
  }
}
