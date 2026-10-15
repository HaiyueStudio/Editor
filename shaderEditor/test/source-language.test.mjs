import test from 'node:test';
import assert from 'node:assert/strict';
import {detectShaderLanguage, languageOf, sourceOf, defaultGlsl} from '../dist/sourceLanguage.js';
import {ShaderWorkspace} from '../dist/workspace.js';
import {createProject, parseProject, passOf, validateProject} from '../dist/model.js';
import {refreshProjectGlsl, projectTranslationOptions} from '../dist/glslProject.js';

test('language detection ignores comments and refuses ambiguous or mixed syntax', () => {
 for (const source of [defaultGlsl('image'), defaultGlsl('sound'), '#define GAIN 1.0', 'float gain(float x) { return x; }', 'vec2 p;', 'mat2 rotation;'])
  assert.equal(detectShaderLanguage(source),'glsl',source);
 for (const source of ['fn f() -> f32 { return 1.0; }', 'let x: f32 = 1.0;', 'var<private> x: f32;', '@fragment fn f() {}','vec4f(1.0)', 'let x = 1.0;', 'struct Sample { color: vec4f, }', 'alias Scalar = f32;', 'vec3<f32>(1.0)'])
  assert.equal(detectShaderLanguage(source),'wgsl',source);
 for (const source of ['', '// void mainImage() {}\n/* fn x() {} */', 'return sin(iTime);', 'const GAIN = 1.0;', 'fn mainImage() {}\nfloat x;'])
  assert.equal(detectShaderLanguage(source),null,source);
});

test('language choices preserve independent drafts including incomplete GLSL and survive export', () => {
 const w=new ShaderWorkspace(), native=sourceOf(w.document.state,'image');
 w.setLanguage('image','glsl'); assert.equal(sourceOf(w.document.state,'image'),defaultGlsl('image'));
 w.document.setSource('image','void mainImage(','glsl');
 w.setLanguage('image','wgsl'); assert.equal(sourceOf(w.document.state,'image'),native);
 w.document.setSource('image',native+'\n// WGSL draft','wgsl');
 w.setLanguage('image','glsl'); assert.equal(sourceOf(w.document.state,'image'),'void mainImage(');
 const saved=parseProject(JSON.stringify(w.document.serialize()));
 assert.equal(sourceOf(saved,'image'),'void mainImage(');
 assert.equal(passOf(saved,'image').code,native+'\n// WGSL draft');
 const snapshot=structuredClone(saved), errors=refreshProjectGlsl(snapshot);
 assert.ok(errors.some(d=>d.pass==='image'&&d.language==='glsl'&&d.severity==='error'));
 w.setLanguage('image','wgsl');
 assert.deepEqual(refreshProjectGlsl(w.document.serialize()),[],'inactive invalid GLSL never compiles');
 assert.equal(sourceOf(w.document.state,'image'),native+'\n// WGSL draft');
});

test('GLSL Common and Pass originals link on runtime snapshots without modifying editor drafts', () => {
 const w=new ShaderWorkspace();
 w.document.setSource('common','float gain(float x) { return x * .4; }','glsl');
 for(const id of ['image','buffer-a'])w.document.setSource(id,'void mainImage(out vec4 c, in vec2 p) { c=vec4(gain(.5)); }','glsl');
 w.document.setSource('sound','vec2 mainSound(int s, float t) { return vec2(gain(t)); }','glsl');
 const original=w.document.serialize(), snapshot=w.document.serialize();
 assert.deepEqual(refreshProjectGlsl(snapshot),[]);
 for(const id of ['image','buffer-a','sound']) {
  assert.match(passOf(snapshot,id).code,/@haiyue-common-included/);
  assert.equal(passOf(snapshot,id).glsl,passOf(original,id).glsl);
  assert.notEqual(passOf(snapshot,id).code,passOf(original,id).code);
 }
 assert.deepEqual(w.document.serialize(),original);
 w.document.setSource('common','const gain = 0.3;','wgsl');
 assert.equal(projectTranslationOptions(w.document.serialize(),'image').common,undefined);
 w.setLanguage('common','glsl');assert.equal(sourceOf(w.document.state,'common'),original.commonGlsl);
});

test('legacy imported GLSL is editable by default; malformed language metadata is rejected', () => {
 const project=createProject();
 assert.equal(languageOf(project,'image'),'wgsl');
 passOf(project,'image').glsl=defaultGlsl('image');
 assert.equal(languageOf(validateProject(project),'image'),'glsl');
 for(const editorLanguages of [{image:'other'}, {unknown:'wgsl'}, [], {sound:'glsl'}])
  assert.throws(()=>validateProject({...project,editorLanguages}),/语言/);
 project.editorLanguages={image:'wgsl'};
 assert.equal(languageOf(parseProject(JSON.stringify(project)),'image'),'wgsl');
});


test('source API reports language, rejects stale writes and shares assets without mutating prior drafts', async () => {
 const w=new ShaderWorkspace(); await w.start();
 try {
  const call=(operation,params={},revision=w.document.revision)=>w.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:w.document.identity.id,expectedRevision:revision,operation,params});
  const prior=w.document.state, revision=w.document.revision, source=defaultGlsl('image');
  assert.equal((await call('shader.source.set',{pass:'image',language:'glsl',code:source})).status,'completed');
  assert.equal(w.document.state.assets,prior.assets);
  assert.equal(prior.editorLanguages,undefined); assert.equal(passOf(prior,'image').glsl,undefined);
  assert.equal((await call('shader.query')).value.editorLanguages.image,'glsl');
  assert.notEqual((await call('shader.source.set',{pass:'image',language:'wgsl',code:'bad'},revision)).status,'completed');
  assert.equal(sourceOf(w.document.state,'image'),source);
  const r=w.document.revision;
  assert.equal((await call('shader.source.set',{pass:'image',language:'glsl',code:source})).status,'completed');
  assert.equal(w.document.revision,r,'identical source writes do not dirty the document');
 } finally { await w.dispose(); }
});
