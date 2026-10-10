/** Original GLSL source locations shared by preprocessing and translation. */
export type Token = { value: string; line: number; column: number };
export class TranslationError extends Error {
  constructor(readonly token: Token, message: string) { super(message); }
}
