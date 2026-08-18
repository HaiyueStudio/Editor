export interface CameraStatePort<State> {
  captureCameraState(): State;
  restoreCameraState(state: State): void;
}

export interface VoxelCameraState {
  radius: number;
  theta: number;
  phi: number;
  target: readonly [number, number, number];
  projectionType: 'perspective' | 'orthographic';
}

interface VoxelCameraViewport {
  readonly cameraTransform: {
    readonly radius: number;
    readonly theta: number;
    readonly phi: number;
    readonly target: ArrayLike<number>;
    set(radius: number, theta: number, phi: number): void;
    setTarget(x: number, y: number, z: number): void;
  };
  readonly projectionType: VoxelCameraState['projectionType'];
  setProjectionType(type: VoxelCameraState['projectionType']): void;
}

/** Adapts viewport camera controls to history without making the renderer own transactions. */
export function createVoxelCameraStatePort(
  viewport: VoxelCameraViewport | null,
): CameraStatePort<VoxelCameraState> | null {
  if (!viewport) return null;
  return {
    captureCameraState: () => {
      const { cameraTransform } = viewport;
      const target = cameraTransform.target;
      return {
        radius: cameraTransform.radius,
        theta: cameraTransform.theta,
        phi: cameraTransform.phi,
        target: [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0],
        projectionType: viewport.projectionType,
      };
    },
    restoreCameraState: state => {
      viewport.cameraTransform.set(state.radius, state.theta, state.phi);
      viewport.cameraTransform.setTarget(state.target[0], state.target[1], state.target[2]);
      viewport.setProjectionType(state.projectionType);
    },
  };
}

/**
 * History operations mutate the document, never the user's viewport.
 * Restoring in a finally block also keeps that invariant when a command fails.
 */
export function runPreservingCamera<State, Result>(
  camera: CameraStatePort<State> | null,
  operation: () => Result,
): Result {
  if (!camera) return operation();
  const state = camera.captureCameraState();
  try {
    return operation();
  } finally {
    camera.restoreCameraState(state);
  }
}
