"""Independent native PSD structure/parameters/source pixels; cached and selected forced composites."""
import json,sys,hashlib,platform,logging,io,math
from pathlib import Path
import numpy as np
import psd_tools
from psd_tools import PSDImage
from psd_tools.constants import Tag
out=Path(sys.argv[1]);cases=json.loads((out/'native-cases.json').read_text());results=[];warnings=[]
class Warnings(logging.Handler):
    def emit(self,r):
        if r.levelno>=logging.WARNING:warnings.append(r.getMessage())
logging.getLogger('psd_tools').addHandler(Warnings())
def sha(data):return hashlib.sha256(data).hexdigest()
for case in cases:
    path=out/(case['id']+'.psd');assert sha(path.read_bytes())==case['sha256'],'fixture hash'
    psd=PSDImage.open(path);assert psd.size==(case['width'],case['height']);assert len(psd)==len(case['layers'])
    for layer,expected in zip(psd,case['layers']):
        assert layer.name==expected['name'];assert layer.clipping_layer==expected['clipping']
        if expected['pixels']:
            image=layer.topil(apply_icc=False).convert('RGBA');assert image.size==(expected['pixels']['width'],expected['pixels']['height']);assert sha(image.tobytes())==expected['pixels']['sha256'],'cached layer pixels'
        c=expected['content']
        if expected['kind']=='smart':
            assert layer.kind=='smartobject';smart=layer.smart_object;assert smart.kind=='data';assert smart.filename==c['name']+'.psd'
            source=PSDImage.open(io.BytesIO(smart.data));assert source.size==(c['source']['width'],c['source']['height']);assert sha(source[0].topil(apply_icc=False).convert('RGBA').tobytes())==c['source']['sha256'],'embedded source pixels'
            t=c['transform'];a=math.radians(t['angle']);cx=expected['x']+expected['pixels']['width']/2;cy=expected['y']+expected['pixels']['height']/2;corners=[]
            for x,y in [(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]:
                x*=t['width']*(-1 if t['flipX'] else 1);y*=t['height']*(-1 if t['flipY'] else 1);corners.extend([cx+x*math.cos(a)-y*math.sin(a),cy+x*math.sin(a)+y*math.cos(a)])
            assert np.allclose(smart.transform_box,corners,atol=1e-6),'placed transform'
        elif expected['kind']=='text':assert layer.kind=='type' and layer.text==c['text'],'native text'
        elif expected['kind'] in ['shape','path']:
            assert layer.kind=='shape';paths=layer.vector_mask.paths;assert len(paths)==1 and len(paths[0])==len(expected['knots'])
            for node,knots in zip(paths[0],expected['knots']):
                actual=[]
                for y,x in [node.preceding,node.anchor,node.leaving]:actual.extend([x*case['width'],y*case['height']])
                assert np.allclose(actual,knots,atol=.0001),'native vector points'
        elif expected['kind']=='adjustment':
            assert layer.kind==c['filter']
            if c['filter']=='levels':
                l=layer.master;r=c['levels'];assert [l.input_floor,l.input_ceiling,l.gamma,l.output_floor,l.output_ceiling]==[r['black'],r['white'],round(r['gamma']*100),r['outputBlack'],r['outputWhite']];assert len(layer.data)==29,'canonical levels records'
            elif c['filter']=='curves':assert layer.tagged_blocks.get_data(Tag.CURVES).data[0]==[(p['output'],p['input']) for p in c['curves']],'native curve control points'
        if expected['styles']:
            s=expected['styles'];effects={type(e).__name__:e for e in layer.effects};assert layer.effects.enabled==s['enabled']
            for key,kind in [('stroke','Stroke'),('overlay','ColorOverlay'),('shadow','DropShadow')]:
                if key in s:
                    e=effects[kind];assert abs(e.opacity-s[key]['opacity']*100)<1e-6
                    if key=='stroke':assert e.size==s[key]['size']
    expected=np.frombuffer((out/(case['id']+'.rgba')).read_bytes(),dtype=np.uint8).reshape(case['height'],case['width'],4).astype(np.int32)
    cached=np.asarray(psd.topil(apply_icc=False).convert('RGBA')).astype(np.int32);assert np.array_equal(expected[:,:,3],cached[:,:,3]),'cached alpha'
    delta=float((np.abs(cached[:,:,:3]-expected[:,:,:3])*expected[:,:,3:4]/255).max());assert delta<=1,'cached associated RGB'
    forced={'status':'not-validated','reason':'Native text/vector/effect/adjustment rendering is not certified against Photoshop; parameters and cached pixels are checked.'}
    if case['force']:
        actual=np.asarray(psd.composite(force=True,apply_icc=False).convert('RGBA')).astype(np.int32);alpha=int(np.abs(actual[:,:,3]-expected[:,:,3]).max());rgb=float(np.abs(actual[:,:,:3]*actual[:,:,3:4]/255-expected[:,:,:3]*expected[:,:,3:4]/255).max());assert alpha<=2 and rgb<=2,'independent recomposition';forced={'status':'passed','alphaMaxError':alpha,'associatedRgbMaxError':rgb}
    results.append({'id':case['id'],'nativeParameters':'passed','layerPixels':'exact','cachedAlpha':'exact','cachedAssociatedRgbMaxError':delta,'forcedComposite':forced})
assert not warnings,'decoder warnings: '+repr(warnings)
report={'schemaVersion':1,'status':'passed','decoder':'psd-tools@'+psd_tools.__version__,'python':platform.python_version(),'cases':results,'decoderWarnings':warnings,'photoshopEquivalent':False}
(out/'native-independent.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
