import { profileResource,srgbProfileBytes,embeddedProfile } from './colorManagement.js';
import { transformBitmapIcc,linearSrgbProfile } from './iccEngine.js';
import { convertDepth } from './pixelFormat.js';
import type { ImageState } from './document.js';
import { checkSize, type Bitmap, makeLayer, ImageDocument } from './document.js';

export function inspectImageSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    const width = view.getUint32(16), height = view.getUint32(20); checkSize(width, height); return { width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) break;
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5); checkSize(width, height); return { width, height };
      }
      offset += length;
    }
  }
  throw new Error('图片文件损坏或格式不支持。请选择 PNG、JPEG 或 .hyimage 工程，PSD 请通过 PSD 导入流程打开。');
}
export async function decodeImage(file: File): Promise<Bitmap> {
  if (file.size > 32 * 1024 * 1024) throw new Error('PNG/JPEG 文件不能超过 32 MiB。');
  inspectImageSize(new Uint8Array(await file.arrayBuffer()));
  let decoded: ImageBitmap | undefined;
  try {
    decoded = await createImageBitmap(file, { imageOrientation: 'from-image' }); checkSize(decoded.width, decoded.height);
    const canvas = document.createElement('canvas'); canvas.width = decoded.width; canvas.height = decoded.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('无法解码图片。');
    context.drawImage(decoded, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = 1; canvas.height = 1;
    return { width: decoded.width, height: decoded.height, data };
  } finally { decoded?.close(); }
}
/** Canvas decode returns sRGB samples; importing into another RGB working space must convert them. */
export function rasterForDocument(bitmap:Bitmap,state:ImageState):Bitmap {
 if(state.colorMode==='cmyk')return bitmap;
 const depth=state.bitDepth??8,b=convertDepth(bitmap,depth),target=embeddedProfile(state);
 return target?transformBitmapIcc(b,depth===32?linearSrgbProfile():srgbProfileBytes(),target,{intent:state.icc?.intent??1,bpc:state.icc?.bpc??true}):b;
}
export function imageDocument(name: string, bitmap: Bitmap) {
  const doc = ImageDocument.create(name, bitmap.width, bitmap.height);
  // Build the initial imported state once, without an empty layer in its undo history.
  const layer = makeLayer(name, bitmap);
  const result = new ImageDocument({ ...doc.state, psdOrigin:{sourceName:name,flattened:true,resources:profileResource(srgbProfileBytes())},layers: [layer], selectedId: layer.id, selectedIds: [layer.id] }); doc.dispose(); return result;
}
/** Deterministic, independently editable layers for the bundled moonrise example. */
export function createDemo(): ImageDocument {
  const width = 1200, height = 800, horizon = 438;
  const raster = (name: string, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; paint(ctx);
    const layer = makeLayer(name, { width, height, data: ctx.getImageData(0, 0, width, height).data });
    canvas.width = canvas.height = 1; return layer;
  };
  let seed = 20261007;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const background = raster('01 · 夜空', ctx => {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#081528'); sky.addColorStop(.4, '#16354b'); sky.addColorStop(.57, '#527481'); sky.addColorStop(1, '#102536');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 130; i++) {
      const x = random() * width, y = random() * 370, r = .3 + random() * .8;
      ctx.fillStyle = `rgba(220,238,242,${.12 + random() * .5})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const haze = ctx.createRadialGradient(842, 350, 10, 842, 350, 390);
    haze.addColorStop(0, '#b8d7d518'); haze.addColorStop(1, '#b8d7d500'); ctx.fillStyle = haze; ctx.fillRect(0, 0, width, horizon);
  });
  const moon = raster('02 · 明月', ctx => {
    const halo = ctx.createRadialGradient(842, 288, 75, 842, 288, 210);
    halo.addColorStop(0, '#d9eee84a'); halo.addColorStop(.55, '#bcdce516'); halo.addColorStop(1, '#bcdce500');
    ctx.fillStyle = halo; ctx.fillRect(610, 56, 464, 464);
    const disc = ctx.createRadialGradient(813, 255, 10, 842, 288, 94);
    disc.addColorStop(0, '#fff9df'); disc.addColorStop(.75, '#e6ebd5'); disc.addColorStop(1, '#c2d9d3');
    ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(842, 288, 94, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.clip();
    for (let i = 0; i < 65; i++) {
      const x = 752 + random() * 180, y = 198 + random() * 180, r = 3 + random() * 19;
      const crater = ctx.createRadialGradient(x, y, 0, x, y, r);
      crater.addColorStop(0, '#788f9120'); crater.addColorStop(1, '#788f9100'); ctx.fillStyle = crater; ctx.fillRect(x-r, y-r, r*2, r*2);
    }
    ctx.restore();
  });
  const sea = raster('03 · 海面与月光', ctx => {
    const water = ctx.createLinearGradient(0, horizon, 0, height);
    water.addColorStop(0, '#305563'); water.addColorStop(.22, '#163c4d'); water.addColorStop(1, '#071c2c');
    ctx.fillStyle = water; ctx.fillRect(0, horizon, width, height-horizon);
    const reflection = ctx.createRadialGradient(842, 443, 0, 842, 443, 390);
    reflection.addColorStop(0, '#c5d9c627'); reflection.addColorStop(1, '#9ac6ce00');
    ctx.fillStyle = reflection; ctx.fillRect(0, horizon, width, height-horizon);
    ctx.strokeStyle = '#b6d0cf4a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, horizon+.5); ctx.lineTo(width, horizon+.5); ctx.stroke();
    // Increasing wavelength towards the viewer gives the water perspective.
    for (let i = 0; i < 1600; i++) {
      const depth = random(), y = horizon + 3 + depth * (height-horizon-3), x = random()*width;
      const span = 3 + depth*depth*45 + random()*12;
      ctx.strokeStyle = `rgba(135,186,198,${.035+random()*.13})`; ctx.lineWidth = .4+depth*1.2;
      ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+span*.5,y-1-depth*2,x+span,y); ctx.stroke();
    }
    for (let i = 0; i < 340; i++) {
      const depth = random(), y = horizon+3+depth*(height-horizon), spread = 18+depth*160;
      const center = 842 + Math.sin(depth*16)*depth*15, x = center+(random()-.5)*spread*2, span = 3+random()*(8+depth*32);
      const edge = Math.max(0,1-Math.abs(x-center)/(spread+1));
      ctx.strokeStyle = `rgba(221,231,208,${edge*(.15+random()*.48)*(1-depth*.6)})`; ctx.lineWidth = .6+depth*1.8;
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+span,y); ctx.stroke();
    }
  });
  const title = raster('04 · 海上生明月 · 题字', ctx => {
    ctx.fillStyle = '#b7d0d2'; ctx.font = '14px sans-serif'; ctx.fillText('HAIYUE  /  MOONRISE OVER THE SEA', 76, 94);
    ctx.fillStyle = '#edf0df'; ctx.font = '500 76px serif'; ctx.fillText('海上生明月', 72, 242);
    ctx.fillStyle = '#a9c4ca'; ctx.font = '23px serif'; ctx.fillText('天涯共此时', 78, 294);
    ctx.strokeStyle = '#b4d1d44d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(78,326); ctx.lineTo(152,326); ctx.stroke();
    ctx.fillStyle = '#abc3c9'; ctx.font = '12px sans-serif'; ctx.fillText('海月  ·  望月怀远', 78, 742);
    ctx.fillStyle = '#799da9'; ctx.font = '11px sans-serif'; ctx.fillText('01 — A QUIET STUDY OF LIGHT & WATER', 78, 765);
  });
  const doc = ImageDocument.create('海上生明月 · 示例', width, height);
  const result = new ImageDocument({ ...doc.state, layers: [background, moon, sea, title], selectedId: title.id, selectedIds: [title.id] }); doc.dispose(); return result;
}
