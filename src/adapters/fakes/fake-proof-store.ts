import type { ProofStore } from '../../core/proof-intake';

export class FakeProofStore implements ProofStore {
  readonly files = new Map<string, { file: Buffer; mimeType: string }>();

  async save(file: Buffer, mimeType: string) {
    const url = `memory://proof/${this.files.size + 1}`;
    this.files.set(url, { file, mimeType });
    return { url };
  }
}
