# HaiYue Voxel Editor

## Web / PWA

```bash
npm run build:pwa -w ./voxelEditor
npm run preview:pwa -w ./voxelEditor
```

The installable application is assembled in `voxelEditor/app-dist`. The preview server listens on
`http://localhost:4174`; install it from the browser's application menu. The generated Service Worker
precaches the editor shell, WebGPU runtime chunks, import/export workers, and icons. Project snapshots
continue to use IndexedDB and remain available offline.

Set `VOXEL_EDITOR_PWA_PORT` to use a different preview port.

## Electron

```bash
# Run the desktop editor from the shared app build.
npm run electron:start -w ./voxelEditor

# Create an unpacked application for the current platform.
npm run electron:pack -w ./voxelEditor

# Create installers for the current platform.
npm run electron:dist -w ./voxelEditor
```

Desktop artifacts are written to `voxelEditor/release-electron`. The builder configuration declares
DMG/ZIP targets for macOS, NSIS/portable targets for Windows, and AppImage/DEB targets for Linux.
Signing and notarization credentials are intentionally not stored in the repository and must be
provided by the release environment.

The Electron renderer runs with Node integration disabled, context isolation and Chromium sandboxing
enabled, and external navigation blocked from the editor window.
