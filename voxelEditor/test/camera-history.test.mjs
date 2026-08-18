import assert from 'node:assert/strict';
import test from 'node:test';

import { createVoxelCameraStatePort, runPreservingCamera } from '../dist/camera-history.js';

const initialState = () => ({
  radius: 23,
  theta: 1.2,
  phi: 0.7,
  target: [4, 5, 6],
  projectionType: 'orthographic',
});

function fakeCamera() {
  return {
    state: initialState(),
    captureCameraState() {
      return structuredClone(this.state);
    },
    restoreCameraState(state) {
      this.state = structuredClone(state);
    },
  };
}

test('undo-style operations preserve the complete camera state', () => {
  const camera = fakeCamera();
  const result = runPreservingCamera(camera, () => {
    camera.state = {
      radius: 10,
      theta: 0,
      phi: Math.PI / 4,
      target: [0, 0, 0],
      projectionType: 'perspective',
    };
    return '撤销体素编辑';
  });

  assert.equal(result, '撤销体素编辑');
  assert.deepEqual(camera.state, initialState());
});

test('camera state is restored when a history command throws', () => {
  const camera = fakeCamera();

  assert.throws(() => runPreservingCamera(camera, () => {
    camera.state.radius = 1;
    camera.state.target = [0, 0, 0];
    throw new Error('broken command');
  }), /broken command/);
  assert.deepEqual(camera.state, initialState());
});

test('history operations still run before the renderer is ready', () => {
  assert.equal(runPreservingCamera(null, () => 'no renderer'), 'no renderer');
});

test('voxel viewport adapter captures and restores camera state including projection sync', () => {
  const transform = {
    radius: 23,
    theta: 1.2,
    phi: 0.7,
    target: [4, 5, 6],
    set(radius, theta, phi) {
      this.radius = radius;
      this.theta = theta;
      this.phi = phi;
    },
    setTarget(x, y, z) {
      this.target = [x, y, z];
    },
  };
  let projectionSyncs = 0;
  const viewport = {
    cameraTransform: transform,
    projectionType: 'orthographic',
    setProjectionType(type) {
      this.projectionType = type;
      projectionSyncs += 1;
    },
  };
  const port = createVoxelCameraStatePort(viewport);

  runPreservingCamera(port, () => {
    transform.set(4, 0, 0.5);
    transform.setTarget(0, 0, 0);
    viewport.projectionType = 'perspective';
  });

  assert.deepEqual({
    radius: transform.radius,
    theta: transform.theta,
    phi: transform.phi,
    target: transform.target,
    projectionType: viewport.projectionType,
  }, initialState());
  assert.equal(projectionSyncs, 1);
});
