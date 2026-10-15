import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'imageEditor/artifacts/icc-workflow'),python=process.env.PSD_PYTHON??'python3',hash=b=>createHash('sha256').update(b).digest('hex');
// Requires the real browser fixture outputs; missing prerequisites fail explicitly.
const files=['normal.png','ui-proof-free.png','output.jpg','untagged.png','p3.psd','srgb.icc','p3.icc'];for(const file of files)readFileSync(resolve(out,file));
const result=JSON.parse(execFileSync(python,['-c',`import json,sys,ctypes
from pathlib import Path
from PIL import Image,ImageCms
import PIL,numpy as np,psd_tools
from psd_tools import PSDImage
from psd_tools.constants import Resource
p=Path(sys.argv[1]);icc=(p/'srgb.icc').read_bytes()
for name in ['normal.png','ui-proof-free.png','output.jpg']:
 im=Image.open(p/name);im.load();assert im.size==(96,64),name
 assert im.info['icc_profile']==icc,name
assert 'icc_profile' not in Image.open(p/'untagged.png').info
normal=np.asarray(Image.open(p/'normal.png').convert('RGBA'))
assert np.array_equal(normal,np.asarray(Image.open(p/'ui-proof-free.png').convert('RGBA')))
psd=PSDImage.open(p/'p3.psd');source=psd.image_resources.get_data(Resource.ICC_PROFILE)
assert source==(p/'p3.icc').read_bytes()
# Load Pillow's actual native LCMS dependency; preserve the PSD's float samples.
# RGB8 pre-quantization can magnify error near gamut clipping, so it is not a reference for RGB16.
cms=ctypes.CDLL(ImageCms.core.__file__)
void=ctypes.c_void_p;u32=ctypes.c_uint32
for name,args,result in [
 ('cmsOpenProfileFromMem',[void,u32],void),
 ('cmsFormatterForColorspaceOfProfile',[void,u32,u32],u32),
 ('cmsCreateTransform',[void,u32,void,u32,u32,u32],void),
 ('cmsDoTransform',[void,void,void,u32],None),
 ('cmsDeleteTransform',[void],None),('cmsCloseProfile',[void],u32)]:
 fn=getattr(cms,name);fn.argtypes=args;fn.restype=result
source_buf=ctypes.create_string_buffer(source);target_buf=ctypes.create_string_buffer(icc)
a=cms.cmsOpenProfileFromMem(source_buf,len(source));b=cms.cmsOpenProfileFromMem(target_buf,len(icc));assert a and b
transform=None
try:
 fmt=cms.cmsFormatterForColorspaceOfProfile(a,4,1)
 transform=cms.cmsCreateTransform(a,fmt,b,fmt,1,0x100|0x2000);assert transform
 rgb=np.ascontiguousarray(psd[0].numpy()[:,:,:3],dtype='float32');expected=np.empty_like(rgb)
 cms.cmsDoTransform(transform,rgb.ctypes.data,expected.ctypes.data,rgb.shape[0]*rgb.shape[1])
finally:
 if transform:cms.cmsDeleteTransform(transform)
 cms.cmsCloseProfile(a);cms.cmsCloseProfile(b)
expected=np.rint(np.clip(expected,0,1)*255).astype('int16')
error=int(np.abs(expected-normal[:,:,:3].astype('int16')).max())
# Independent float transform, then output quantization; retain the two-code-value gate.
assert error<=2,error
print(json.dumps({'status':'passed','maxRgb8Error':error,'tolerance':2,'pillow':PIL.__version__,'nativeLcms':ImageCms.core.littlecms_version,'psdTools':psd_tools.__version__,'checks':['PNG iCCP decoded and byte-exact','JPEG APP2 decoded and byte-exact','untagged output omits ICC','UI export excludes proof settings','PSD retains source P3','independent P3 to sRGB appearance comparison']}))`,out],{encoding:'utf8',maxBuffer:1024*1024}));
const report={schemaVersion:1,...result,generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),runner:{node:process.version,python,platform:process.platform,arch:process.arch},buildHash:JSON.parse(readFileSync(resolve(out,'browser.json'))).buildHash,inputs:Object.fromEntries(files.map(f=>[f,hash(readFileSync(resolve(out,f)))])),sourceFingerprints:Object.fromEntries(['imageEditor/src/iccEngine.ts','imageEditor/src/iccWorkflow.ts','imageEditor/src/rasterExport.ts','imageEditor/src/rasterIcc.ts','imageEditor/scripts/check-icc-workflow.mjs'].map(f=>[f,hash(readFileSync(resolve(root,f)))]))};writeFileSync(resolve(out,'independent.json'),JSON.stringify(report,null,2));console.log(report);
