import type { Bitmap } from './document.js';
/** Apply the same associated-alpha geometry to four ink planes, never re-separate RGB. */
export function mapCmykGeometry(source:Bitmap, transform:(b:Bitmap)=>Bitmap):Bitmap {
 const {cmyk,...preview}=source;if(!cmyk)return transform(preview);
 const planes=()=>new Float32Array(source.data.length),cmy=planes(),black=planes();
 for(let i=0;i<cmy.length;i+=4){for(let c=0;c<3;c++){cmy[i+c]=cmyk[i+c]!;black[i+c]=cmyk[i+3]!;}cmy[i+3]=black[i+3]=source.data[i+3]!;}
 const a=transform({width:source.width,height:source.height,data:cmy,depth:16}),b=transform({width:source.width,height:source.height,data:black,depth:16}),out=transform(preview),ink=new Float32Array(out.data.length);
 for(let i=0;i<ink.length;i++)ink[i]=Math.max(0,Math.min(100,i%4===3?b.data[i-3]!:a.data[i]!));
 return {...out,cmyk:ink};
}
