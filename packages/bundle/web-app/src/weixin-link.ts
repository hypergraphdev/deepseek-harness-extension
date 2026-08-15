/**
 * Web-surface routes for the WeChat link panel: read the link state, start a
 * QR login, and unlink. Linking is a one-time act, so the panel polls
 * `status` while a challenge is pending and stops once an account is linked.
 *
 * Without `ctx.weixin` the routes answer 404 and the settings panel hides
 * itself, exactly as the roster route does for HXA. Cross-site requests are
 * refused; the exact paths win dispatch over the connection plugin's /api
 * prefix.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-weixin'

/** Send one JSON response. */
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

/**
 * Register the WeChat link routes while a web server is mounted.
 * @param ctx - plugin context; `weixin` is read per request so the routes
 *   follow the capability's presence live.
 */
export function installWeixinLink(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    /** Answer one request against the live service, or 404 when absent. */
    const handle = (
      run: (weixin: NonNullable<ReturnType<Context['get']>> & Context['weixin']) => Promise<unknown> | unknown,
    ) => async (req: IncomingMessage, res: ServerResponse) => {
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, 403, { error: 'cross-site request refused' })
        return
      }
      const weixin = ctx.get('weixin')
      if (weixin === undefined) { json(res, 404, { error: 'weixin is not composed' }); return }
      try {
        json(res, 200, await run(weixin))
      } catch (error: unknown) {
        json(res, 502, { error: String(error) })
      }
    }

    for (const [path, run] of [
      ['/api/weixin/status', (weixin: Context['weixin']) => weixin.status()],
      ['/api/weixin/link', async (weixin: Context['weixin']) => ({ qrcodeUrl: await weixin.startLink() })],
      ['/api/weixin/unlink', (weixin: Context['weixin']) => { weixin.unlink(); return { linked: false } }],
    ] as const) {
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'exact', path, handler: handle(run) }),
        `web-app: ${path}`,
      )
    }
  })
}
