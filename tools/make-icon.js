/**
 * Ritar programikonen och skriver build/icon.ico samt build/icon.png.
 *
 *   node_modules\electron\dist\electron.exe tools\make-icon.js
 *
 * Electron far rita bilden at oss i stallet for att dra in ett bildbibliotek.
 * Ritningen gors med canvas inne i sidan i stallet for med capturePage — ett
 * fonster som inte syns fotograferas som en tom bild.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const OUT_DIR = path.join(__dirname, '..', 'build')
const LOG = path.join(OUT_DIR, 'make-icon.log')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

// Morkt holje med en fosforgron skarm — en gammal CRT-monitor sedd framifran.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bezel" x1="0.1" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#3d4553"/>
      <stop offset="0.42" stop-color="#20252e"/>
      <stop offset="1" stop-color="#0c0f14"/>
    </linearGradient>
    <radialGradient id="screen" cx="0.5" cy="0.4" r="0.75">
      <stop offset="0" stop-color="#14251a"/>
      <stop offset="0.62" stop-color="#0a0f0c"/>
      <stop offset="1" stop-color="#040705"/>
    </radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.13"/>
      <stop offset="0.42" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>

    <!-- Skannlinjer: varannan rad nedtonad, som pa ett bildror. -->
    <pattern id="scan" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="3" fill="#000000" opacity="0.3"/>
    </pattern>

    <!-- Fosforglod. Suddigheten laggs dubbelt for att lysa tydligare. -->
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <clipPath id="screenClip">
      <rect x="32" y="40" width="192" height="176" rx="34"/>
    </clipPath>
  </defs>

  <rect x="14" y="22" width="228" height="212" rx="50" fill="url(#bezel)"/>
  <rect x="15.5" y="23.5" width="225" height="209" rx="48.5"
        fill="none" stroke="#67728a" stroke-opacity="0.45" stroke-width="3"/>

  <rect x="32" y="40" width="192" height="176" rx="34" fill="url(#screen)"/>

  <g clip-path="url(#screenClip)">
    <g filter="url(#glow)">
      <path d="M74 101 L107 128 L74 155" fill="none" stroke="#5ef08a"
            stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="121" y="148" width="56" height="14" rx="7" fill="#5ef08a"/>
    </g>
    <rect x="32" y="40" width="192" height="176" fill="url(#scan)"/>
    <rect x="32" y="40" width="192" height="176" rx="34" fill="url(#glass)"/>
  </g>
</svg>`

// ICO-behallare med PNG-data. Windows Vista och senare klarar PNG rakt av, sa
// vi slipper det gamla BMP-formatet med sin separata maskbild.
function buildIco (images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)              // reserverad
  header.writeUInt16LE(1, 2)              // typ 1 = ikon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16

  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    // 256 skrivs som 0 — falten ar bara en byte breda.
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)                // paletten oanvand
    entry.writeUInt8(0, 3)                // reserverad
    entry.writeUInt16LE(1, 4)             // fargplan
    entry.writeUInt16LE(32, 6)            // bitar per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }

  return Buffer.concat([header, ...entries, ...images.map(image => image.data)])
}

const script = `(async () => {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)})
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('kunde inte lasa SVG'))
    img.src = url
  })
  return ${JSON.stringify(SIZES)}.map(size => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  })
})()`

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const win = new BrowserWindow({ width: 300, height: 300, show: false })

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8">'))
    const dataUrls = await win.webContents.executeJavaScript(script)

    const images = dataUrls.map((url, index) => ({
      size: SIZES[index],
      data: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
    }))

    const empty = images.filter(image => image.data.length === 0)
    if (empty.length) throw new Error('tomma bilder: ' + empty.map(i => i.size).join(', '))

    fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(images))
    fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images[images.length - 1].data)
    fs.writeFileSync(LOG, 'OK ' + images.map(i => `${i.size}:${i.data.length}`).join(' ') + '\n')
  } catch (err) {
    fs.writeFileSync(LOG, 'FEL ' + err.message + '\n')
  }

  app.quit()
})
