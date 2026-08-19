# Shared mechanism and domain adapter matrix

| Concern | Shared owner | Scene adapter | HYA adapter | Voxel adapter |
| --- | --- | --- | --- | --- |
| Plugin lifecycle/services/contributions | editor-platform | Engine/Scene resource owners | compiler/preview owners | Worker/renderer owners |
| History stack/group/budget | editor-platform | Scene `Command` | HYA command payload | Voxel transactional command |
| Document identity/revision/dirty | editor-platform | scene serialization | HYA project snapshot | VoxelDocument JSON |
| Selection references | editor-platform | entity/resource resolver | layer/item resolver | voxel/module/material resolver |
| Latest-wins tasks | editor-platform | import/export/preview | compile/package/preview | import/export/projection |
| Browser hosts and shortcuts | editor-shell | Scene contributions | HYA contributions | Voxel contributions |
| Artifact assembly | editor-app-kit | Scene descriptor | HYA descriptor | Voxel descriptor |

Scene, HYA and Voxel models, command payloads, serialization formats and projections are intentionally not unified.
