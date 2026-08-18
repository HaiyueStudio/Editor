# Editor Todo: 支持在编辑器内搭建俄罗斯方块

目标：结合当前编辑器已有的 entity 层级、资源面板、组件编辑、脚本组件、场景序列化、Play iframe 预览能力，补齐一组功能后，可以不直接写独立 game demo，而是在编辑器里搭建并运行一个俄罗斯方块游戏。

## 当前已有能力

- [Finished] 场景层级：支持 entity 树、选中、多选、复制、粘贴、剪切、删除、拖拽改层级、显隐切换。
- [Finished] 资源面板：已有 geometry、material、texture 三类资源，支持创建基础几何体、创建材质、导入纹理、拖拽资源到 viewport 替换 mesh。
- [Finished] Inspector：支持编辑 entity name/id、Transform、SphericalTransform、Camera、Mesh3D、ScriptComponent 等。
- [Finished] 脚本组件：支持生命周期代码编辑，并可以随 Play 运行进入 iframe。
- [Finished] 场景文件：支持保存/打开 JSON，Play 时会把当前场景序列化到 iframe 内运行。
- [Finished] 预览能力：viewport 可 orbit、框选、raycast 选中，Play 可独立运行当前场景。

## 必须补齐

1. [Finished] Prefab / Template
   - 需要支持把一组 entity 保存成 prefab。
   - 俄罗斯方块需要复用单元格方块、棋盘格、UI 数字、不同 tetromino 形状。
   - 需要支持从资源面板拖拽 prefab 到场景。

2. [Finished] 运行时创建和销毁 entity 的编辑器 API
   - ScriptComponent 里需要稳定访问 `world.createEntity`、添加组件、移除 entity、查找 prefab。
   - 俄罗斯方块运行中需要不断生成新方块、锁定方块、清除行、刷新网格。

3. 输入系统
   - 需要在编辑器中配置键盘输入映射，例如 Left/Right/Down/Up/Space。
   - ScriptComponent 应能读取 `input.isPressed()`、`input.wasPressed()`。
   - 俄罗斯方块需要移动、旋转、软降、硬降、暂停/重开。

4. [Finished] UI / HUD 能力
   - 需要在场景里添加文本或 UI 面板，用于显示分数、等级、游戏状态、下一个形状。
   - 当前 engine 有 BitmapText，但编辑器缺少完整添加和编辑 BitmapText 的能力。
   - 需要支持屏幕空间 UI，避免分数文本跟随 3D 相机乱动。

5. [Finished] ScriptComponent 运行时状态保存
   - 需要区分“脚本代码”和“脚本运行时状态”。
   - Play 开始时从初始状态启动，退出 Play 后不污染编辑器场景。
   - 俄罗斯方块需要维护棋盘数组、当前方块、下一个方块、分数、游戏状态。

6. [Finished] 脚本资源化
   - 需要支持把脚本作为资源保存，而不是只内嵌在单个组件里。
   - 多个 entity 可以引用同一个脚本资源。
   - 俄罗斯方块可以拆成 `GameManager`、`BoardRenderer`、`InputController`、`ScoreView` 等脚本。

7. 可配置数据组件
   - 需要一个通用 JSON/Data 组件，用于在 Inspector 里编辑脚本参数。
   - 俄罗斯方块需要配置行列数、下落速度、颜色映射、方块尺寸、得分规则。

8. [Finished] 2D/正交工作流
   - 需要一键创建正交相机和固定视角。
   - viewport 需要支持 2D 平移缩放模式。
   - 俄罗斯方块更适合正交视角，棋盘位置和尺寸要稳定。

## 俄罗斯方块专项功能

1. Grid / Board 组件
   - 可配置行列数，默认 20 行 10 列。
   - 提供坐标到世界位置的转换。
   - 可显示网格线、边框和背景。

2. Tilemap / Cell Renderer
   - 用一个网格数据驱动多个小方块显示。
   - 支持按格子状态切换材质。
   - 比每个格子手动建 entity 更适合游戏运行性能和编辑体验。

3. Tetromino 资源
   - 内置 I、O、T、S、Z、J、L 七种形状。
   - 可在资源面板里查看、编辑颜色、预览下一个形状。
   - 支持旋转中心和碰撞格子定义。

4. 碰撞和规则工具
   - 提供 grid collision helper，判断移动/旋转是否合法。
   - 支持行消除、锁定当前方块、生成下一个方块。
   - 支持 wall kick 简化配置。

5. Game State 组件
   - 状态包括 Ready、Playing、Paused、GameOver。
   - Inspector 可查看当前状态和分数。
   - Play 时可重开，不影响编辑器场景。

6. 下一个方块预览
   - 需要支持一个独立 preview board 或 prefab 容器。
   - GameManager 更新 next piece 时同步刷新该区域。

## 编辑体验增强

1. Play/Stop 生命周期
   - 当前 Play 使用 iframe 运行，后续需要明确 Stop、Restart、Pause。
   - 需要显示运行时报错信息，并定位到脚本组件。

2. 脚本调试
   - Console 面板展示 `console.log`、错误堆栈、生命周期执行错误。
   - 可以在 Play overlay 里把 iframe 的日志转发到编辑器 Output。

3. 资源引用检查
   - 删除材质/几何体/prefab 前提示是否被引用。
   - 未引用资源可清理。

4. Inspector 批量编辑
   - 多选 entity 后可批量修改材质、Transform、可见性。
   - 搭棋盘和 UI 时可以减少重复操作。

5. Scene Bootstrap
   - 支持设置主相机、启动脚本、初始场景参数。
   - Play 时不需要猜第一个 Camera3D。

6. 资源库预设 [Finished]
   - 提供“Tetris Starter Kit”：棋盘 prefab、7 种方块材质、正交相机、GameManager 脚本模板。
   - 用户可以直接从模板开始搭建。

## 推荐实现顺序

1. 增加 DataComponent 和脚本运行 API，让脚本能稳定访问 world、entity、input、time。
2. 增加输入系统和 Play overlay 日志转发。
3. 增加 BitmapText / HUD 编辑能力。
4. 增加 Prefab 资源和实例化能力。
5. 增加 Grid/Tilemap 组件。
6. 增加 Tetris Starter Kit 模板。
7. 用模板在编辑器里搭建一个完整俄罗斯方块场景，并保存为示例 JSON。

## 完成标准

- 用户可以只通过编辑器创建俄罗斯方块场景，不需要新建独立 game 目录。
- Play 后可以键盘控制方块移动、旋转、下落。
- 棋盘能正确锁定方块、消除行、计分、显示 GameOver。
- 分数和下一个形状可以在 HUD 上实时显示。
- 场景保存为 JSON 后重新打开，仍然可以继续编辑和 Play。
