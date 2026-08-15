/**
 * Agents panel plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. The roster data itself is served by the web-app bundle's
 * `/api/hxa/contacts` route over `ctx.hxa`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
