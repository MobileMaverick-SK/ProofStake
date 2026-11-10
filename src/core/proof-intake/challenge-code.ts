/** No 0/O, 1/I/L: the code has to survive being handwritten and photographed. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CHALLENGE_CODE_LENGTH = 6;

export type CodeGenerator = () => string;

export const randomChallengeCode: CodeGenerator = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(CHALLENGE_CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
};
