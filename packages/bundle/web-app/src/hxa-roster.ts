/**
 * Web-surface roster route for the HXA team panel: `GET /api/hxa/contacts`
 * answers the org's bot list through `ctx.hxa`. Dormant HXA answers 404, so
 * the sidebar panel that polls this route hides itself on unconfigured
 * deployments. Cross-site requests are refused (the browser marks them via
 * `sec-fetch-site`), mirroring the /api channel's DNS-rebinding stance; the
 * exact route wins dispatch over the connection plugin's /api prefix.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-hxa'

/**
 * Register the roster route while a web server is mounted.
 * @param ctx - plugin context; `hxa` is read per request so the route follows
 *   the connection's dormancy live.
 */
export function installHxaRoster(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/api/hxa/contacts',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const json = (status: number, value: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(value))
        }
        const site = req.headers['sec-fetch-site']
        if (site === 'cross-site') { json(403, { error: 'cross-site request refused' }); return }
        const hxa = ctx.get('hxa')
        if (hxa === undefined || hxa.endpoint() === undefined) { json(404, { error: 'hxa is not configured' }); return }
        try {
          json(200, { bots: await hxa.listBots() })
        } catch (error: unknown) {
          json(502, { error: String(error) })
        }
      },
    }), 'web-app: /api/hxa/contacts')
  })
}
