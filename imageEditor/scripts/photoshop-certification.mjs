import { cmykBitmap } from '../dist/cmyk.js';
import {validatePhotoshopRun} from './photoshopValidation.mjs';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {makeLayer,ImageDocument} from '../dist/document.js';
import {withPixels} from '../dist/pixelFormat.js';
import {exportPsd,importPsd} from '../dist/psdAdapter.js';
import {linearSrgbProfile} from '../dist/iccEngine.js';
import {srgbProfileBytes,profileResource} from '../dist/colorManagement.js';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),mode=process.argv[2],out=resolve(process.argv[3]??join(root,'imageEditor/artifacts/photoshop-certification'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const fingerprints=()=>Object.fromEntries(readdirSync(join(root,'imageEditor/src')).sort().map(f=>[f,hash(readFileSync(join(root,'imageEditor/src',f)))]));
if(mode==='prepare'){
 if(existsSync(join(out,'manifest.json')))throw Error('Output already contains a certification run. Choose a new output directory.');mkdirSync(out,{recursive:true});
 const cases=[];for(const depth of [8,16,32]){const width=32,height=24,data=depth===8?new Uint8ClampedArray(width*height*4):new Float32Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=i%4===3?255:depth===32?((i%67)-3)*17:depth===16?(32700+i%100)/257:i%256;const layer=makeLayer('Precision source',withPixels(width,height,data,depth)),d=new ImageDocument({id:randomUUID(),name:'Photoshop '+depth,width,height,bitDepth:depth,layers:[layer],selectedId:layer.id,revision:1,psdOrigin:{sourceName:'certification',flattened:false,resources:profileResource(depth===32?linearSrgbProfile():srgbProfileBytes())}}),name=`rgb${depth}.psd`,bytes=exportPsd(d.state).bytes;writeFileSync(join(out,name),bytes,{flag:'wx'});cases.push({name,depth,width,height,sha256:hash(bytes),output:`rgb${depth}-photoshop.psd`});d.dispose();}
 for(const depth of [8,16]){const width=32,height=24,ink=Float32Array.from({length:width*height*4},(_,i)=>i%4===3?80:i%8<4?0:(i*17.123)%100),layer=makeLayer('Native ink source',cmykBitmap(width,height,ink,new Float32Array(width*height).fill(255),depth)),d=new ImageDocument({id:randomUUID(),name:'CMYK '+depth,width,height,colorMode:'cmyk',bitDepth:depth,layers:[layer],selectedId:layer.id,revision:1}),name=`cmyk${depth}.psd`,bytes=exportPsd(d.state).bytes;writeFileSync(join(out,name),bytes,{flag:'wx'});cases.push({name,depth,width,height,colorMode:'cmyk',sha256:hash(bytes),output:`cmyk${depth}-photoshop.psd`});d.dispose();}
 const manifest={schemaVersion:2,runId:randomUUID(),status:'pending-photoshop',generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0,sourceFingerprints:fingerprints(),runner:{node:process.version,platform:process.platform,arch:process.arch},cases};
 // All paths are relative to the script so the complete folder can be moved to a Photoshop machine.
 const jsx=`#target photoshop
(function(){
var base=new File($.fileName).parent, previousDialogs=app.displayDialogs, current=null, results=[],runId=${JSON.stringify(manifest.runId)};
function quote(s){var q=String.fromCharCode(34),slash=String.fromCharCode(92),out=q;s=String(s);for(var k=0;k<s.length;k++){var n=s.charCodeAt(k);out+=n===34?slash+q:n===92?slash+slash:n===10?slash+'n':n===13?slash+'r':n<32?' ':s.charAt(k);}return out+q;}
function record(name,ok,error){results.push('{"name":'+quote(name)+',"ok":'+ok+',"error":'+quote(error||'')+'}');}
try {app.displayDialogs=DialogModes.NO;
var names=['rgb8','rgb16','rgb32','cmyk8','cmyk16'];
for(var i=0;i<names.length;i++){var name=names[i],destination=new File(base+'/'+name+'-photoshop.psd');try{
if(destination.exists)throw Error('Refusing to overwrite existing output');
current=app.open(new File(base+'/'+name+'.psd'));var initial=current.activeHistoryState,old=current.layers[0].name;
current.layers[0].name='Undo probe';current.activeHistoryState=initial;if(current.layers[0].name!==old)throw Error('Undo failed');
current.layers[0].name='Certified edit';var options=new PhotoshopSaveOptions();options.layers=true;options.embedColorProfile=true;options.alphaChannels=true;
current.saveAs(destination,options,true,Extension.LOWERCASE);current.close(SaveOptions.DONOTSAVECHANGES);current=null;
current=app.open(destination);if(current.layers[0].name!=='Certified edit')throw Error('Reopened edit missing');current.close(SaveOptions.DONOTSAVECHANGES);current=null;record(name+'.psd',true,'');
}catch(e){record(name+'.psd',false,e.message);if(current){current.close(SaveOptions.DONOTSAVECHANGES);current=null;}}}
}finally{app.displayDialogs=previousDialogs;var f=new File(base+'/photoshop-receipt.json');if(f.exists)throw Error('Receipt already exists');f.encoding='UTF8';if(!f.open('w'))throw Error('Cannot write receipt');f.write('{"schemaVersion":1,"runId":'+quote(runId)+',"application":'+quote(app.name)+',"version":'+quote(app.version)+',"os":'+quote($.os)+',"cases":['+results.join(',')+']}');f.close();}
})();`;
 writeFileSync(join(out,'run-in-photoshop.jsx'),jsx,{flag:'wx'});manifest.scriptSha256=hash(Buffer.from(jsx));writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});console.log(JSON.stringify({status:'pending-photoshop',directory:out,instruction:'Photoshop: File > Scripts > Browse > run-in-photoshop.jsx; then run verify. Originals are never overwritten.'}));
}else if(mode==='verify'){
 const manifest=JSON.parse(readFileSync(join(out,'manifest.json'))),receipt=JSON.parse(readFileSync(join(out,'photoshop-receipt.json')));
 const results=validatePhotoshopRun(manifest,receipt,name=>readFileSync(join(out,name)));
 const sourceUnchanged=JSON.stringify(fingerprints())===JSON.stringify(manifest.sourceFingerprints);if(!sourceUnchanged)process.exitCode=1;
 const report={schemaVersion:1,status:sourceUnchanged?'automated-cases-passed-visual-review-pending':'stale-source-evidence',runId:manifest.runId,verifiedAt:new Date().toISOString(),photoshop:receipt,sourceUnchanged:JSON.stringify(fingerprints())===JSON.stringify(manifest.sourceFingerprints),results,limitations:['Three RGB and two CMYK precision fixtures only; not blanket Photoshop certification.','Display appearance, native text/shape/effect redraw, CMYK proof targets and real HDR display require separate reviewed evidence.']};writeFileSync(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}else throw Error('Usage: node imageEditor/scripts/photoshop-certification.mjs prepare|verify <new-output-directory>');
