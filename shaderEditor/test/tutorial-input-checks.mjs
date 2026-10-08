import assert from 'node:assert/strict';

export async function checkTutorialInput(lab, driver, call) {
  if (!['mouse-position','mouse-drag','keyboard-held','keyboard-toggle','keyboard-movement'].includes(lab)) return;
  const {evaluate,cdp,nextPaint}=driver;
  const sample=async()=>{
    const result=await call('shader.image.read');
    return evaluate(`(()=>{const bytes=haiyueEditor.readResource(${JSON.stringify(result.resourceId)});let hash=2166136261;
      for(const value of bytes) hash=Math.imul(hash^value,16777619)>>>0;
      const pixel=Array.from(bytes.slice(0,4));haiyueEditor.releaseResource(${JSON.stringify(result.resourceId)});return {hash,pixel};})()`);
  };
  const key=async(type,name,repeat=false)=>{
    const codes={ArrowRight:39,ArrowLeft:37,ArrowUp:38,ArrowDown:40,Space:32,KeyR:82};
    await cdp.call('Input.dispatchKeyEvent',{type,key:name==='Space'?' ':name==='KeyR'?'r':name,code:name,windowsVirtualKeyCode:codes[name],autoRepeat:repeat});
    await nextPaint();
  };
  await evaluate('document.getElementById("shader-canvas").focus({preventScroll:true})');
  if(lab.startsWith('mouse-')){
    const rect=await evaluate('(()=>{const r=document.getElementById("shader-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
    const move=async(x,y,buttons=0)=>{await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+rect.width*x,y:rect.y+rect.height*y,button:buttons?'left':'none',buttons});await nextPaint();};
    const time=await evaluate('shaderEditor.getStatus().time');
    await move(.4,.5);await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:rect.x+rect.width*.4,y:rect.y+rect.height*.5});
    await nextPaint();const start=await sample();
    await move(.7,.35,1);const held=await sample();assert.notEqual(start.hash,held.hash,lab+': paused drag updates image');
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:rect.x+rect.width*.7,y:rect.y+rect.height*.35});
    await nextPaint();const released=await sample();
    if(lab==='mouse-position') assert.equal(released.hash,held.hash,'release retains last position');
    else assert.notEqual(released.hash,held.hash,'release changes drag line color');
    await move(.2,.8);assert.equal((await sample()).hash,released.hash,'hover retains last drag position');
    assert.equal(await evaluate('shaderEditor.getStatus().time'),time,'mouse refresh does not advance paused time');
  } else if(lab==='keyboard-held'){
    const base=await sample();await key('keyDown','ArrowRight');const held=await sample();assert.notEqual(held.hash,base.hash);
    await key('keyUp','ArrowRight');assert.equal((await sample()).hash,base.hash,'held input has no position memory');
    await evaluate('document.querySelector("#code-editor .cm-content").focus()');
    await key('keyDown','ArrowRight');await key('keyUp','ArrowRight');assert.equal((await sample()).hash,base.hash,'editing does not trigger shader keyboard input');
  } else if(lab==='keyboard-toggle'){
    const base=await sample();await key('keyDown','Space');await nextPaint();const held=await sample();
    await key('keyDown','Space',true);assert.equal((await sample()).hash,held.hash,'repeat neither pulses nor flips');
    await key('keyUp','Space');const toggled=await sample();assert.notEqual(toggled.hash,base.hash);
    await key('keyDown','Space');await key('keyUp','Space');assert.equal((await sample()).hash,base.hash,'second press returns to original theme');
  } else {
    const original=tutorialStateCode;
    await call('shader.code.set',{pass:'image',code:original});
    assert.equal((await call('shader.compile')).compiled,true);
    await call('shader.playback.step');await nextPaint();
    const base=(await sample()).pixel;
    await key('keyDown','ArrowRight');
    for(let i=0;i<10;i++) await call('shader.playback.step');
    await key('keyUp','ArrowRight');const moved=(await sample()).pixel;
    assert.ok(moved[0]-base[0]>=24 && moved[0]-base[0]<=27,'0.6 units/sec * 10/60 sec');
    const frozen=(await sample()).hash;await call('shader.playback.step');assert.equal((await sample()).hash,frozen,'release retains position');
    await key('keyDown','Space');await key('keyUp','Space');assert.equal((await sample()).pixel[2],255,'toggle is forwarded through state Buffer');
    await key('keyDown','KeyR');const reset=(await sample()).pixel;assert.ok(Math.abs(reset[0]-base[0])<=1 && Math.abs(reset[1]-base[1])<=1,'R pulse recenters while paused');
    await key('keyDown','ArrowRight');await key('keyDown','ArrowUp');
    for(let i=0;i<10;i++) await call('shader.playback.step');
    const diagonal=(await sample()).pixel;
    assert.ok(diagonal[0]-base[0]>=17 && diagonal[0]-base[0]<=20 && diagonal[1]-base[1]>=17 && diagonal[1]-base[1]<=20,'normalized diagonal speed; held R does not reset repeatedly');
    await key('keyUp','ArrowRight');await key('keyUp','ArrowUp');await key('keyUp','KeyR');
    await call('shader.playback.reset');await call('shader.playback.step');const cleared=(await sample()).pixel;
    assert.ok(Math.abs(cleared[0]-base[0])<=1 && cleared[2]===0,'reset clears history and keyboard toggle');
  }
}
// Observe the lesson's actual Buffer state without changing its update shader.
const tutorialStateCode='fn mainImage(p:vec2f)->vec4f { let state=channel1(vec2f(0.5)); return vec4f(state.xy+vec2f(0.5),state.z,1.0); }';
