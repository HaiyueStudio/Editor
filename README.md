# HaiyueStudio Editor

Non-AI editor platform and products. This repository currently contains the Scene Editor, HYA Animation
Editor, and Voxel Editor; Milestone 3 will converge them on a headless platform, browser shell, Plugin SDK,
and shared app packaging pipeline.

Editor consumes Engine and UI through package exports. AI providers, Agent loops, and DeepSeek Harness belong
only in the separate AIStudio repository.

Until the `0.1.x` packages are published, build local package candidates in the sibling `Engine` and `UI`
repositories, then run `npm run deps:local`. Product manifests still declare the supported
`>=0.1.0 <0.2.0` compatibility window; the bootstrap only substitutes exact `0.1.0` tarballs for
pre-publish validation.
