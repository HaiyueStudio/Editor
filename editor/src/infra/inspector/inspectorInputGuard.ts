export interface InspectorInputGuard {
  isActive(): boolean;
  run<T>(callback: () => T): T;
}

export function createInspectorInputGuard(): InspectorInputGuard {
  let depth = 0;
  return {
    isActive: () => depth > 0,
    run<T>(callback: () => T): T {
      depth++;
      try {
        return callback();
      } finally {
        depth--;
      }
    },
  };
}
