import { EditorPlatform, createEditorAutomationAPI } from '@haiyue/editor-platform';
import type { EditorDocumentAdapter, EditorJsonValue, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import { createProject, codeOf, codeTabs, revealCodeTab, passOf, parseProject, validateProject, LIMITS, PASS_IDS, CUBE_FACES, type CubeFace, type CodeId, type RenderPassId, type PassId, type Channel, type PreviewMode, type PreviewMesh, type ShaderProject, type ShaderDiagnostic } from './model.js';
import { BUILTIN_TEXTURES } from './builtinTextures.js';
import { uploadVideo, uploadImage, uploadCubemap, type FaceUpload } from './textureUpload.js';
import { projectTranslationOptions, refreshProjectGlsl } from './glslProject.js';
import { translateGlsl } from './glsl.js';
import { CompileError, type ShaderRuntime, type PreparedShader } from './runtime.js';

export class ShaderDocument implements EditorDocumentAdapter<ShaderProject> {
  private project: ShaderProject = createProject();
  private readonly documentId = crypto.randomUUID();
  private listeners = new Set<() => void>();
  revision = 1;
  savedRevision = 0;
  get identity() { return { id: this.documentId, kind: 'haiyue.shader', name: this.project.name }; }
  get state(): Readonly<ShaderProject> { return this.project; }
  get dirty() { return this.revision !== this.savedRevision; }
  serialize() { return structuredClone(this.project); }
  replace(project: ShaderProject) { this.project = validateProject(project); this.revision++; this.emit(); }
  change(change: (project: ShaderProject) => void) { const next = this.serialize(); change(next); next.updatedAt = new Date().toISOString(); this.replace(next); }
  setCode(pass: CodeId, code: string) {
    if (typeof code !== 'string' || code.length > LIMITS.code) throw new Error('单个 Pass 代码不能超过 100 KB。');
    if (codeOf(this.project, pass) === code) return;
    this.project = { ...this.project }; revealCodeTab(this.project, pass);
    if (pass === 'common' || pass === 'sound') {
      this.project = { ...this.project, ...(pass === 'common' ? { common: code } : { sound: { ...this.project.sound, code } }), updatedAt: new Date().toISOString() };
      if (pass === 'common') delete this.project.commonGlsl; else delete this.project.sound.glsl;
      this.revision++; this.emit(); return;
    }
    this.project = { ...this.project, updatedAt: new Date().toISOString(), passes: this.project.passes.map(p => p.id === pass ? (({ glsl, ...native }) => ({ ...native, code }))(p) : p) };
    this.revision++; this.emit();
  }
  markSaved(revision = this.revision) { this.savedRevision = Math.min(revision, this.revision); this.emit(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return { dispose: () => { this.listeners.delete(listener); } }; }
  private emit() { for (const listener of this.listeners) listener(); }
  dispose() { this.listeners.clear(); }
}
type Params = { readonly [key: string]: EditorJsonValue };
export class ShaderWorkspace {
  readonly platform = new EditorPlatform();
  readonly api = createEditorAutomationAPI(this.platform);
  readonly document = new ShaderDocument();
  runtime: ShaderRuntime | undefined;
  diagnostics: ShaderDiagnostic[] = [];
  compiledRevision = 0;
  onCompiled: (() => void) | undefined;
  onOpen: (() => void) | undefined;
  private lastRevision = 0;
  applyGlsl(pass: CodeId, source: string) {
    const next = this.document.serialize();
    const result = translateGlsl(source, projectTranslationOptions(next, pass));
    if (result.code === null) throw new Error(result.diagnostics.map(d => `${d.source === 'common' ? 'Common ' : ''}${d.line}:${d.column} ${d.message}`).join('\n'));
    revealCodeTab(next, pass);
    if (pass === 'common') { next.commonGlsl = source; next.common = result.code; }
    else { const target = passOf(next, pass); target.glsl = source; target.code = result.code; }
    const diagnostics = refreshProjectGlsl(next);
    next.updatedAt = new Date().toISOString(); this.document.replace(next);
    return { ...result, diagnostics };
  }
  configuringSound = false;
  configureSound(settings: { duration?: number; volume?: number }) {
    const compiled = this.compiledRevision === this.document.revision;
    this.configuringSound = true;
    try { this.document.change(next => { if (settings.duration !== undefined) next.sound.duration = settings.duration; if (settings.volume !== undefined) next.sound.volume = settings.volume; }); }
    finally { this.configuringSound = false; }
    this.runtime?.setSoundVolume(this.document.state.sound.volume);
    this.runtime?.setSoundExportDuration(this.document.state.sound.duration);
    if (compiled) { this.compiledRevision = this.document.revision; this.onCompiled?.(); }
  }
  async start() {
    await this.platform.start({ schemaVersion: 1, id: 'haiyue.shader-editor', displayName: 'Haiyue Shader Editor', version: '0.1.0', requiredPlugins: [] });
    this.platform.documents.attach(this.document);
    this.document.subscribe(() => { if (this.lastRevision !== this.document.revision) { this.runtime?.invalidate(); this.lastRevision = this.document.revision; } });
    this.registerOperations();
  }
  open(project: ShaderProject) { void this.runtime?.setSoundAudible(false); this.document.replace(project); this.diagnostics = []; this.compiledRevision = 0; this.onOpen?.(); }
  private renderer() { if (!this.runtime) throw new Error('GPU 尚未就绪；请先打开编辑页。'); return this.runtime; }
  addPass(pass: CodeId) {
    if (codeTabs(this.document.state).includes(pass) && (pass === 'common' || passOf(this.document.state as ShaderProject, pass).enabled)) return;
    this.document.change(p => { revealCodeTab(p, pass); if (pass !== 'common') passOf(p, pass).enabled = true; });
  }
  setChannel(pass: RenderPassId, index: number, channel: Channel) {
    if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error('通道索引必须为 0–3。');
    this.document.change(p => { revealCodeTab(p, pass); if (channel.kind === 'buffer') { revealCodeTab(p, channel.pass); passOf(p, channel.pass).enabled = true; } passOf(p, pass).channels[index] = channel; });
  }
  setEnabled(pass: RenderPassId, enabled: boolean) {
    if (pass === 'sound' && !enabled) void this.runtime?.setSoundAudible(false);
    this.document.change(p => {
      revealCodeTab(p, pass);
      if (pass === 'image' && !enabled) throw new Error('Image 必须启用。');
      passOf(p, pass).enabled = enabled;
      if (!enabled) for (const item of p.passes) item.channels = item.channels.map(c => c.kind === 'buffer' && c.pass === pass ? { kind: 'none' } : c);
    });
  }
  async compile() {
    const revision = this.document.revision, runtime = this.renderer();
    let prepared: PreparedShader | undefined;
    let committed = false;
    try {
      prepared = await runtime.prepare(this.document.serialize());
      if (revision !== this.document.revision) { runtime.releasePrepared(prepared); return false; }
      runtime.commit(prepared); committed = true; this.diagnostics = prepared.diagnostics; this.compiledRevision = revision; this.onCompiled?.(); return true;
    } catch (error) {
      if (prepared && !committed) runtime.releasePrepared(prepared);
      if (revision !== this.document.revision) return false;
      if (error instanceof CompileError) { this.diagnostics = error.diagnostics; this.onCompiled?.(); return false; }
      throw error;
    }
  }
  preview(mode: PreviewMode, mesh: PreviewMesh) {
    this.document.change(p => { p.preview.mode = mode; p.preview.mesh = mesh; });
    this.runtime?.setMode(mode); this.runtime?.setMesh(mesh);
  }
  private registerOperations() {
    const empty = { type: 'object', properties: {} } as const;
    const pass = { type: 'string', enum: [...PASS_IDS, 'sound'] } as const;
    const short = { type: 'string', minLength: 1, maxLength: 160 } as const;
    const code = { type: 'string', maxLength: LIMITS.code } as const;
    const json = (value: unknown) => value as EditorJsonValue;
    const register = <T>(id: string, input: EditorOperationSchema, access: 'read' | 'write', prepare: (params: Params) => T | Promise<T>, commit: (value: T) => EditorJsonValue, rollback?: (value: T | undefined) => void) => {
      this.platform.operations.register({ ownerId: 'shader.core', descriptor: { id: `shader.${id}`, version: 1, title: id, target: 'document', documentKinds: ['haiyue.shader'], access, input, output: { type: 'json' } }, prepare, commit, rollback: value => rollback?.(value) });
    };
    register('query', empty, 'read', () => null, () => json({ project: { id: this.document.state.id, name: this.document.state.name }, revision: this.document.revision, compiledRevision: this.compiledRevision,
      tabs: codeTabs(this.document.state), common: this.document.state.common, commonGlsl: this.document.state.commonGlsl ?? null, sound: this.document.state.sound, passes: this.document.state.passes, assets: this.document.state.assets.map(asset => ({ id: asset.id, name: asset.name, kind: asset.kind ?? 'image' })), preview: this.document.state.preview, diagnostics: this.diagnostics, runtime: this.runtime?.status() ?? null }));
    register('code.set', { type: 'object', properties: { pass: { type: 'string', enum: ['common', 'sound', ...PASS_IDS] }, code }, required: ['pass', 'code'] }, 'write', p => p, p => { this.document.setCode(p.pass as CodeId, p.code as string); return { revision: this.document.revision }; });
    register('pass.add', { type: 'object', properties: { pass: { type: 'string', enum: ['common', 'sound', ...PASS_IDS.filter(id => id !== 'image')] } }, required: ['pass'] }, 'write', p => p, p => { this.addPass(p.pass as CodeId); return { revision: this.document.revision }; });
    register('pass.enable', { type: 'object', properties: { pass, enabled: { type: 'boolean' } }, required: ['pass', 'enabled'] }, 'write', p => p, p => { this.setEnabled(p.pass as RenderPassId, p.enabled as boolean); return { revision: this.document.revision }; });
    register('channel.set', { type: 'object', properties: { pass, index: { type: 'integer', minimum: 0, maximum: 3 }, channel: { type: 'json' } }, required: ['pass', 'index', 'channel'] }, 'write', p => p,
      p => { this.setChannel(p.pass as RenderPassId, p.index as number, p.channel as Channel); return { revision: this.document.revision }; });
    register('preview.set', { type: 'object', properties: { mode: { type: 'string', enum: ['canvas', 'scene'] }, mesh: { type: 'string', enum: ['sphere', 'box', 'torus'] } }, required: ['mode', 'mesh'] }, 'write', p => p,
      p => { this.preview(p.mode as PreviewMode, p.mesh as PreviewMesh); return { revision: this.document.revision }; });
    register('playback.set', { type: 'object', properties: { playing: { type: 'boolean' } }, required: ['playing'] }, 'write', p => p, p => { this.renderer().setPlaying(p.playing as boolean); return json(this.renderer().status()); });
    register('playback.reset', empty, 'write', () => null, () => { this.renderer().reset(); return json(this.renderer().status()); });
    register('playback.step', empty, 'write', () => null, () => { this.renderer().step(); return json(this.renderer().status()); });
    register('camera.reset', empty, 'write', () => null, () => { this.renderer().resetCamera(); return json(this.renderer().status()); });
    register('project.export', empty, 'read', () => new TextEncoder().encode(JSON.stringify(this.document.serialize(), null, 2)), bytes => json(this.platform.resources.put(bytes)));
    register('project.open', { type: 'object', properties: { resourceId: short }, required: ['resourceId'] }, 'write', p => parseProject(new TextDecoder('utf-8', { fatal: true }).decode(this.platform.resources.read(p.resourceId as string))), p => { this.open(p); return { projectId: p.id, revision: this.document.revision }; });
    const glslPass = { type: 'string', enum: ['common', 'sound', ...PASS_IDS] } as const;
    register('glsl.translate', { type: 'object', properties: { code, pass: glslPass }, required: ['code'] }, 'read', p => translateGlsl(p.code as string,
      p.pass ? projectTranslationOptions(this.document.state as ShaderProject, p.pass as CodeId) : this.document.state.commonGlsl === undefined ? {} : { common: this.document.state.commonGlsl }), result => json(result));
    register('glsl.apply', { type: 'object', properties: { code, pass: glslPass }, required: ['code', 'pass'] }, 'write', p => p,
      p => json(this.applyGlsl(p.pass as CodeId, p.code as string)));
    register('texture.upload', { type: 'object', properties: { resourceId: short, name: short, mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] } }, required: ['resourceId', 'name', 'mimeType'] }, 'write', async p => {
      const asset = await uploadImage(p.name as string, p.mimeType as string, this.platform.resources.read(p.resourceId as string));
      const next = this.document.serialize(); next.assets.push(asset); return { next: validateProject(next), id: asset.id };
    }, ({ next, id }) => { this.document.replace(next); return { assetId: id, revision: this.document.revision }; });
    register('textures.list', empty, 'read', () => null, () => json(BUILTIN_TEXTURES));
    register('video.upload', { type: 'object', properties: { resourceId: short, name: short, mimeType: { type: 'string', enum: ['video/mp4', 'video/webm'] } }, required: ['resourceId', 'name', 'mimeType'] }, 'write', async p => {
      const asset = await uploadVideo(p.name as string, p.mimeType as string, this.platform.resources.read(p.resourceId as string));
      const next = this.document.serialize(); next.assets.push(asset); return { next: validateProject(next), id: asset.id };
    }, ({ next, id }) => { this.document.replace(next); return { assetId: id, revision: this.document.revision }; });
    const face = { type: 'object', properties: { resourceId: short, mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] } }, required: ['resourceId', 'mimeType'] } as const;
    register('cubemap.upload', { type: 'object', properties: { name: short, faces: { type: 'object', properties: Object.fromEntries(CUBE_FACES.map(key => [key, face])), required: CUBE_FACES } }, required: ['name', 'faces'] }, 'write', async p => {
      const asset = await uploadCubemap(p.name as string, p.faces as unknown as Record<CubeFace, FaceUpload>, id => this.platform.resources.read(id));
      const next = this.document.serialize(); next.assets.push(asset); return { next: validateProject(next), id: asset.id };
    }, ({ next, id }) => { this.document.replace(next); return { assetId: id, revision: this.document.revision }; });
    register('compile', empty, 'write', async () => {
      const runtime = this.renderer();
      try { return { prepared: await runtime.prepare(this.document.serialize()), runtime, diagnostics: [] as ShaderDiagnostic[] }; }
      catch (error) { if (error instanceof CompileError) return { prepared: undefined, runtime, diagnostics: error.diagnostics }; throw error; }
    }, result => {
      if (result.prepared) { result.runtime.commit(result.prepared); this.compiledRevision = this.document.revision; }
      this.diagnostics = result.prepared?.diagnostics ?? result.diagnostics; this.onCompiled?.();
      return json({ compiled: Boolean(result.prepared), revision: this.compiledRevision, diagnostics: this.diagnostics });
    }, result => { if (result?.prepared) result.runtime.releasePrepared(result.prepared); });
    register('sound.configure', { type: 'object', properties: { duration: { type: 'number', minimum: 1, maximum: 120 }, volume: { type: 'number', minimum: 0, maximum: 1 } } }, 'write', p => p, p => {
      this.configureSound({ ...(typeof p.duration === 'number' ? { duration: p.duration } : {}), ...(typeof p.volume === 'number' ? { volume: p.volume } : {}) }); return json(this.document.state.sound);
    });
    register('sound.audible', { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] }, 'write', p => p, p => {
      if (p.enabled) throw new Error('开启音频请点击编辑器“开启声音”；API 可设置音量、暂停和导出 WAV。');
      void this.renderer().setSoundAudible(false); return json(this.renderer().status().sound);
    });
    register('sound.export', empty, 'read', () => this.renderer().exportSound(this.document.state.sound.duration), bytes => json({ ...this.platform.resources.put(bytes), mimeType: 'audio/wav' }));
    register('image.read', empty, 'read', async () => this.renderer().readImage(), result => json({ ...this.platform.resources.put(result.pixels), width: result.width, height: result.height, format: 'rgba8unorm', origin: 'top-left' }));
  }
  async dispose() { await this.platform.dispose(); await this.runtime?.dispose(); }
}
