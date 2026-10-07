"""P3 independent decoder: exact layer RGBA and alpha, bounded white-matte preview error."""
import json,sys,hashlib,platform,logging
from pathlib import Path
import numpy as np
import psd_tools
from psd_tools import PSDImage
decoder_warnings=[]
class DecoderWarnings(logging.Handler):
    def emit(self,record):
        if record.levelno>=logging.WARNING: decoder_warnings.append(record.getMessage())
logging.getLogger('psd_tools').addHandler(DecoderWarnings())
output=Path(sys.argv[1]);cases=json.loads((output/'cases.json').read_text());results=[]
def visit(actual,expected):
    assert len(actual)==len(expected),'layer count'
    for layer,reference in zip(actual,expected):
        assert layer.name==reference['name'],'Unicode name'
        assert layer.visible==(not reference['hidden']),'visibility'
        assert layer.opacity==reference['opacity'],'opacity'
        if reference['children'] is not None:
            assert layer.is_group(),'group';visit(layer,reference['children'])
        elif reference['pixels']:
            assert layer.left==reference['left'] and layer.top==reference['top'],'offset'
            image=layer.topil(apply_icc=False).convert('RGBA');assert image.size==(reference['pixels']['width'],reference['pixels']['height']),'pixel extent'
            assert hashlib.sha256(image.tobytes()).hexdigest()==reference['pixels']['sha256'],'layer bytes'
for case in cases:
    psd=PSDImage.open(output/(case['id']+'.psd'));assert psd.size==(case['width'],case['height']);visit(psd,case['layers'])
    expected=np.frombuffer((output/(case['id']+'.expected.rgba')).read_bytes(),dtype=np.uint8).reshape(case['height'],case['width'],4).astype(np.int32)
    cached=np.asarray(psd.topil(apply_icc=False).convert('RGBA')).astype(np.int32)
    assert np.array_equal(expected[:,:,3],cached[:,:,3]),'composite alpha'
    delta=np.abs(cached-expected);premult=delta[:,:,:3]*expected[:,:,3:4]/255
    assert float(premult.max())<=1,'premultiplied composite error > 1/255'
    forced=np.asarray(psd.composite(force=True,apply_icc=False).convert('RGBA')).astype(np.int32)
    forced_alpha=int(np.abs(forced[:,:,3]-expected[:,:,3]).max())
    # Fully transparent hidden RGB is irrelevant to recomposition; compare associated color and alpha separately.
    forced_pre=np.abs(forced[:,:,:3]*forced[:,:,3:4]/255-expected[:,:,:3]*expected[:,:,3:4]/255)
    assert forced_alpha<=2,'independent recomposition alpha'
    assert float(forced_pre.max())<=2,'independent recomposition associated RGB'
    results.append({'id':case['id'],'layerPixels':'exact','cachedAlpha':'exact','cachedStraightMaxError':int(delta.max()),'cachedPremultipliedMaxError':float(premult.max()),'recompositeAlphaMaxError':forced_alpha,'recompositePremultipliedMaxError':float(forced_pre.max())})
assert not decoder_warnings, 'Independent decoder warnings: '+repr(decoder_warnings)
report={'decoderWarnings':decoder_warnings,'schemaVersion':1,'status':'passed','decoder':'psd-tools@'+psd_tools.__version__,'python':platform.python_version(),'cases':results,'photoshopEquivalent':False}
(output/'independent.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'cases':len(results),'status':'passed'}))
