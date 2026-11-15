
// A stand-in for any GNOME API: every property is another stand-in, every call returns one.
function make() {
    const f = function () {};
    return new Proxy(f, {
        get(_t, k) {
            if (k === Symbol.toPrimitive) return () => '';
            if (k === Symbol.iterator) return undefined;
            if (k === 'then') return undefined;
            return A;
        },
        apply() { return A; },
        construct() { return A; },
        set(_t, k, v, receiver) {
            Object.defineProperty(receiver, k, {value: v, writable: true, configurable: true, enumerable: true});
            return true;
        },
    });
}
export const A = make();
