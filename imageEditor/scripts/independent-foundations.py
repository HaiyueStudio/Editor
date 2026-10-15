"""Decode both generations with psd-tools; inspect embedded layers and force recomposition."""
import io,json,sys,hashlib,platform,logging
from pathlib import Path
import numpy as np
import psd_tools
from psd_tools import PSDImage
out=Path(sys.argv[1]);spec=json.loads((out/'inputs.json').read_text());warnings=[]
class Warnings(logging.Handler):
    def emit(self,r):
        if r.levelno>=logging.WARNING:warnings.append(r.getMessage())
logging.getLogger('psd_tools').addHandler(Warnings())
for file,digest in spec['inputs'].items():assert hashlib.sha256((out/file).read_bytes()).hexdigest()==digest,file
expected=np.frombuffer((out/'expected.rgba').read_bytes(),dtype=np.uint8).reshape(spec['height'],spec['width'],4).astype(np.float64)
def compare(image,reference):
    actual=np.array(image.convert('RGBA')).astype(np.float64)
    alpha=float(np.abs(actual[:,:,3]-reference[:,:,3]).max())
    rgb=float(np.abs(actual[:,:,:3]*actual[:,:,3:4]/255-reference[:,:,:3]*reference[:,:,3:4]/255).max())
    assert alpha<=1 and rgb<=2,(alpha,rgb)
    return {'alphaMaxError':alpha,'associatedRgbMaxError':rgb}
results=[]
for file in ['generation1.psd','generation2.psd']:
    psd=PSDImage.open(out/file);smart=[l for l in psd if l.kind=='smartobject'][0]
    assert smart.smart_object.kind=='data'
    embedded=smart.smart_object.data;assert embedded==(out/'source.psd').read_bytes(),'embedded PSD bytes changed'
    source=PSDImage.open(io.BytesIO(embedded));assert len(source)==2
    assert [l.name for l in source]==['图层 1','第二层']
    source_ref=np.frombuffer((out/'source.rgba').read_bytes(),dtype=np.uint8).reshape(spec['sourceHeight'],spec['sourceWidth'],4).astype(np.float64)
    results.append({'file':file,'embeddedBytes':'exact','sourceLayers':len(source),'cached':compare(psd.topil(apply_icc=False),expected),'sourceForcedComposite':compare(source.composite(force=True,apply_icc=False),source_ref)})
assert not warnings,warnings
report={'schemaVersion':1,'status':'passed','decoder':'psd-tools@'+psd_tools.__version__,'python':platform.python_version(),'cases':results,'photoshopEquivalent':False,'decoderWarnings':warnings}
(out/'independent.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
