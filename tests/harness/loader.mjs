
const H = new URL('./', import.meta.url).href;
const REPO = new URL('../../', import.meta.url).href;
const named = {
  'gi://GLib': ['GLib', 'default'], 'gi://GObject': ['GObject', 'default'],
};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('gi://')) return {url: 'stub:' + spec, shortCircuit: true};
  if (spec.startsWith('resource://')) return {url: 'stub:' + spec, shortCircuit: true};
  if (spec === './util.js' && ctx.parentURL?.startsWith(REPO)) return {url: H + 'fake-util.mjs', shortCircuit: true};
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.startsWith('stub:')) return next(url, ctx);
  const spec = url.slice(5);
  let src;
  if (spec === 'gi://GLib') src = `import {GLib} from '${H}gjs-stubs.mjs'; export default GLib;`;
  else if (spec === 'gi://Gio') src = `import {Gio} from '${H}gjs-stubs.mjs'; export default Gio;`;
  else if (spec === 'gi://GObject') src = `import {GObject} from '${H}gjs-stubs.mjs'; export default GObject;`;
  else if (spec.endsWith('/ui/main.js')) src = `import {Main} from '${H}gjs-stubs.mjs'; export const {panel, wm, messageTray, inputMethod, sessionMode, overview, notify, layoutManager} = Main;`;
  else if (spec.endsWith('/ui/panelMenu.js')) src = `import {PanelMenu} from '${H}gjs-stubs.mjs'; export const Button = PanelMenu.Button;`;
  else if (spec.endsWith('/ui/popupMenu.js')) src = `import {PopupMenu} from '${H}gjs-stubs.mjs'; export const {PopupBaseMenuItem, PopupMenuItem, PopupSeparatorMenuItem} = PopupMenu;`;
  else if (spec.endsWith('/extensions/extension.js')) src = `import {Extension as E} from '${H}gjs-stubs.mjs'; export const Extension = E;`;
  else if (spec.includes('status/keyboard.js')) src = `import {A} from '${H}any.mjs'; export const getInputSourceManager = () => A;`;
  else src = `import {A} from '${H}any.mjs'; export default A;`;
  return {format: 'module', source: src, shortCircuit: true};
}
