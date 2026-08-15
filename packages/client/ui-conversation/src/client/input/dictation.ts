/**
 * Composer dictation over the browser's Web Speech API. The hook owns one
 * recognition session at a time: finalized transcript segments stream to the
 * caller, the browser ends a session on sustained silence, and an unsupported
 * browser reports `supported: false` so the control never renders. The API is
 * not in lib.dom, so the minimal surface this module touches is declared
 * here.
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

/** Failure kinds the composer announces; everything else ends the session silently. */
export type DictationFailure = 'denied' | 'error'

/** The dictation control the composer renders. */
export interface Dictation {
  /** Whether this browser exposes speech recognition at all. */
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
  const sessionRef = useRef<DictationRecognition | null>(null)
  // Latest-callback refs: a live session survives re-renders without
  // re-binding its handlers to stale closures.
  const segmentRef = useRef(onSegment)
  segmentRef.current = onSegment
  const failureRef = useRef(onFailure)
  failureRef.current = onFailure
  const supported = recognitionConstructor() !== undefined

  const stop = useCallback(() => {
    sessionRef.current?.stop()
  }, [])

  const toggle = useCallback(() => {
    const live = sessionRef.current
    if (live !== null) {
      live.stop()
      return
    }
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

  // Unmount kills the session outright: nothing is left to receive segments.
  useEffect(() => () => {
    sessionRef.current?.abort()
    sessionRef.current = null
  }, [])

  return { supported, listening, toggle, stop }
}
