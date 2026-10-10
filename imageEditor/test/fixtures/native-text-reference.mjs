// Frozen pre-optimization renderer for pixel-equivalence and measureText-count benchmarks.
export function textStyles(content) { const styles = Array.from({ length: content.text.length }, () => ({})); for (const r of content.runs ?? [])
    for (let i = r.start; i < r.end; i++) {
        const { start, end, ...style } = r;
        styles[i] = style;
    } return styles; }
export function rasterNativeText(canvas, c) {
    const l = c.layout, ctx = canvas.getContext('2d'), styles = textStyles(c), m = l.transform ?? [l.scaleX ?? 1, 0, 0, l.scaleY ?? 1], box = l.box;
    const font = (s) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px ${s.fontName ? '"' + s.fontName + '", ' : ''}${s.family}`;
    const lines = [];
    let line = { glyphs: [], width: 0, size: c.size, first: true, paragraphEnd: false };
    const available = () => box ? Math.max(1, box[2] - box[0] - (l.startIndent ?? 0) - (l.endIndent ?? 0) - (line.first ? (l.firstLineIndent ?? 0) : 0)) : 8192;
    const next = (paragraph = false) => { line.paragraphEnd = paragraph; lines.push(line); line = { glyphs: [], width: 0, size: c.size, first: paragraph, paragraphEnd: false }; };
    const push = (glyph) => { line.glyphs.push(glyph); line.width += glyph.width; line.size = Math.max(line.size, glyph.style.size); };
    for (const word of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(c.text)) {
        const glyphs = [];
        for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.segment)) {
            const text = part.segment;
            if (text === '\n' || text === '\r' || text === '\r\n') {
                next(true);
                continue;
            }
            const override = styles[word.index + part.index], style = { ...c, ...override };
            if (override?.family && override.family !== c.family && !override.fontName)
                delete style.fontName;
            ctx.font = font(style);
            ctx.letterSpacing = `${(l.tracking ?? 0) * style.size / 1000}px`;
            glyphs.push({ text, style, width: ctx.measureText(text).width });
        }
        const width = glyphs.reduce((n, g) => n + g.width, 0), white = /^\s+$/.test(word.segment);
        if (box && !white && line.glyphs.length && line.width + width > available())
            next();
        for (const glyph of glyphs) {
            if (box && !white && line.glyphs.length && line.width + glyph.width > available())
                next();
            push(glyph);
        }
    }
    lines.push(line);
    const corners = box ? [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]] : [];
    const width = Math.max(l.width, ...corners.map(([x, y]) => Math.ceil(l.x + m[0] * x + m[2] * y))), height = Math.max(l.height, ...corners.map(([x, y]) => Math.ceil(l.y + m[1] * x + m[3] * y)));
    if (width > 8192 || height > 8192 || width * height > 16777216)
        throw Error('文字框变换超出画布预算。');
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(m[0], m[1], m[2], m[3], l.x, l.y);
    ctx.textBaseline = 'alphabetic';
    if (box) {
        ctx.beginPath();
        ctx.rect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        ctx.clip();
    }
    let y = box ? box[1] : 0;
    for (const row of lines) {
        if (row.first)
            y += l.spaceBefore ?? 0;
        const leading = Math.max(l.leading, row.size * 1.2), start = (box?.[0] ?? 0) + (l.startIndent ?? 0) + (row.first ? (l.firstLineIndent ?? 0) : 0), end = (box?.[2] ?? 0) - (l.endIndent ?? 0);
        let x = c.align === 'left' ? start : c.align === 'right' ? end - row.width : box ? (start + end - row.width) / 2 : -row.width / 2;
        const baseline = y + (box ? row.size * .8 : 0);
        for (const glyph of row.glyphs) {
            const s = glyph.style;
            ctx.font = font(s);
            ctx.letterSpacing = `${(l.tracking ?? 0) * s.size / 1000}px`;
            ctx.fillStyle = s.color;
            ctx.fillText(glyph.text, x, baseline);
            if (s.underline)
                ctx.fillRect(x, baseline + Math.max(1, s.size * .08), glyph.width, Math.max(1, s.size * .06));
            x += glyph.width;
        }
        y += leading + (row.paragraphEnd ? l.spaceAfter ?? 0 : 0);
    }
}
