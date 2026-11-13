// Informer - export / import of settings (pure, no gi:// imports).
// prefs.js reads the schema and turns each key into a plain description:
//   {name, type: 'b' | 'i' | 's' | 'as' | ..., range: null
//        | {kind: 'range', min, max} | {kind: 'enum', values: [...]}}
// This module checks a parsed JSON object against that list. prefs.js then
// double-checks each accepted value with GLib.Variant and the schema's own range check.

export const FORMAT = 'informer-settings';
export const VERSION = 1;
// kept by the extension itself (not a preference): never exported, refused on import
export const NEVER = ['data-usage'];

const MAX_TEXT = 100000;      // longest string we accept
const MAX_ITEMS = 5000;       // longest list we accept
const INT32 = [-2147483648, 2147483647];

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// null when the value is fine, otherwise a short reason
export function checkValue(type, value, range = null) {
    switch (type) {
    case 'b':
        return typeof value === 'boolean' ? null : 'must be true or false';
    case 'i':
        if (typeof value !== 'number' || !Number.isInteger(value))
            return 'must be a whole number';
        if (value < INT32[0] || value > INT32[1])
            return 'number is too big';
        if (range?.kind === 'range' && (value < range.min || value > range.max))
            return `must be between ${range.min} and ${range.max}`;
        return null;
    case 's':
        if (typeof value !== 'string')
            return 'must be text';
        if (value.length > MAX_TEXT)
            return 'text is too long';
        if (range?.kind === 'enum' && !range.values.includes(value))
            return `must be one of: ${range.values.join(', ')}`;
        return null;
    case 'as':
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string'))
            return 'must be a list of text';
        if (value.length > MAX_ITEMS || value.some(v => v.length > MAX_TEXT))
            return 'list is too long';
        return null;
    default:
        return 'type not supported';
    }
}

// spec: key descriptions (see top). input: the parsed `settings` object.
// Returns {valid: {key: value}, invalid: [{key, reason}]}. Unknown keys are never accepted.
export function validateSettings(spec, input) {
    const valid = {};
    const invalid = [];
    if (input === null || typeof input !== 'object' || Array.isArray(input))
        return {valid, invalid: [{key: '(file)', reason: 'no settings found'}]};
    const byName = new Map(spec.map(k => [k.name, k]));
    for (const key of Object.keys(input)) {
        if (NEVER.includes(key)) {
            invalid.push({key, reason: 'not imported'});
            continue;
        }
        const k = byName.get(key);
        if (!k) {
            invalid.push({key, reason: 'unknown setting'});
            continue;
        }
        const why = checkValue(k.type, input[key], k.range);
        if (why)
            invalid.push({key, reason: why});
        else
            valid[key] = input[key];
    }
    return {valid, invalid};
}

// values: {key: jsValue} read from the live settings. Returns the file text.
export function buildExport(values) {
    const settings = {};
    for (const key of Object.keys(values).sort()) {
        if (!NEVER.includes(key))
            settings[key] = values[key];
    }
    return `${JSON.stringify({format: FORMAT, version: VERSION, settings}, null, 2)}\n`;
}

// file text -> {ok, settings} or {ok: false, error}
export function parseImport(text) {
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        return {ok: false, error: 'This file is not valid JSON'};
    }
    if (obj === null || typeof obj !== 'object' || obj.format !== FORMAT)
        return {ok: false, error: 'This is not an Informer settings file'};
    if (obj.settings === null || typeof obj.settings !== 'object' || Array.isArray(obj.settings))
        return {ok: false, error: 'This file has no settings in it'};
    if (typeof obj.version === 'number' && obj.version > VERSION)
        return {ok: false, error: 'This file is from a newer Informer'};
    return {ok: true, settings: obj.settings};
}

// one short line for the toast
export function summary(importedCount, invalid) {
    let t = `Imported ${importedCount} setting${importedCount === 1 ? '' : 's'}`;
    if (invalid.length) {
        const names = invalid.slice(0, 3).map(i => i.key).join(', ');
        const more = invalid.length > 3 ? ` and ${invalid.length - 3} more` : '';
        t += `. Skipped ${invalid.length}: ${names}${more}`;
    }
    return t;
}
