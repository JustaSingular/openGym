import { describe, it, expect } from 'vitest'
import { normalizeFmt, canRenderFmt } from './qr.js'

// The QR helpers decide which scanned codes the check-in feature will store: it can read more
// symbologies than it can redraw, so canRenderFmt is the gate, and normalizeFmt is what
// folds every spelling mlkit might report into the single token everything else compares on.

describe('normalizeFmt', () => {
  it('folds every QR spelling to "qrcode"', () => {
    // mlkit's BarcodeFormat, the enum-ish casings, and the casual 'qr' all mean the same thing.
    expect(normalizeFmt('QR_CODE')).toBe('qrcode')
    expect(normalizeFmt('QrCode')).toBe('qrcode')
    expect(normalizeFmt('qrcode')).toBe('qrcode')
    expect(normalizeFmt('qr')).toBe('qrcode')
    expect(normalizeFmt('QR')).toBe('qrcode')
  })

  it('lower-cases and strips separators for other formats', () => {
    expect(normalizeFmt('EAN_13')).toBe('ean13')
    expect(normalizeFmt('Code128')).toBe('code128')
    expect(normalizeFmt('CODE_128')).toBe('code128')
  })

  it('treats empty / nullish as an empty token rather than throwing', () => {
    expect(normalizeFmt('')).toBe('')
    expect(normalizeFmt(null)).toBe('')
    expect(normalizeFmt(undefined)).toBe('')
  })
})

describe('canRenderFmt', () => {
  it('accepts only QR, in any spelling', () => {
    expect(canRenderFmt('QR_CODE')).toBe(true)
    expect(canRenderFmt('QrCode')).toBe(true)
    expect(canRenderFmt('qr')).toBe(true)
  })

  it('accepts the linear barcodes lib/barcode.js redraws, in every spelling a decoder reports', () => {
    // ML Kit says CODE_128, BarcodeDetector code_128, zxing Code128: all one card format.
    for (const fmt of ['EAN_13', 'ean_13', 'EAN13', 'EAN_8', 'CODE_128', 'code_128', 'Code128',
      'CODE_39', 'Code93', 'CODABAR', 'ITF', 'UPC_A', 'UPCA']) {
      expect(canRenderFmt(fmt)).toBe(true)
    }
  })

  it('rejects the symbologies we cannot faithfully redraw', () => {
    // Readable by the scanner, but nothing here reproduces them, so a card in one of these
    // formats must never be stored — it would display as the wrong code at the turnstile. UPC-E
    // comes back from the decoders expanded to 13 digits, which would redraw as different bars.
    for (const fmt of ['UPC_E', 'UPCE', 'PDF_417', 'AZTEC', 'DATA_MATRIX', 'ITF14', 'Code39Ext']) {
      expect(canRenderFmt(fmt)).toBe(false)
    }
  })

  it('rejects empty / unknown formats', () => {
    expect(canRenderFmt('')).toBe(false)
    expect(canRenderFmt(null)).toBe(false)
    expect(canRenderFmt('something-else')).toBe(false)
  })
})
