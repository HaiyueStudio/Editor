import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';

const root=resolve(import.meta.dirname,'../..'), output=resolve(root,'shaderEditor/artifacts/cubemap');
mkdirSync(output,{recursive:true});
const downloads=resolve(output,'downloads');mkdirSync(downloads,{recursive:true});
const faces=['px','nx','py','ny','pz','nz'];
const direction=`vec3 direction(vec2 p) {
  vec2 uv=vec2(fract(p.x/iResolution.x*6.0),1.0-p.y/iResolution.y);
  float s=uv.x*2.0-1.0,t=uv.y*2.0-1.0;
  int face=min(int(p.x/iResolution.x*6.0),5);
  if(face==0)return vec3(1.0,-t,-s);
  if(face==1)return vec3(-1.0,-t,s);
  if(face==2)return vec3(s,1.0,t);
  if(face==3)return vec3(s,-1.0,-t);
  if(face==4)return vec3(s,-t,1.0);
  return vec3(-s,-t,-1.0);
}`;
const helpers=`vec4 read(samplerCube tex,vec3 d){
  vec3 n=vec3(0.0,1.0,0.0),rd=reflect(d,n),col=vec3(0.0);float fres=1.0;
  col=mix(col,texture(tex,reflect(rd,n)).rgb,fres);
  return vec4(col,1.0);
}
vec4 read(sampler2D tex,vec2 uv){return texture(tex,uv);}
void env(samplerCube tex,vec3 d,inout vec4 col){
  col=d.x>0.0?read(tex,d):textureCube(tex,d);
}
`;
const buffer=direction+helpers+`void mainImage(out vec4 c,in vec2 p){
  c=vec4(0.0);env(iChannel0,direction(p),c);
  c=(c+textureLod(iChannel0,direction(p),0.0))*0.5;
}`;
const image=direction+helpers+`void mainImage(out vec4 c,in vec2 p){
  vec2 uv=p/iResolution.xy;
  c=(read(iChannel0,uv)+read(iChannel2,direction(p))+textureCube(iChannel3,direction(p)))/3.0;
  c.rgb+=texture(iChannel1,uv).rgb;
  ivec2 size=textureSize(iChannel2,0);if(size.x!=32||size.y!=32||iChannelResolution[2].x!=32.0)c=vec4(1.0,0.0,0.0,1.0);
}`;

const report=await runEditorBrowserScenario({root,downloadDirectory:downloads,route:'shaderEditor/app-dist/index.html#editor',
  failureScreenshotPath:resolve(output,'failure.png'),timeoutMs:45000,
  readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false" && window.shaderEditor?.getStatus()?.ready',
  scenario:async driver=>{
    const {evaluate,click,waitFor,nextPaint,cdp,setFileInputFiles}=driver,checks=[];
    const api=(operation,params={})=>evaluate(`(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:${JSON.stringify(operation)},params:${JSON.stringify(params)}});})()`);
    const call=async(op,p)=>{const r=await api(op,p);assert.equal(r.status,'completed',JSON.stringify(r));return r.value;};
    const shot=async name=>{await nextPaint();const s=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(output,name),Buffer.from(s.result.data,'base64'));};
    const project=()=>evaluate('shaderEditor.getProject()');
    const compile=async()=>{const r=await call('shader.compile');assert.equal(r.compiled,true,JSON.stringify(r));await call('shader.playback.step');};
    const checkPixels=async()=>{
      const image=await call('shader.image.read');
      const samples=await evaluate(`(()=>{const bytes=haiyueEditor.readResource(${JSON.stringify(image.resourceId)}),w=${image.width},h=${image.height},out=[];
        for(let face=0;face<6;face++)for(const v of [.25,.75])for(const u of [.25,.75]){const x=Math.floor((face+u)*w/6),y=Math.floor(v*h),i=(y*w+x)*4;out.push({face,u,v,color:Array.from(bytes.slice(i,i+4))});}
        haiyueEditor.releaseResource(${JSON.stringify(image.resourceId)});return out;})()`);
      for(const {face,u,v,color} of samples){
        const expected=[16+face*32,u<.5?64:192,v<.5?64:192,255];
        expected.forEach((n,i)=>assert.ok(Math.abs(n-color[i])<=2,JSON.stringify({face,u,v,color,expected})));
      }
      return samples;
    };
    await call('shader.playback.set',{playing:false});
    // Regression: translate/apply BEFORE selecting any texture. The source owns
    // its cube types, and unbound inputs must have valid black cube views.
    const emptyGlsl='uniform samplerCube iChannel2;vec4 read(samplerCube t,vec3 p){return texture(t,p);}void mainImage(out vec4 c,in vec2 p){vec3 rd=vec3(1.0),n=vec3(0.0,1.0,0.0);c=(texture(iChannel0,reflect(rd,n))+textureLod(iChannel1,rd,0.0)+read(iChannel2,rd)+textureCube(iChannel3,rd))/4.0;}';
    const legacy=await call('shader.glsl.translate',{code:'void mainImage(out vec4 c,in vec2 p){c=texture(iChannel0,vec3(1.0));}'});
    await call('shader.code.set',{pass:'image',code:legacy.code.replace(/^\/\/ @haiyue-channel.*\n/gm,'')});
    const legacyError=await call('shader.compile');
    assert.equal(legacyError.compiled,false);
    assert.ok(legacyError.diagnostics.some(d=>d.message.includes('iChannel0') && d.message.includes('重新翻译')));
    await click('document.getElementById("glsl-button")');
    await click('document.querySelector("#glsl-source .cm-content")');
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
    await cdp.call('Input.insertText',{text:emptyGlsl});
    await click('document.getElementById("translate-glsl")');
    await waitFor(()=>evaluate('!document.getElementById("apply-glsl").disabled'),'unbound cube translation');
    await click('document.getElementById("apply-glsl")');
    await waitFor(()=>evaluate('!document.getElementById("glsl-dialog").open && !document.getElementById("compile").disabled'),'unbound cube applied');
    const compiledEmpty=await call('shader.compile');
    assert.equal(compiledEmpty.compiled,true,JSON.stringify(compiledEmpty));
    assert.equal(compiledEmpty.diagnostics.length,4);
    assert.ok(compiledEmpty.diagnostics.every(d=>d.severity==='warning' && d.message.includes('黑色占位')));
    await call('shader.playback.step');
    const blank=await call('shader.image.read');
    const blankPixel=await evaluate(`(()=>{const data=haiyueEditor.readResource(${JSON.stringify(blank.resourceId)});haiyueEditor.releaseResource(${JSON.stringify(blank.resourceId)});return Array.from(data.slice(0,4));})()`);
    assert.deepEqual(blankPixel,[0,0,0,255]);
    assert.ok((await project()).passes[4].channels.every(c=>c.kind==='none'));
    assert.equal((await project()).assets.length,0);
    const emptyExport=await call('shader.project.export');
    await call('shader.project.open',{resourceId:emptyExport.resourceId});
    await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(emptyExport.resourceId)})`);
    await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'empty cube import completed');
    await compile();
    assert.match((await project()).passes[4].code,/@haiyue-channel iChannel0 cube/);
    checks.push('Legacy vec3/vec2 errors explain binding; UI translation/apply with four empty cube inputs compiles, samples opaque black, warns per channel and survives export/import without creating assets');
    const pngs=await evaluate(`(()=>{const result=[];for(let face=0;face<8;face++){
      const c=document.createElement('canvas');c.width=32;c.height=face===6?16:32;const x=c.getContext('2d');
      for(let y=0;y<2;y++)for(let u=0;u<2;u++){x.fillStyle=face===7?'black':'rgb('+(16+face*32)+','+(u?192:64)+','+(y?192:64)+')';x.fillRect(u*16,y*16,16,16);}
      result.push(c.toDataURL('image/png'));
    }return result;})()`);
    const paths=pngs.map((url,i)=>{const path=resolve(output,`face-${i}.png`);writeFileSync(path,Buffer.from(url.split(',')[1],'base64'));return path;});
    await evaluate('document.querySelector(".upload-cubemap").scrollIntoView({block:"center"})');
    await click('document.querySelector(".upload-cubemap")');
    for(let i=0;i<6;i++)await setFileInputFiles('#cubemap-'+faces[i],[paths[i===5?6:i]]);
    const before=await project();
    await click('document.getElementById("cubemap-submit")');
    await waitFor(()=>evaluate('document.getElementById("cubemap-error").textContent.includes("尺寸相同") && !document.getElementById("cubemap-submit").disabled'),'mismatched face rejected');
    assert.deepEqual(await project(),before,'failed six-face upload is atomic');
    await setFileInputFiles('#cubemap-nz',[paths[5]]);
    await shot('six-face-upload.png');
    await click('document.getElementById("cubemap-submit")');
    await waitFor(()=>evaluate('!document.getElementById("cubemap-dialog").open && shaderEditor.getProject().assets.length===1 && !document.getElementById("compile").disabled'),'UI cube uploaded and compiled');
    const afterUpload=await call('shader.compile');
    assert.equal(afterUpload.compiled,true,JSON.stringify(afterUpload));
    assert.equal(afterUpload.diagnostics.filter(d=>d.message.includes('iChannel0')).length,0,'upload fixes the previously empty cube without retranslating');
    assert.equal(afterUpload.diagnostics.filter(d=>d.severity==='warning').length,3);
    const cube=(await project()).assets[0];assert.equal(cube.kind,'cubemap');assert.deepEqual(Object.keys(cube.faces),faces);
    assert.equal(await evaluate('document.querySelectorAll(".cubemap-preview img").length'),6);
    checks.push('Six named upload inputs preview images, reject mismatched sizes atomically, and bind the cube with six thumbnail faces');
    // Upload a second cube and a normal image through the same public API/IPC operations.
    const resources=[];
    try{
      const uploads={};
      for(let i=0;i<8;i++){
        const r=await evaluate(`haiyueEditor.putResource(Uint8Array.from(atob(${JSON.stringify(pngs[i].split(',')[1])}),c=>c.charCodeAt(0)))`);
        resources.push(r.resourceId);
        if(i<6)uploads[faces[i]]={resourceId:r.resourceId,mimeType:'image/png'};
      }
      const bad={...uploads,nz:{resourceId:resources[6],mimeType:'image/png'}};
      const snapshot=await project();assert.equal((await api('shader.cubemap.upload',{name:'Invalid',faces:bad})).status,'failed');assert.deepEqual(await project(),snapshot);
      const uploaded=await call('shader.cubemap.upload',{name:'API cube',faces:uploads});
      const flat=await call('shader.texture.upload',{name:'Black',resourceId:resources[7],mimeType:'image/png'});
      await call('shader.channel.set',{pass:'buffer-a',index:0,channel:{kind:'cubemap',assetId:cube.id}});
      await call('shader.pass.enable',{pass:'buffer-a',enabled:true});
      await call('shader.channel.set',{pass:'image',index:0,channel:{kind:'buffer',pass:'buffer-a'}});
      await call('shader.channel.set',{pass:'image',index:1,channel:{kind:'image',assetId:flat.assetId}});
      await call('shader.channel.set',{pass:'image',index:2,channel:{kind:'cubemap',assetId:uploaded.assetId}});
      await call('shader.channel.set',{pass:'image',index:3,channel:{kind:'cubemap',assetId:cube.id}});
    }finally{for(const id of resources)await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(id)})`);}
    for(const [pass,code] of [['buffer-a',buffer],['image',image]]){
      const translated=await call('shader.glsl.translate',{pass,code});
      assert.deepEqual(translated.diagnostics,[]);
      await call('shader.code.set',{pass,code:translated.code});
      writeFileSync(resolve(output,pass+'.wgsl'),translated.code);
    }
    await compile();const sampled=await checkPixels();await shot('mixed-channels.png');
    checks.push('Real GPU verifies all six faces and four quadrants per face, with reflection, textureCube/textureLod, cube helper/output parameters, lazy branches, and mixed image/buffer/cube slots across passes');
    // The GPU renders translated cube parameter overloads, not just direct channel helpers.
    await call('shader.preview.set',{mode:'scene',mesh:'sphere'});
    await nextPaint();await shot('cube-material.png');await checkPixels();
    await call('shader.preview.set',{mode:'canvas',mesh:'sphere'});
    checks.push('Cubemap shaders work in both fullscreen and Haiyue 3D material preview');
    const saved=await project();
    await call('shader.channel.set',{pass:'image',index:2,channel:{kind:'image',assetId:saved.passes[4].channels[1].assetId}});
    const mismatch=await call('shader.glsl.translate',{pass:'image',code:image});
    assert.equal(mismatch.code,null);assert.match(mismatch.diagnostics[0].message,/类型冲突/);
    const boundError=await call('shader.compile');
    assert.equal(boundError.compiled,false);
    assert.ok(boundError.diagnostics.some(d=>d.message.includes('iChannel2') && d.message.includes('普通二维图片')));
    await checkPixels();
    await call('shader.channel.set',{pass:'image',index:2,channel:saved.passes[4].channels[2]});await compile();
    checks.push('Dimension mismatch gives a GLSL diagnostic; failed WGSL compile preserves the last working GPU output');
    const exported=await call('shader.project.export');
    const bytes=await evaluate(`Array.from(haiyueEditor.readResource(${JSON.stringify(exported.resourceId)}))`);
    const serialized=JSON.parse(Buffer.from(bytes).toString('utf8'));
    assert.deepEqual(serialized.assets,(await project()).assets);
    await call('shader.project.open',{resourceId:exported.resourceId});
    await evaluate(`haiyueEditor.releaseResource(${JSON.stringify(exported.resourceId)})`);
    await waitFor(()=>evaluate('!document.getElementById("compile").disabled && shaderEditor.getStatus().ready'),'imported cubemap compiled');
    await compile();await checkPixels();
    await evaluate('document.getElementById("save-project").scrollIntoView({block:"center"})');
    await click('document.getElementById("save-project")');
    await waitFor(()=>evaluate('document.getElementById("save-state").textContent.includes("已保存")'),'saved Cubemap project');
    const stored=await project();
    await cdp.call('Page.reload',{ignoreCache:true});
    await waitFor(()=>evaluate('document.querySelector("#app")?.getAttribute("aria-busy")==="false" && window.shaderEditor?.getStatus()?.ready && !document.getElementById("compile").disabled'),'saved cube restored after reload');
    await call('shader.playback.set',{playing:false});await call('shader.playback.step');
    assert.deepEqual((await project()).assets,stored.assets);await checkPixels();
    checks.push('Export/import and saved-project reload preserve all six embedded images and render identical pixels');
    driver.assertNoBrowserErrors();
    return {status:'passed',checks,sampled,buildHash:JSON.parse(readFileSync(resolve(root,'shaderEditor/app-dist/app-manifest.json'))).buildHash};
  }});
writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
