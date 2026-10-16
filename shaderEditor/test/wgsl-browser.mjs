import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
import {examples} from '../dist/examples.js';
import {TUTORIAL_LABS,tutorialProject} from '../dist/tutorialLabs.js';
import {createProject,passOf} from '../dist/model.js';
import {resolveChannelBindings} from '../dist/channelBindings.js';
import {exportShadertoy} from '../dist/shadertoyExport.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/wgsl');mkdirSync(out,{recursive:true});
const downloads=resolve(out,'downloads-'+Date.now());mkdirSync(downloads,{recursive:true});
const fixtures=[];
for(const p of [...examples().map(e=>e.project),...TUTORIAL_LABS.map(l=>tutorialProject(l.id))]){
 const bundle=await exportShadertoy(p);
 for(const pass of bundle.passes)fixtures.push({label:p.name+'/'+pass.pass,code:pass.code,dimensions:resolveChannelBindings(passOf(p,pass.pass),p.common).dimensions});
}

// Compile with exactly the declarations Shadertoy supplies. Render using an
// independent WebGL pipeline; none of the production WGSL wrappers are reused.
function installWebGlTest(){
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});
 if(!gl)throw Error('WebGL2 unavailable');
 window.exportGlTest={compile(code,dimensions=['2d','2d','2d','2d'],sound=false){
  const uniforms=`uniform vec3 iResolution;uniform float iTime,iTimeDelta,iFrameRate,iSampleRate;uniform int iFrame;uniform vec4 iMouse,iDate;uniform vec3 iChannelResolution[4];uniform float iChannelTime[4];`+dimensions.map((d,i)=>`uniform highp sampler${d==='cube'?'Cube':'2D'} iChannel${i};`).join('\n');
  const fragment='#version 300 es\nprecision highp float;precision highp int;\n'+uniforms+'\n'+code+'\nout vec4 testColor;void main(){'+(sound?'testColor=vec4(mainSound(int(gl_FragCoord.x), gl_FragCoord.x/44100.0),0.0,1.0);':'mainImage(testColor,gl_FragCoord.xy);')+'}';
  const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(log);}return s;};
  const vert=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
  let frag;try{frag=shader(gl.FRAGMENT_SHADER,fragment);}catch(e){gl.deleteShader(vert);throw e;}
  const p=gl.createProgram();gl.attachShader(p,vert);gl.attachShader(p,frag);gl.linkProgram(p);gl.deleteShader(vert);gl.deleteShader(frag);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
 },check(code,dimensions,sound){const p=this.compile(code,dimensions,sound);gl.deleteProgram(p);return true;},
 render(code,width,height,points,{sound=false,texture=false}={}){
  canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);
  const p=this.compile(code,undefined,sound);gl.useProgram(p);gl.disable(gl.DITHER);
  const loc=n=>gl.getUniformLocation(p,n);
  gl.uniform3f(loc('iResolution'),width,height,1);gl.uniform1f(loc('iSampleRate'),44100);gl.uniform1f(loc('iTime'),0);gl.uniform1i(loc('iFrame'),0);gl.uniform1f(loc('iTimeDelta'),1/60);
  for(let i=0;i<4;i++)gl.uniform3f(loc('iChannelResolution['+i+']'),width,height,1);
  let tex;
  if(texture){
   if(!gl.getExtension('OES_texture_float_linear'))throw Error('float linear textures unavailable');
   tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(loc('iChannel0'),0);
   const data=new Float32Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=(x+.5)/width;data[i+1]=(y+.5)/height;data[i+2]=.25;data[i+3]=1;}
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,data);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  }
  gl.drawArrays(gl.TRIANGLES,0,3);gl.finish();
  const pixels=points.map(([x,y])=>{const b=new Uint8Array(4);gl.readPixels(x,height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return Array.from(b);});
  if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL render error');gl.deleteProgram(p);if(tex)gl.deleteTexture(tex);return pixels;
 }};
}
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:downloads,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:90000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 const call=async(operation,params={})=>{const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');assert.equal(r.status,'completed',JSON.stringify(r));return r.value;};
 await evaluate('('+installWebGlTest.toString()+')()');
 for(const f of fixtures){try{await evaluate('exportGlTest.check('+JSON.stringify(f.code)+','+JSON.stringify(f.dimensions)+')');}catch(e){writeFileSync(resolve(out,'failed.glsl'),f.code);throw Error(f.label+': '+e.message);}}
 const original=await evaluate('JSON.stringify(shaderEditor.getProject())');
 // First export loads the local WASM in the browser, not the Node test process.
 await click('document.getElementById("shadertoy-button")');
 await waitFor(()=>evaluate('document.getElementById("shadertoy-dialog").open && !document.getElementById("copy-shadertoy").disabled'),'browser compiler initialized');
 assert.equal(await evaluate('JSON.stringify(shaderEditor.getProject())'),original);
 assert.ok(await evaluate('document.querySelectorAll("#shadertoy-code .cm-line span").length>4'),'GLSL highlighting');
 assert.equal(await evaluate('document.querySelectorAll("#shadertoy-channels li").length'),4);
 await click('document.getElementById("download-shadertoy")');await click('document.getElementById("download-shadertoy-all")');
 await waitFor(()=>readdirSync(downloads).some(f=>f.endsWith('.glsl'))&&readdirSync(downloads).some(f=>f.endsWith('-shadertoy.json')),'GLSL and all-pass downloads');
 const bundle=JSON.parse(readFileSync(resolve(downloads,readdirSync(downloads).find(f=>f.endsWith('-shadertoy.json'))),'utf8'));assert.equal(bundle.common,'');assert.equal(bundle.passes.length,1);assert.ok(bundle.passes[0].code);
 await nextPaint();const shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'export-dialog.png'),Buffer.from(shot.result.data,'base64'));
 await click('document.querySelector("#shadertoy-dialog .dialog-header button")');
 const source=`struct Material { color:vec3f, gain:f32 }
 fn mainImage(p:vec2f)->vec4f {
   let uv=p/iResolution.xy;
   var a:array<f32,3>; a[1]=.25;
   var m:Material; m.color=vec3f(uv, .25); m.gain=bitcast<f32>(1065353216u);
   var sum=0.; for(var i=0;i<3;i++){ if(i==0){continue;} sum+=a[i]; }
   let v=mat2x2f(1.,0.,0.,1.)*uv;
   return vec4f(v.x, m.color.y, sum*m.gain+(-3.5%2.+2.)*.25, 1.);
 }`;
 const p=createProject('Export pixel parity');passOf(p,'image').code=source;
 const open=async p=>{await evaluate('shaderEditor.open('+JSON.stringify(p)+')');await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'GPU project compiled');assert.deepEqual((await call('shader.query')).diagnostics.filter(d=>d.severity==='error'),[]);await call('shader.playback.set',{playing:false});await call('shader.playback.reset');await call('shader.playback.step');};
 const compare=async texture=>{
  const r=await call('shader.image.read');
  const points=[[5,5],[r.width-7,11],[11,r.height-7],[Math.floor(r.width*.37),Math.floor(r.height*.73)]];
  const gpu=await evaluate('(()=>{const b=haiyueEditor.readResource('+JSON.stringify(r.resourceId)+');const p='+JSON.stringify(points)+'.map(([x,y])=>Array.from(b.slice((y*'+r.width+'+x)*4,(y*'+r.width+'+x)*4+4)));haiyueEditor.releaseResource('+JSON.stringify(r.resourceId)+');return p;})()');
  const translated=await call('shader.shadertoy.export',{pass:'image'});assert.ok(translated.code,JSON.stringify(translated));
  const gl=await evaluate('exportGlTest.render('+JSON.stringify(translated.code)+','+r.width+','+r.height+','+JSON.stringify(points)+',{texture:'+texture+'})');
  gpu.forEach((point,i)=>point.forEach((v,c)=>assert.ok(Math.abs(v-gl[i][c])<=2,JSON.stringify({i,c,gpu:point,gl:gl[i]}))));
  return gpu;
 };
 const roundtrip=async texture=>{
  const native=await compare(texture),exported=await call('shader.shadertoy.export',{pass:'image'});
  const imported=await call('shader.glsl.translate',{pass:'image',code:exported.code});assert.ok(imported.code,JSON.stringify(imported.diagnostics));
  await call('shader.code.set',{pass:'image',code:imported.code});const compiled=await call('shader.compile');assert.equal(compiled.compiled,true,JSON.stringify(compiled));await call('shader.playback.reset');await call('shader.playback.step');
  const restored=await compare(texture);native.forEach((v,i)=>v.forEach((x,c)=>assert.ok(Math.abs(x-restored[i][c])<=2,JSON.stringify({native,restored}))));
 };
 await open(p);await roundtrip(false);
 passOf(p,'buffer-a').enabled=true;passOf(p,'buffer-a').code='fn mainImage(p:vec2f)->vec4f{return vec4f(p/iResolution.xy,.25,1.);}';passOf(p,'image').channels[0]={kind:'buffer',pass:'buffer-a'};
 passOf(p,'image').code=`fn mainImage(p:vec2f)->vec4f {
  let uv=p/iResolution.xy;let a=channel0(uv).r;
  let b=textureSampleLevel(iChannel0,iSampler,uv,0.).g;
  let c=textureLoad(iChannel0,vec2i(0,0),0).g;
  return vec4f(a,b,(c+dpdy(p.y)+2.)*.25,1.);
 }`;
 await open(p);await roundtrip(true);
 const sound='fn mainSound(s:i32,t:f32)->vec2f{return vec2f(f32(s%2)*.5,t*44100./16.);}';
 const sr=await call('shader.wgsl.translate',{code:sound,pass:'sound'});assert.ok(sr.code,JSON.stringify(sr));
 await evaluate('exportGlTest.check('+JSON.stringify(sr.code)+',undefined,true)');
 const sp=await evaluate('exportGlTest.render('+JSON.stringify(sr.code)+',8,1,[[0,0],[1,0],[7,0]],{sound:true})');
 sp.forEach((p,i)=>assert.ok(Math.abs(p[0]-(i===0?0:128))<=1));assert.ok(Math.abs(sp[2][1]-120)<=1);
 await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'none'}});
 const cube=await call('shader.wgsl.translate',{code:'// @haiyue-channel iChannel0 cube\nfn mainImage(p:vec2f)->vec4f{return channel0(normalize(vec3f(p,1.)));}'});assert.ok(cube.code);await evaluate('exportGlTest.check('+JSON.stringify(cube.code)+',["cube","2d","2d","2d"])');
 const invalid=await call('shader.wgsl.translate',{code:'fn mainImage(p:vec2f)->vec4f {\nreturn noSuchName;\n}'});assert.equal(invalid.code,null);assert.equal(invalid.diagnostics[0].line,2);
 return {status:'passed',compiledPasses:fixtures.length,checks:['Every Gallery/tutorial export compiled by real WebGL2','Lazy local WASM, read-only highlighted GLSL preview, channel list, current/all downloads','Independent WebGPU/WebGL pixel parity for arrays, structs, matrices, loops, bitcasts and signed float remainder','WGSL → GLSL → WGSL reimport preserves pixel values on real GPU','Raw versus convenience UV origins, textureLoad y coordinates and screen derivatives agree','Sound sample index/time and Cubemap entries compile; source diagnostics retain line numbers']};
}});console.log(JSON.stringify(report,null,2));
