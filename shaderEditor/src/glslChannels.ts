import { TranslationError, type Token } from './glslPreprocessor.js';
import type { Expression } from './glslUpdates.js';

export type ChannelDimension = '2d' | 'cube';
export interface TranslationOptions { channelTypes?: readonly (ChannelDimension | null)[] }
export class ChannelRetry extends Error {}
export const builtinChannel = (expr: Expression) => expr.reference?.space === 'private' && /^iChannel[0-3]$/.test(expr.reference.root) ? Number(expr.reference.root.at(-1)) : undefined;

/** Retain constraints across bounded parser retries, rebuilding earlier emitted
 * helpers when a later use establishes a builtin channel's dimension. */
export class ChannelTypes {
  readonly types: (ChannelDimension | null)[];
  constructor(options: TranslationOptions) {
    const hints = options.channelTypes;
    if (hints && (hints.length !== 4 || hints.some(t => t !== null && t !== '2d' && t !== 'cube'))) throw new Error('channelTypes 需要四项：2d、cube 或 null。');
    this.types = hints ? [...hints] : [null, null, null, null];
  }
  sampler(index: number) { return this.types[index] === 'cube' ? 'samplerCube' : 'sampler2D'; }
  require(token: Token, index: number, dimension: ChannelDimension, parsedType: string) {
    const current = this.types[index];
    if (current && current !== dimension) throw new TranslationError(token, `iChannel${index} 的纹理类型冲突：${current === 'cube' ? 'Cubemap' : '二维纹理'} 不能作为 ${dimension === 'cube' ? 'samplerCube' : 'sampler2D'} 使用。请检查通道绑定和 uniform 声明。`);
    this.types[index] = dimension;
    if (parsedType !== this.sampler(index)) throw new ChannelRetry();
  }
}
