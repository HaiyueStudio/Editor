# ADR 0001: Fixed non-AI editor platform kernel

- Status: Accepted
- Date: 2026-08-19

## Decision

HaiyueStudio Editor uses four public `0.1.x` foundation packages: `@haiyue/editor-plugin-sdk`,
`@haiyue/editor-platform`, `@haiyue/editor-shell`, and `@haiyue/editor-app-kit`. The platform kernel owns lifecycle,
services, contributions, document routing, history, selection references and cancellable tasks. Products keep their Scene,
HYA and Voxel models behind typed adapters and static product manifests.

Plugins are trusted build-time modules. Activation is transactional, resources are scope-owned and disposed in reverse
order, dependencies are explicit, and optional failures produce structured diagnostics without blocking unrelated features.
There is no universal product Store or cross-plugin string EventBus.

Editor is deliberately unaware of AI. Model providers, Agent loops/sessions/tools, chat surfaces and DeepSeek Harness belong
to the future AIStudio repository, which may consume only these public contracts.

Cross-repository Engine/UI dependencies use `>=0.1.0 <0.2.0`; repository workspaces use coordinated `0.1.x` versions.
Relative cross-workspace source imports and local-path publish dependencies are forbidden by the repository boundary gate.
