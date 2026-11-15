// Informer - USB device logic (pure, no gi:// imports).
// The extension reads /sys/bus/usb/devices; these helpers decide what counts.

// "1-2" or "1-2.3" is a device. "usb1" is a root hub, "1-2:1.0" is an interface.
export const USB_DEVICE_RE = /^\d+-\d+(\.\d+)*$/;

// d: {id, cls, removable, ifaceClasses}  (all text as found in sysfs)
// Skips hubs, built-in parts (webcam, Bluetooth chip) and storage (UsbSource tells about those).
export function trackUsb(d) {
    if (!USB_DEVICE_RE.test(d.id ?? ''))
        return false;
    if ((d.cls ?? '').toLowerCase() === '09')
        return false;
    if ((d.removable ?? '') === 'fixed')
        return false;
    if ((d.ifaceClasses ?? []).some(c => `${c}`.toLowerCase() === '08'))
        return false;
    return true;
}

export function usbName(vendor, product) {
    const p = `${product ?? ''}`.trim();
    const v = `${vendor ?? ''}`.trim();
    return p || v || 'USB device';
}

// prev, cur: Map(id -> name). Returns {added: [[id, name]], removed: [[id, name]]}
export function diffUsb(prev, cur) {
    const added = [];
    const removed = [];
    for (const [id, name] of cur) {
        if (!prev.has(id))
            added.push([id, name]);
    }
    for (const [id, name] of prev) {
        if (!cur.has(id))
            removed.push([id, name]);
    }
    return {added, removed};
}

// A USB printer has an interface of class 07. It gets its own message kind (`printer`).
export function isPrinter(ifaceClasses) {
    return (ifaceClasses ?? []).some(c => `${c}`.trim().toLowerCase() === '07');
}
