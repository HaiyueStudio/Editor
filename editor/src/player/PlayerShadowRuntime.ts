import { RadialShadowRenderFeature as EngineRadialShadowRenderFeature } from '@haiyue/engine/systems';

// Keep this value in a real dynamic module. A bare re-export is folded into
// player.js by Rollup and makes the optional shadow boundary fictitious.
export const RadialShadowRenderFeature = EngineRadialShadowRenderFeature;
