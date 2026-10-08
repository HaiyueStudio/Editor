import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/assignments');
mkdirSync(out,{recursive:true});
const source=readFileSync(new URL('./fixtures/assignments.glsl',import.meta.url),'utf8');
const report=await runEditorBrowserScenario({root,downloadDirectory:out,route:'shaderEditor/app-dist/index.html#editor',timeoutMs:45000,
 failureScreenshotPath:resolve(out,'failure.png'),
 readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false" && shaderEditor.getStatus()?.ready',
 scenario:async({evaluate})=>{
  const call=async(operation,params={})=>{
   const r=await evaluate(`(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:${JSON.stringify(operation)},params:${JSON.stringify(params)}});})()`);
   assert.equal(r.status,'completed',JSON.stringify(r));return r.value;
  };
  const compile=async text=>{
   const t=await call('shader.glsl.translate',{code:text});assert.deepEqual(t.diagnostics,[]);assert.ok(t.code);
   await call('shader.code.set',{pass:'image',code:t.code});
   const c=await call('shader.compile');assert.equal(c.compiled,true,JSON.stringify(c));await call('shader.playback.step');
   return call('shader.image.read');
  };
  await call('shader.playback.set',{playing:false});
  const image=await compile(source);
  const referenceSource=source.replace('a[i++]=b[j++]=nextValue();','int savedI=i++,savedJ=j++;a[savedI]=b[savedJ]=nextValue();');
  const comparison=await evaluate(`(()=>{
   const canvas=document.createElement('canvas');canvas.width=${image.width};canvas.height=${image.height};
   const gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 unavailable');
   const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const vs=shader(gl.VERTEX_SHADER,'#version 300 es\\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}');
   const fs=shader(gl.FRAGMENT_SHADER,'#version 300 es\\nprecision highp float;\\nprecision highp int;\\nout vec4 result;\\n'+${JSON.stringify(referenceSource)}+'\\nvoid main(){mainImage(result,gl_FragCoord.xy);}');
   const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,3);
   const rgba=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
   const actual=haiyueEditor.readResource(${JSON.stringify(image.resourceId)});let max=0;const samples=[],reference=[];
   for(let y=0;y<4;y++)for(let x=0;x<16;x++){
    const a=(y*canvas.width+x)*4,b=((canvas.height-1-y)*canvas.width+x)*4;
    for(let ch=0;ch<4;ch++)max=Math.max(max,Math.abs(actual[a+ch]-rgba[b+ch]));
    if(y===0){samples.push(Array.from(actual.slice(a,a+4)));reference.push(Array.from(rgba.slice(b,b+4)));}
   }
   haiyueEditor.releaseResource(${JSON.stringify(image.resourceId)});gl.getExtension('WEBGL_lose_context')?.loseContext();
   return {max,samples,reference};
  })()`);
  assert.ok(comparison.max<=1,JSON.stringify(comparison));
  const expected=[.6,.5,.7,.6,.5,.3,.4,.5,.9,.8,.1,.6,.8,.5,.3,.5];
  expected.forEach((v,i)=>assert.ok(Math.abs(v*255-comparison.samples[i][0])<=1,JSON.stringify({i,actual:comparison.samples[i],expected:v})));
  const converted=await call('shader.glsl.translate',{code:source,pass:'buffer-a'});
  await call('shader.code.set',{pass:'buffer-a',code:converted.code});
  await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
  await call('shader.code.set',{pass:'image',code:'fn mainImage(p:vec2f)->vec4f{return channel0(p/iResolution.xy);}'});
  const compiled=await call('shader.compile');assert.equal(compiled.compiled,true,JSON.stringify(compiled));
  await call('shader.playback.step');
  const bufferImage=await call('shader.image.read');
  const actual=await evaluate(`(()=>{const p=haiyueEditor.readResource(${JSON.stringify(bufferImage.resourceId)});const values=Array.from(p.slice(0,64));haiyueEditor.releaseResource(${JSON.stringify(bufferImage.resourceId)});return values;})()`);
  expected.forEach((v,i)=>assert.ok(Math.abs(v*255-actual[i*4])<=1,JSON.stringify({i,actual:actual[i*4],expected:v})));
  return {status:'passed',checks:['Original chained q.x assignment with true/false unbraced branches','GLSL ES and WGSL pixels agree for sixteen assignment, aggregate, compound, indexed and lazy cases','RHS calls and indices execute once; chaining works in Image and Buffer'],comparison};
 }
});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
