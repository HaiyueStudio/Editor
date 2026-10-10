# HaiyueStudio Editor

Non-AI editor platform and products. This repository currently contains the Scene Editor, HYA Animation
Editor, and Voxel Editor; Milestone 3 will converge them on a headless platform, browser shell, Plugin SDK,
and shared app packaging pipeline.

Editor consumes Engine and UI through package exports. AI providers, Agent loops, and DeepSeek Harness belong
only in the separate AIStudio repository.

The [Shader Editor](shaderEditor/README.md) is a Shadertoy-style WGSL playground with a local Gallery,
Image + Buffer A–D passes, four image/framebuffer inputs per pass, feedback rendering, GLSL subset import,
and Haiyue Canvas / 3D material previews with OrbitControl. It shares the Editor automation API and
Electron JSON-RPC bridge. Run `npm run build:foundations` once, then `npm run preview:shader`.

The [Image Editor](imageEditor/README.md) includes a browser workspace with PNG/JPEG import, layered
documents, history, and local project recovery. P2 adds brush/eraser editing, rectangular selections,
crop and layer transforms, raster text, and PNG/JPEG export. P3 adds bounded PSD layer import,
compatibility reports, explicit merged-image fallback, and validated PSD copy export. Advanced editing adds
13 adjustable filters, pixel-mask selections, color range/magic wand, freehand/polygon lasso, inversion,
selection combinations and feathering with undo and project recovery. P4 adds chunked binary recovery, tile-delta pixel history, bounded canvas caches, offline restart acceptance and a locally validated macOS Electron candidate; see [P4 evidence and limits](imageEditor/docs/p4-stability.md). Run `npm run preview -w ./imageEditor` to open it locally.
Its PSD compatibility research (`npm run test:image:p0`) remains separate from the product workflow;
Photoshop acceptance and unsupported-format findings are tracked explicitly.

Until the `0.1.x` packages are published, build local package candidates in the sibling `Engine` and `UI`
repositories, then run `npm run deps:local`. Product manifests still declare the supported
`>=0.1.0 <0.2.0` compatibility window; the bootstrap only substitutes exact `0.1.0` tarballs for
pre-publish validation.
