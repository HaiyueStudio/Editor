"""Read laboratory outputs with a separate PSD implementation, never Photoshop proof."""
import hashlib
import json
import sys
import platform
from importlib.metadata import version
from pathlib import Path
import numpy as np
from psd_tools import PSDImage
import psd_tools

fixtures, output = map(Path, sys.argv[1:])
manifest = json.loads((fixtures / 'manifest.json').read_text())

def pixel_hash(image):
    if image is None:
        return None
    image = image.convert('RGBA')
    return {'size': list(image.size), 'sha256': hashlib.sha256(image.tobytes()).hexdigest()}

def layers(parent):
    result = []
    for layer in parent:
        result.append({
            'name': layer.name, 'bbox': list(layer.bbox), 'visible': layer.visible,
            'opacity': layer.opacity, 'blend': str(layer.blend_mode),
            'pixels': None if layer.is_group() else pixel_hash(layer.topil(apply_icc=False)),
            'mask': pixel_hash(layer.mask.topil()) if layer.has_mask() else None,
            'children': layers(layer) if layer.is_group() else None,
        })
    return result

checks = []
for sample in manifest['samples']:
    if sample['expectedAdmission'] != 'readable':
        continue
    try:
        original = PSDImage.open(fixtures / sample['file'])
        reopened = PSDImage.open(output / (sample['id'] + '.codec-roundtrip.psd'))
        assert original.size == reopened.size, sample['id'] + ': dimensions'
        assert layers(original) == layers(reopened), sample['id'] + ': layers/pixels/masks changed'
        before_image = original.topil(apply_icc=False)
        after_image = reopened.topil(apply_icc=False)
        if before_image is None:
            assert after_image is None, sample['id'] + ': missing merged-image flag changed'
            checks.append({'id': sample['id'], 'layerPixelsMasksAndStructure': 'exact',
                           'storedComposite': 'unavailable: source declares no real merged image'})
            continue
        assert after_image is not None, sample['id'] + ': merged image lost'
        before = np.asarray(before_image.convert('RGBA')).astype(np.int16)
        after = np.asarray(after_image.convert('RGBA')).astype(np.int16)
        assert before.shape == after.shape
        assert np.array_equal(before[:, :, 3], after[:, :, 3]), sample['id'] + ': composite alpha changed'
        checks.append({'id': sample['id'], 'layerPixelsMasksAndStructure': 'exact',
                       'storedCompositeMaxError': int(np.abs(before-after).max()),
                       'storedCompositeAlpha': 'exact'})
    except Exception as error:
        checks.append({'id': sample['id'], 'status': 'incompatible',
                       'error': type(error).__name__ + ': ' + str(error)})

edited = PSDImage.open(output / 'synthetic-edited.psd')
expected_meta = json.loads((output / 'synthetic-edited.pixels.json').read_text())
expected = (output / 'synthetic-edited.rgba').read_bytes()
assert edited.size == (expected_meta['width'], expected_meta['height'])
assert pixel_hash(edited.topil(apply_icc=False))['sha256'] == expected_meta['sha256']
assert edited[1][0].name == 'Edited 编辑'
assert edited[1][0].left == 5
assert edited[1][0].topil(apply_icc=False).convert('RGBA').getpixel((0, 0)) == (10, 240, 80, 255)
rendered = edited.composite(force=True, apply_icc=False).convert('RGBA')
actual_array = np.asarray(rendered).astype(np.int16)
expected_array = np.frombuffer(expected, dtype=np.uint8).reshape(actual_array.shape).astype(np.int16)
delta = np.abs(actual_array - expected_array)
maximum = int(delta.max())
# Independent floating point compositor can round by 1 at each blend stage.
assert maximum <= 2, f'Independent composite differs by {maximum}, tolerance 2'
rendered.save(output / 'synthetic-edited-independent.png')
result = {'schemaVersion': 1, 'status': 'completed-with-findings' if any(c.get('status') == 'incompatible' for c in checks) else 'passed', 'python': platform.python_version(),
          'decoder': 'psd-tools@' + psd_tools.__version__, 'cases': checks,
          'dependencies': {name: version(name) for name in ['psd-tools', 'Pillow', 'numpy', 'scipy', 'scikit-image', 'aggdraw']},
          'incompatibleCases': [c['id'] for c in checks if c.get('status') == 'incompatible'],
          'syntheticEdited': {'structureAndCachedPixels': 'exact', 'forcedRecompositeMaxError': maximum,
                             'tolerance': 2, 'meanAbsoluteError': float(delta.mean())},
          'photoshopEquivalent': False}
(output / 'independent.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'independentChecks': len(checks), 'syntheticMaxError': maximum}))
