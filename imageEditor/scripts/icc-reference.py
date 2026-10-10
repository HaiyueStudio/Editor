"""Independent native Little CMS oracle via Pillow. Profiles are read locally, never redistributed."""
import sys, json
from PIL import Image, ImageCms
spec=json.load(sys.stdin)
source=ImageCms.ImageCmsProfile(spec['source'])
target=ImageCms.ImageCmsProfile(spec['target'])
if spec.get('proof'):
    proof=ImageCms.ImageCmsProfile(spec['proof'])
    transform=ImageCms.buildProofTransform(source,target,proof,'RGB',spec['mode'],renderingIntent=spec['intent'],proofRenderingIntent=1,flags=0x4000|0x2000)
else:
    transform=ImageCms.buildTransform(source,target,'RGB',spec['mode'],renderingIntent=spec['intent'],flags=0x2000)
image=Image.frombytes('RGB',(len(spec['samples'])//3,1),bytes(spec['samples']))
result=ImageCms.applyTransform(image,transform)
print(json.dumps({'bytes':list(result.tobytes()),'engine':ImageCms.core.littlecms_version}))
