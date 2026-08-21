import {
  applyEditorTheme,
  readStoredEditorTheme,
  storeEditorTheme,
} from '../theme/editorTheme';

type EditorLanguage = 'zh-CN' | 'en-US';
export type EditorDefaultMaterialKind = 'pbr' | 'basic' | 'blinn-phong' | 'normal' | 'depth';

type LocalizedOptions = Array<{ label: string; value: string }>;

interface EditorOptionsElements {
  button: HTMLButtonElement | null;
  panel: HTMLElement | null;
  languageSelect: HTMLSelectElement | null;
  themeSelect: HTMLSelectElement | null;
  defaultMaterialSelect: HTMLSelectElement | null;
  resourceTabs: HTMLElement | null;
  inspectorTabs: HTMLElement | null;
  workspaceSplit?: HTMLElement | null;
  leftStackSplit?: HTMLElement | null;
  centerSplit?: HTMLElement | null;
  viewportStackSplit?: HTMLElement | null;
}

interface EditorOptionsSession {
  resourceTab?: string;
  inspectorTab?: string;
  workspaceRatio?: number | null;
  leftStackRatio?: number | null;
  centerRatio?: number | null;
  viewportStackRatio?: number | null;
}

interface EditorOptionsSetupOptions {
  session?: EditorOptionsSession;
  onSessionChange?: (session: EditorOptionsSession) => void;
}

interface EditorDictionary {
  strings: Record<string, string>;
  resourceTabs: LocalizedOptions;
  inspectorTabs: LocalizedOptions;
}

const STORAGE_KEY = 'haiyue.editor.language';
const DEFAULT_MATERIAL_STORAGE_KEY = 'haiyue.editor.defaultMaterial';
const DEFAULT_LANGUAGE: EditorLanguage = 'zh-CN';
const DEFAULT_MATERIAL_KIND: EditorDefaultMaterialKind = 'pbr';
const LANGUAGE_CHANGE_EVENT = 'editor-language-change';
let currentLanguage: EditorLanguage = readStoredLanguage();
let currentDefaultMaterialKind: EditorDefaultMaterialKind = readStoredDefaultMaterialKind();

const dictionaries: Record<EditorLanguage, EditorDictionary> = {
  'zh-CN': {
    strings: {
      'app.brand': '海月',
      'toolbar.recent': '最近',
      'toolbar.saveAs': '另存为',
      'toolbar.exportProject': '导出项目',
      'toolbar.kits': '模板',
      'options.open': '编辑器选项',
      'options.title': '编辑器选项',
      'options.language': '语言',
      'options.theme': '主题配色',
      'options.defaultMaterial': '默认 3D 材质',
      'recent.openScene': '打开场景...',
      'recent.empty': '暂无最近打开',
      'recent.clear': '清空最近打开',
      'language.zh': '中文',
      'language.en': 'English',
      'theme.light': '月白 · 淡蓝明亮',
      'theme.dark': '夜阑 · 深蓝紫暗色',
      'defaultMaterial.basic': 'Basic',
      'defaultMaterial.pbr': 'PBR 金属度/粗糙度',
      'defaultMaterial.blinnPhong': 'Blinn-Phong',
      'defaultMaterial.normal': 'Normal',
      'defaultMaterial.depth': 'Depth',
      'panel.hierarchy': '层级',
      'panel.systems': '系统',
      'panel.viewport': '视口',
      'action.add': '添加',
      'action.close': '关闭',
      'viewport.modeAria': '视口控制模式',
      'viewport.orbit': '环绕',
      'viewport.boxAll': '框选：全部',
      'viewport.box3d': '框选：3D',
      'viewport.box2d': '框选：2D',
      'viewport.select3dObjects': '选择 3D 对象',
      'viewport.select2dObjects': '选择 2D 对象',
      'viewport.selectAllObjects': '选择全部对象',
      'inspector.empty': '未选择实体',
      'inspector.multiSelected': '已选择 {count} 个实体',
      'inspector.mixed': '多个值',
      'inspector.mixedUnsupported': '该公共组件暂不支持批量编辑。',
      'inspector.noComponents': '无组件',
      'field.name': '名称',
      'field.id': 'ID',
      'field.components': '组件',
      'field.position': '位置',
      'field.rotation': '旋转',
      'field.scale': '缩放',
      'field.radius': '半径',
      'field.angles': '角度',
      'field.target': '目标',
      'field.geometry': '几何体',
      'field.material': '材质',
      'field.positionRotation': '位置 / 旋转',
      'field.color': '颜色',
      'field.alpha': '透明度',
      'field.blending': '混合',
      'field.text': '文本',
      'field.styleJson': '样式 JSON',
      'field.gridSize': '网格尺寸',
      'field.cellSizeGap': '单元尺寸 / 间距',
      'field.origin': '原点',
      'field.paletteJson': '调色板 JSON',
      'field.cellsJson': '单元 JSON',
      'field.currentPressedKeys': '当前按键',
      'field.projection': '投影',
      'field.clip': '裁剪',
      'field.orthoBounds': '正交边界',
      'field.orthoBottom': '正交底边',
      'field.sizeZoom': '尺寸 / 缩放',
      'field.script': '脚本',
      'component.add': '添加组件',
      'component.remove': '移除组件',
      'component.empty': '选择一个组件进行编辑。',
      'script.api': '脚本 API',
      'script.lifecycle': '生命周期',
      'script.lifecycleParameters': '生命周期参数',
      'script.insertExample': '插入示例',
      'resource.title': '资源',
      'global.game': '游戏',
      'global.designSize': '设计尺寸',
      'global.viewportMode': '视口模式',
      'global.clearColor': '清屏颜色',
      'global.clearAlpha': '清屏透明度',
      'global.reverseZ': '反向 Z',
      'global.render2DLoadOp': '2D Load Op',
      'global.guiLoadOp': 'GUI Load Op',
      'global.customParameters': '自定义参数',
      'viewportMode.expand': '扩展',
      'viewportMode.fill': '填充',
      'viewportMode.fixed': '固定',
      'play.title': '运行',
      'play.restart': '重启',
      'play.pause': '暂停',
      'play.device': '设备',
      'play.zoom': '缩放 %',
      'play.widthShort': '宽',
      'play.heightShort': '高',
      'play.frameTitle': '场景播放器',
      'device.pc': 'PC 自适应',
      'device.custom': '自定义',
      'resource.create': '创建',
      'resource.box': '立方体',
      'resource.roundedBox': '圆角立方体',
      'resource.sphere': '球体',
      'resource.cone': '圆锥',
      'resource.cylinder': '圆柱',
      'resource.torus': '圆环',
      'resource.icosahedron': '二十面体',
      'resource.plane': '平面',
      'resource.rect2D': '2D 矩形',
      'resource.circle2D': '2D 圆形',
      'resource.triangle2D': '2D 三角形',
      'resource.hexagon2D': '2D 六边形',
      'resource.star2D': '2D 星形',
      'resource.basic': '基础',
      'resource.css': 'CSS',
      'resource.normal': '法线',
      'resource.depth': '深度',
      'resource.blinnPhong': 'Blinn-Phong',
      'resource.toon': '卡通分层',
      'resource.radialShadow': '径向阴影',
      'resource.importModel': '导入模型',
      'resource.importTexture': '导入纹理',
      'resource.newScript': '新建脚本',
      'resource.openScript': '打开脚本',
      'resource.instantiate': '实例化',
      'resource.createPrefab': '创建预制体',
      'resource.import': '导入',
      'resource.files': '文件',
      'resource.folder': '文件夹',
      'detail.type': '类型',
      'detail.assetKey': 'Asset Key',
      'detail.status': '状态',
      'detail.gpuAsset': 'GPU 资源',
      'detail.assetError': '资源错误',
      'detail.materialType': '材质类型',
      'detail.texture': '纹理',
      'detail.noTexture': '无纹理',
      'detail.source': '来源',
      'detail.size': '尺寸',
      'detail.file': '文件',
      'detail.fileType': '文件类型',
      'detail.fileSize': '文件大小',
      'detail.textureContainer': '纹理容器',
      'detail.textureDimension': '纹理维度',
      'detail.textureSupercompression': 'Supercompression',
      'detail.textureGpuFormat': 'GPU 格式',
      'detail.textureRequiredFeature': '所需特性',
      'detail.textureUploadPath': '上传路径',
      'detail.textureLayers': '层级',
      'detail.textureSupport': '支持状态',
      'detail.compatibility': '兼容性',
      'detail.compatible': '完整兼容',
      'detail.degraded': '降级运行',
      'detail.extensionCompatibility': '扩展兼容性',
      'detail.mipmapSource': 'Mipmap 来源',
      'detail.boundsCompatibility': 'Bounds 兼容性',
      'detail.uvSemanticCompatibility': 'UV 语义映射',
      'detail.modelLoadPerformance': '模型加载性能',
      'detail.compatibilityIssue': '兼容性问题',
      'detail.meshes': '网格',
      'detail.primitives': '图元',
      'detail.materials': '材质',
      'detail.textures': '纹理',
      'detail.images': '图像',
      'detail.animations': '动画',
      'detail.preview': '预览',
      'detail.root': '根实体',
      'detail.entities': '实体',
      'detail.action': '操作',
      'detail.prefab': '预制体',
      'detail.revision': '版本',
      'detail.basePrefab': '基础预制体',
      'detail.baseRevision': '基础版本',
      'detail.syncInstances': '同步实例',
      'detail.syncSelectedInstances': '同步选中实例',
      'detail.createVariant': '创建 Variant',
      'detail.rebaseVariant': '合并基础变更',
      'detail.captureVariantOverrides': '捕获选中覆盖',
      'detail.variant': 'Variant',
      'detail.variantOverrides': '覆盖项',
      'detail.variantOverride': '覆盖',
      'detail.variantConflicts': '冲突',
      'detail.variantConflict': '冲突项',
      'detail.variantDiff': '字段 Diff',
      'detail.diffBase': 'Base',
      'detail.diffOverride': 'Override',
      'detail.diffResolved': '当前结果',
      'detail.noVariantOverrides': '当前没有字段覆盖。',
      'detail.acceptBase': '接受 base',
      'detail.keepOverride': '保留 override',
      'detail.addToScene': '添加到场景',
      'detail.color': '颜色',
      'detail.alpha': '透明度',
      'detail.opacity': '不透明度',
      'detail.innerRadius': '内半径',
      'detail.blending': '混合',
      'detail.text': '文本',
      'detail.styleJson': '样式 JSON',
      'detail.editable': '可编辑',
      'detail.noMaterialEditor': '该材质类型暂无编辑器',
      'detail.clearcoatFactor': '清漆强度',
      'detail.clearcoatRoughness': '清漆粗糙度',
      'detail.clearcoatNormalScale': '清漆法线强度',
      'detail.clearcoatTexture': '清漆纹理',
      'detail.clearcoatRoughnessTexture': '清漆粗糙度纹理',
      'detail.clearcoatNormalTexture': '清漆法线纹理',
      'detail.ior': '折射率（IOR）',
      'detail.specularFactor': '镜面反射强度',
      'detail.specularColorR': '镜面颜色 R',
      'detail.specularColorG': '镜面颜色 G',
      'detail.specularColorB': '镜面颜色 B',
      'detail.specularTexture': '镜面反射强度纹理',
      'detail.specularColorTexture': '镜面颜色纹理',
      'detail.sheenColorR': '光泽颜色 R',
      'detail.sheenColorG': '光泽颜色 G',
      'detail.sheenColorB': '光泽颜色 B',
      'detail.sheenRoughness': '光泽粗糙度',
      'detail.sheenColorTexture': '光泽颜色纹理',
      'detail.sheenRoughnessTexture': '光泽粗糙度纹理',
      'detail.transmissionFactor': '透射强度',
      'detail.transmissionTexture': '透射纹理',
      'detail.thicknessFactor': '体积厚度',
      'detail.thicknessTexture': '厚度纹理',
      'detail.attenuationDistance': '衰减距离',
      'detail.attenuationColorR': '衰减颜色 R',
      'detail.attenuationColorG': '衰减颜色 G',
      'detail.attenuationColorB': '衰减颜色 B',
      'detail.vertices': '顶点',
      'detail.triangles': '三角形',
      'detail.indices': '索引',
      'detail.topology': '拓扑',
      'detail.cullMode': '剔除模式',
      'detail.frontFace': '正面',
      'detail.references': '引用',
      'detail.hasNormals': '包含法线',
      'detail.hasUvs': '包含 UV',
      'detail.aabbMin': 'AABB 最小值',
      'detail.aabbMax': 'AABB 最大值',
      'detail.rendererDefault': '渲染器默认',
      'common.yes': '是',
      'common.no': '否',
      'empty.noGeometries': '没有几何体',
      'empty.noMaterials': '没有材质',
      'empty.no2DMaterials': '没有 2D 材质',
      'empty.noScript': '无脚本',
      'empty.geometriesInUse': '暂无使用中的几何体。',
      'empty.materialsInUse': '暂无使用中的材质。',
      'empty.texturesInUse': '暂无使用中的纹理。',
      'empty.modelsImported': '尚未导入模型。',
      'empty.prefabsCreated': '尚未创建预制体。',
      'empty.dropJsFiles': '将 .js 文件拖到这里。',
      'component.noEditor': '{name} 暂无编辑器。',
      'component.transformCannotEdit': '{name} 不能作为位置 / 旋转 / 缩放编辑。',
    },
    resourceTabs: [
      { label: '几何体', value: 'geometry' },
      { label: '材质', value: 'material' },
      { label: '纹理', value: 'texture' },
      { label: '模型', value: 'model' },
      { label: '预制体', value: 'prefab' },
      { label: '脚本', value: 'script' },
    ],
    inspectorTabs: [
      { label: '检查器', value: 'inspector' },
      { label: '全局设置', value: 'global' },
      { label: '动画', value: 'animation' },
      { label: '材质图', value: 'material-graph' },
    ],
  },
  'en-US': {
    strings: {
      'app.brand': 'Haiyue',
      'toolbar.recent': 'Recent',
      'toolbar.saveAs': 'Save As',
      'toolbar.exportProject': 'Export Project',
      'toolbar.kits': 'Kits',
      'options.open': 'Editor options',
      'options.title': 'Editor Options',
      'options.language': 'Language',
      'options.theme': 'Color Theme',
      'options.defaultMaterial': 'Default 3D Material',
      'recent.openScene': 'Open scene...',
      'recent.empty': 'No recent scenes',
      'recent.clear': 'Clear recent',
      'language.zh': '中文',
      'language.en': 'English',
      'theme.light': 'Moonlight · Pale Blue',
      'theme.dark': 'Nightfall · Deep Indigo',
      'defaultMaterial.basic': 'Basic',
      'defaultMaterial.pbr': 'PBR Metallic/Roughness',
      'defaultMaterial.blinnPhong': 'Blinn-Phong',
      'defaultMaterial.normal': 'Normal',
      'defaultMaterial.depth': 'Depth',
      'panel.hierarchy': 'Hierarchy',
      'panel.systems': 'Systems',
      'panel.viewport': 'Viewport',
      'action.add': 'Add',
      'action.close': 'Close',
      'viewport.modeAria': 'Viewport control mode',
      'viewport.orbit': 'Orbit',
      'viewport.boxAll': 'Box Select: All',
      'viewport.box3d': 'Box Select: 3D',
      'viewport.box2d': 'Box Select: 2D',
      'viewport.select3dObjects': 'Select 3D objects',
      'viewport.select2dObjects': 'Select 2D objects',
      'viewport.selectAllObjects': 'Select all objects',
      'inspector.empty': 'No entity selected',
      'inspector.multiSelected': '{count} entities selected',
      'inspector.mixed': 'Mixed values',
      'inspector.mixedUnsupported': 'Batch editing is not available for this common component yet.',
      'inspector.noComponents': 'No components',
      'field.name': 'Name',
      'field.id': 'ID',
      'field.components': 'Components',
      'field.position': 'Position',
      'field.rotation': 'Rotation',
      'field.scale': 'Scale',
      'field.radius': 'Radius',
      'field.angles': 'Angles',
      'field.target': 'Target',
      'field.geometry': 'Geometry',
      'field.material': 'Material',
      'field.positionRotation': 'Position / Rotation',
      'field.color': 'Color',
      'field.alpha': 'Alpha',
      'field.blending': 'Blending',
      'field.text': 'Text',
      'field.styleJson': 'Style JSON',
      'field.gridSize': 'Grid Size',
      'field.cellSizeGap': 'Cell Size / Gap',
      'field.origin': 'Origin',
      'field.paletteJson': 'Palette JSON',
      'field.cellsJson': 'Cells JSON',
      'field.currentPressedKeys': 'Current pressed keys',
      'field.projection': 'Projection',
      'field.clip': 'Clip',
      'field.orthoBounds': 'Ortho Bounds',
      'field.orthoBottom': 'Ortho Bottom',
      'field.sizeZoom': 'Size / Zoom',
      'field.script': 'Script',
      'component.add': 'Add component',
      'component.remove': 'Remove component',
      'component.empty': 'Select a component to edit.',
      'script.api': 'Script API',
      'script.lifecycle': 'Lifecycle',
      'script.lifecycleParameters': 'Lifecycle parameters',
      'script.insertExample': 'Insert Example',
      'resource.title': 'Resource',
      'global.game': 'Game',
      'global.designSize': 'Design Size',
      'global.viewportMode': 'Viewport Mode',
      'global.clearColor': 'Clear Color',
      'global.clearAlpha': 'Clear Alpha',
      'global.reverseZ': 'Reverse Z',
      'global.render2DLoadOp': '2D Load Op',
      'global.guiLoadOp': 'GUI Load Op',
      'global.customParameters': 'Custom Parameters',
      'viewportMode.expand': 'Expand',
      'viewportMode.fill': 'Fill',
      'viewportMode.fixed': 'Fixed',
      'play.title': 'Play',
      'play.restart': 'Restart',
      'play.pause': 'Pause',
      'play.device': 'Device',
      'play.zoom': 'Zoom %',
      'play.widthShort': 'W',
      'play.heightShort': 'H',
      'play.frameTitle': 'Scene Player',
      'device.pc': 'PC Responsive',
      'device.custom': 'Custom',
      'resource.create': 'Create',
      'resource.box': 'Box',
      'resource.roundedBox': 'Rounded Box',
      'resource.sphere': 'Sphere',
      'resource.cone': 'Cone',
      'resource.cylinder': 'Cylinder',
      'resource.torus': 'Torus',
      'resource.icosahedron': 'Icosahedron',
      'resource.plane': 'Plane',
      'resource.rect2D': '2D Rect',
      'resource.circle2D': '2D Circle',
      'resource.triangle2D': '2D Triangle',
      'resource.hexagon2D': '2D Hexagon',
      'resource.star2D': '2D Star',
      'resource.basic': 'Basic',
      'resource.css': 'Css',
      'resource.normal': 'Normal',
      'resource.depth': 'Depth',
      'resource.blinnPhong': 'BlinnPhong',
      'resource.toon': 'Toon Layers',
      'resource.radialShadow': 'RadialShadow',
      'resource.importModel': 'Import Model',
      'resource.importTexture': 'Import Texture',
      'resource.newScript': 'New Script',
      'resource.openScript': 'Open Script',
      'resource.instantiate': 'Instantiate',
      'resource.createPrefab': 'Create Prefab',
      'resource.import': 'Import',
      'resource.files': 'Files',
      'resource.folder': 'Folder',
      'detail.type': 'Type',
      'detail.assetKey': 'Asset Key',
      'detail.status': 'Status',
      'detail.gpuAsset': 'GPU Asset',
      'detail.assetError': 'Asset Error',
      'detail.materialType': 'Material type',
      'detail.texture': 'Texture',
      'detail.noTexture': 'No texture',
      'detail.source': 'Source',
      'detail.size': 'Size',
      'detail.file': 'File',
      'detail.fileType': 'File type',
      'detail.fileSize': 'File size',
      'detail.textureContainer': 'Texture container',
      'detail.textureDimension': 'Texture dimension',
      'detail.textureSupercompression': 'Supercompression',
      'detail.textureGpuFormat': 'GPU format',
      'detail.textureRequiredFeature': 'Required feature',
      'detail.textureUploadPath': 'Upload path',
      'detail.textureLayers': 'Layers',
      'detail.textureSupport': 'Support',
      'detail.compatibility': 'Compatibility',
      'detail.compatible': 'Compatible',
      'detail.degraded': 'Degraded',
      'detail.extensionCompatibility': 'Extension compatibility',
      'detail.mipmapSource': 'Mipmap source',
      'detail.boundsCompatibility': 'Bounds compatibility',
      'detail.uvSemanticCompatibility': 'UV semantic mapping',
      'detail.modelLoadPerformance': 'Model load performance',
      'detail.compatibilityIssue': 'Compatibility issue',
      'detail.meshes': 'Meshes',
      'detail.primitives': 'Primitives',
      'detail.materials': 'Materials',
      'detail.textures': 'Textures',
      'detail.images': 'Images',
      'detail.animations': 'Animations',
      'detail.preview': 'Preview',
      'detail.root': 'Root',
      'detail.entities': 'Entities',
      'detail.action': 'Action',
      'detail.prefab': 'Prefab',
      'detail.revision': 'Revision',
      'detail.basePrefab': 'Base Prefab',
      'detail.baseRevision': 'Base Revision',
      'detail.syncInstances': 'Sync Instances',
      'detail.syncSelectedInstances': 'Sync Selected Instances',
      'detail.createVariant': 'Create Variant',
      'detail.rebaseVariant': 'Merge Base Changes',
      'detail.captureVariantOverrides': 'Capture Selected Overrides',
      'detail.variant': 'Variant',
      'detail.variantOverrides': 'Overrides',
      'detail.variantOverride': 'Override',
      'detail.variantConflicts': 'Conflicts',
      'detail.variantConflict': 'Conflict',
      'detail.variantDiff': 'Field Diff',
      'detail.diffBase': 'Base',
      'detail.diffOverride': 'Override',
      'detail.diffResolved': 'Resolved',
      'detail.noVariantOverrides': 'No field overrides.',
      'detail.acceptBase': 'Accept Base',
      'detail.keepOverride': 'Keep Override',
      'detail.addToScene': 'Add to Scene',
      'detail.color': 'Color',
      'detail.alpha': 'Alpha',
      'detail.opacity': 'Opacity',
      'detail.innerRadius': 'Inner Radius',
      'detail.blending': 'Blending',
      'detail.text': 'Text',
      'detail.styleJson': 'Style JSON',
      'detail.editable': 'Editable',
      'detail.noMaterialEditor': 'No editor for this material type yet',
      'detail.clearcoatFactor': 'Clearcoat factor',
      'detail.clearcoatRoughness': 'Clearcoat roughness',
      'detail.clearcoatNormalScale': 'Clearcoat normal scale',
      'detail.clearcoatTexture': 'Clearcoat texture',
      'detail.clearcoatRoughnessTexture': 'Clearcoat roughness texture',
      'detail.clearcoatNormalTexture': 'Clearcoat normal texture',
      'detail.ior': 'Index of refraction (IOR)',
      'detail.specularFactor': 'Specular factor',
      'detail.specularColorR': 'Specular color R',
      'detail.specularColorG': 'Specular color G',
      'detail.specularColorB': 'Specular color B',
      'detail.specularTexture': 'Specular factor texture',
      'detail.specularColorTexture': 'Specular color texture',
      'detail.sheenColorR': 'Sheen color R',
      'detail.sheenColorG': 'Sheen color G',
      'detail.sheenColorB': 'Sheen color B',
      'detail.sheenRoughness': 'Sheen roughness',
      'detail.sheenColorTexture': 'Sheen color texture',
      'detail.sheenRoughnessTexture': 'Sheen roughness texture',
      'detail.transmissionFactor': 'Transmission factor',
      'detail.transmissionTexture': 'Transmission texture',
      'detail.thicknessFactor': 'Volume thickness',
      'detail.thicknessTexture': 'Thickness texture',
      'detail.attenuationDistance': 'Attenuation distance',
      'detail.attenuationColorR': 'Attenuation color R',
      'detail.attenuationColorG': 'Attenuation color G',
      'detail.attenuationColorB': 'Attenuation color B',
      'detail.vertices': 'Vertices',
      'detail.triangles': 'Triangles',
      'detail.indices': 'Indices',
      'detail.topology': 'Topology',
      'detail.cullMode': 'Cull mode',
      'detail.frontFace': 'Front face',
      'detail.references': 'References',
      'detail.hasNormals': 'Has normals',
      'detail.hasUvs': 'Has UVs',
      'detail.aabbMin': 'AABB min',
      'detail.aabbMax': 'AABB max',
      'detail.rendererDefault': 'Renderer default',
      'common.yes': 'Yes',
      'common.no': 'No',
      'empty.noGeometries': 'No geometries',
      'empty.noMaterials': 'No materials',
      'empty.no2DMaterials': 'No 2D materials',
      'empty.noScript': 'No script',
      'empty.geometriesInUse': 'No geometries in use.',
      'empty.materialsInUse': 'No materials in use.',
      'empty.texturesInUse': 'No textures in use.',
      'empty.modelsImported': 'No models imported.',
      'empty.prefabsCreated': 'No prefabs created.',
      'empty.dropJsFiles': 'Drop .js files here.',
      'component.noEditor': '{name} has no editor yet.',
      'component.transformCannotEdit': '{name} cannot be edited as position / rotation / scale.',
    },
    resourceTabs: [
      { label: 'Geometries', value: 'geometry' },
      { label: 'Materials', value: 'material' },
      { label: 'Textures', value: 'texture' },
      { label: 'Models', value: 'model' },
      { label: 'Prefabs', value: 'prefab' },
      { label: 'Scripts', value: 'script' },
    ],
    inspectorTabs: [
      { label: 'Inspector', value: 'inspector' },
      { label: 'Global Settings', value: 'global' },
      { label: 'Animation', value: 'animation' },
      { label: 'Material Graph', value: 'material-graph' },
    ],
  },
};

export function setupEditorOptions(elements: EditorOptionsElements, options: EditorOptionsSetupOptions = {}): void {
  const initialTheme = applyEditorTheme(readStoredEditorTheme());
  applyLanguage(currentLanguage, elements);
  if (elements.themeSelect) elements.themeSelect.value = initialTheme;
  if (elements.defaultMaterialSelect) elements.defaultMaterialSelect.value = currentDefaultMaterialKind;
  applyTabsSession(elements, options.session);
  applySplitSession(elements, options.session);

  elements.languageSelect?.addEventListener('change', () => {
    currentLanguage = normalizeLanguage(elements.languageSelect?.value);
    localStorage.setItem(STORAGE_KEY, currentLanguage);
    applyLanguage(currentLanguage, elements);
    applyTabsSession(elements, options.session);
    applySplitSession(elements, options.session);
  });
  elements.themeSelect?.addEventListener('change', () => {
    const theme = storeEditorTheme(elements.themeSelect?.value);
    applyEditorTheme(theme);
    if (elements.themeSelect) elements.themeSelect.value = theme;
  });
  elements.defaultMaterialSelect?.addEventListener('change', () => {
    currentDefaultMaterialKind = normalizeDefaultMaterialKind(elements.defaultMaterialSelect?.value);
    localStorage.setItem(DEFAULT_MATERIAL_STORAGE_KEY, currentDefaultMaterialKind);
    if (elements.defaultMaterialSelect) elements.defaultMaterialSelect.value = currentDefaultMaterialKind;
  });
  elements.resourceTabs?.addEventListener('tab-change', event => {
    const value = (event as CustomEvent<{ value: string }>).detail.value;
    options.session = { ...options.session, resourceTab: value };
    options.onSessionChange?.({ resourceTab: value });
  });
  elements.inspectorTabs?.addEventListener('tab-change', event => {
    const value = (event as CustomEvent<{ value: string }>).detail.value;
    options.session = { ...options.session, inspectorTab: value };
    options.onSessionChange?.({ inspectorTab: value });
  });
  bindSplitSession(elements.workspaceSplit, 'workspaceRatio', options);
  bindSplitSession(elements.leftStackSplit, 'leftStackRatio', options);
  bindSplitSession(elements.centerSplit, 'centerRatio', options);
  bindSplitSession(elements.viewportStackSplit, 'viewportStackRatio', options);

  elements.button?.addEventListener('click', (event) => {
    event.stopPropagation();
    setPanelOpen(elements, elements.panel?.hidden === true);
  });
  elements.panel?.addEventListener('click', event => event.stopPropagation());
  window.addEventListener('click', () => setPanelOpen(elements, false));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setPanelOpen(elements, false);
  });
}

function applyTabsSession(elements: EditorOptionsElements, session: EditorOptionsSession | undefined): void {
  if (session?.resourceTab && elements.resourceTabs) setTabValue(elements.resourceTabs, session.resourceTab);
  if (session?.inspectorTab && elements.inspectorTabs) setTabValue(elements.inspectorTabs, session.inspectorTab);
}

function applySplitSession(elements: EditorOptionsElements, session: EditorOptionsSession | undefined): void {
  setSplitRatio(elements.workspaceSplit, session?.workspaceRatio);
  setSplitRatio(elements.leftStackSplit, session?.leftStackRatio);
  setSplitRatio(elements.centerSplit, session?.centerRatio);
  setSplitRatio(elements.viewportStackSplit, session?.viewportStackRatio);
}

function bindSplitSession(
  element: HTMLElement | null | undefined,
  key: keyof Pick<EditorOptionsSession, 'workspaceRatio' | 'leftStackRatio' | 'centerRatio' | 'viewportStackRatio'>,
  options: EditorOptionsSetupOptions,
): void {
  element?.addEventListener('ratio-change', event => {
    if (event.target !== element) return;
    const ratio = (event as CustomEvent<{ ratio: number }>).detail.ratio;
    if (!Number.isFinite(ratio)) return;
    options.session = { ...options.session, [key]: ratio };
    options.onSessionChange?.({ [key]: ratio });
  });
}

function setSplitRatio(element: HTMLElement | null | undefined, ratio: number | null | undefined): void {
  if (!element || ratio === null || ratio === undefined || !Number.isFinite(ratio)) return;
  if ('ratio' in element) {
    (element as HTMLElement & { ratio: number }).ratio = ratio;
  } else {
    element.setAttribute('ratio', String(ratio));
  }
}

function setTabValue(element: HTMLElement, value: string): void {
  if ('value' in element) {
    (element as HTMLElement & { value: string }).value = value;
  } else {
    element.setAttribute('value', value);
  }
}

function applyLanguage(language: EditorLanguage, elements: EditorOptionsElements): void {
  currentLanguage = language;
  const dictionary = dictionaries[language];
  document.documentElement.lang = language;
  if (elements.languageSelect) elements.languageSelect.value = language;
  if (elements.defaultMaterialSelect) elements.defaultMaterialSelect.value = currentDefaultMaterialKind;

  applyTextContent(dictionary);
  applyAttribute(dictionary, 'data-i18n-label', 'label');
  applyAttribute(dictionary, 'data-i18n-title', 'title');
  applyAttribute(dictionary, 'data-i18n-aria-label', 'aria-label');
  applyAttribute(dictionary, 'data-i18n-placeholder', 'placeholder');
  setTabsOptions(elements.resourceTabs, dictionary.resourceTabs);
  setTabsOptions(elements.inspectorTabs, dictionary.inspectorTabs);
  window.dispatchEvent(new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { language } }));
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const value = dictionaries[currentLanguage].strings[key] ?? dictionaries[DEFAULT_LANGUAGE].strings[key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
}

export function getDefaultEditorMaterialKind(): EditorDefaultMaterialKind {
  return currentDefaultMaterialKind;
}

export function onEditorLanguageChange(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(LANGUAGE_CHANGE_EVENT, handler);
  return () => window.removeEventListener(LANGUAGE_CHANGE_EVENT, handler);
}

function applyTextContent(dictionary: EditorDictionary): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (!key) continue;
    element.textContent = dictionary.strings[key] ?? element.textContent;
  }
}

function applyAttribute(dictionary: EditorDictionary, dataKey: string, attribute: string): void {
  for (const element of document.querySelectorAll<HTMLElement>(`[${dataKey}]`)) {
    const key = element.getAttribute(dataKey);
    if (!key) continue;
    const value = dictionary.strings[key];
    if (value === undefined) continue;
    element.setAttribute(attribute, value);
    if (attribute === 'label' && 'label' in element) {
      (element as HTMLElement & { label: string }).label = value;
    }
  }
}

function setTabsOptions(element: HTMLElement | null, options: LocalizedOptions): void {
  if (!element) return;
  (element as HTMLElement & { options?: LocalizedOptions }).options = options;
  element.setAttribute('options', JSON.stringify(options));
}

function setPanelOpen(elements: EditorOptionsElements, open: boolean): void {
  if (elements.panel) elements.panel.hidden = !open;
  elements.button?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function readStoredLanguage(): EditorLanguage {
  return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
}

function normalizeLanguage(value: unknown): EditorLanguage {
  return value === 'en-US' ? 'en-US' : DEFAULT_LANGUAGE;
}

function readStoredDefaultMaterialKind(): EditorDefaultMaterialKind {
  return normalizeDefaultMaterialKind(localStorage.getItem(DEFAULT_MATERIAL_STORAGE_KEY));
}

function normalizeDefaultMaterialKind(value: unknown): EditorDefaultMaterialKind {
  return value === 'pbr' || value === 'basic' || value === 'blinn-phong' || value === 'normal' || value === 'depth'
    ? value
    : DEFAULT_MATERIAL_KIND;
}
