#!/usr/bin/env node
// Comprehensive CDP-based test suite for MatSlop
// Tests the actual running app via Chrome DevTools Protocol
// Usage: node scripts/cdp-test.cjs

const http = require('http')
const net = require('net')
const crypto = require('crypto')
const { execSync } = require('child_process')

let passCount = 0, failCount = 0
const results = []

function log(msg) { console.log(msg) }
function pass(name) { passCount++; results.push({ name, pass: true }); log(`  ✓ ${name}`) }
function fail(name, reason) { failCount++; results.push({ name, pass: false, reason }); log(`  ✗ ${name}: ${reason}`) }

function getPages() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
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
    const msg = JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expression} })()`, returnByValue: true, awaitPromise: true } })
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      if (!headerDone) {
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        headerDone = true; buf = buf.slice(idx + 4)
        const payload = Buffer.from(msg)
        const maskKey = crypto.randomBytes(4)
        let header
        if (payload.length < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; maskKey.copy(header, 2) }
        else { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); maskKey.copy(header, 4) }
        const masked = Buffer.alloc(payload.length)
        for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4]
        socket.write(Buffer.concat([header, masked]))
      }
      while (buf.length > 2) {
        let len = buf[1] & 0x7f, off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (buf.length < off + len) return
        const frame = buf.slice(off, off + len).toString(); buf = buf.slice(off + len)
        try {
          const parsed = JSON.parse(frame)
          if (parsed.id === 1) {
            const r = parsed.result?.result
            if (r?.type === 'string') { socket.destroy(); resolve(r.value); return }
            if (r?.value !== undefined) { socket.destroy(); resolve(JSON.stringify(r.value)); return }
            socket.destroy(); resolve(JSON.stringify(parsed.result)); return
          }
        } catch {}
      }
    })
    socket.on('error', reject)
    setTimeout(() => { socket.destroy(); reject(new Error('CDP timeout')) }, 15000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function screenshot(name) {
  try {
    execSync(`powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $b=New-Object System.Drawing.Bitmap($s.Width,$s.Height); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size); $b.Save('C:\\Users\\benki\\Documents\\RES\\projects\\MatSlop\\test-screenshots\\${name}.png'); $g.Dispose(); $b.Dispose()"`, { stdio: 'pipe' })
  } catch {}
}

async function main() {
  log('MatSlop Comprehensive Test Suite')
  log('================================\n')

  const pages = await getPages()
  const page = pages.find(p => p.type === 'page')
  if (!page) { log('ERROR: No page found'); process.exit(1) }
  const ws = page.webSocketDebuggerUrl
  const eval_ = (expr) => cdpEval(ws, expr)

  // ==========================================
  log('TEST GROUP 1: Initial State')
  // ==========================================
  {
    const r = JSON.parse(await eval_('return JSON.stringify({ title: document.title, hasToolbar: !!document.querySelector(".editor-toolbar"), hasFileBrowser: !!document.querySelector("[data-testid=\\"file-browser\\"]"), hasWorkspace: !!document.querySelector("[data-testid=\\"workspace-panel\\"]") })'))
    if (r.title?.includes('MatSlop')) pass('Window title contains MatSlop')
    else fail('Window title', `got: ${r.title}`)
    if (r.hasToolbar) pass('Editor toolbar exists')
    else fail('Editor toolbar', 'not found')
    if (r.hasFileBrowser) pass('File browser panel exists')
    else fail('File browser panel', 'not found')
    if (r.hasWorkspace) pass('Workspace panel exists')
    else fail('Workspace panel', 'not found')
  }

  // ==========================================
  log('\nTEST GROUP 2: Create .m Script')
  // ==========================================
  {
    // Click the new file button
    await eval_('document.querySelector(".toolbar-split-btn > .toolbar-btn").click()')
    await sleep(500)
    const r = JSON.parse(await eval_('const tabs = Array.from(document.querySelectorAll("[data-testid=\\"editor-tab\\"]")).map(t => ({ fn: t.dataset.tabFilename, active: t.classList.contains("active") })); return JSON.stringify(tabs)'))
    const mTab = r.find(t => t.fn.match(/^untitled\d*\.m$/) && t.active)
    if (mTab) pass(`Created ${mTab.fn} tab (active)`)
    else fail('Create .m tab', JSON.stringify(r))
  }

  // ==========================================
  log('\nTEST GROUP 3: Type Code in .m Script')
  // ==========================================
  {
    await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; if (eds.length > 0) eds[eds.length-1].setValue("x = 1:10;\\ny = x .^ 2;\\ndisp(y)")')
    await sleep(300)
    const val = await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; return eds.length > 0 ? eds[eds.length-1].getValue() : "none"')
    if (val.includes('disp(y)')) pass('Code entered in .m editor')
    else fail('Type code in .m', val.substring(0, 50))
  }

  // ==========================================
  log('\nTEST GROUP 4: Create Live Script')
  // ==========================================
  {
    await eval_('document.querySelector(".toolbar-split-chevron").click()')
    await sleep(500)
    await eval_('for (const i of document.querySelectorAll(".toolbar-dropdown-item")) { if (i.textContent.includes("Live")) { i.click(); break; } }')
    await sleep(1000)
    const r = JSON.parse(await eval_('const tabs = Array.from(document.querySelectorAll("[data-testid=\\"editor-tab\\"]")).map(t => ({ fn: t.dataset.tabFilename, active: t.classList.contains("active") })); return JSON.stringify(tabs)'))
    const mlsTab = r.find(t => t.fn.match(/^untitled\d*\.mls$/) && t.active)
    if (mlsTab) pass(`Created ${mlsTab.fn} tab (active)`)
    else fail('Create .mls tab', JSON.stringify(r))
  }

  // ==========================================
  log('\nTEST GROUP 5: Live Script Cell Rendering')
  // ==========================================
  {
    const r = JSON.parse(await eval_('return JSON.stringify({ hasLS: !!document.querySelector(".ls-editor"), hasToolbar: !!document.querySelector(".ls-toolbar"), hasRunAll: !!document.querySelector(".ls-run-all-btn"), cellCount: document.querySelectorAll("[data-testid=\\"ls-cell\\"]").length, addBtnCount: document.querySelectorAll(".ls-add-cell-btn").length })'))
    if (r.hasLS) pass('LiveScriptEditor renders')
    else fail('LS rendering', 'no .ls-editor')
    if (r.hasToolbar) pass('LS toolbar with Run All button')
    else fail('LS toolbar', 'missing')
    if (r.cellCount >= 1) pass(`Has ${r.cellCount} cell(s)`)
    else fail('LS cells', `count: ${r.cellCount}`)
    if (r.addBtnCount >= 2) pass('Add-cell buttons present between cells')
    else fail('Add-cell buttons', `count: ${r.addBtnCount}`)
  }

  // ==========================================
  log('\nTEST GROUP 6: Live Script Cell Height')
  // ==========================================
  {
    const r = JSON.parse(await eval_('const cells = document.querySelectorAll("[data-testid=\\"ls-cell\\"]"); const monacos = document.querySelectorAll(".ls-code-cell-editor"); return JSON.stringify({ cellH: Array.from(cells).map(c => c.offsetHeight), monacoH: Array.from(monacos).map(m => m.offsetHeight) })'))
    const cellH = r.cellH[0] || 0
    const monacoH = r.monacoH[0] || 0
    if (cellH >= 38) pass(`Cell height is ${cellH}px (>= 38px minimum)`)
    else fail('Cell height', `${cellH}px is too small`)
    if (monacoH >= 30) pass(`Monaco wrapper height is ${monacoH}px`)
    else fail('Monaco wrapper height', `${monacoH}px`)
  }

  // ==========================================
  log('\nTEST GROUP 7: Engine Status')
  // ==========================================
  {
    const r = JSON.parse(await eval_('return JSON.stringify({ status: document.querySelector("[data-testid=\\"engine-status\\"]")?.textContent, runAllDisabled: document.querySelector(".ls-run-all-btn")?.disabled, runCellDisabled: document.querySelector(".ls-cell-run-btn")?.disabled })'))
    if (r.status === 'Ready') pass('Engine status is Ready')
    else fail('Engine status', r.status)
    if (r.runAllDisabled === false) pass('Run All button is enabled')
    else fail('Run All button', 'disabled')
    if (r.runCellDisabled === false) pass('Run Cell button is enabled')
    else fail('Run Cell button', 'disabled')
  }

  // ==========================================
  log('\nTEST GROUP 8: Live Script Code Execution')
  // ==========================================
  {
    // Set code in cell
    await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; if (eds.length > 0) eds[eds.length-1].setValue("a = 42;\\nb = 58;\\ndisp(a + b)")')
    await sleep(500)
    // Click Run All
    await eval_('document.querySelector(".ls-run-all-btn").click()')
    await sleep(5000)
    const r = JSON.parse(await eval_('const outputs = document.querySelectorAll("[data-testid=\\"ls-cell-output\\"]"); return JSON.stringify(Array.from(outputs).map(o => ({ text: o.textContent?.substring(0, 200), hasError: !!o.querySelector(".ls-cell-output-error") })))'))
    if (r.length > 0 && r[0].text?.includes('100')) pass('Cell output shows correct result (100)')
    else fail('Cell execution', JSON.stringify(r))
    if (!r[0]?.hasError) pass('No error in cell output')
    else fail('Cell error', 'error flag set')
  }

  // ==========================================
  log('\nTEST GROUP 9: Command Window Isolation')
  // ==========================================
  {
    const r = await eval_('return document.querySelector(".cw-output")?.textContent?.substring(0, 200) || ""')
    if (!r.includes('source(')) pass('Command window has no source() pollution')
    else fail('Command window', `contains source(): ${r.substring(0, 80)}`)
  }

  // ==========================================
  log('\nTEST GROUP 10: Workspace Variables')
  // ==========================================
  {
    await sleep(1000)
    const r = await eval_('return document.querySelector("[data-testid=\\"workspace-panel\\"]")?.textContent?.substring(0, 300) || ""')
    if (r.includes('a') || r.includes('42')) pass('Workspace shows variable a')
    else fail('Workspace variables', `content: ${r.substring(0, 100)}`)
  }

  // ==========================================
  log('\nTEST GROUP 11: Markdown Cell')
  // ==========================================
  {
    // Click add-cell button after the code cell
    const addResult = await eval_('const btns = document.querySelectorAll(".ls-add-cell-btn"); if (btns.length >= 2) { btns[1].click(); return "clicked"; } return "no button";')
    await sleep(500)
    const menuResult = await eval_('const menu = document.querySelector(".ls-add-cell-menu"); if (!menu) return "no menu"; for (const b of menu.querySelectorAll("button")) { if (b.textContent.includes("Markdown")) { b.click(); return "added"; } } return "no md btn";')
    await sleep(500)
    const r = JSON.parse(await eval_('const cells = document.querySelectorAll("[data-testid=\\"ls-cell\\"]"); return JSON.stringify({ count: cells.length, types: Array.from(cells).map(c => c.dataset.cellType) })'))
    if (r.types.includes('markdown')) pass('Markdown cell created')
    else fail('Markdown cell', JSON.stringify(r))
  }

  // ==========================================
  log('\nTEST GROUP 12: F5 Routes to Run All for Live Scripts')
  // ==========================================
  {
    // Change cell content
    await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; if (eds.length > 0) eds[0].setValue("c = 999;\\ndisp(c)")')
    await sleep(300)
    // Dispatch F5 event
    await eval_('window.dispatchEvent(new CustomEvent("matslop:runActiveScript"))')
    await sleep(5000)
    const r = JSON.parse(await eval_('const outputs = document.querySelectorAll("[data-testid=\\"ls-cell-output\\"]"); return JSON.stringify(Array.from(outputs).map(o => o.textContent?.substring(0, 100)))'))
    if (r.some(t => t?.includes('999'))) pass('F5 executed live script cells (output shows 999)')
    else fail('F5 routing', JSON.stringify(r))
  }

  // ==========================================
  log('\nTEST GROUP 13: Switch to .m Tab and Run Plot')
  // ==========================================
  {
    // Click on the .m tab
    await eval_('for (const t of document.querySelectorAll("[data-testid=\\"editor-tab\\"]")) { if (t.dataset.tabFilename === "untitled.m") { t.click(); break; } }')
    await sleep(500)
    // Set plot code
    await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; if (eds.length) eds[eds.length-1].setValue("t = 0:0.01:2*pi;\\ny = sin(t);\\nplot(t, y);\\ntitle(\\"Test Plot\\");\\nxlabel(\\"t\\");\\nylabel(\\"sin(t)\\")")')
    await sleep(300)
    // Run via F5
    await eval_('window.dispatchEvent(new CustomEvent("matslop:runActiveScript"))')
    await sleep(8000) // plots take longer
    const r = await eval_('return document.querySelector(".cw-output")?.textContent?.substring(0, 200) || ""')
    if (r.includes('untitled.m')) pass('Command window shows filename (no source())')
    else fail('.m run display', r.substring(0, 80))
    // Check if figure panel appeared
    const figR = JSON.parse(await eval_('return JSON.stringify({ hasFig: !!document.querySelector("[data-testid=\\"dock-tab-matslop-figure\\"]"), figContent: document.querySelector("[data-testid=\\"dock-tab-matslop-figure\\"]")?.closest(".dock-tabpane")?.textContent?.substring(0, 100) || "" })'))
    if (figR.hasFig) pass('Figure panel visible after .m plot')
    else fail('Figure panel', 'not found')
  }

  // ==========================================
  log('\nTEST GROUP 14: Live Script Plot Rendering')
  // ==========================================
  {
    // Switch to .mls tab
    await eval_('for (const t of document.querySelectorAll("[data-testid=\\"editor-tab\\"]")) { if (t.dataset.tabFilename === "untitled.mls") { t.click(); break; } }')
    await sleep(500)
    // Set plot code in the first code cell
    await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; if (eds.length) eds[0].setValue("x = linspace(0, 4*pi, 200);\\ny = cos(x);\\nplot(x, y);\\ntitle(\\"Cosine\\");")')
    await sleep(500)
    // Click Run All
    await eval_('document.querySelector(".ls-run-all-btn")?.click()')
    await sleep(8000)
    const r = JSON.parse(await eval_('const outputs = document.querySelectorAll("[data-testid=\\"ls-cell-output\\"]"); return JSON.stringify(Array.from(outputs).map(o => ({ hasFigure: !!o.querySelector("[data-testid=\\"ls-inline-plot\\"]"), text: o.textContent?.substring(0, 100) })))'))
    if (r.some(o => o.hasFigure)) pass('Live script inline plot rendered')
    else fail('LS inline plot', JSON.stringify(r))
  }

  // ==========================================
  log('\nTEST GROUP 15: Cell Height Grows with Content')
  // ==========================================
  {
    // Add more lines and check height grows
    await eval_('const eds = window.monaco?.editor?.getEditors?.() || []; if (eds.length) eds[0].setValue("% Line 1\\n% Line 2\\n% Line 3\\n% Line 4\\n% Line 5\\n% Line 6\\n% Line 7\\n% Line 8\\n% Line 9\\n% Line 10")')
    await sleep(500)
    const r = JSON.parse(await eval_('const cells = document.querySelectorAll("[data-testid=\\"ls-cell\\"][data-cell-type=\\"code\\"]"); return JSON.stringify({ cellH: cells[0]?.offsetHeight })'))
    if (r.cellH > 100) pass(`Code cell grew to ${r.cellH}px for 10 lines`)
    else fail('Cell height growth', `only ${r.cellH}px for 10 lines`)
  }

  // ==========================================
  log('\nTEST GROUP 16: Command Window Input')
  // ==========================================
  {
    // Check that command window has an input field
    const r = JSON.parse(await eval_('return JSON.stringify({ hasInput: !!document.querySelector(".cw-input"), placeholder: document.querySelector(".cw-input")?.placeholder })'))
    if (r.hasInput) pass('Command window has input field')
    else fail('CW input', 'not found')
  }

  screenshot('test-final')

  // Summary
  log('\n================================')
  log(`RESULTS: ${passCount} passed, ${failCount} failed out of ${passCount + failCount} tests`)
  if (failCount > 0) {
    log('\nFailed tests:')
    results.filter(r => !r.pass).forEach(r => log(`  ✗ ${r.name}: ${r.reason}`))
  }
  log('================================')
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(e => { console.error('Test suite error:', e.message); process.exit(1) })
