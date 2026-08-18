# Animation Editor instructions

## Product contract

- `PROJECT_FORMAT.md` and `schema/project.schema.json` define the authoring contract. The editor, compiler, exact preview, persistence, and delivery packager must consume the same model.
- Do not duplicate HYA validation, binary encoding, runtime state-machine semantics, or animation playback logic. Use `animation-spec` and `extensions` public contracts.
- Authoring state changes go through domain operations that can be validated, undone/redone, and marked dirty consistently. A failed multi-step edit must restore the complete previous project state.
- Keep domain/compiler/persistence logic testable without DOM. UI/inspector code adapts user input to domain commands rather than mutating document objects directly.

## Preview, assets, and export

- Browser preview must run the freshly compiled HYA through the real runtime. Do not maintain a visually similar editor-only playback implementation.
- Asset replacement and project close abort pending reads/loads and release object URLs, handles, listeners, and preview bindings.
- Delivery export is deterministic: stable ordering/timestamps, traversal-safe paths, bounded sizes, hashes, and no implicit network fetch for external dependencies.
- An export works from a detached snapshot and must not modify the editable project, save baseline, selection, or preview state.
- Format/compiler changes update the project schema, normative documentation, fixture, migrations/error paths, and contract verifier atomically.

## Validation

```bash
npm run typecheck -w ./AnimationEditor
npm test -w ./AnimationEditor
npm run build -w ./AnimationEditor
npm run test:browser -w ./AnimationEditor
```

- Run browser verification for preview, asset, or shell lifecycle changes; unit-only coverage is insufficient for object URL, WebGPU, and disposal behavior.

