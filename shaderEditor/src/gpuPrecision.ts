type GpuProvider = Pick<GPU, 'requestAdapter' | 'getPreferredCanvasFormat'>;
const FLOAT_FILTERING: GPUFeatureName = 'float32-filterable';

/** Extend Haiyue's device request through its public GPU provider hook. Keep
 * adapter methods/getters bound to the native object; never patch WebGPU globals.
 */
export function shaderGpuProvider(gpu: GpuProvider): GpuProvider {
  return {
    getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(),
    requestAdapter: async options => {
      const adapter = await gpu.requestAdapter(options);
      if (!adapter || !adapter.features.has(FLOAT_FILTERING)) return adapter;
      return new Proxy(adapter, {
        get(target, property) {
          if (property === 'requestDevice') return (descriptor: GPUDeviceDescriptor = {}) => target.requestDevice({
            ...descriptor,
            requiredFeatures: [...new Set([...(descriptor.requiredFeatures ?? []), FLOAT_FILTERING])],
          });
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

export function feedbackFormat(features: Pick<GPUSupportedFeatures, 'has'>): 'rgba32float' | 'rgba16float' {
  return features.has(FLOAT_FILTERING) ? 'rgba32float' : 'rgba16float';
}
