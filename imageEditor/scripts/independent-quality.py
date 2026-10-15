"""Validate native channel IDs/parameters and caches with an independent decoder."""
import hashlib, json, logging, platform, sys
from pathlib import Path
import psd_tools
from psd_tools import PSDImage
from psd_tools.constants import Tag
out=Path(sys.argv[1]); source=json.loads((out/'psd-input.json').read_text()); warnings=[]; cases=[]
class Capture(logging.Handler):
    def emit(self, record):
        if record.levelno >= logging.WARNING: warnings.append(record.getMessage())
logging.getLogger('psd_tools').addHandler(Capture())
for case in source['cases']:
    kind=case['filter']; path=out/(kind+'.psd'); assert hashlib.sha256(path.read_bytes()).hexdigest()==case['sha256']
    psd=PSDImage.open(path); layer=psd[-1]; content=case['content']; assert layer.kind==kind
    if kind=='levels':
        records=layer.data; assert len(records)==29
        for i,channel in enumerate(['rgb','red','green','blue']):
            expected=content['levels'] if channel=='rgb' else content['channels'][channel]['levels']; actual=records[i]
            assert [actual.input_floor,actual.input_ceiling,actual.gamma,actual.output_floor,actual.output_ceiling]==[expected['black'],expected['white'],round(expected['gamma']*100),expected['outputBlack'],expected['outputWhite']],channel
    else:
        data=layer.tagged_blocks.get_data(Tag.CURVES); assert data.count_map==0b1011, 'RGB/red/blue channel mask'
        for record in data.extra:
            channel=['rgb','red','green','blue'][record.channel_id]; points=content['curves'] if channel=='rgb' else content['channels'][channel]['curves']
            assert record.points==[(p['output'],p['input']) for p in points],channel
        assert data.data==[item.points for item in data.extra]
    assert psd.topil(apply_icc=False).convert('RGBA').tobytes()==(out/(kind+'.rgba')).read_bytes(), 'cached pixels'
    cases.append({'filter':kind,'nativeChannels':'passed','cachedPixels':'exact'})
assert not warnings, warnings
report={**source,'status':'passed','decoder':'psd-tools@'+psd_tools.__version__,'python':platform.python_version(),'cases':cases,'decoderWarnings':warnings,'photoshopRedraw':'not-validated'}
(out/'psd-independent.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','cases':cases}))
