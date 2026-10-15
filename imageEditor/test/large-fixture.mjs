import {Deflate} from 'pako';
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;},section=b=>Buffer.concat([u32(b.length),b]);
/** Large deterministic PSD without allocating a full-resolution test bitmap. */
export function largePsd(width,height,{layered=true,compression=2}={}){
 const header=Buffer.alloc(26);header.write('8BPS');header.writeUInt16BE(1,4);header.writeUInt16BE(3,12);header.writeUInt32BE(height,14);header.writeUInt32BE(width,18);header.writeUInt16BE(8,22);header.writeUInt16BE(3,24);
 const colors=[40,130,210],channels=[];
 for(const color of colors){const row=new Uint8Array(width).fill(color);if(compression===3){row.fill(0);row[0]=color;}const z=new Deflate();for(let y=0;y<height;y++)z.push(row,y===height-1);channels.push(Buffer.concat([u16(compression),Buffer.from(z.result)]));}
 let layers=Buffer.alloc(0);
 if(layered){const extra=Buffer.concat([u32(0),u32(0),Buffer.from([1,76,0,0])]);const record=Buffer.concat([u32(0),u32(0),u32(height),u32(width),u16(3),...channels.map((c,i)=>Buffer.concat([u16(i),u32(c.length)])),Buffer.from('8BIMnorm'),Buffer.from([255,0,0,0]),section(extra)]);let info=Buffer.concat([u16(1),record,...channels]);if(info.length%2)info=Buffer.concat([info,Buffer.alloc(1)]);layers=Buffer.concat([section(info),u32(0)]);}
 const rows=colors.map(color=>{const parts=[];for(let x=0;x<width;x+=128)parts.push(Buffer.from([257-Math.min(128,width-x),color]));return Buffer.concat(parts);}),table=Buffer.alloc(3*height*2);for(let c=0;c<3;c++)for(let y=0;y<height;y++)table.writeUInt16BE(rows[c].length,(c*height+y)*2);
 return Buffer.concat([header,u32(0),u32(0),section(layers),u16(1),table,...rows.flatMap(row=>Array.from({length:height},()=>row))]);
}
