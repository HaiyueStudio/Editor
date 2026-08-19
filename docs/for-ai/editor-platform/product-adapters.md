# Product adapters

Each product has a static product manifest and keeps its own authoritative model:

| Product | Manifest | Document adapter | Domain model |
| --- | --- | --- | --- |
| Scene | `editor/src/platform/sceneProductManifest.ts` | `sceneEditorPlatform.ts` | ECS `World`, resources, `EditorStore` |
| Animation | `AnimationEditor/src/platform/animationEditorProductManifest.ts` | `animationEditorPlatform.ts` | immutable HYA authoring project |
| Voxel | `voxelEditor/src/platform/voxelEditorProductManifest.ts` | `voxelEditorPlatform.ts` | transactional `VoxelDocument` |

An adapter exposes stable identity, revision/saved revision, serialization, save notification, immutable selection
references, and revision-checked prepare/commit. It must not normalize one product into another or expose live product
objects through the Plugin SDK. Scene commands, HYA project mutations, and Voxel transactions remain opaque history
commands.

The Scene `CommandBus`, HYA `CommandHistory`, HYA `DesignerTaskCoordinator`, and Voxel `CommandHistory` retain their old
product-facing APIs only as thin adapters. Their stacks and task ownership are the platform services, which preserves
existing tests and keyboard/UI call sites while eliminating parallel mechanisms.
