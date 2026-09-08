# G07 neutral advanced authoring leaf

The implementation is in `editor-shell/src/advanced-authoring`. It consumes the public Plugin SDK types and owns only controlled presentation, field parsing, hierarchy paging, temporary gestures and DOM lifetimes. The host supplies immutable projections of its existing Selection, Document and History. There is no new History, Selection, product store, Engine World, renderer or AI dependency.

`index.ts` proposes `ADVANCED_AUTHORING_API_VERSION = 1`, `parseAdvancedAuthoringView`, presentation types and `mountAdvancedAuthoring(options, signal)`. Mount uses a real dynamic import. The returned facade supports update, reveal, cancel and idempotent dispose. Abort releases the mounted panel. No shared export, package manifest or candidate is changed by this leaf goal.

Hierarchy supports all supplied items through search, ancestor expansion and 50-row pages (maximum 10,000 supplied items). Inspector supports registered scalar/enum/JSON fields, enable/remove/add intents, 10 sections per page and 50 fields per section page. Unknown versions are rejected. Runtime fields are read-only; old runs/revisions stay visibly historical. All project strings use textContent/value.

Transform uses degrees with Y * X * Z composition, local/world translation and rotation, local scaling, active/center pivot, axis/uniform controls and snapping. Parent transforms and selected ancestors are accounted for. Rotation under a nonuniform/sheared parent in world space is rejected when it cannot be represented faithfully; local rotation remains available. Scaling is explicitly local. The center translation handle edits world XY and uniform scale is available in scale mode. A gesture emits one transform intent; previews and cancellation never write the Document.

The host provides a viewport projection at the active/center pivot in CSS pixels. `axes` contains projected world directions at equal world lengths; local handle directions are derived from the active transform. `unitsPerPixel` sets translation sensitivity. Preview is display-only and null restores the authoritative viewport; the host must refresh projection on camera/viewport/selection changes. Bounds, camera framing and the actual renderer remain host-owned. The host must not feed drag previews back as authoritative Document snapshots.

Run from Editor:

```powershell
node editor-shell/test/advanced-authoring/verify.mjs --projection-file D:\HaiyueStudio\AIStudio\apps\ai-studio\test\advanced-editor\test-output\studio-view.json
```

The optional projection argument reads a generated JSON fixture only. It does not import AIStudio code or emulate a public package installation. Checks cover the real Electron panel with native pointer/keyboard input, Chromium accessibility tree, desktop/narrow screenshots, 1000 items, shared SDK Selection/History, cancellation, retry, repeated disposal and viewport failure. Math tests cover parent transforms, local axes, snapping, center pivot and stale gestures. Existing Shell/Platform tests, repository boundaries, public API and compatibility checks also run. `test-output/checks.json` binds the sources, test files, package manifests and lockfile; it is historical evidence, not a claim of production integration.

G09 must add a reviewed public subpath such as `@haiyue/editor-shell/advanced-authoring` and a scoped CSS export, publish/review the declaration and bundle closure, build a candidate with a new recorded provenance, install it with exact lock integrity in AIStudio and wire the product mount. CSS currently lives beside the leaf source and must be copied/exported in that build. Root `test` currently matches only top-level tests; G09 must add the leaf gate to the shared test command.
