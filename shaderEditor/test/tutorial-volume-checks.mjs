import assert from 'node:assert/strict';

export async function checkTutorialVolume(lab, driver, call) {
  if (!lab.id.startsWith('volume-')) return;
  const sphere=lab.id==='volume-sphere';
  // Analytic path lengths are independent references for the probe rays.
  const cases=sphere ? [
    {ro:[0,0,3],rd:[0,0,-1],enter:2.25,length:1.5},
    {ro:[.7,0,3],rd:[0,0,-1],enter:3-Math.sqrt(.75**2-.7**2),length:2*Math.sqrt(.75**2-.7**2)},
    {ro:[.9,0,3],rd:[0,0,-1],enter:0,length:0},
    {ro:[0,0,0],rd:[1,0,0],enter:0,length:.75},
    {ro:[0,0,3],rd:[0,0,1],enter:0,length:0},
  ] : [
    {ro:[0,0,3],rd:[0,0,-1],enter:2.4,length:1.2},
    {ro:[.59,0,3],rd:[0,0,-1],enter:2.4,length:1.2},
    {ro:[.7,0,3],rd:[0,0,-1],enter:0,length:0},
    {ro:[0,0,0],rd:[1,0,0],enter:0,length:.6},
    {ro:[0,0,3],rd:[0,0,1],enter:0,length:0},
    {ro:[.6,0,3],rd:[0,0,-1],enter:2.4,length:1.2},
    {ro:[2,2,2],rd:[-1,-1,-1],enter:1.4*Math.sqrt(3),length:1.2*Math.sqrt(3)},
  ];
  const probes=cases.map((c,i)=>`case ${i}: { ro=vec3f(${c.ro.join(',')}); rd=normalize(vec3f(${c.rd.join(',')})); }`).join('\n');
  const probeMain=`
fn mainImage(fragCoord: vec2f) -> vec4f {
 var ro=vec3f(0.0); var rd=vec3f(0.0,0.0,-1.0);
 switch i32(floor(fragCoord.x/iResolution.x*${cases.length}.0)) {
 ${probes}
 default: {}
 }
 let segment=volumeInterval(ro,rd);
 let volume=shadeVolume(ro,rd,segment);
 return vec4f(volume.a,max(segment.y-segment.x,0.0)/3.0,volume.r,1.0);
}
`;
  const check=async(source,density=()=>1,extinction=1.2)=>{
    await call('shader.code.set',{pass:'image',code:source.replace('fn mainImage(','fn lessonImage(')+probeMain});
    const compile=await call('shader.compile');assert.equal(compile.compiled,true,JSON.stringify(compile));
    await call('shader.playback.step');
    const frame=await call('shader.image.read');
    const actual=await driver.evaluate(`(()=>{const bytes=haiyueEditor.readResource(${JSON.stringify(frame.resourceId)}),w=${frame.width},h=${frame.height};const out=[];
      for(let j=0;j<${cases.length};j++){const offset=(Math.floor(h/2)*w+Math.floor((j+.5)*w/${cases.length}))*4;out.push(Array.from(bytes.slice(offset,offset+4)));}
      haiyueEditor.releaseResource(${JSON.stringify(frame.resourceId)});return out;})()`);
    cases.forEach((c,i)=>{
      const length=Math.hypot(...c.rd),direction=c.rd.map(x=>x/length);
      let opticalDepth=0;const n=4096;
      for(let j=0;j<n;j++){const t=c.enter+(j+.5)*c.length/n;opticalDepth+=density(c.ro.map((x,k)=>x+direction[k]*t))*c.length/n;}
      const alpha=1-Math.exp(-extinction*opticalDepth);
      const expected=[alpha*255,c.length/3*255,alpha*.08*255,255];
      expected.forEach((value,k)=>assert.ok(Math.abs(actual[i][k]-value)<=2,lab.id+' probe '+i+' component '+k+': '+actual[i][k]+' vs '+value));
    });
    return actual;
  };
  if(lab.id==='volume-march'){
    const density=([x,y,z])=>.25+.75*(.5+.5*Math.sin(x*8+2*Math.sin(y*5))*Math.sin(z*7))**2;
    await check(lab.code,density);
    const uniform=lab.code.replace(/fn volumeDensity\([\s\S]*?(?=fn shadeVolume)/,'fn volumeDensity(p:vec3f)->f32 { return 1.0; }\n');
    for(const steps of [16,64,128]) await check(uniform.replace('VOLUME_STEPS: i32 = 64','VOLUME_STEPS: i32 = '+steps));
  } else {
    await check(lab.code);
    await check(lab.code.replace('EXTINCTION: f32 = 1.2','EXTINCTION: f32 = 0.0'),()=>1,0);
  }
}
