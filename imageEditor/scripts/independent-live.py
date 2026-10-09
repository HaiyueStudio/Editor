"""Independently decode native split ranges, mask parameters and cached pixels."""
import hashlib, json, logging, platform, sys
from pathlib import Path
import numpy as np
import psd_tools
from psd_tools import PSDImage
out=Path(sys.argv[1]); source=json.loads((out/'psd-input.json').read_text()); warnings=[]; cases=[]
class Capture(logging.Handler):
    def emit(self, record):
        if record.levelno >= logging.WARNING: warnings.append(record.getMessage())
logging.getLogger('psd_tools').addHandler(Capture())
def split(pair):
    return [pair[0] >> 8, pair[0] & 255, pair[1] >> 8, pair[1] & 255]
for case in source['cases']:
    channel=case['channel']; path=out/(channel+'.psd'); assert hashlib.sha256(path.read_bytes()).hexdigest()==case['sha256']
    psd=PSDImage.open(path); layer=psd[-1]; ranges=layer._record.blending_ranges
    assert len(ranges.channel_ranges)==3
    active=0 if channel=='gray' else ['red','green','blue'].index(channel)+1
    for index,pair in enumerate([ranges.composite_ranges]+ranges.channel_ranges):
        assert split(pair[0])==(case['rule']['source'] if index==active else [0,0,255,255])
        assert split(pair[1])==(case['rule']['underlying'] if index==active else [0,0,255,255])
    params=layer._record.mask_data.parameters
    assert params.user_mask_density==128
    assert params.user_mask_feather==1.25
    assert layer.mask.topil().tobytes()==bytes(range(256)), 'raw mask'
    expected=np.frombuffer((out/(channel+'.rgba')).read_bytes(),dtype=np.uint8).reshape(16,16,4).astype(np.int32)
    cached=np.asarray(psd.topil(apply_icc=False).convert('RGBA')).astype(np.int32)
    assert np.array_equal(expected[:,:,3],cached[:,:,3]),'cached alpha'
    # The independent decoder reverses PSD's white matte with integer rounding.
    delta=float((np.abs(cached[:,:,:3]-expected[:,:,:3])*expected[:,:,3:4]/255).max())
    assert delta<=1,'cached associated RGB' 
    cases.append({'channel':channel,'nativeRanges':'passed','maskParameters':'passed','rawMask':'exact','cachedAlpha':'exact','cachedAssociatedRgbMaxError':delta})
assert not warnings,warnings
report={**source,'status':'passed','decoder':'psd-tools@'+psd_tools.__version__,'python':platform.python_version(),'cases':cases,'decoderWarnings':warnings,'photoshopRedraw':'not-validated'}
(out/'psd-independent.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','cases':cases}))
