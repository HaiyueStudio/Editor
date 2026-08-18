# Scene Editor instructions

## Architecture

- Preserve the domain/infra boundary from ADR 0011. `src/domain/**` cannot depend on DOM globals, storage globals, custom elements, or `src/infra/**`.
- `EditorStore` composes state slices and exposes snapshots, selectors, commands, and typed events. UI must not mutate store internals or maintain a second selection/runtime source of truth.
- Engine/world/runtime attach and clear as one owned context. Engine-specific and experimental imports belong behind `engine-adapter` or a similarly explicit adapter boundary.
- Core open/save/import/preview/export flows go through `CoreWorkflowCoordinator` with status, AbortSignal, rollback, and structured errors.
- Optional capabilities use the manifest and lazy contribution loader. A failing optional renderer/capability degrades only that feature and cannot block editor startup.

## Startup, bundle, and lifecycle

- Keep non-first-frame serialization, debug, shadow, physics, exporters, codecs, and script tooling out of the startup closure unless proven necessary.
- Preserve real dynamic imports; do not satisfy a boundary test with a wrapper that statically pulls optional runtime code into `player-core`.
- Resource replacement, play/restart/stop, document close, and app teardown must release listeners, timers, workers, blob URLs, scenes, GPU owners, and stale async results.
- Changes to player/runtime export/ResourcePool/orchestrators follow responsibility ownership gates and must not move extracted responsibilities back into facades.
- Bundle budgets are constraints, not baselines to raise casually. Explain gzip and cold-start impact for any capability that grows its closure.

## Validation

```bash
npm run typecheck -w ./editor
npm test -w ./editor
npm run build -w ./editor
npm run bundle:check -w ./editor
npm run editor-architecture:check
npm run responsibilities:check
```

- Workflow changes run `npm run verify:editor-e2e`.
- Startup/lazy-loading changes include optional-capability and cold-start tests; large-scene or retention changes include the relevant memory/performance verifier.

