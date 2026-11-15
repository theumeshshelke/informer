// Informer - texts for the on/off style messages of version 8 (plain ES module: no gi:// imports).

const NAMES = {nightlight: 'Night Light', location: 'Location'};

// Night Light and Location: {text, kind} for on / off.
export function onOffMessage(cat, on) {
    const name = NAMES[cat];
    if (!name)
        return null;
    return {text: `${name} is ${on ? 'ON' : 'OFF'}`, kind: on ? 'good' : 'bad'};
}

// Touchpad: the value of `send-events`. Unknown values say nothing.
export function touchpadMessage(value) {
    switch (value) {
    case 'enabled': return {text: 'Touchpad enabled', kind: 'good'};
    case 'disabled': return {text: 'Touchpad disabled', kind: 'bad'};
    case 'disabled-on-external-mouse': return {text: 'Touchpad off with mouse', kind: 'info'};
    default: return null;
    }
}

// Power mode: the value of the `ActiveProfile` property of power-profiles-daemon.
export function profileMessage(name) {
    switch (name) {
    case 'power-saver': return {text: 'Power saver', kind: 'info'};
    case 'balanced': return {text: 'Balanced', kind: 'info'};
    case 'performance': return {text: 'Performance', kind: 'info'};
    default: return null;
    }
}
