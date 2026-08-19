# Editor Platform guide

`@haiyue/editor-platform` is the single non-visual kernel used by all three editor products. It owns plugin lifecycle,
typed services and contributions, active documents, the command history stack, stable selection references, latest-wins
tasks, and project-session metadata. It does not import DOM, WebGPU, Engine, UI, or any product model.

Create one `EditorPlatform` per application window, start it with exactly one product manifest, and dispose it on the
window lifecycle boundary. Product code must not create a second authoritative history, task coordinator, or project
session. A legacy product class may remain only as a thin API adapter around the platform instance.

Mutating asynchronous work follows `prepare → synchronous commit → rollback`. `prepare` receives an `AbortSignal`, may
run in a Worker, and must not mutate shared document state. `commit` validates the base revision and completes within one
synchronous transaction. Superseded or disposed work cannot commit.

Every registration and long-lived resource has one owner. Plugin activation is transactional; failed activation rolls
back its scope, and successful plugins dispose in reverse activation order. Optional plugin failures surface structured,
capability-local diagnostics and do not disable unrelated editing.
