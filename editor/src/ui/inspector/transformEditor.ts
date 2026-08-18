import { CartesianTransform3D, SphericalTransform3D, Transform2D } from '@haiyue/engine';
import type { SphericalTransformSnapshot, Transform2DSnapshot, TransformSnapshot } from '../../types';
import { DEG_TO_RAD, RAD_TO_DEG, readNumber } from '../../utils/formValues';

function vectorValue(values: ArrayLike<number>, index: number, fallback = 0): number {
  return values[index] ?? fallback;
}

function inputAt(inputs: Array<HTMLInputElement | null>, index: number): HTMLInputElement | null {
  return inputs[index] ?? null;
}

export interface CartesianTransformEditorElements {
  positionInputs: Array<HTMLInputElement | null>;
  rotationInputs: Array<HTMLInputElement | null>;
  scaleInputs: Array<HTMLInputElement | null>;
}

export interface SphericalTransformEditorElements {
  radiusInput: HTMLInputElement | null;
  thetaInput: HTMLInputElement | null;
  phiInput: HTMLInputElement | null;
  targetInputs: Array<HTMLInputElement | null>;
}

export interface Transform2DEditorElements {
  xInput: HTMLInputElement | null;
  yInput: HTMLInputElement | null;
  rotationInput: HTMLInputElement | null;
  scaleXInput: HTMLInputElement | null;
  scaleYInput: HTMLInputElement | null;
}

function setVectorInputs(inputs: Array<HTMLInputElement | null>, values: ArrayLike<number>, multiplier = 1, formatNumber: (value: number) => string): void {
  inputs.forEach((input, index) => {
    if (input) input.value = formatNumber((values[index] ?? 0) * multiplier);
  });
}

export function snapshotTransform(transform: CartesianTransform3D): TransformSnapshot {
  return {
    position: [vectorValue(transform.position, 0), vectorValue(transform.position, 1), vectorValue(transform.position, 2)],
    rotation: [vectorValue(transform.rotation, 0), vectorValue(transform.rotation, 1), vectorValue(transform.rotation, 2)],
    scale: [vectorValue(transform.scale, 0, 1), vectorValue(transform.scale, 1, 1), vectorValue(transform.scale, 2, 1)],
  };
}

export function applyTransformSnapshot(transform: CartesianTransform3D, snapshot: TransformSnapshot): void {
  transform.setPosition(...snapshot.position);
  transform.setRotation(...snapshot.rotation);
  transform.setScale(...snapshot.scale);
}

export function snapshotSphericalTransform(transform: SphericalTransform3D): SphericalTransformSnapshot {
  return {
    radius: transform.radius,
    theta: transform.theta,
    phi: transform.phi,
    target: [vectorValue(transform.target, 0), vectorValue(transform.target, 1), vectorValue(transform.target, 2)],
  };
}

export function applySphericalTransformSnapshot(transform: SphericalTransform3D, snapshot: SphericalTransformSnapshot): void {
  transform.setTarget(...snapshot.target);
  transform.set(snapshot.radius, snapshot.theta, snapshot.phi);
}

export function snapshotTransform2D(transform: Transform2D): Transform2DSnapshot {
  return {
    x: transform.x,
    y: transform.y,
    rotation: transform.rotation,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  };
}

export function applyTransform2DSnapshot(transform: Transform2D, snapshot: Transform2DSnapshot): void {
  transform.x = snapshot.x;
  transform.y = snapshot.y;
  transform.rotation = snapshot.rotation;
  transform.scaleX = snapshot.scaleX;
  transform.scaleY = snapshot.scaleY;
}

export function renderCartesianTransformInputs(
  transform: CartesianTransform3D,
  elements: CartesianTransformEditorElements,
  formatNumber: (value: number) => string,
): void {
  setVectorInputs(elements.positionInputs, transform.position, 1, formatNumber);
  setVectorInputs(elements.rotationInputs, transform.rotation, RAD_TO_DEG, formatNumber);
  setVectorInputs(elements.scaleInputs, transform.scale, 1, formatNumber);
}

export function renderMixedCartesianTransformInputs(
  transforms: readonly CartesianTransform3D[],
  elements: CartesianTransformEditorElements,
  formatNumber: (value: number) => string,
): void {
  renderMixedVector(elements.positionInputs, transforms.map(transform => transform.position), 1, formatNumber);
  renderMixedVector(elements.rotationInputs, transforms.map(transform => transform.rotation), RAD_TO_DEG, formatNumber);
  renderMixedVector(elements.scaleInputs, transforms.map(transform => transform.scale), 1, formatNumber);
}

function renderMixedVector(
  inputs: Array<HTMLInputElement | null>,
  values: readonly ArrayLike<number>[],
  multiplier: number,
  formatNumber: (value: number) => string,
): void {
  inputs.forEach((input, index) => {
    if (!input) return;
    const first = values[0]?.[index];
    const mixed = first === undefined || values.some(value => value[index] !== first);
    input.value = mixed ? '' : formatNumber(first * multiplier);
    input.placeholder = mixed ? 'Mixed' : '';
    input.dataset.mixed = String(mixed);
  });
}

export function renderSphericalTransformInputs(
  transform: SphericalTransform3D,
  elements: SphericalTransformEditorElements,
  formatNumber: (value: number) => string,
): void {
  if (elements.radiusInput) elements.radiusInput.value = formatNumber(transform.radius);
  if (elements.thetaInput) elements.thetaInput.value = formatNumber(transform.theta * RAD_TO_DEG);
  if (elements.phiInput) elements.phiInput.value = formatNumber(transform.phi * RAD_TO_DEG);
  setVectorInputs(elements.targetInputs, transform.target, 1, formatNumber);
}

export function renderTransform2DInputs(
  transform: Transform2D,
  elements: Transform2DEditorElements,
  formatNumber: (value: number) => string,
): void {
  if (elements.xInput) elements.xInput.value = formatNumber(transform.x);
  if (elements.yInput) elements.yInput.value = formatNumber(transform.y);
  if (elements.rotationInput) elements.rotationInput.value = formatNumber(transform.rotation * RAD_TO_DEG);
  if (elements.scaleXInput) elements.scaleXInput.value = formatNumber(transform.scaleX);
  if (elements.scaleYInput) elements.scaleYInput.value = formatNumber(transform.scaleY);
}

export function applyCartesianTransformInputs(transform: CartesianTransform3D, elements: CartesianTransformEditorElements): void {
  transform.setPosition(
    readNumber(inputAt(elements.positionInputs, 0), vectorValue(transform.position, 0)),
    readNumber(inputAt(elements.positionInputs, 1), vectorValue(transform.position, 1)),
    readNumber(inputAt(elements.positionInputs, 2), vectorValue(transform.position, 2)),
  );
  transform.setRotation(
    readNumber(inputAt(elements.rotationInputs, 0), vectorValue(transform.rotation, 0) * RAD_TO_DEG) * DEG_TO_RAD,
    readNumber(inputAt(elements.rotationInputs, 1), vectorValue(transform.rotation, 1) * RAD_TO_DEG) * DEG_TO_RAD,
    readNumber(inputAt(elements.rotationInputs, 2), vectorValue(transform.rotation, 2) * RAD_TO_DEG) * DEG_TO_RAD,
  );
  transform.setScale(
    readNumber(inputAt(elements.scaleInputs, 0), vectorValue(transform.scale, 0, 1)),
    readNumber(inputAt(elements.scaleInputs, 1), vectorValue(transform.scale, 1, 1)),
    readNumber(inputAt(elements.scaleInputs, 2), vectorValue(transform.scale, 2, 1)),
  );
}

export function applySphericalTransformInputs(transform: SphericalTransform3D, elements: SphericalTransformEditorElements): void {
  transform.setTarget(
    readNumber(inputAt(elements.targetInputs, 0), vectorValue(transform.target, 0)),
    readNumber(inputAt(elements.targetInputs, 1), vectorValue(transform.target, 1)),
    readNumber(inputAt(elements.targetInputs, 2), vectorValue(transform.target, 2)),
  );
  transform.set(
    readNumber(elements.radiusInput, transform.radius),
    readNumber(elements.thetaInput, transform.theta * RAD_TO_DEG) * DEG_TO_RAD,
    readNumber(elements.phiInput, transform.phi * RAD_TO_DEG) * DEG_TO_RAD,
  );
}

export function applyTransform2DInputs(transform: Transform2D, elements: Transform2DEditorElements): void {
  transform.x = readNumber(elements.xInput, transform.x);
  transform.y = readNumber(elements.yInput, transform.y);
  transform.rotation = readNumber(elements.rotationInput, transform.rotation * RAD_TO_DEG) * DEG_TO_RAD;
  transform.scaleX = readNumber(elements.scaleXInput, transform.scaleX);
  transform.scaleY = readNumber(elements.scaleYInput, transform.scaleY);
}
