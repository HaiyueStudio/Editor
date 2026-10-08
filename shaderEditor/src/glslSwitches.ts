import { TranslationError, type Token } from './glslPreprocessor.js';

export type SwitchScope = { prefix: string; declarations: string[]; names: Set<string> };
export type SwitchCase = { selectors: string[]; body: string[]; stops: boolean; hasStatement: boolean };

/** WGSL has no implicit fallthrough. Copy only the reachable suffix into each
 * entry, keeping native switch/loop control targets and function returns.
 * Declarations shared by GLSL labels live in an enclosing, renamed scope;
 * their initializers remain at the original execution site in these bodies.
 */
export function lowerSwitch(token: Token, selector: string, cases: SwitchCase[], scope: SwitchScope): string {
  const groups: SwitchCase[] = [];
  for (const branch of cases) {
    const previous = groups.at(-1);
    // Adjacent labels (including labels separated by empty statements) share
    // one WGSL clause, avoiding needless copies for large groups of aliases.
    if (previous && !previous.body.length) previous.selectors.push(...branch.selectors), Object.assign(previous, { body: branch.body, stops: branch.stops });
    else groups.push({ ...branch, selectors: [...branch.selectors] });
  }
  const clauses: string[] = [];
  let size = 0;
  for (let i = 0; i < groups.length; i++) {
    const body: string[] = [];
    for (let j = i; j < groups.length; j++) {
      const branch = groups[j]!;
      for (const statement of branch.body) {
        size += statement.length;
        if (size > 100_000) throw new TranslationError(token, 'switch 连续贯穿分支展开后超过 100 KB，请将重复逻辑提取为辅助函数或增加 break。');
        body.push(statement);
      }
      if (branch.stops) break;
    }
    const labels = groups[i]!.selectors;
    const label = labels.length === 1 && labels[0] === 'default' ? 'default' : `case ${labels.join(', ')}`;
    clauses.push(`${label}: {\n${body.join('\n')}\n}`);
  }
  if (!cases.some(branch => branch.selectors.includes('default'))) clauses.push('default: {}');
  const statement = `switch (${selector}) {\n${clauses.join('\n')}\n}`;
  return scope.declarations.length ? `{\n${scope.declarations.join('\n')}\n${statement}\n}` : statement;
}
