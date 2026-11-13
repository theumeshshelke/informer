// Informer - weather alert logic (pure, no gi:// imports)

// hourly: {precipitation_probability: [...], temperature_2m: [...]} starting at the current hour.
// Returns the first of the next 2 hours with a rain chance >= percent, or null.
export function rainSoon(hourly, percent) {
    const p = hourly?.precipitation_probability;
    if (!Array.isArray(p))
        return null;
    for (let i = 0; i <= 2 && i < p.length; i++) {
        if (typeof p[i] === 'number' && p[i] >= percent)
            return {inHours: i, chance: p[i]};
    }
    return null;
}

// Hot / cold thresholds are stored in Celsius. Temps may be in F.
export function toLimit(celsius, isF) {
    return isF ? celsius * 9 / 5 + 32 : celsius;
}

// state: {rain, hot, cold} booleans remembered between refreshes.
// Returns {alerts: [{key, text}], state}: an alert only on the change false -> true.
export function weatherAlerts(state, {rain, temp, hotC, coldC, isF, unit}) {
    const next = {rain: !!rain, hot: false, cold: false};
    const alerts = [];
    if (rain && !state.rain) {
        alerts.push({key: 'rain', text: rain.inHours === 0
            ? `Rain likely now (${rain.chance}%)`
            : `Rain likely in about ${rain.inHours === 1 ? 'an hour' : `${rain.inHours} hours`} (${rain.chance}%)`});
    }
    if (typeof temp === 'number') {
        next.hot = temp >= toLimit(hotC, isF);
        next.cold = temp <= toLimit(coldC, isF);
        if (next.hot && !state.hot)
            alerts.push({key: 'hot', text: `It is hot: ${Math.round(temp)}\u00b0${unit}`});
        if (next.cold && !state.cold)
            alerts.push({key: 'cold', text: `It is cold: ${Math.round(temp)}\u00b0${unit}`});
    }
    return {alerts, state: next};
}
