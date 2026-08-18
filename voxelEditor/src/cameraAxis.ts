export type CameraAxisName = 'x' | 'y' | 'z';

export interface ProjectedCameraAxis {
  name: CameraAxisName;
  x: number;
  y: number;
  depth: number;
}

/** Projects positive world axes into the camera's 2D screen basis. */
export function projectCameraAxes(cameraWorldMatrix: ArrayLike<number>): readonly ProjectedCameraAxis[] {
  if (cameraWorldMatrix.length < 16) throw new Error('相机矩阵至少需要 16 个数值。');
  return [
    { name: 'x', x: finite(cameraWorldMatrix[0]), y: -finite(cameraWorldMatrix[4]), depth: finite(cameraWorldMatrix[8]) },
    { name: 'y', x: finite(cameraWorldMatrix[1]), y: -finite(cameraWorldMatrix[5]), depth: finite(cameraWorldMatrix[9]) },
    { name: 'z', x: finite(cameraWorldMatrix[2]), y: -finite(cameraWorldMatrix[6]), depth: finite(cameraWorldMatrix[10]) },
  ];
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
}
