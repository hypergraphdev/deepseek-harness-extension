/**
 * The WeChat settings section: link an account by scanning a QR, and unlink
 * one that is already linked.
 *
 * Linking is a one-time act, so the panel only shows a QR while no account
 * is linked. It polls the host's status route while a challenge is pending
 * and stops the moment the scan confirms; a linked account shows its id and
 * an unlink control instead. A host without the WeChat capability answers
 * 404, and the section renders nothing at all.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-settings SlotMap merge (the settings.section seat).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import qrcode from 'qrcode-generator'
import css from './WeixinSection.module.css'

/** Quiet-zone modules the spec requires around the symbol. */
const QUIET_ZONE = 4

/**
 * Render one payload as an inline SVG QR code. Encoding happens in the
 * panel: sending a login payload to an image service would hand a third
 * party the credential the scan carries.
 */
function QrImage({ payload, label }: { payload: string; label: string }) {
  const encoded = useMemo(() => {
    try {
      // Type 0 picks the smallest version that fits; L is ample for a URL
      // shown on a screen a phone is held up to.
      const symbol = qrcode(0, 'L')
      symbol.addData(payload)
      symbol.make()
      const count = symbol.getModuleCount()
      const parts: string[] = []
      for (let row = 0; row < count; row += 1) {
        for (let column = 0; column < count; column += 1) {
          if (symbol.isDark(row, column)) parts.push(`M${String(column)} ${String(row)}h1v1h-1z`)
        }
      }
      return { path: parts.join(''), size: count }
    } catch {
      return undefined
    }
  }, [payload])
  if (encoded === undefined) return null
  const extent = encoded.size + QUIET_ZONE * 2
  return (
    <svg
      className={css.qr}
      role="img"
      aria-label={label}
      viewBox={`${String(-QUIET_ZONE)} ${String(-QUIET_ZONE)} ${String(extent)} ${String(extent)}`}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={extent} height={extent} fill="#fff" />
      <path d={encoded.path} fill="#000" />
    </svg>
  )
}

/** The host's view of the connection. */
interface LinkStatus {
  linked: boolean
  accountId?: string
  qrcodeUrl?: string
  scanned?: boolean
}

/** How often the panel re-reads status while a challenge is pending. */
const POLL_MS = 2_000

/** Full seat props: the settings runtime share and this section's locale. */
export type WeixinSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'weixin'>

/** Read the link status; undefined means the capability is absent. */
async function fetchStatus(): Promise<LinkStatus | undefined> {
  try {
    const response = await fetch('/api/weixin/status')
    if (!response.ok) return undefined
    return await response.json() as LinkStatus
  } catch {
    return undefined
  }
}

export function WeixinSection({ t }: WeixinSectionProps) {
  // undefined = capability absent or not yet read; the section stays blank.
  const [status, setStatus] = useState<LinkStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await fetchStatus()
    setStatus(next)
    return next
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // While a challenge is pending, follow it until it confirms or lapses.
  useEffect(() => {
    if (status === undefined || status.linked || status.qrcodeUrl === undefined) return
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [status?.linked, status?.qrcodeUrl, refresh])

  const startLink = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/weixin/link', { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? t('error.link'))
        return
      }
      await refresh()
    } catch {
      setError(t('error.link'))
    } finally {
      setBusy(false)
    }
  }, [refresh, t])

  const unlink = useCallback(async () => {
    setBusy(true)
    try {
      await fetch('/api/weixin/unlink', { method: 'POST' })
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  if (status === undefined) return null
  return (
    <div className={css.section}>
      <p className={css.lead}>{t('lead')}</p>
      {status.linked
        ? (
          <div className={css.linked}>
            <span className={css.badge}>{t('state.linked')}</span>
            {status.accountId !== undefined && <code className={css.account}>{status.accountId}</code>}
            <button type="button" className={css.button} disabled={busy} onClick={() => { void unlink() }}>
              {t('action.unlink')}
            </button>
          </div>
        )
        : status.qrcodeUrl !== undefined
          ? (
            <div className={css.pending}>
              {/* Encoded in the panel: sending a login payload to an image
                    service would hand a third party the link credential. */}
              <QrImage payload={status.qrcodeUrl} label={t('qr.alt')} />
              <p className={css.hint}>{status.scanned === true ? t('qr.scanned') : t('qr.hint')}</p>
              <a className={css.fallback} href={status.qrcodeUrl} target="_blank" rel="noreferrer">{t('qr.fallback')}</a>
            </div>
          )
          : (
            <button type="button" className={css.button} disabled={busy} onClick={() => { void startLink() }}>
              {busy ? t('action.linking') : t('action.link')}
            </button>
          )}
      {error !== null && <p className={css.error}>{error}</p>}
    </div>
  )
}
