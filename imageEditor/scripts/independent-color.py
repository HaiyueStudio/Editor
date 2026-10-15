"""Compare explicit RGB matrix/TRC conversion with Pillow's independent LittleCMS engine."""
import json,sys,platform
from pathlib import Path
from PIL import Image,ImageCms
out=Path(sys.argv[1]);raw=(out/'icc-input.rgba').read_bytes();source=Image.frombytes('RGBA',(1024,1),raw);rgb=source.convert('RGB');results=[]
for name in ['srgb','display-p3','adobe-rgb']:
    profile=ImageCms.getOpenProfile(str(out/(name+'.icc')))
    transform=ImageCms.buildTransformFromOpenProfiles(profile,ImageCms.createProfile('sRGB'),'RGB','RGB',renderingIntent=1,flags=ImageCms.Flags.NOOPTIMIZE)
    reference=ImageCms.applyTransform(rgb,transform).tobytes()
    for suffix in ['', '-parsed']:
        actual=(out/(name+suffix+'.rgba')).read_bytes();assert actual[3::4]==raw[3::4], 'alpha must be exact'
        error=max(abs(actual[(i//3)*4+i%3]-v) for i,v in enumerate(reference))
        assert error<=2,(name,suffix,error)
        results.append({'profile':name+suffix,'maxChannelError':error,'alpha':'exact','pixels':1024})
report={'status':'passed','python':platform.python_version(),'pillow':Image.__version__,'littlecms':ImageCms.core.littlecms_version,'intent':'relative colorimetric','tolerance':2,'cases':results}
(out/'icc-independent.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
