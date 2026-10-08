import assert from 'node:assert/strict';

export async function checkTutorialNoise(lab,driver,call) {
 const selected=['noise-1d-linear','noise-1d-smooth','noise-2d','noise-fbm','noise-3d','noise-fbm3d'];
 const compile=async(source,main)=>{
   await call('shader.code.set',{pass:'image',code:source.replace('fn mainImage(','fn lessonImage(')+main});
   const result=await call('shader.compile');assert.equal(result.compiled,true,JSON.stringify(result));
   await call('shader.playback.step');
 };
 const read=async()=>{const frame=await call('shader.image.read');return {frame,expression:`haiyueEditor.readResource(${JSON.stringify(frame.resourceId)})`};};
 if(selected.includes(lab.id)){
   let expressions=[];
   if(lab.id.startsWith('noise-1d')) expressions=[
     ['noise1(-2.0)-lattice1(-2)',0],
     ['noise1(-0.75)',null],
     ['abs(noise1(0.9999)-noise1(1.0001))',0]
   ];
   else if(lab.id==='noise-2d') expressions=[
     ['abs(noise2(vec2f(-2.0,3.0))-lattice2(vec2i(-2,3)))',0],
     ['abs(noise2(vec2f(0.9999,0.37))-noise2(vec2f(1.0001,0.37)))',0],
     ['noise2(vec2f(0.25,0.75))',null]
   ];
   else if(lab.id==='noise-fbm') expressions=[['fbm2(vec2f(-2.3,0.71))',null],['abs(fbm2(vec2f(0.9999,0.3))-fbm2(vec2f(1.0001,0.3)))',0]];
   else expressions=[['abs(noise3(vec3f(-2.0,3.0,1.0))-lattice3(vec3i(-2,3,1)))',0],['abs(noise3(vec3f(0.2,0.3,0.9999))-noise3(vec3f(0.2,0.3,1.0001)))',0],[lab.id==='noise-3d'?'noise3(vec3f(0.25,0.75,0.5))':'fbm3(vec3f(-1.23,2.41,0.71))',null]];
   const main=`
fn mainImage(p:vec2f)->vec4f {
 var value=0.0;
 switch i32(p.x/iResolution.x*${expressions.length}.0) {
 ${expressions.map(([e],i)=>`case ${i}: {value=${e};}`).join('\n')}
 default: {}
 }
 return vec4f(value,value,value,1.0);
}`;
   await compile(lab.code,main);
   const a=await read();const values=await driver.evaluate(`(()=>{const b=${a.expression};const out=[];for(let i=0;i<${expressions.length};i++)out.push(b[Math.floor((i+.5)*${a.frame.width}/${expressions.length})*4]);haiyueEditor.releaseResource(${JSON.stringify(a.frame.resourceId)});return out;})()`);
   expressions.forEach(([,expected],i)=>{if(expected===0)assert.ok(values[i]<=1,lab.id+': lattice interpolation/continuity');else assert.ok(values[i]>0 && values[i]<255,lab.id+': nondegenerate value');});
   // Identical coordinates and seed must produce the same value on later frames.
   const baseline=values.join(',');
   await call('shader.playback.step');const b=await read();
   const repeated=await driver.evaluate(`(()=>{const b=${b.expression};const out=[];for(let i=0;i<${expressions.length};i++)out.push(b[Math.floor((i+.5)*${b.frame.width}/${expressions.length})*4]);haiyueEditor.releaseResource(${JSON.stringify(b.frame.resourceId)});return out.join(",");})()`);
   assert.equal(repeated,baseline,'fixed noise does not change per frame');
 }
 if(!lab.id.startsWith('voxel-'))return;
 const grid=`
fn mainImage(p:vec2f)->vec4f {
 let index=i32(p.x)+i32(p.y)*i32(iResolution.x);
 if(index>=24576) {return vec4f(0.0,0.0,0.0,1.0);}
 let cell=vec3i(index%32-16,(index/32)%24,index/(32*24)-16);
 return vec4f(select(0.0,1.0,occupied(cell)),0.0,0.0,1.0);
}`;
 const field=async(source,save)=>{
   await compile(source,grid);const {frame,expression}=await read();assert.ok(frame.width*frame.height>=24576);
   return driver.evaluate(`(()=>{
    const bytes=${expression},cells=new Uint8Array(24576);let count=0,overhangs=0,outside=0,base=0;
    for(let i=0;i<cells.length;i++){const x=i%${frame.width},y=Math.floor(i/${frame.width});cells[i]=bytes[((${frame.height}-1-y)*${frame.width}+x)*4]>128?1:0;count+=cells[i];if(cells[i]&&window.__voxelHeight&&!window.__voxelHeight[i])outside++;}
    for(let z=0;z<32;z++)for(let x=0;x<32;x++){let gap=false,roof=false;for(let y=0;y<24;y++){const solid=cells[x+32*(y+24*z)];if(y<2)base+=solid;if(!solid)gap=true;else if(gap)roof=true;}if(roof)overhangs++;}
    if(${save})window.__voxelHeight=cells;
    haiyueEditor.releaseResource(${JSON.stringify(frame.resourceId)});return {count,overhangs,outside,base};
   })()`);
 };
 const original=await field(lab.code,lab.id==='voxel-height');
 assert.equal(original.base,2048,'two base layers remain solid');
 if(lab.id==='voxel-height') assert.equal(original.overhangs,0,'heightfield has one contiguous column');
 else {
   assert.ok(original.overhangs>10,'3D density creates solid above empty cells');
   assert.equal(original.outside,0,'caves only remove heightfield cells');
   const sparse=await field(lab.code.replace('CAVE_THRESHOLD: f32 = 0.46','CAVE_THRESHOLD: f32 = 0.65'),false);
   assert.ok(sparse.count<original.count,'raising density threshold removes solid voxels');
 }
 const rays=[
  [[0,-2,0],[0,1,0],2,[0,-1]],
  [[30,.5,0],[-1,0,0],6,[1,0]],
  [[30,.5,30],[-1,0,-1],6*Math.sqrt(2),[1,0]],
  [[-30,.5,-30],[1,0,1],6*Math.sqrt(2),[-1,0]],
  [[30,30,30],[1,1,1],-1,[0,0]]
 ];
 const rayMain=`
fn mainImage(p:vec2f)->vec4f {
 var ro=vec3f(0.0);var rd=vec3f(0.0,1.0,0.0);
 switch i32(p.x/iResolution.x*${rays.length}.0) {
 ${rays.map(([ro,rd],i)=>`case ${i}: {ro=vec3f(${ro.join(',')});rd=normalize(vec3f(${rd.join(',')}));}`).join('\n')}
 default: {}
 }
 let hit=traceVoxels(ro,rd);
 return vec4f(max(hit.distance,0.0)/32.0,hit.normal.xy*0.5+0.5,1.0);
}`;
 await compile(lab.code,rayMain);const {frame,expression}=await read();
 const pixels=await driver.evaluate(`(()=>{const bytes=${expression};const out=[];for(let i=0;i<${rays.length};i++){const offset=Math.floor((i+.5)*${frame.width}/${rays.length})*4;out.push(Array.from(bytes.slice(offset,offset+3)));}haiyueEditor.releaseResource(${JSON.stringify(frame.resourceId)});return out;})()`);
 rays.forEach(([, ,distance,n],i)=>{const expected=[Math.max(distance,0)/32*255,(n[0]*.5+.5)*255,(n[1]*.5+.5)*255];expected.forEach((v,k)=>assert.ok(Math.abs(pixels[i][k]-v)<2,lab.id+' DDA ray '+i+': '+pixels[i]+' vs '+expected));});
}
