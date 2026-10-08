import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/arrays');
mkdirSync(out,{recursive:true});
const source=readFileSync(new URL('./fixtures/arrays.glsl',import.meta.url),'utf8');
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
  // Use explicit temporaries for the reference's side-effecting l-values: the
  // WebGL backend on some adapters reevaluates indices while copying outputs.
  // Also lower aggregate ternaries (not accepted by WebGL) to equivalent if/else.
  const referenceSource=source.replace('float c[2]=column>0?a:b;', 'float c[2]; if(column>0)c=a;else c=b;')
    .replace('bump(a[i++]);','int saved=i++;bump(a[saved]);')
    .replace('items[i++].points[j++].yx+=','int savedI=i++,savedJ=j++;items[savedI].points[savedJ].yx+=')
    .replace('bump(items[i++].basis[j++][0][0]);','int savedI=i++,savedJ=j++;bump(items[savedI].basis[savedJ][0][0]);');
  const comparison=await evaluate(`(()=>{
   const canvas=document.createElement('canvas');canvas.width=${image.width};canvas.height=${image.height};
   const gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 unavailable');
   const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const vs=shader(gl.VERTEX_SHADER,'#version 300 es\\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}');
   const fs=shader(gl.FRAGMENT_SHADER,'#version 300 es\\nprecision highp float;\\nprecision highp int;\\nout vec4 result;\\n'+${JSON.stringify(referenceSource)}+'\\nvoid main(){mainImage(result,gl_FragCoord.xy);}');
   const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,3);
   const rgba=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
   const actual=haiyueEditor.readResource(${JSON.stringify(image.resourceId)});let max=0;const samples=[],reference=[];
   for(let y=0;y<4;y++)for(let x=0;x<8;x++){
    const a=(y*canvas.width+x)*4,b=((canvas.height-1-y)*canvas.width+x)*4;
    for(let ch=0;ch<4;ch++)max=Math.max(max,Math.abs(actual[a+ch]-rgba[b+ch]));
    if(y===0){samples.push(Array.from(actual.slice(a,a+4)));reference.push(Array.from(rgba.slice(b,b+4)));}
   }
   haiyueEditor.releaseResource(${JSON.stringify(image.resourceId)});gl.getExtension('WEBGL_lose_context')?.loseContext();
   return {max,samples,reference};
  })()`);
  assert.ok(comparison.max<=1,JSON.stringify(comparison));
  // Also assert arithmetic expectations independently of the WebGL reference.
  [153,102,108,179,83,204,191].forEach((v,i)=>assert.ok(Math.abs(v-comparison.samples[i][0])<=1));
  const nested=await compile('struct S{float a[2][2];};void change(inout float x){x+=0.1;}void mainImage(out vec4 c,in vec2 p){S s; s.a[1]=float[2](0.2,0.3);int i=1,j=0;change(s.a[i++][j++]);const float q[2][2]={{0.1,0.2},{0.3,0.4}};float a[2]=i>0?q[1]:q[0];c=vec4(s.a[1][0],a[1],float(i+j)*0.1,1.);}');
  const values=await evaluate(`(()=>{const p=haiyueEditor.readResource(${JSON.stringify(nested.resourceId)});const c=Array.from(p.slice(0,4));haiyueEditor.releaseResource(${JSON.stringify(nested.resourceId)});return c;})()`);
  [77,102,77,255].forEach((v,i)=>assert.ok(Math.abs(v-values[i])<=1,JSON.stringify(values)));
  const lengthImage=await compile('int count=0;float[2] make(){count++;return float[2](1.,2.);}void mainImage(out vec4 c,in vec2 p){float a[2][3];int i=0;int n=a[i++].length(),m=make().length();c=vec4(float(i)*0.1,float(count)*0.2,float(n+m)*0.1,1.);}');
  const lengthValues=await evaluate(`(()=>{const p=haiyueEditor.readResource(${JSON.stringify(lengthImage.resourceId)});const c=Array.from(p.slice(0,4));haiyueEditor.releaseResource(${JSON.stringify(lengthImage.resourceId)});return c;})()`);
  [26,51,128,255].forEach((v,i)=>assert.ok(Math.abs(v-lengthValues[i])<=1,JSON.stringify(lengthValues)));
  return {status:'passed',checks:['GLSL ES and WGSL matching pixels for initialized arrays, parameters/returns, indexed updates, struct/matrix arrays, equality and ternaries','Nested array constructors, braces, row assignment and inout indices compile and render on GPU'],comparison};
 }
});
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
