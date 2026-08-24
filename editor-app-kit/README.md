# @haiyue/editor-app-kit

Versioned descriptors and shared deterministic Web/PWA/Electron assembly for HaiyueStudio editor products.

Products that set `electron.unsavedCloseProtection` receive a sandboxed preload bridge and a native
Save and Close / Don't Save / Cancel dialog. The renderer publishes only document identity and dirty state and
handles save requests; raw Electron APIs are never exposed to product code.
