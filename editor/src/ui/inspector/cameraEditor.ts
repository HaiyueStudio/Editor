import { Camera2D, Camera3D } from '@haiyue/engine';
import type { Camera2DSnapshot, Camera3DSnapshot } from '../../types';
import { DEG_TO_RAD, RAD_TO_DEG, readNumber } from '../../utils/formValues';

export interface Camera3DEditorElements {
  projectionSelect: HTMLSelectElement | null;
  fovInput: HTMLInputElement | null;
  nearInput: HTMLInputElement | null;
  farInput: HTMLInputElement | null;
  reverseZInput: HTMLInputElement | null;
  orthoLeftInput: HTMLInputElement | null;
  orthoRightInput: HTMLInputElement | null;
  orthoTopInput: HTMLInputElement | null;
  orthoBottomInput: HTMLInputElement | null;
}

export interface Camera2DEditorElements {
  widthInput: HTMLInputElement | null;
  heightInput: HTMLInputElement | null;
  zoomInput: HTMLInputElement | null;
  nearInput: HTMLInputElement | null;
  farInput: HTMLInputElement | null;
}

export function snapshotCamera3D(camera: Camera3D): Camera3DSnapshot {
  return {
    projectionType: camera.projectionType,
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    orthoLeft: camera.orthoLeft,
    orthoRight: camera.orthoRight,
    orthoTop: camera.orthoTop,
    orthoBottom: camera.orthoBottom,
    reverseZ: camera.reverseZ,
  };
}

export function applyCamera3DSnapshot(camera: Camera3D, snapshot: Camera3DSnapshot): void {
  camera.projectionType = snapshot.projectionType;
  camera.fov = snapshot.fov;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.orthoLeft = snapshot.orthoLeft;
  camera.orthoRight = snapshot.orthoRight;
  camera.orthoTop = snapshot.orthoTop;
  camera.orthoBottom = snapshot.orthoBottom;
  camera.reverseZ = snapshot.reverseZ;
  camera.setDirty();
}

export function snapshotCamera2D(camera: Camera2D): Camera2DSnapshot {
  return {
    width: camera.width,
    height: camera.height,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
  };
}

export function applyCamera2DSnapshot(camera: Camera2D, snapshot: Camera2DSnapshot): void {
  camera.width = snapshot.width;
  camera.height = snapshot.height;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.zoom = snapshot.zoom;
  camera.resize(camera.width, camera.height);
}

export function readCamera3DInputs(camera: Camera3D, elements: Camera3DEditorElements): Camera3DSnapshot {
  return {
    projectionType: (elements.projectionSelect?.value as Camera3D['projectionType']) || camera.projectionType,
    fov: Math.max(1, Math.min(179, readNumber(elements.fovInput, camera.fov * RAD_TO_DEG))) * DEG_TO_RAD,
    near: readNumber(elements.nearInput, camera.near),
    far: readNumber(elements.farInput, camera.far),
    orthoLeft: readNumber(elements.orthoLeftInput, camera.orthoLeft),
    orthoRight: readNumber(elements.orthoRightInput, camera.orthoRight),
    orthoTop: readNumber(elements.orthoTopInput, camera.orthoTop),
    orthoBottom: readNumber(elements.orthoBottomInput, camera.orthoBottom),
    reverseZ: Boolean(elements.reverseZInput?.checked),
  };
}

export function readCamera2DInputs(camera: Camera2D, elements: Camera2DEditorElements): Camera2DSnapshot {
  return {
    width: readNumber(elements.widthInput, camera.width),
    height: readNumber(elements.heightInput, camera.height),
    near: readNumber(elements.nearInput, camera.near),
    far: readNumber(elements.farInput, camera.far),
    zoom: readNumber(elements.zoomInput, camera.zoom),
  };
}

export function renderCamera3DInputs(camera: Camera3D, elements: Camera3DEditorElements, formatNumber: (value: number) => string): void {
  if (elements.projectionSelect) elements.projectionSelect.value = camera.projectionType;
  if (elements.fovInput) elements.fovInput.value = formatNumber(camera.fov * RAD_TO_DEG);
  if (elements.nearInput) elements.nearInput.value = formatNumber(camera.near);
  if (elements.farInput) elements.farInput.value = formatNumber(camera.far);
  if (elements.reverseZInput) elements.reverseZInput.checked = camera.reverseZ;
  if (elements.orthoLeftInput) elements.orthoLeftInput.value = formatNumber(camera.orthoLeft);
  if (elements.orthoRightInput) elements.orthoRightInput.value = formatNumber(camera.orthoRight);
  if (elements.orthoTopInput) elements.orthoTopInput.value = formatNumber(camera.orthoTop);
  if (elements.orthoBottomInput) elements.orthoBottomInput.value = formatNumber(camera.orthoBottom);
}

export function renderCamera2DInputs(camera: Camera2D, elements: Camera2DEditorElements, formatNumber: (value: number) => string): void {
  if (elements.widthInput) elements.widthInput.value = formatNumber(camera.width);
  if (elements.heightInput) elements.heightInput.value = formatNumber(camera.height);
  if (elements.zoomInput) elements.zoomInput.value = formatNumber(camera.zoom);
  if (elements.nearInput) elements.nearInput.value = formatNumber(camera.near);
  if (elements.farInput) elements.farInput.value = formatNumber(camera.far);
}
