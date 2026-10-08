import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { generate } from 'lean-qr'
import { encodeLinear, isLinearFmt, canDrawCode, barLayout, QUIET } from './barcode.js'
import { decodeImageData, setZxingWasmBinary } from './scan-web.js'

// The promise this feature makes is that the bars on the phone carry exactly what the card did.
// So every symbology is checked as a round trip through the two halves the app uses: barcode.js
// encodes the value (the same bits the card view paints), and the browser decoder in scan-web.js
// reads them back. Pixels are built by hand from the bits — no canvas in this environment — with
// the same quiet zone and whole-pixel modules the card view draws.

const require = createRequire(import.meta.url)
beforeAll(() => {
  setZxingWasmBinary(readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')).buffer)
})

function paint(bits, px = 3, height = 80) {
  const width = (bits.length + QUIET * 2) * px
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let x = 0; x < width; x++) {
    const i = Math.floor(x / px) - QUIET
    if (i < 0 || i >= bits.length || bits[i] !== '1') continue
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 4
      data[p] = data[p + 1] = data[p + 2] = 0
    }
  }
  return { data, width, height }
}

describe('a card barcode survives being redrawn', () => {
  it.each([
    ['code128', '1234567890'],
    ['code128', 'MEMBER-0042 b'],
    ['code39', 'ABC123'],
    ['code39', 'FIT 42-7'],
    ['code93', 'GYM93X'],
    ['codabar', 'A40156B'],
    ['ean13', '5901234123457'],
    ['ean8', '96385074'],
    ['itf', '00123456'],
  ])('%s %s reads back as the same value and format', async (fmt, value) => {
    const bits = await encodeLinear(value, fmt)
    expect(bits).toMatch(/^[01]+$/)
    expect(await decodeImageData(paint(bits))).toEqual({ value, fmt })
  })

  it('a UPC-A card comes back as the EAN-13 it is a subset of, and redraws to the same bars', async () => {
    const bits = await encodeLinear('036000291452', 'upca')
    const hit = await decodeImageData(paint(bits))
    expect(hit).toEqual({ value: '0036000291452', fmt: 'ean13' })
    expect(await encodeLinear(hit.value, hit.fmt)).toBe(bits)
  })

  it('what the decoder returns is stable: drawing it again gives identical bars', async () => {
    // A Codabar value without its start/stop letters gets 'A…A' added; the reading of that
    // carries them, and must be what is saved and redrawn from then on.
    const first = await decodeImageData(paint(await encodeLinear('40156', 'codabar')))
    expect(first).toEqual({ value: 'A40156A', fmt: 'codabar' })
    const again = await decodeImageData(paint(await encodeLinear(first.value, first.fmt)))
    expect(again).toEqual(first)
  })

  it('QR cards still read through the same decoder', async () => {
    const value = 'MEMBER-0042-FITZONE'
    const code = generate(value)
    const scale = 4, quiet = 4, n = code.size + quiet * 2, w = n * scale
    const data = new Uint8ClampedArray(w * w * 4).fill(255)
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet
      if (mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my)) {
        const p = (y * w + x) * 4
        data[p] = data[p + 1] = data[p + 2] = 0
      }
    }
    expect(await decodeImageData({ data, width: w, height: w })).toEqual({ value, fmt: 'qrcode' })
  })
})

describe('encodeLinear refuses what it cannot draw faithfully', () => {
  it.each([
    ['ean13', '5901234123458', 'a wrong check digit'],
    ['ean13', '12345', 'the wrong length'],
    ['itf', '12345', 'an odd number of digits'],
    ['code39', 'lower case', 'lower case, which Code 39 would silently upper-case'],
    ['code39', 'A_B', 'characters Code 39 has no bars for'],
    ['upce', '01234565', 'UPC-E, which decoders hand back expanded'],
    ['pdf417', 'ANY', 'a 2D symbology'],
    ['code128', '', 'an empty value'],
  ])('%s %j (%s)', async (fmt, value) => {
    expect(await encodeLinear(value, fmt)).toBeNull()
  })
})

describe('isLinearFmt', () => {
  it('knows the linear codes in any decoder spelling, and nothing else', () => {
    expect(isLinearFmt('CODE_128')).toBe(true)
    expect(isLinearFmt('code_39')).toBe(true)
    expect(isLinearFmt('EAN13')).toBe(true)
    expect(isLinearFmt('QR_CODE')).toBe(false)
    expect(isLinearFmt('UPC_E')).toBe(false)
    expect(isLinearFmt(null)).toBe(false)
  })
})

describe('canDrawCode', () => {
  it('takes any QR and any linear code whose value encodes', async () => {
    expect(await canDrawCode({ value: 'anything at all', fmt: 'QR_CODE' })).toBe(true)
    expect(await canDrawCode({ value: '5901234123457', fmt: 'EAN_13' })).toBe(true)
    expect(await canDrawCode({ value: 'MEMBER 42', fmt: 'CODE_39' })).toBe(true)
  })

  it('refuses a bad value, an unknown format and an empty code', async () => {
    expect(await canDrawCode({ value: '5901234123458', fmt: 'EAN_13' })).toBe(false)
    expect(await canDrawCode({ value: 'X', fmt: 'PDF_417' })).toBe(false)
    expect(await canDrawCode({ value: '', fmt: 'QR_CODE' })).toBe(false)
    expect(await canDrawCode(null)).toBe(false)
  })
})

describe('barLayout', () => {
  it('gives every module the same whole number of device pixels', () => {
    const bits = '1'.repeat(90)                          // a short Code 128
    const L = barLayout(bits, { maxCss: 280, dpr: 3 })
    expect(Number.isInteger(L.px)).toBe(true)
    expect(L.width).toBe((90 + QUIET * 2) * L.px)
    expect(L.cssWidth).toBeLessThanOrEqual(280)
    expect(L.cssWidth).toBe(L.width / 3)
  })

  it('never goes below one device pixel per module, even for a very long code', () => {
    const L = barLayout('1'.repeat(1000), { maxCss: 200, dpr: 1 })
    expect(L.px).toBe(1)
  })

  it('stays tall enough to aim at', () => {
    const L = barLayout('1'.repeat(60), { maxCss: 150, dpr: 2 })
    expect(L.cssHeight).toBeGreaterThanOrEqual(72)
  })
})
