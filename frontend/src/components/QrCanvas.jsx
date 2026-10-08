import { useEffect, useRef, useState } from 'react'
import { renderQrToCanvas } from '../lib/qr.js'
import { isLinearFmt, renderBarsToCanvas } from '../lib/barcode.js'
import { t } from '../lib/i18n.js'

// Renders a gym check-in code on a <canvas>: a QR by default, or the card's own linear barcode
// when `fmt` is one (lib/barcode.js). Regenerated from `value` on every change — we never store
// the picture (see lib/qr.js).
//
// A QR is drawn one module per pixel and scaled up by CSS (.qr-canvas, image-rendering: pixelated)
// into a `size` square. Bars can't take that stretch — a reader goes by their width ratios — so a
// barcode is drawn at the screen's own resolution, whole device pixels per module, up to a bit
// wider than `size`, and shown at exactly the CSS size that gives.
//
// The libs load via dynamic import, so the first paint is a frame behind; a plain box holds the
// space until then. A render failure (empty value, lib load error) shows nothing rather than a
// broken canvas — the caller decides what an unusable card looks like.
export default function QrCanvas({ value, fmt, size = 240, className = '' }) {
  const ref = useRef(null)
  const [ok, setOk] = useState(false)
  const linear = isLinearFmt(fmt)
  const [bars, setBars] = useState(null)

  useEffect(() => {
    let alive = true
    setOk(false)
    const draw = linear
      ? renderBarsToCanvas(ref.current, value, fmt, { maxCss: Math.round(size * 1.25), dpr: window.devicePixelRatio || 1 })
        .then(dims => { if (alive) setBars(dims); return dims ? 1 : 0 })
      : renderQrToCanvas(ref.current, value)
    draw
      .then(mods => { if (alive) setOk(mods > 0) })
      .catch(() => { if (alive) setOk(false) })
    return () => { alive = false }
  }, [value, fmt, linear, size])

  const style = linear
    ? { width: bars ? bars.width : size, height: bars ? bars.height : Math.round(size * 0.4), opacity: ok ? 1 : 0 }
    : { width: size, height: size, opacity: ok ? 1 : 0 }
  return (
    <canvas
      ref={ref}
      className={(linear ? 'bar-canvas ' : 'qr-canvas ') + className}
      style={style}
      aria-label={linear ? t('Barcode') : t('QR code')}
    />
  )
}
