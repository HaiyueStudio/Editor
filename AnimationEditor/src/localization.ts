export const ANIMATION_EDITOR_LOCALE_STORAGE_KEY = 'haiyue.animation-editor.locale';

export const ANIMATION_EDITOR_LOCALES = ['zh-CN', 'en-US'] as const;
export type AnimationEditorLocale = typeof ANIMATION_EDITOR_LOCALES[number];

const zhCN = {
  'app.title': '海月动画编辑器',
  'app.settings': '编辑器设置',
  'app.capabilities': '能力与限制',
  'toolbar.projectActions': '工程操作',
  'toolbar.new': '新建工程',
  'toolbar.open': '打开工程',
  'toolbar.save': '保存工程',
  'toolbar.saveShortcut': '保存工程（⌘/Ctrl+S）',
  'toolbar.saveAs': '另存为',
  'toolbar.recent': '最近',
  'toolbar.close': '关闭',
  'toolbar.historyActions': '历史操作',
  'toolbar.undo': '撤销',
  'toolbar.redo': '重做',
  'toolbar.transport': '播放控制',
  'toolbar.jumpStart': '回到开始',
  'toolbar.play': '播放运行时预览',
  'toolbar.pause': '暂停运行时预览',
  'toolbar.jumpEnd': '跳到结束',
  'toolbar.exportActions': '运行时导出',
  'toolbar.exportHya': '导出 HYA',
  'toolbar.exportHyaTitle': '编译、校验并导出内联资源的运行时 HYA',
  'toolbar.exportPackage': '导出交付包',
  'toolbar.exportPackageTitle': '导出 HYA、外置资源和确定性清单 ZIP',
  'panel.assets': '资源',
  'panel.hierarchy': '节点层级',
  'panel.preview': 'WebGPU 预览',
  'panel.previewTitle': 'WebGPU 预览',
  'panel.inspector': '属性检查器',
  'panel.properties': '属性',
  'panel.authoring': '时间轴和状态机',
  'panel.leftSplit': '资源和层级面板尺寸',
  'action.importAsset': '导入图片、音频或二进制资源',
  'action.importSource': '导入 Lottie 或裸 HYA 来源',
  'action.deleteAsset': '删除所选资源',
  'action.addNode': '添加内容节点',
  'action.deleteNode': '删除所选节点',
  'action.composition': '合成',
  'action.compositionTitle': '编辑工程总时长与播放设置',
  'preview.canvas': '动画预览画布',
  'preview.detecting': '检测中',
  'preview.preparingTitle': '正在准备 HYA Runtime',
  'preview.preparingDetail': '工程会先经过编译和二进制反向校验',
  'preview.select': '选择工具',
  'preview.pan': '平移',
  'preview.zoom': '缩放',
  'preview.notCompiled': '尚未编译',
  'preview.noSelection': '未选择',
  'timeline.tab': '时间轴',
  'stateMachine.tab': '状态机',
  'timeline.tracks': '属性轨道',
  'timeline.addTrack': '＋ 轨道',
  'timeline.addTrackTitle': '给所选节点添加核心变换轨道',
  'timeline.addKeyframeTitle': '在播放头添加关键帧',
  'timeline.addClip': '＋ 片段',
  'timeline.addClipTitle': '添加命名动画片段',
  'timeline.ruler': '时间标尺',
  'timeline.lanes': '关键帧轨道；双击轨道空白处插入关键帧',
  'timeline.zoom': '时间轴缩放',
  'timeline.zoomOut': '缩小时间轴',
  'timeline.zoomIn': '放大时间轴',
  'stateMachine.parameters': '参数',
  'stateMachine.layers': '层',
  'stateMachine.addParameter': '添加状态机参数',
  'stateMachine.addLayer': '添加状态机层',
  'stateMachine.noLayer': '未选择层',
  'stateMachine.addState': '＋ 状态',
  'stateMachine.connect': '连接所选状态',
  'stateMachine.reset': '重置运行时',
  'stateMachine.transitions': '状态转场',
  'stateMachine.graph': '状态图',
  'stateMachine.hint': '先创建命名片段，再建立状态机',
  'stateMachine.create': '创建状态机',
  'status.ready': '就绪',
  'task.cancel': '取消',
  'template.title': '从模板新建',
  'template.familyHint': '工程创建后固定为 2D 或原生 3D；两种数据不会混在同一工程中。',
  'capability.title': '能力与限制',
  'capability.exactTitle': 'Exact HYA 预览',
  'capability.exactDetail': '预览、裸 HYA 和交付包都消费同一次编译的运行时数据。',
  'capability.authoringTitle': '可视化编辑',
  'capability.authoringDetail': 'Tween、SpriteSheet、Path/Vector、粒子、状态机与原生 3D 均有可视化入口。',
  'capability.limitTitle': '明确限制',
  'capability.limitDetail': 'HYA 反向导入只恢复有限编辑数据；2D/3D 工程不能混合；外部资源需要在交付环境中可访问。',
  'capability.matrix': '查看完整能力矩阵',
  'status.languageChanged': '界面语言已切换为中文。',
  'status.stats': '{nodes} 个节点 · {tracks} 条轨道 · {assets} 个资源',
  'drop.title': '打开工程或导入资源',
  'drop.detail': '支持 .hya-project.json、图片、音频和二进制文件',
  'dialog.unsaved': '未保存的修改',
  'dialog.cancel': '取消',
  'dialog.continue': '继续',
  'dialog.saveAs': '工程另存为',
  'dialog.fileName': '文件名',
  'dialog.saveAsHint': '文件会以 .hya-project.json 后缀下载。',
  'dialog.saveCopy': '保存副本',
  'dialog.recovery': '发现自动保存',
  'dialog.discard': '丢弃',
  'dialog.restore': '恢复工程',
  'dialog.openError': '无法打开工程',
  'dialog.dismiss': '知道了',
  'settings.title': '编辑器设置',
  'settings.language': '界面语言',
  'settings.languageHint': '语言设置会保存在当前浏览器中。',
  'settings.done': '完成',
  'recent.empty': '暂无最近工程',
  'recent.clear': '清除最近记录',
  'history.undoLabel': '撤销 {label}',
  'history.redoLabel': '重做 {label}',
  'history.noUndo': '没有可撤销操作',
  'history.noRedo': '没有可重做操作',
  'selection.summary': '{kind} · {count} 项',
  'timeline.emptySelected': '点击“＋轨道”开始制作动画',
  'timeline.empty': '选择节点后添加动画轨道',
  'timeline.keyframeTitle': '在播放头给 {track} 添加关键帧',
  'timeline.playheadMoved': '播放头已移动到 {time}s。',
  'stateMachine.noParameters': '尚无参数',
  'stateMachine.noParametersDetail': '创建状态机后可添加',
  'stateMachine.noParametersAction': '点击＋添加运行时参数',
  'stateMachine.noLayers': '尚无层',
  'stateMachine.noLayersDetail': '状态机至少包含一个层',
  'stateMachine.conditionCount': '{count} 个条件',
  'stateMachine.exit': '退出',
  'stateMachine.fire': '触发',
  'stateMachine.fireTitle': '触发 {name}',
  'preview.gpuAvailable': 'WEBGPU 可用',
  'preview.gpuUnavailable': 'WEBGPU 不可用',
  'preview.compileTitle': '正在编译 HYA',
  'preview.compileDetail': '工程会经过运行时文档和二进制双重校验',
  'preview.compileFailed': 'HYA 编译失败',
  'preview.compileFailedShort': '编译失败',
  'preview.runtimeReady': 'HYA Runtime 已连接',
  'preview.runtimePaused': '运行时预览已暂停。',
  'preview.runtimePlaying': '运行时预览正在播放。',
  'common.node': '节点',
} as const;

export type AnimationEditorTranslationKey = keyof typeof zhCN;

const enUS: Record<AnimationEditorTranslationKey, string> = {
  'app.title': 'HaiYue Animation Editor',
  'app.settings': 'Editor settings',
  'app.capabilities': 'Capabilities and limits',
  'toolbar.projectActions': 'Project actions',
  'toolbar.new': 'New project',
  'toolbar.open': 'Open project',
  'toolbar.save': 'Save project',
  'toolbar.saveShortcut': 'Save project (⌘/Ctrl+S)',
  'toolbar.saveAs': 'Save as',
  'toolbar.recent': 'Recent',
  'toolbar.close': 'Close',
  'toolbar.historyActions': 'History actions',
  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'toolbar.transport': 'Playback controls',
  'toolbar.jumpStart': 'Jump to start',
  'toolbar.play': 'Play runtime preview',
  'toolbar.pause': 'Pause runtime preview',
  'toolbar.jumpEnd': 'Jump to end',
  'toolbar.exportActions': 'Runtime export',
  'toolbar.exportHya': 'Export HYA',
  'toolbar.exportHyaTitle': 'Compile, validate, and export a runtime HYA with inline assets',
  'toolbar.exportPackage': 'Export package',
  'toolbar.exportPackageTitle': 'Export a ZIP with HYA, external assets, and a deterministic manifest',
  'panel.assets': 'Assets',
  'panel.hierarchy': 'Hierarchy',
  'panel.preview': 'WebGPU preview',
  'panel.previewTitle': 'WebGPU Preview',
  'panel.inspector': 'Inspector',
  'panel.properties': 'Properties',
  'panel.authoring': 'Timeline and state machine',
  'panel.leftSplit': 'Resize assets and hierarchy panels',
  'action.importAsset': 'Import an image, audio, or binary asset',
  'action.importSource': 'Import a Lottie or bare HYA source',
  'action.deleteAsset': 'Delete selected asset',
  'action.addNode': 'Add content node',
  'action.deleteNode': 'Delete selected node',
  'action.composition': 'Composition',
  'action.compositionTitle': 'Edit project duration and playback settings',
  'preview.canvas': 'Animation preview canvas',
  'preview.detecting': 'Detecting',
  'preview.preparingTitle': 'Preparing HYA Runtime',
  'preview.preparingDetail': 'The project is compiled and binary round-trip validated first',
  'preview.select': 'Select',
  'preview.pan': 'Pan',
  'preview.zoom': 'Zoom',
  'preview.notCompiled': 'Not compiled',
  'preview.noSelection': 'No selection',
  'timeline.tab': 'Timeline',
  'stateMachine.tab': 'State Machine',
  'timeline.tracks': 'Property tracks',
  'timeline.addTrack': '＋ Track',
  'timeline.addTrackTitle': 'Add a core transform track to the selected node',
  'timeline.addKeyframeTitle': 'Add a keyframe at the playhead',
  'timeline.addClip': '＋ Clip',
  'timeline.addClipTitle': 'Add a named animation clip',
  'timeline.ruler': 'Time ruler',
  'timeline.lanes': 'Keyframe tracks; double-click empty track space to insert a keyframe',
  'timeline.zoom': 'Timeline zoom',
  'timeline.zoomOut': 'Zoom timeline out',
  'timeline.zoomIn': 'Zoom timeline in',
  'stateMachine.parameters': 'Parameters',
  'stateMachine.layers': 'Layers',
  'stateMachine.addParameter': 'Add state-machine parameter',
  'stateMachine.addLayer': 'Add state-machine layer',
  'stateMachine.noLayer': 'No Layer',
  'stateMachine.addState': '＋ State',
  'stateMachine.connect': 'Connect selected states',
  'stateMachine.reset': 'Reset runtime',
  'stateMachine.transitions': 'State transitions',
  'stateMachine.graph': 'State graph',
  'stateMachine.hint': 'Create a named clip before building a state machine',
  'stateMachine.create': 'Create state machine',
  'status.ready': 'Ready',
  'task.cancel': 'Cancel',
  'template.title': 'Create from template',
  'template.familyHint': 'A project is permanently 2D or native 3D; both data families are never mixed in one project.',
  'capability.title': 'Capabilities and limits',
  'capability.exactTitle': 'Exact HYA preview',
  'capability.exactDetail': 'Preview, bare HYA, and delivery packages consume the same compiled runtime data.',
  'capability.authoringTitle': 'Visual authoring',
  'capability.authoringDetail': 'Tween, SpriteSheet, Path/Vector, particles, state machines, and native 3D have visual entry points.',
  'capability.limitTitle': 'Explicit limits',
  'capability.limitDetail': 'HYA reverse import only recovers limited authoring data; 2D/3D projects cannot mix; external assets must be reachable at delivery time.',
  'capability.matrix': 'Open the complete capability matrix',
  'status.languageChanged': 'Interface language changed to English.',
  'status.stats': '{nodes} nodes · {tracks} tracks · {assets} assets',
  'drop.title': 'Open a project or import assets',
  'drop.detail': 'Supports .hya-project.json, images, audio, and binary files',
  'dialog.unsaved': 'Unsaved changes',
  'dialog.cancel': 'Cancel',
  'dialog.continue': 'Continue',
  'dialog.saveAs': 'Save project as',
  'dialog.fileName': 'File name',
  'dialog.saveAsHint': 'The file will be downloaded with a .hya-project.json suffix.',
  'dialog.saveCopy': 'Save copy',
  'dialog.recovery': 'Autosave found',
  'dialog.discard': 'Discard',
  'dialog.restore': 'Restore project',
  'dialog.openError': 'Unable to open project',
  'dialog.dismiss': 'Got it',
  'settings.title': 'Editor settings',
  'settings.language': 'Interface language',
  'settings.languageHint': 'The language setting is saved in this browser.',
  'settings.done': 'Done',
  'recent.empty': 'No recent projects',
  'recent.clear': 'Clear recent projects',
  'history.undoLabel': 'Undo {label}',
  'history.redoLabel': 'Redo {label}',
  'history.noUndo': 'Nothing to undo',
  'history.noRedo': 'Nothing to redo',
  'selection.summary': '{kind} · {count} items',
  'timeline.emptySelected': 'Click “＋ Track” to start animating',
  'timeline.empty': 'Select a node, then add an animation track',
  'timeline.keyframeTitle': 'Add a keyframe to {track} at the playhead',
  'timeline.playheadMoved': 'Playhead moved to {time}s.',
  'stateMachine.noParameters': 'No parameters',
  'stateMachine.noParametersDetail': 'Create a state machine to add parameters',
  'stateMachine.noParametersAction': 'Click ＋ to add a runtime parameter',
  'stateMachine.noLayers': 'No layers',
  'stateMachine.noLayersDetail': 'A state machine requires at least one layer',
  'stateMachine.conditionCount': '{count} conditions',
  'stateMachine.exit': 'exit',
  'stateMachine.fire': 'FIRE',
  'stateMachine.fireTitle': 'Fire {name}',
  'preview.gpuAvailable': 'WEBGPU AVAILABLE',
  'preview.gpuUnavailable': 'WEBGPU UNAVAILABLE',
  'preview.compileTitle': 'Compiling HYA',
  'preview.compileDetail': 'The project is validated as runtime JSON and binary',
  'preview.compileFailed': 'HYA compilation failed',
  'preview.compileFailedShort': 'Compilation failed',
  'preview.runtimeReady': 'HYA Runtime connected',
  'preview.runtimePaused': 'Runtime preview paused.',
  'preview.runtimePlaying': 'Runtime preview playing.',
  'common.node': 'node',
};

const catalogs: Record<AnimationEditorLocale, Record<AnimationEditorTranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

const literalPairs = [
  ['Composition Settings', '合成设置'], ['Timeline Track', '时间轴轨道'], ['Keyframe', '关键帧'],
  ['Temporal Easing', '时间缓动'], ['Spatial Bézier', '空间贝塞尔'], ['Animation Clip', '动画片段'],
  ['Asset', '资源'], ['Node', '节点'], ['Local Range', '局部时间范围'], ['Transform', '变换'],
  ['Advanced Content', '高级内容'], ['Actions', '操作'], ['Component', '组件'],
  ['State Machine Layer', '状态机层'], ['Binding Mask', '绑定遮罩'], ['State', '状态'],
  ['Motion', '动画源'], ['Transition', '转场'], ['Conditions', '条件'], ['Parameter', '参数'],
  ['Name', '名称'], ['Project Name', '工程名称'], ['Duration (seconds)', '总时长（秒）'],
  ['End Behavior', '结束行为'], ['Hold final frame', '停留在末帧'], ['Loop playback', '循环播放'],
  ['Destroy after playback', '播放后销毁'], ['Time (seconds)', '时间（秒）'], ['Interpolation', '插值'],
  ['Enter handle', '进入手柄'], ['Leave handle', '离开手柄'], ['Start', '开始'], ['Duration', '时长'],
  ['Parent Node', '父节点'], ['Position', '位置'], ['Rotation', '旋转'], ['Scale', '缩放'],
  ['Anchor', '锚点'], ['Opacity', '透明度'], ['Shape', '形状'], ['Size', '尺寸'],
  ['Fill Alpha', '填充 Alpha'], ['Fill Type', '填充类型'], ['Stroke Width', '描边宽度'],
  ['Gradient Start', '渐变起点'], ['Gradient End', '渐变终点'], ['Text', '文本'], ['Text Box', '文本框'],
  ['Font', '字体'], ['Font Size', '字号'], ['Font Weight', '字重'], ['Horizontal Align', '水平对齐'],
  ['Vertical Align', '垂直对齐'], ['Selector Start', '选择器开始'], ['Selector End', '选择器结束'],
  ['Character Offset', '字符位移'], ['Character Rotation', '字符旋转'], ['Image Asset', '图片资源'],
  ['Sprite Sheet Columns', '图集列数'], ['Sprite Sheet Rows', '图集行数'], ['Current Frame', '当前帧'],
  ['Generate Full Sprite Sheet Animation', '生成整张图集动画'], ['Max Particles', '最大粒子'],
  ['Emission Rate', '发射率'], ['Audio Asset', '音频资源'], ['Volume', '音量'], ['Playback Rate', '播放速率'],
  ['Intensity', '强度'], ['Radius', '半径'], ['Delete Node', '删除节点'], ['Delete Asset', '删除资源'],
  ['Delete Track', '删除轨道'], ['Delete Clip', '删除片段'], ['Add Keyframe at Playhead', '在播放头添加关键帧'],
  ['Jump to Frame', '跳到此帧'], ['Jump to Clip Start', '跳到片段开始'], ['Clear Spatial Handles', '清除空间手柄'],
  ['Default Value', '默认值'], ['Initial State', '初始状态'], ['Blend Mode', '混合模式'], ['Weight', '权重'],
  ['Mode', '模式'], ['All Nodes', '全部节点'], ['Include Only', '仅包含'], ['Exclude', '排除'],
  ['Loop', '循环'], ['Speed', '速度'], ['Speed Parameter', '速度参数'], ['Fixed Speed', '固定速度'],
  ['Animation Clip', '动画片段'], ['Driver Parameter', '驱动参数'], ['Algorithm', '算法'],
  ['Source', '来源'], ['Destination', '目标'], ['Blend Duration', '混合时长'], ['Use Exit Time', '使用退出时间'],
  ['Exit Time', '退出时间'], ['Destination Offset', '目标偏移'], ['Interruption', '中断'],
  ['Add Condition', '添加条件'], ['Remove Condition', '移除条件'], ['Comparison', '比较'], ['Comparison Value', '比较值'],
  ['Set Initial State', '设为初始状态'], ['Delete Parameter', '删除参数'], ['Delete Transition', '删除转场'],
  ['Track Enabled', '启用轨道'], ['Locked for Editing', '锁定编辑'], ['Default Enabled', '默认启用'],
  ['Hidden in Preview', '在预览中隐藏'],
  ['Type', '类型'], ['Canvas', '画布'], ['Frame Rate', '帧率'], ['Project Data', '工程数据'],
  ['Record Text Document', '记录文本 Document'], ['Remove Component', '移除组件'], ['Remove Effect', '移除效果'],
  ['Remove Composite Layer', '移除合成层'], ['Remove Child', '移除子项'], ['Add Child', '添加子项'],
  ['Fill', '填充'], ['Stroke', '描边'], ['Blur', '模糊'], ['Feather', '羽化'], ['Expansion', '扩张'],
  ['Topology', '拓扑'], ['Control Value', '控制值'], ['Matrix', '矩阵'], ['Black Point', '黑点'], ['White Point', '白点'],
  ['Color', '颜色'], ['Offset', '偏移'], ['Source Node', '来源节点'], ['Binding', '绑定'], ['Operation', '操作'],
  ['MIME', 'MIME'], ['ID', 'ID'], ['Seed', 'Seed'], ['UV Rect', 'UV 矩形'], ['Spritesheet', '精灵图集'],
  ['Tint', '色调'], ['Tint Alpha', '色调 Alpha'], ['Trim Start', 'Trim 开始'], ['Trim End', 'Trim 结束'],
  ['Round Radius', '圆角半径'], ['Color Stop A', '色标 A'], ['Color Stop B', '色标 B'],
  ['Parameter X', '参数 X'], ['Parameter Y', '参数 Y'], ['Clip', '片段'], ['Motion', '动画源'],
  ['Cartesian', '笛卡尔'], ['Directional', '方向'], ['Source → Destination', '来源 → 目标'],
  ['Destination → Source', '目标 → 来源'], ['Source', '来源'], ['Destination', '目标'],
  ['Float', '浮点数'], ['Integer', '整数'], ['Boolean', '布尔值'], ['Trigger', '触发器'],
  ['override', '覆盖'], ['additive', '叠加'], ['asset', '资源'], ['node', '节点'], ['track', '轨道'],
  ['keyframe', '关键帧'], ['clip', '片段'], ['parameter', '参数'], ['layer', '层'], ['state', '状态'],
  ['transition', '转场'], ['ASSET', '资源'], ['NODE', '节点'], ['TRACK', '轨道'], ['KEYFRAME', '关键帧'],
  ['CLIP', '片段'], ['PARAMETER', '参数'], ['LAYER', '层'], ['STATE', '状态'], ['TRANSITION', '转场'],
  ['Resource not found', '资源不存在'], ['Node not found', '节点不存在'], ['Track not found', '轨道不存在'],
  ['Keyframe not found', '关键帧不存在'], ['Clip not found', '动画片段不存在'],
  ['State machine not found', '状态机不存在'], ['Parameter not found', '参数不存在'], ['Layer not found', '层不存在'],
  ['State not found', '状态不存在'], ['Transition not found', '转场不存在'], ['Not editable yet', '暂不可编辑'],
  ['Rectangle', '矩形'], ['Ellipse', '椭圆'], ['Left', '左对齐'], ['Center', '居中'], ['Right', '右对齐'],
  ['Top', '顶部'], ['Middle', '居中'], ['Bottom', '底部'], ['Solid', '纯色'],
  ['Linear Gradient', '线性渐变'], ['Radial Gradient', '径向渐变'], ['Override', '覆盖'], ['Additive', '叠加'],
  ['Once', '单次'], ['Repeat', '循环'], ['Ping Pong', '往返'], ['Any State', '任意状态'], ['None', '无'],
] as const satisfies readonly (readonly [string, string])[];

let activeLocale: AnimationEditorLocale = 'zh-CN';

export function normalizeAnimationEditorLocale(value: string | null | undefined): AnimationEditorLocale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en-US';
  return null;
}

export function getAnimationEditorLocale(): AnimationEditorLocale {
  return activeLocale;
}

export function translate(
  key: AnimationEditorTranslationKey,
  values: Readonly<Record<string, string | number>> = {},
  locale: AnimationEditorLocale = activeLocale,
): string {
  return catalogs[locale][key].replace(/\{([^}]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

export function localizeLiteral(value: string, locale: AnimationEditorLocale = activeLocale): string {
  const pair = literalPairs.find(candidate => candidate[0] === value || candidate[1] === value);
  if (pair) return locale === 'zh-CN' ? pair[1] : pair[0];
  if (value.startsWith('＋ ')) return `＋ ${localizeLiteral(value.slice(2), locale)}`;
  const indexed = /^(阈值|位置) (\d+)$/u.exec(value);
  if (indexed) return locale === 'zh-CN' ? value : `${indexed[1] === '阈值' ? 'Threshold' : 'Position'} ${indexed[2]}`;
  return value;
}

export function localizedText(
  zhText: string,
  enText: string,
  locale: AnimationEditorLocale = activeLocale,
): string {
  return locale === 'zh-CN' ? zhText : enText;
}

export interface AnimationEditorLocalizationController {
  readonly locale: AnimationEditorLocale;
  setLocale(locale: AnimationEditorLocale): void;
  apply(): void;
}

class DomAnimationEditorLocalizationController implements AnimationEditorLocalizationController {
  private readonly root: Document;
  private readonly storage: Storage | null;
  private readonly dialog: HTMLElement & { open?: boolean; showModal?: () => void; close?: (reason?: string) => void };
  private readonly language: HTMLSelectElement;

  constructor(root: Document, storage: Storage | null) {
    this.root = root;
    this.storage = storage;
    this.dialog = requiredElement(root, 'editor-settings-dialog');
    this.language = requiredElement(root, 'editor-language');
    activeLocale = this.readStoredLocale() ?? 'zh-CN';
    this.language.value = activeLocale;
    requiredElement(root, 'editor-settings').addEventListener('click', () => this.openSettings());
    this.language.addEventListener('change', () => this.setLocale(
      normalizeAnimationEditorLocale(this.language.value) ?? 'zh-CN',
    ));
    requiredElement(root, 'close-editor-settings').addEventListener('click', () => this.closeSettings());
    this.apply();
  }

  get locale(): AnimationEditorLocale { return activeLocale; }

  setLocale(locale: AnimationEditorLocale): void {
    if (!ANIMATION_EDITOR_LOCALES.includes(locale)) return;
    activeLocale = locale;
    this.language.value = locale;
    try { this.storage?.setItem(ANIMATION_EDITOR_LOCALE_STORAGE_KEY, locale); }
    catch { /* Storage policies must not prevent language switching. */ }
    this.apply();
    this.root.dispatchEvent(new CustomEvent('animation-editor-locale-change', { detail: { locale } }));
  }

  apply(): void {
    this.root.documentElement.lang = activeLocale;
    this.root.title = translate('app.title');
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = translationKey(node.dataset.i18n);
      if (key) node.textContent = translate(key, translationValues(node));
    }
    this.applyAttribute('data-i18n-title', 'title');
    this.applyAttribute('data-i18n-aria-label', 'aria-label');
    this.applyAttribute('data-i18n-placeholder', 'placeholder');
    this.applyAttribute('data-i18n-label', 'label');
    this.applyAttribute('data-i18n-heading', 'heading');
    const tabs = this.root.getElementById('authoring-tabs') as (HTMLElement & {
      options?: Array<{ label: string; value: string }>;
    }) | null;
    if (tabs) {
      const options = [
        { label: translate('timeline.tab'), value: 'timeline' },
        { label: translate('stateMachine.tab'), value: 'state-machine' },
      ];
      tabs.options = options;
      tabs.setAttribute('options', JSON.stringify(options));
    }
  }

  private applyAttribute(dataAttribute: string, attribute: string): void {
    for (const node of this.root.querySelectorAll<HTMLElement>(`[${dataAttribute}]`)) {
      const key = translationKey(node.getAttribute(dataAttribute));
      if (key) node.setAttribute(attribute, translate(key));
    }
  }

  private readStoredLocale(): AnimationEditorLocale | null {
    try { return normalizeAnimationEditorLocale(this.storage?.getItem(ANIMATION_EDITOR_LOCALE_STORAGE_KEY)); }
    catch { return null; }
  }

  private openSettings(): void {
    if (this.dialog.open) return;
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.language.focus();
  }

  private closeSettings(): void {
    if (typeof this.dialog.close === 'function') this.dialog.close('action');
    else this.dialog.removeAttribute('open');
  }
}

let controller: AnimationEditorLocalizationController | null = null;

export function initializeAnimationEditorLocalization(
  root: Document = document,
  storage: Storage | null = safeLocalStorage(),
): AnimationEditorLocalizationController {
  controller ??= new DomAnimationEditorLocalizationController(root, storage);
  return controller;
}

function safeLocalStorage(): Storage | null {
  try { return window.localStorage; }
  catch { return null; }
}

function translationKey(value: string | null | undefined): AnimationEditorTranslationKey | null {
  return value && value in zhCN ? value as AnimationEditorTranslationKey : null;
}

function translationValues(node: HTMLElement): Record<string, string> | undefined {
  let values: Record<string, string> | undefined;
  for (const [name, value] of Object.entries(node.dataset)) {
    if (!name.startsWith('i18n') || name.length === 4 || value === undefined) continue;
    const parameterName = `${name.charAt(4).toLowerCase()}${name.slice(5)}`;
    (values ??= {})[parameterName] = value;
  }
  return values;
}

function requiredElement<T extends Element = HTMLElement>(root: Document, id: string): T {
  const value = root.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
