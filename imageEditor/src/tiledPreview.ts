import { PreviewJobs } from './previewJobs.js';
import { PersistentPreviewCache,previewFingerprint } from './previewCache.js';
import type { ImageState } from './document.js';
import { DisplayPyramid } from './largeImageTiles.js';
import { compositeRegionAsync } from './diskCompositor.js';
import { colorDisplay } from './iccEngine.js';
/** Bounded dialog preview. No document-size canvas or structured clone of native planes. */
export async function tiledPreview(state:ImageState,signal?:AbortSignal){const jobs=new PreviewJobs(),pyramid=new DisplayPyramid(state.width,state.height,(r,s)=>jobs.read(state,r,false,s),8,new PersistentPreviewCache(previewFingerprint(state,'reference-v1-sdr')));try{return await pyramid.tile(pyramid.overviewLevel,0,0,signal);}finally{jobs.dispose();}}
