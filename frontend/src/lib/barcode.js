// Linear (1D) barcode rendering for the gym check-in cards — the barcode half of lib/qr.js.
//
// Plenty of gyms still print a plain barcode on the membership card (Code 128 and Code 39 most
// often, sometimes Codabar, ITF or an EAN). As with QR codes we store only the decoded value and
// its symbology, and redraw the bars from them every time the card is shown.
//
// The encoders come from JsBarcode (MIT, see NOTICE.md). Only its encoders are used, not its DOM
// renderer: an encoder turns a value into a string of modules ('1' bar, '0' space) and we paint
// those ourselves, so every module lands on a whole number of device pixels. A 1D code is read
// from the ratio of bar widths, and the CSS upscaling QR codes get away with (a 1px-per-module
// canvas stretched by image-rendering: pixelated) makes some bars a pixel wider than their
// neighbours. Loaded with a dynamic import, like lean-qr, so it only ships when a card is shown.
//
// UPC-E is deliberately missing: the decoders hand it back expanded to its 13-digit UPC-A form,
// and redrawing that would give different bars than the card has. The capture flow refuses any
// symbology not listed here, so a saved card is always one we can draw.

import { normalizeFmt } from './qr.js'

// Stored `fmt` token (see normalizeFmt) → JsBarcode encoder name.
const ENCODERS = {
  code128: 'CODE128',
  code39: 'CODE39',
  code93: 'CODE93',
  codabar: 'codabar',
  ean13: 'EAN13',
  ean8: 'EAN8',
  upca: 'UPC',
  itf: 'ITF',
}

export function isLinearFmt(fmt) {
  return Object.hasOwn(ENCODERS, normalizeFmt(fmt))
}

let _enc = null
async function loadEncoders() {
  if (!_enc) {
    // A CommonJS module whose exports carry their own `default`; depending on the bundler's
    // interop the encoders sit one or two `default`s deep.
    const m = await import('jsbarcode/bin/barcodes/index.js')
    const d = m.default || m
    _enc = d.CODE128 ? d : d.default
  }
  return _enc
}

// `value` as a string of modules for `fmt`, or null when the symbology is not one we draw or the
// value cannot be encoded in it (a wrong EAN check digit, an odd-length ITF, a character Code 39
// has no bars for). EAN and UPC encoders return their guards and halves as separate parts.
export async function encodeLinear(value, fmt) {
  const name = ENCODERS[normalizeFmt(fmt)]
  if (!name || !value) return null
  value = String(value)
  // JsBarcode upper-cases Code 39/93 input on its own, which would draw a different code than
  // the card's (a reader that saw lower case was reading the full-ASCII variant). Refuse instead.
  if ((name === 'CODE39' || name === 'CODE93') && value !== value.toUpperCase()) return null
  const encoders = await loadEncoders()
  try {
    const enc = new encoders[name](value, {})
    if (!enc.valid()) return null
    const out = enc.encode()
    const bits = Array.isArray(out) ? out.map(p => p.data).join('') : out.data
    return /^[01]+$/.test(bits) ? bits : null
  } catch (e) {
    return null
  }
}

// The check the capture flow makes before a scanned code reaches the form: a QR always redraws,
// a linear code only if its value encodes in its symbology. Async because the encoders load on
// demand.
export async function canDrawCode(code) {
  if (!code || !code.value) return false
  if (normalizeFmt(code.fmt) === 'qrcode') return true
  return (await encodeLinear(code.value, code.fmt)) != null
}

// Every symbology here wants at least 10 modules of white either side (EAN asks 11 on the left);
// 12 covers them all. The white plate around the canvas adds more on top.
export const QUIET = 12

// Lays `bits` out for a box at most `maxCss` CSS pixels wide on a screen with `dpr` device pixels
// per CSS pixel: a whole number of device pixels per module (at least one), so every bar of a
// given width is drawn the same width. Pure, so it can be tested without a canvas.
export function barLayout(bits, { maxCss, dpr = 1 }) {
  const modules = bits.length + QUIET * 2
  const px = Math.max(1, Math.floor((maxCss * dpr) / modules))
  const width = modules * px
  // Tall enough for a reader to find the code with a tilted phone, the way a printed card is.
  const height = Math.max(Math.round(width * 0.4), Math.round(72 * dpr))
  return { px, width, height, cssWidth: width / dpr, cssHeight: height / dpr }
}

// Draw `value` as a `fmt` barcode onto `canvas`, sized for `maxCss` CSS pixels. Black on white
// for the same reason as the QR codes: readers want contrast, not theme colours. Returns the CSS
// size the canvas should be shown at, or null if the value can't be drawn.
export async function renderBarsToCanvas(canvas, value, fmt, { maxCss = 280, dpr = 1 } = {}) {
  if (!canvas) return null
  const bits = await encodeLinear(value, fmt)
  if (!bits) return null
  const L = barLayout(bits, { maxCss, dpr })
  canvas.width = L.width
  canvas.height = L.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, L.width, L.height)
  ctx.fillStyle = '#000000'
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') ctx.fillRect((QUIET + i) * L.px, 0, L.px, L.height)
  }
  return { width: L.cssWidth, height: L.cssHeight }
}
