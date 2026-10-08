export interface TutorialCodeLine { kind: 'same' | 'added' | 'removed'; text: string }
/** Line diff between complete runnable examples, preserving source order. */
export function tutorialDiff(before: string, after: string): TutorialCodeLine[] {
  const a = before ? before.replaceAll('\r\n','\n').split('\n') : [];
  const b = after ? after.replaceAll('\r\n','\n').split('\n') : [];
  const table = Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for (let i=a.length-1;i>=0;i--) for (let j=b.length-1;j>=0;j--)
    table[i]![j] = a[i]===b[j] ? table[i+1]![j+1]!+1 : Math.max(table[i+1]![j]!,table[i]![j+1]!);
  const lines: TutorialCodeLine[] = [];
  let i=0,j=0;
  while (i<a.length || j<b.length) {
    if (i<a.length && j<b.length && a[i]===b[j]) { lines.push({kind:'same',text:a[i++]!}); j++; }
    else if (i<a.length && (j===b.length || table[i+1]![j]!>=table[i]![j+1]!)) lines.push({kind:'removed',text:a[i++]!});
    else lines.push({kind:'added',text:b[j++]!});
  }
  return lines;
}
