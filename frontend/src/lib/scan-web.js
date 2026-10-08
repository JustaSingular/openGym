// Browser-side code decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Three decoders, tried in order:
//   1. BarcodeDetector — the browser's own (Chrome/Edge on Android, Samsung Internet). Native
//      speed and quality when it exists.
//   2. zxing-wasm (MIT, wrapping zxing-cpp under Apache-2.0, see NOTICE.md) — reads QR codes and
//      the plain barcodes many membership cards carry, everywhere including iOS Safari, which has
//      no BarcodeDetector. About 1 MB of WebAssembly, fetched the first time someone scans and
//      kept by the service worker after that.
//   3. jsQR (Apache-2.0, see NOTICE.md) — pure JS, QR only. The fallback for when the WebAssembly
//      can't be had (offline before the first scan, a browser that refuses to compile it).
// All of them are loaded with a dynamic import so they only ship when someone scans.
//
// decodeImageData is the pure core (pixels in, string out) and is what the unit test exercises;
// decodeSource wraps it with the canvas plumbing the browser paths need.
import { normalizeFmt } from './qr.js'

// What we ask the decoders for: everything lib/qr.js and lib/barcode.js can redraw, plus the
// other 2D codes a card might carry, so those are reported as "can't be shown" rather than
// "nothing found". UPC-E is read too, for the same reason; barcode.js refuses it.
const NATIVE_FORMATS = ['qr_code', 'code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8',
  'itf', 'upc_a', 'upc_e', 'data_matrix', 'aztec', 'pdf417']
const ZXING_FORMATS = ['QRCode', 'Code128', 'Code39', 'Code93', 'Codabar', 'EAN13', 'EAN8',
  'ITF', 'UPCA', 'UPCE', 'DataMatrix', 'Aztec', 'PDF417']

let _jsqr = null
async function loadJsQr() {
  if (!_jsqr) _jsqr = (await import('jsqr')).default
  return _jsqr
}

// Where the .wasm comes from. In a build it is one of our own hashed assets, served next to the
// app (zxing-wasm would otherwise fetch it from a CDN). Node has no server to fetch from, so the
// tests hand the bytes over with setZxingWasmBinary instead.
let _wasmBinary = null
export function setZxingWasmBinary(bytes) { _wasmBinary = bytes; _zxing = null }

let _zxing = null
function loadZxing() {
  if (!_zxing) {
    _zxing = (async () => {
      const zx = await import('zxing-wasm/reader')
      if (_wasmBinary) {
        zx.prepareZXingModule({ overrides: { wasmBinary: _wasmBinary } })
      } else {
        const { default: url } = await import('zxing-wasm/reader/zxing_reader.wasm?url')
        zx.prepareZXingModule({ overrides: { locateFile: (p, prefix) => p.endsWith('.wasm') ? url : prefix + p } })
      }
      return zx
    })()
    // A failed load (offline, say) must not stick: the next scan tries again.
    _zxing.catch(() => { _zxing = null })
  }
  return _zxing
}

let _detector = null
async function nativeDetector() {
  if (_detector !== null) return _detector
  try {
    if (typeof BarcodeDetector !== 'function') { _detector = false; return _detector }
    const supported = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : ['qr_code']
    const formats = NATIVE_FORMATS.filter(f => supported.includes(f))
    _detector = formats.length ? new BarcodeDetector({ formats }) : false
  } catch (e) { _detector = false }
  return _detector
}

// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// zxing first, jsQR if zxing could not be loaded; the native detector wants a drawable, not raw
// pixels, so it lives in decodeSource.
export async function decodeImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  let zx = null
  try { zx = await loadZxing() } catch (e) { /* fall through to jsQR */ }
  if (zx) {
    try {
      const hits = await zx.readBarcodes(img, { formats: ZXING_FORMATS, maxNumberOfSymbols: 1 })
      const hit = hits.find(h => h.isValid && h.text)
      return hit ? { value: hit.text, fmt: normalizeFmt(hit.format) } : null
    } catch (e) { /* fall through to jsQR */ }
  }
  const jsQR = await loadJsQr()
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return hit && hit.data ? { value: hit.data, fmt: 'qrcode' } : null
}

// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge — plenty for a QR or a card's barcode, and it
// keeps decoding fast enough to run on every few video frames on a phone. Reuses one canvas.
const MAX = 800
let _canvas = null
export async function decodeSource(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0
  const sh = source.videoHeight || source.naturalHeight || source.height || 0
  if (!sw || !sh) return null
  const k = Math.min(1, MAX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k))
  if (!_canvas) _canvas = document.createElement('canvas')
  _canvas.width = w; _canvas.height = h
  const ctx = _canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)

  const det = await nativeDetector()
  if (det) {
    try {
      const found = await det.detect(_canvas)
      const b = found && found.find(x => x.rawValue)
      if (b) return { value: b.rawValue, fmt: normalizeFmt(b.format) || 'qrcode' }
    } catch (e) { /* fall through to zxing */ }
  }
  return decodeImageData(ctx.getImageData(0, 0, w, h))
}

// A picked File → { value, fmt } | null. createImageBitmap honours EXIF orientation where the
// browser supports it, which matters for photos of a card taken in portrait.
export async function importCodeFromImageWeb(file) {
  if (!file) return null
  let bmp
  if (typeof createImageBitmap === 'function') {
    bmp = await createImageBitmap(file)
  } else {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('bad image'))
      img.src = URL.createObjectURL(file)
    })
  }
  try { return await decodeSource(bmp) } finally { if (bmp.close) bmp.close() }
}
