# Cross-repository dependency compatibility

Editor consumes Engine and UI only through public packages in the `>=0.1.0 <0.2.0` compatibility line. The lockfile is
the application resolution. Cross-repository relative imports, `file:` dependencies, floating Git references, and direct
package `src/` imports are rejected by `npm run check:boundaries`.

The compatibility matrix has three lanes:

- minimum allowed: the released `0.1.0` Engine/UI family;
- latest allowed: the highest registry versions below `0.2.0`;
- packed producer candidate: tarballs built by the sibling Engine/UI repositories before publication.

Producer additions are published or packed first, consumers migrate and pass their typecheck/test/build gates second,
and removal waits for the next breaking minor line. Internal Editor foundation dependencies are exact coordinated
`0.1.x` versions; the four foundation packages are published before any external consumer such as AIStudio.

Use `npm run compatibility:minimum` after `npm ci` for the lower bound. The latest lane installs the registry versions
selected by `>=0.1.0 <0.2.0` without changing the lockfile and runs `compatibility:check`, typecheck, and tests. The packed
lane runs `pack:candidates` in Engine and `pack:candidate` in UI, installs the resulting tarballs with
`--no-save --package-lock=false`, runs the same consumer gates, and finally restores the repository with `npm ci`.
