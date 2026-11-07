#!/usr/bin/env node
// scripts/demo-windows.mjs
//
// Opens one browser window per demo identity, each already signed in with the
// demo (mock) login and tiled on screen: two TAs and an instructor on the top
// row, three students below. Every window is a separate browser, so sessions
// never mix.
//
// Usage:  npm run demo:windows        (the app must be running, e.g. docker compose up)
// Env:    BASE_URL     default http://localhost:3000
//         DEMO_COURSE  default cs101
//
// Close the windows (or press Ctrl+C here) to end the demo.

import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const COURSE = process.env.DEMO_COURSE || 'cs101'

const WINDOWS = [
  { label: 'TA User', as: 'ta', email: 'ta@example.com', path: `/courses/${COURSE}/ta` },
  { label: 'TA Two', as: 'ta', email: 'ta2@example.com', path: `/courses/${COURSE}/ta` },
  { label: 'Instructor', as: 'instructor', email: 'instructor@example.com', path: `/courses/${COURSE}/admin` },
  { label: 'Student User', as: 'student', email: 'student@example.com', path: `/courses/${COURSE}/student` },
  { label: 'Student Two', as: 'student', email: 'student2@example.com', path: `/courses/${COURSE}/student` },
  { label: 'Student Three', as: 'student', email: 'student3@example.com', path: `/courses/${COURSE}/student` }
]

/** Usable screen area (excluding the taskbar) on Windows; a 1080p guess elsewhere. */
function screenArea() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; ' +
            '$a = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; ' +
            '"$($a.X) $($a.Y) $($a.Width) $($a.Height)"'
        ],
        { encoding: 'utf8' }
      )
      const [x, y, width, height] = out.trim().split(/\s+/).map(Number)
      if (width > 0 && height > 0) return { x, y, width, height }
    } catch {
      // fall through to the default
    }
  }
  return { x: 0, y: 0, width: 1920, height: 1040 }
}

const health = await fetch(`${BASE_URL}/api/health`).catch(() => null)
if (!health?.ok) {
  console.error(`CampusWorks is not reachable at ${BASE_URL}. Start it first, e.g. "docker compose up -d --build".`)
  process.exit(1)
}

const area = screenArea()
const cols = 3
const width = Math.floor(area.width / cols)
const height = Math.floor(area.height / 2)

const browsers = []

async function openWindow(win, index) {
  const x = area.x + (index % cols) * width
  const y = area.y + Math.floor(index / cols) * height

  const browser = await chromium.launch({
    headless: false,
    args: [`--window-position=${x},${y}`, `--window-size=${width},${height}`]
  })
  browsers.push(browser)

  const context = await browser.newContext({ viewport: null, baseURL: BASE_URL })

  // Prefix the tab / taskbar title with the identity of this window.
  await context.addInitScript((tag) => {
    const apply = () => {
      if (document.title && !document.title.startsWith(tag)) document.title = tag + document.title
    }
    new MutationObserver(apply).observe(document, { subtree: true, childList: true, characterData: true })
  }, `[${win.label}] `)

  const res = await context.request.post('/api/auth/mock', { data: { as: win.as, email: win.email } })
  if (!res.ok()) throw new Error(`Demo login failed for ${win.email}: ${res.status()} ${await res.text()}`)

  const page = await context.newPage()
  await page.goto(win.path)
  console.log(`  ${win.label.padEnd(14)} ${win.email.padEnd(24)} ${BASE_URL}${win.path}`)
}

console.log(`Opening ${WINDOWS.length} demo windows on ${BASE_URL}:`)
for (const [i, win] of WINDOWS.entries()) {
  await openWindow(win, i)
}
console.log('Ready. Close the windows (or press Ctrl+C) to end the demo.')

const closeAll = async () => {
  await Promise.allSettled(browsers.map((b) => b.close()))
  process.exit(0)
}
process.on('SIGINT', closeAll)
process.on('SIGTERM', closeAll)

// Stay alive until every window has been closed.
await Promise.all(browsers.map((b) => new Promise((resolve) => b.once('disconnected', resolve))))
