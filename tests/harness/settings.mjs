
import {readFileSync} from 'node:fs';
const XML = new URL('../../schemas/org.gnome.shell.extensions.informer.gschema.xml', import.meta.url);
export function makeSettings() {
  const xml = readFileSync(XML, 'utf8');
  const vals = new Map(); const types = new Map(); const handlers = new Map(); let hid = 1;
  for (const m of xml.matchAll(/<key name="([^"]+)" type="([^"]+)">\s*<default>([\s\S]*?)<\/default>/g)) {
    const [, k, t, d] = m; types.set(k, t);
    let v = d.trim();
    if (t === 'b') v = v === 'true'; else if (t === 'i') v = parseInt(v);
    else if (t === 's') v = v.replace(/^'|'$/g, ''); else if (t === 'as') v = [];
    vals.set(k, v);
  }
  const need = (k, t) => { if (!types.has(k)) throw new Error('NO SUCH KEY: ' + k); if (types.get(k) !== t) throw new Error(`WRONG TYPE for ${k}: ${types.get(k)} not ${t}`); };
  return {
    get_boolean: k => (need(k, 'b'), vals.get(k)), get_int: k => (need(k, 'i'), vals.get(k)),
    get_string: k => (need(k, 's'), vals.get(k)), get_strv: k => (need(k, 'as'), vals.get(k)),
    set_boolean(k, v) { need(k, 'b'); vals.set(k, v); this._fire(k); }, set_int(k, v) { need(k, 'i'); vals.set(k, v); this._fire(k); },
    set_string(k, v) { need(k, 's'); vals.set(k, v); this._fire(k); }, set_strv(k, v) { vals.set(k, v); },
    connect(sig, cb) { const id = hid++; handlers.set(id, {sig, cb}); return id; },
    disconnect(id) { handlers.delete(id); }, _fire(k) { for (const h of [...handlers.values()]) if (h.sig === 'changed' || h.sig === 'changed::' + k) h.cb(this, k); },
    handlerCount: () => handlers.size,
  };
}
