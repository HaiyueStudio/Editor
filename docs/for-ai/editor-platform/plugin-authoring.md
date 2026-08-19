# Plugin authoring

Define trusted build-time plugins with `defineEditorPlugin()` from `@haiyue/editor-plugin-sdk`. A manifest has a stable
ID, API version, declared required/optional/provided capabilities, conflicts, and one activation function. Register
services and contributions only through the activation context so the plugin scope owns their cleanup.

Required capability absence, dependency cycles, capability conflicts, and activation exceptions fail closed. Optional
capability failure is diagnostic-only. Lazy plugins belong in the product manifest and are loaded through
`EditorLazyPluginLoader`; a failed chunk can be retried without poisoning the rest of the Shell.

Contributions are presentation or routing descriptors (`panel`, `menu`, `toolbar`, `shortcut`, `inspector`, `importer`,
`exporter`, `viewport`, `diagnostics`). They are not a product state store. Keep domain mutations behind the product's
Document/History/Task adapter and return an idempotent disposer for listeners, timers, Workers, object URLs, and GPU
owners.

Remote URL plugins, runtime marketplaces, iframe isolation, model providers, Agent loops, and AI tools are outside this
repository. Future AIStudio integration may consume the public SDK but Editor must never import AIStudio.
