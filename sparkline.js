// Informer - speed sparkline maths (pure, no gi:// imports)

// Keeps the last `size` samples in a fixed ring: no array grows or shifts.
export class RingBuffer {
    constructor(size = 60) {
        this.size = Math.max(1, Math.floor(size));
        this._d = new Array(this.size).fill(0);
        this._n = 0;          // how many samples are stored
        this._i = 0;          // where the next one goes
    }

    push(v) {
        const n = Number(v);
        this._d[this._i] = Number.isFinite(n) && n > 0 ? n : 0;    // never negative, never NaN
        this._i = (this._i + 1) % this.size;
        if (this._n < this.size)
            this._n++;
    }

    clear() {
        this._n = 0;
        this._i = 0;
    }

    get length() { return this._n; }

    // oldest first, newest last
    values() {
        const out = [];
        const start = (this._i - this._n + this.size) % this.size;
        for (let k = 0; k < this._n; k++)
            out.push(this._d[(start + k) % this.size]);
        return out;
    }
}

// Points for the line, inside a w x h box. The newest sample is on the right;
// until the ring is full the line starts part-way along. `floor` is the smallest
// scale (bytes/s): a quiet connection then shows a flat low line, not noise.
export function graphPoints(values, count, w, h, floor = 10240) {
    if (!values.length || w <= 0 || h <= 2)
        return [];
    const peak = Math.max(floor, ...values);
    const step = count > 1 ? w / (count - 1) : w;
    const offset = Math.max(0, count - values.length);
    return values.map((v, k) => {
        const y = h - 1 - (Math.min(v, peak) / peak) * (h - 2);
        return {x: Math.min(w, (offset + k) * step), y};
    });
}

// '#rrggbb' or '#rgb' -> [r, g, b] in 0..1 (white when it cannot be read)
export function hexToRgb(hex) {
    let s = `${hex ?? ''}`.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s))
        s = s.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s))
        return [1, 1, 1];
    return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
}
