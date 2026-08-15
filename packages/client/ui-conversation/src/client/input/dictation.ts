/**
 * Composer dictation. Two modes behind one control: a top-level app drives
 * the browser's Web Speech API directly, while an app embedded in the dsh
 * extension panel delegates recognition to the panel page over the
 * origin-validated parent message channel — Chrome refuses the Web Speech
 * API inside a cross-origin iframe, and the panel's top-level extension page
 * is where it works. Finalized transcript segments stream to the caller
 * either way; an unsupported environment reports `supported: false` so the
 * control never renders. The API is not in lib.dom, so the minimal surface
 * this module touches is declared here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** One recognized alternative of one result. */
interface DictationAlternative {
  transcript: string
}

/** One (possibly interim) recognition result. */
interface DictationResult {
  isFinal: boolean
  0: DictationAlternative
}

/** The event delivering the accumulated result list. */
interface DictationResultEvent {
  resultIndex: number
  results: ArrayLike<DictationResult>
}

/** The recognition session surface this module drives. */
interface DictationRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: DictationResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

/** The constructor exposed by supporting browsers (standard or webkit-prefixed). */
function recognitionConstructor(): (new () => DictationRecognition) | undefined {
  if (typeof window === 'undefined') return undefined
  const speech = window as {
    SpeechRecognition?: new () => DictationRecognition
    webkitSpeechRecognition?: new () => DictationRecognition
  }
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition
}

/** Whether this window is embedded by the extension panel's candidate parent. */
function embedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window
}

/** Failure kinds the composer announces; everything else ends the session silently. */
export type DictationFailure = 'denied' | 'error'

/** The dictation control the composer renders. */
export interface Dictation {
  /** Whether this environment can dictate at all (local API or panel bridge). */
  supported: boolean
  /** Whether a recognition session is live. */
  listening: boolean
  /** Start when idle, stop when listening. */
  toggle(): void
  /** Stop the live session, keeping already-delivered segments. */
  stop(): void
}

/**
 * Drive one dictation session for the composer's lifetime.
 * @param onSegment - receives each finalized transcript segment.
 * @param onFailure - receives one announcement per failed session.
 * @returns the dictation control.
 */
export function useDictation(
  onSegment: (text: string) => void,
  onFailure: (failure: DictationFailure) => void,
): Dictation {
  const [listening, setListening] = useState(false)
  const [bridge, setBridge] = useState(false)
  const sessionRef = useRef<DictationRecognition | null>(null)
  // Latest-callback refs: a live session survives re-renders without
  // re-binding its handlers to stale closures.
  const segmentRef = useRef(onSegment)
  segmentRef.current = onSegment
  const failureRef = useRef(onFailure)
  failureRef.current = onFailure
  // Embedded apps dictate only through the panel bridge — the local API is
  // refused in a cross-origin iframe, so its presence there is a trap.
  const supported = bridge || (!embedded() && recognitionConstructor() !== undefined)

  // Bridge plumbing: probe the embedder once, then follow its capability,
  // state, transcript, and failure messages. Only the parent window at an
  // extension origin is trusted, matching the page-report channel.
  useEffect(() => {
    if (!embedded()) return
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent || !event.origin.startsWith('chrome-extension://')) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const message = data as { type?: unknown; supported?: unknown; listening?: unknown; text?: unknown; failure?: unknown }
      switch (message.type) {
        case 'dsh:dictation-capability':
          setBridge(message.supported === true)
          break
        case 'dsh:dictation-state':
          setListening(message.listening === true)
          break
        case 'dsh:dictation-text':
          if (typeof message.text === 'string' && message.text.length > 0) segmentRef.current(message.text)
          break
        case 'dsh:dictation-failure':
          failureRef.current(message.failure === 'denied' ? 'denied' : 'error')
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    // Carries nothing, so the unknowable extension origin is safely wildcarded.
    window.parent.postMessage({ type: 'dsh:dictation-probe' }, '*')
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  const stop = useCallback(() => {
    if (bridge) {
      window.parent.postMessage({ type: 'dsh:dictation-stop' }, '*')
      return
    }
    sessionRef.current?.stop()
  }, [bridge])

  const startLocal = useCallback(() => {
    const Recognition = recognitionConstructor()
    if (Recognition === undefined) return
    const session = new Recognition()
    session.lang = navigator.language
    session.continuous = true
    session.interimResults = false
    session.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result === undefined || !result.isFinal) continue
        const text = result[0].transcript.trim()
        if (text.length > 0) segmentRef.current(text)
      }
    }
    session.onerror = (event) => {
      // The browser fires `no-speech`/`aborted` for ordinary silence and
      // cancellation; only permission refusals and real failures announce.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        failureRef.current('denied')
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        failureRef.current('error')
      }
    }
    session.onend = () => {
      sessionRef.current = null
      setListening(false)
    }
    sessionRef.current = session
    setListening(true)
    session.start()
  }, [])

  const toggle = useCallback(() => {
    if (bridge) {
      window.parent.postMessage({ type: listening ? 'dsh:dictation-stop' : 'dsh:dictation-start' }, '*')
      return
    }
    const live = sessionRef.current
    if (live !== null) {
      live.stop()
      return
    }
    startLocal()
  }, [bridge, listening, startLocal])

  // Unmount kills a local session outright and quiets a bridge one: nothing
  // is left to receive segments.
  useEffect(() => () => {
    sessionRef.current?.abort()
    sessionRef.current = null
    if (embedded()) window.parent.postMessage({ type: 'dsh:dictation-stop' }, '*')
  }, [])

  return { supported, listening, toggle, stop }
}
