# Web, PWA, and Electron distribution

All products use `@haiyue/editor-app-kit` and an `app/descriptor.json`. The descriptor is the only product-owned source
for application identity, entries, static assets, Workers, PWA theme/icons, Electron window policy, storage/cache
namespace, support tier, and artifact budgets.

The common commands are:

```bash
npm run build:app -w ./editor
npm run build:pwa -w ./AnimationEditor
npm run preview:pwa -w ./voxelEditor
npm run electron:pack -w ./editor
npm run electron:smoke -w ./editor
npm run app:check -w ./editor
npm run test:pwa
```

Assembly removes the old output, copies production files without source maps/tests/source, writes a base-relative PWA
manifest and complete deterministic Service Worker, records SHA-256/raw/gzip evidence, and then copies the validated PWA
tree byte-for-byte as the Electron renderer. Electron uses one generated bootstrap with context isolation, sandboxing,
web security, and Node integration disabled. The clean checkout contains no generated app tree or generated Electron
bootstrap; every Electron command builds it first.

`npm run release:artifact:check` validates descriptor identity isolation. `npm run check:apps` validates built hashes,
PWA URLs, renderer equality, and Electron policy. Packaging is unsigned; code signing, notarization, stores, and automatic
updates remain outside M03.

`npm run test:pwa` mounts every assembled product below a nested base path in Chrome, waits for Service Worker control,
then forces the browser offline and reloads the application. After `electron:pack`, `electron:smoke` starts the packaged
Windows executable with a hidden window and succeeds only after the renderer emits `did-finish-load`. The shared pack
runner creates a unique ignored candidate directory on every invocation, records it in `.electron-candidate.json`, and
on Windows reuses the installed runtime through Electron Builder's `electronDist` input. This avoids overwriting an
earlier `app.asar` while it is temporarily held by system scanning and does not change the product descriptor.
