# Voxel Editor instructions

## Document and transaction model

- `src/document/**` owns normalized project state, aggregate state, dirty policy, projections, and transactions. Controllers orchestrate user intent; they must not create a second mutable document model.
- Multi-step mutations are transactional. Validation, command, persistence, worker, or render-projection failures restore the exact prior aggregate, selection, history, dirty state, and derived caches.
- Undo/redo and load/import start from normalized document snapshots. Do not patch serialized input directly into live runtime objects.
- Keep renderer/projection caches derived and invalidated by explicit revisions. A render failure must not commit document state.

## Workers, exports, and products

- Import/export workers exchange versioned plain data and transferables, support abort/dispose, and cannot mutate editor state after a newer generation or teardown.
- Preserve deterministic VOX/glTF/sprite export and bounded input/output validation. Do not silently drop unsupported scene/module data.
- Web/PWA and Electron consume the same app build and document behavior. Platform adapters may differ, but domain semantics cannot fork.
- Large orchestrators should delegate to the existing document/controller/render/persistence responsibilities; do not grow `main.ts` with new domain logic.

## Validation

```bash
npm run typecheck -w ./voxelEditor
npm test -w ./voxelEditor
npm run build -w ./voxelEditor
```

- Viewport/lifecycle changes also run `npm run test:browser -w ./voxelEditor`; distribution changes include the PWA/app build relevant to the task.

