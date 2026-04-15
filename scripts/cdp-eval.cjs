#!/usr/bin/env node
// CDP evaluator — runs JavaScript in the Electron renderer via Chrome DevTools Protocol
// Usage: node scripts/cdp-eval.js "expression"

const http = require('http')
const net = require('net')
const crypto = require('crypto')

const expr = process.argv[2]
if (!expr) { console.error('Usage: node cdp-eval.js "expression"'); process.exit(1) }

function getPages() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl)
    const key = crypto.randomBytes(16).toString('base64')
    const socket = net.createConnection(Number(url.port), url.hostname, () => {
      socket.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })

    let buf = Buffer.alloc(0), headerDone = false
    const msg = JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      if (!headerDone) {
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        headerDone = true
        buf = buf.slice(idx + 4)
        // Send WS frame
        const payload = Buffer.from(msg)
        const maskKey = crypto.randomBytes(4)
        let header
        if (payload.length < 126) {
          header = Buffer.alloc(6)
          header[0] = 0x81; header[1] = 0x80 | payload.length
          maskKey.copy(header, 2)
        } else {
          header = Buffer.alloc(8)
          header[0] = 0x81; header[1] = 0x80 | 126
          header.writeUInt16BE(payload.length, 2)
          maskKey.copy(header, 4)
        }
        const masked = Buffer.alloc(payload.length)
        for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4]
        socket.write(Buffer.concat([header, masked]))
      }
      // Parse WS frames
      while (buf.length > 2) {
        let len = buf[1] & 0x7f, off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (buf.length < off + len) return
        const frame = buf.slice(off, off + len).toString()
        buf = buf.slice(off + len)
        try {
          const parsed = JSON.parse(frame)
          if (parsed.id === 1) {
            const r = parsed.result?.result
            if (r?.type === 'string') console.log(r.value)
            else if (r?.value !== undefined) console.log(JSON.stringify(r.value))
            else console.log(JSON.stringify(parsed.result))
            socket.destroy()
            resolve()
            return
          }
        } catch {}
      }
    })
    socket.on('error', reject)
    setTimeout(() => { socket.destroy(); reject(new Error('timeout')) }, 5000)
  })
}

async function main() {
  const pages = await getPages()
  const page = pages.find(p => p.type === 'page')
  if (!page) { console.error('No page found'); process.exit(1) }
  await cdpEval(page.webSocketDebuggerUrl, expr)
}

main().catch(e => { console.error(e.message); process.exit(1) })
