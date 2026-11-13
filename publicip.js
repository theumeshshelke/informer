// Informer - public IP helpers (pure, no gi:// imports)

// ipwho.is answer -> {ip, city, country} or null
export function parseIpwho(j) {
    if (!j || j.success === false || !j.ip)
        return null;
    return {ip: `${j.ip}`, city: `${j.city ?? ''}`, country: `${j.country ?? ''}`};
}

// shorter form for the bar: keep only the start of the address
export function maskIp(ip) {
    if (ip.includes(':'))
        return `${ip.split(':').slice(0, 2).join(':')}::x`;
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.x.x` : 'x';
}

export function placeText(info) {
    return [info.city, info.country].filter(Boolean).join(', ') || 'unknown place';
}

export const PUBLIC_IP_MAX_AGE_MS = 30 * 60 * 1000;
export function isStale(info, now, maxAge = PUBLIC_IP_MAX_AGE_MS) {
    return !info || now - info.at >= maxAge;
}
