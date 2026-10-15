export const RESAMPLING = { nearest:'最近邻（像素画）', bilinear:'双线性', bicubic:'双三次', lanczos:'Lanczos 3' } as const;
export type Resampling = keyof typeof RESAMPLING;
export function validateResampling(value:unknown):asserts value is Resampling { if(typeof value!=='string'||!Object.hasOwn(RESAMPLING,value))throw new Error('重采样方式无效。'); }
