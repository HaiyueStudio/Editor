declare module 'lcms-wasm' {
 export const LCMS_VERSION:number;
 export interface Lcms {
  cmsOpenProfileFromMem(bytes:Uint8Array,length:number):number;cmsCloseProfile(h:number):void;
  cmsCreate_sRGBProfile():number;cmsCreateLab4Profile():number;cmsCreateXYZProfile():number;
  cmsGetColorSpaceASCII(h:number):string;cmsGetProfileInfoASCII(h:number,kind:number,language:string,country:string):string;
  cmsFormatterForColorspaceOfProfile(h:number,bytes:number,float:boolean):number;
  cmsCreateTransform(a:number,af:number,b:number,bf:number,intent:number,flags:number):number;
  cmsCreateProofingTransform(a:number,af:number,b:number,bf:number,proof:number,intent:number,proofIntent:number,flags:number):number;
  cmsDoTransform(h:number,data:Float32Array,pixels:number):Float32Array;cmsDeleteTransform(h:number):void;
 }
 export function instantiate(options?:{wasmBinary?:Uint8Array;locateFile?:(name:string)=>string;printErr?:(text:string)=>void}):Promise<Lcms>;
}
