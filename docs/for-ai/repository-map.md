# Editor repository map

| Directory | Owner |
| --- | --- |
| `editor-plugin-sdk/` | Stable plugin, product, contribution and adapter contracts |
| `editor-platform/` | DOM-free lifecycle, registries, document, history, selection and task kernel |
| `editor-shell/` | Browser contribution hosts, shortcut routing and controlled history UI adapter |
| `editor-app-kit/` | Versioned app descriptors and shared Web/PWA/Electron artifact assembly |
| `editor/` | Scene Editor domain and Engine adapters |
| `AnimationEditor/` | HYA project/compiler/preview domain |
| `voxelEditor/` | Voxel document, projection, import/export and renderer domain |

Dependencies flow from products to the four foundation packages. The foundation packages never import product source.
The repository is AI-neutral: AIStudio consumes the public Plugin SDK later; Editor does not contain providers, Agent loops,
sessions, tools, chat UI, or DeepSeek Harness code.
