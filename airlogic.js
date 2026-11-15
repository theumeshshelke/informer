// Informer - air quality logic (pure, no gi:// imports). Uses the US AQI scale.

const BANDS = [
    [50, 'Good'],
    [100, 'Moderate'],
    [150, 'Unhealthy for some'],
    [200, 'Unhealthy'],
    [300, 'Very unhealthy'],
    [Infinity, 'Hazardous'],
];

export function aqiBand(aqi) {
    const i = BANDS.findIndex(([max]) => aqi <= max);
    return i < 0 ? BANDS.length - 1 : i;
}

export function aqiName(aqi) {
    return BANDS[aqiBand(aqi)][1];
}

// state: {high, band} remembered between checks.
// Warns when the air turns bad (aqi >= limit) and again if it gets worse by a whole band.
// It counts as good again only 10 points below the limit, so it does not flip-flop.
// Returns {alert: {text} | null, state}.
export function airAlert(state, aqi, limit) {
    if (typeof aqi !== 'number' || !Number.isFinite(aqi))
        return {alert: null, state};
    const band = aqiBand(aqi);
    const high = aqi >= limit || (state.high && aqi >= limit - 10);
    let alert = null;
    if (high && (!state.high || band > state.band))
        alert = {text: `Air quality is bad: AQI ${Math.round(aqi)} (${aqiName(aqi)})`};
    return {alert, state: {high, band: high ? band : -1}};
}
