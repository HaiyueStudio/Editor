# M03 migration baseline

Captured from the clean split repositories before platform migration on 2026-08-19.

| Product | Authoritative domain | Existing shared-like owners | Accepted pre-migration verification |
| --- | --- | --- | --- |
| Scene | ECS scene/resources and `EditorStore` slices | `CommandBus`, `CoreWorkflowCoordinator`, shortcut and plugin adapters | 99 tests, typecheck/build and bundle budget passed |
| HYA | `.hya-project.json`, compiler and exact runtime preview | `CommandHistory`, `DesignerTaskCoordinator`, project session | 107 tests and typecheck/build passed |
| Voxel | `VoxelDocument`, aggregate transaction and projections | `CommandHistory`, project session, PWA/Electron builder | 145 tests and typecheck/build passed |

Migration must not change any domain format or raise bundle/performance baselines. Common lifecycle/history/task/shell/app
mechanics move to foundation packages; domain normalization, compilation, projections, renderer and persistence adapters stay
with their products.
