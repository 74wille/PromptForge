'use strict'

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, ipcMain, dialog, screen, clipboard, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const PtyManager = require('./ptyManager')
const { resolveShells, resolveTools } = require('./tools')
const { buildEnvironment } = require('./env')

const ptys = new PtyManager()

// Varje session ags av exakt ett fonster. Utdata skickas bara dit, och nar en
// flik dras ut ar det den har kopplingen som flyttas — sjalva processen ror
// sig aldrig, den bara byter mottagare.
const sessionOwner = new Map()   // sessionId -> webContents.id
const sessionNames = new Map()   // sessionId -> "Session One" ...
const pendingAdopt = new Map()   // webContents.id -> uppgifter om fliken som ska tas over
const confirmedClose = new WeakSet()

const SESSION_WORDS = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen', 'Twenty',
]

/**
 * Namnen delas ut har och inte i granssnittet, eftersom varje fonster bara
 * kanner till sina egna flikar. Ett utdraget fonster skulle annars borja om pa
 * "Session One" och tva flikar heta likadant.
 *
 * Lagsta lediga nummer anvands: stanger man Session One ska nasta flik fa
 * tillbaka det namnet i stallet for att numren ska glida ivag.
 */
function allocateSessionName () {
  const taken = new Set(sessionNames.values())

  let number = 1
  while (taken.has(`Session ${SESSION_WORDS[number - 1] || number}`)) number++
  return `Session ${SESSION_WORDS[number - 1] || number}`
}

function forgetSession (id) {
  sessionOwner.delete(id)
  sessionNames.delete(id)
}

let primaryWindowId = null

function ownerWindow (sessionId) {
  const target = sessionOwner.get(sessionId)
  if (target === undefined) return null
  return BrowserWindow.getAllWindows().find(win => win.webContents.id === target) || null
}

function send (sessionId, channel, payload) {
  const win = ownerWindow(sessionId)
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/**
 * Plockar ut en mapp ur kommandoraden — det ar sa hogerklicksmenyn i
 * Utforskaren skickar in "oppna har".
 *
 * I utvecklingslage ser argumenten ut som `electron.exe <appmapp> <mapp>`, och
 * appmappen ar ocksa en giltig mapp. Den maste darfor filtreras bort explicit.
 */
function folderFromArgs (argv) {
  const appPath = path.resolve(app.getAppPath())

  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    const resolved = path.resolve(arg)
    if (resolved === appPath) continue
    try {
      if (fs.statSync(resolved).isDirectory()) return resolved
    } catch {
      // Inte en sokvag alls — hoppa over.
    }
  }
  return null
}

const launchFolder = folderFromArgs(process.argv)

// Byggs av tools/make-icon.js. Saknas den kor Electron pa sin egen ikon.
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.ico')

// Utan egen identitet grupperar Windows fonstren under Electron och visar
// Electrons ikon i aktivitetsfaltet i stallet for var egen.
app.setAppUserModelId('com.promptforge.app')

function createWindow (bounds) {
  const win = new BrowserWindow({
    width: (bounds && bounds.width) || 1180,
    height: (bounds && bounds.height) || 760,
    x: bounds && bounds.x,
    y: bounds && bounds.y,
    minWidth: 720,
    minHeight: 420,
    backgroundColor: '#0f1117',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    // Ingen systemtitelrad — topbaren i granssnittet ar hela fonsterramen.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const contentsId = win.webContents.id
  if (primaryWindowId === null) primaryWindowId = contentsId

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  win.on('focus', () => win.flashFrame(false))

  // Maximeringsikonen maste folja med aven nar fonstret andras utifran,
  // till exempel via Windows fonstersnapp eller ett dubbelklick pa dragytan.
  for (const event of ['maximize', 'unmaximize']) {
    win.on(event, () => {
      if (!win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized() })
    })
  }

  // Stangning gar via granssnittet i stallet for direkt. Forsta forsoket
  // avbryts och renderaren far visa sin egen fraga; svarar anvandaren ja
  // kommer stangningen tillbaka hit med flaggan satt. Detta fangar alla vagar
  // in — egen knapp, Alt+F4 och Windows egen fonstermeny.
  win.on('close', event => {
    if (confirmedClose.has(win)) return
    event.preventDefault()
    win.webContents.send('window:confirmClose')
  })

  // Sessioner som hor till fonstret dor med det.
  win.on('closed', () => {
    for (const [sessionId, target] of [...sessionOwner]) {
      if (target !== contentsId) continue
      ptys.kill(sessionId)
      forgetSession(sessionId)
    }
    pendingAdopt.delete(contentsId)
  })

  return win
}

// Bara en instans. Hogerklickar man "Oppna i PromptForge" nar programmet redan
// kor ska det bli en ny flik i det befintliga fonstret, inte ett andra program.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()

    const folder = folderFromArgs(argv)
    if (folder) win.webContents.send('app:openFolder', folder)
  })

  app.whenReady().then(() => {
    createWindow()
    setupAutoUpdate()
  })
}

app.on('window-all-closed', () => {
  ptys.killAll()
  app.quit()
})

app.on('before-quit', () => {
  stopDragWindow()
  closeToast()
  ptys.killAll()
})

ptys.on('data', (id, data) => send(id, 'pty:data', { id, data }))
ptys.on('exit', (id, code) => {
  send(id, 'pty:exit', { id, code })
  forgetSession(id)
})

// --- Sessioner --------------------------------------------------------------

ipcMain.handle('env:describe', event => ({
  shells: resolveShells(),
  tools: resolveTools(),
  home: process.env.USERPROFILE || '',
  launchCwd: launchFolder,
  // Bara huvudfonstret sparar vilka flikar som ar uppe. Annars skulle varje
  // utdraget fonster skriva over listan med sin egen enda flik.
  primary: event.sender.id === primaryWindowId,
}))

ipcMain.handle('pty:spawn', (event, { shellId, toolIds, extraDirs, cwd, cols, rows }) => {
  const shell = resolveShells().find(s => s.id === shellId && s.available)
  if (!shell) throw new Error(`Skalet "${shellId}" finns inte pa den har datorn.`)

  const env = buildEnvironment(toolIds || [], resolveTools(), extraDirs || [])

  // En sparad startmapp kan ha hunnit tas bort sedan den valdes. Faller
  // tillbaka pa hemmappen i stallet for att lata hela sessionen misslyckas.
  const startIn = cwd && fs.existsSync(cwd) ? cwd : undefined

  const id = ptys.spawn({ shell, env, cwd: startIn, cols, rows })
  sessionOwner.set(id, event.sender.id)

  const defaultName = allocateSessionName()
  sessionNames.set(id, defaultName)
  return { id, defaultName }
})

ipcMain.on('pty:write', (event, { id, data }) => ptys.write(id, data))
ipcMain.on('pty:resize', (event, { id, cols, rows }) => ptys.resize(id, cols, rows))
ipcMain.on('pty:kill', (event, { id }) => {
  ptys.kill(id)
  forgetSession(id)
})

// Drar man ut en flik oppnas ett nytt fonster vid muspekaren, och sessionen
// byter agare dit. Det nya fonstret hamtar sjalv uppgifterna nar det laddat.
ipcMain.handle('session:detach', (event, payload) => {
  const point = screen.getCursorScreenPoint()
  const win = createWindow({
    x: Math.max(0, Math.round(point.x - 240)),
    y: Math.max(0, Math.round(point.y - 18)),
    width: 940,
    height: 620,
  })

  sessionOwner.set(payload.id, win.webContents.id)
  pendingAdopt.set(win.webContents.id, payload)
  return true
})

// --- Flytande flik under dragning -------------------------------------------

/**
 * Fliken som dras ritas i ett eget litet fonster ovanpa allt annat.
 *
 * Webbinnehall kan aldrig ritas utanfor sitt eget fonster, sa en flik som bara
 * flyttades inuti granssnittet klipptes bort i samma stund som pekaren lamnade
 * programmet. Ett separat, genomskinligt och klickgenomslappligt fonster kan
 * folja musen over hela skrivbordet.
 */
let dragWindow = null
let dragTimer = null
let dragGrab = { x: 0, y: 0 }
let dragSource = null
let dockTarget = null

/**
 * Fonstret som skulle ta emot fliken om man slappte just nu.
 *
 * Samma funktion anvands bade for markeringen under dragningen och for det
 * verkliga slappet, sa att de aldrig kan borja svara olika.
 */
function findDockTarget (source) {
  const point = screen.getCursorScreenPoint()

  return BrowserWindow.getAllWindows().find(win => {
    // Den flytande fliken ar ocksa ett fonster, men aldrig ett giltigt mal.
    if (win === source || win === dragWindow) return false
    if (win.isDestroyed() || win.isMinimized()) return false

    const bounds = win.getBounds()
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
           point.y >= bounds.y && point.y <= bounds.y + DOCK_BAND
  }) || null
}

// Skickar bara vid forandring. Timern gar sextio ganger i sekunden och skulle
// annars oversvamma varje fonster med samma besked.
function setDockTarget (win) {
  if (dockTarget === win) return

  if (dockTarget && !dockTarget.isDestroyed()) {
    dockTarget.webContents.send('dock:target', { active: false })
  }
  dockTarget = win
  if (dockTarget && !dockTarget.isDestroyed()) {
    dockTarget.webContents.send('dock:target', { active: true })
  }
}

function escapeHtml (text) {
  return String(text).replace(/[&<>"]/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

function stopDragWindow () {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  setDockTarget(null)
  dragSource = null
  if (dragWindow && !dragWindow.isDestroyed()) dragWindow.destroy()
  dragWindow = null
}

ipcMain.on('drag:start', (event, payload) => {
  stopDragWindow()
  dragGrab = { x: Math.round(payload.grabX) + 3, y: Math.round(payload.grabY) + 3 }
  dragSource = BrowserWindow.fromWebContents(event.sender)

  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;overflow:hidden;
      font:12px "Segoe UI",system-ui,sans-serif}
    .chip{display:flex;align-items:center;gap:7px;height:28px;margin:3px;padding:0 11px;
      border-radius:7px;background:${payload.chrome};color:${payload.text};
      box-shadow:0 8px 22px rgba(0,0,0,.5);white-space:nowrap;overflow:hidden}
    .dot{width:7px;height:7px;flex:none;border-radius:50%;background:${payload.color};
      box-shadow:0 0 0 1px rgba(0,0,0,.2)}
  </style><div class="chip"><span class="dot"></span><span>${escapeHtml(payload.label)}</span></div>`

  const point = screen.getCursorScreenPoint()
  dragWindow = new BrowserWindow({
    width: Math.max(90, Math.round(payload.width) + 6),
    height: 34,
    x: point.x - dragGrab.x,
    y: point.y - dragGrab.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
  })

  // Far inte fanga musen — da skulle den avbryta dragningen den ska illustrera.
  dragWindow.setIgnoreMouseEvents(true)
  dragWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  dragWindow.once('ready-to-show', () => {
    if (dragWindow && !dragWindow.isDestroyed()) dragWindow.showInactive()
  })

  // Positionen pollas i stallet for att skickas fran renderaren. Da fortsatter
  // den folja musen aven nar pekaren ar over ett helt annat fonster.
  dragTimer = setInterval(() => {
    if (!dragWindow || dragWindow.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    dragWindow.setPosition(cursor.x - dragGrab.x, cursor.y - dragGrab.y)

    // Samma tick markerar fonstret som skulle ta emot slappet.
    setDockTarget(findDockTarget(dragSource))
  }, 16)
})

ipcMain.on('drag:end', () => stopDragWindow())

// Hojden pa topbaren. Slapper man en flik inom det bandet i ett annat fonster
// ska den dockas dar i stallet for att bli ett nytt fonster.
const DOCK_BAND = 52

/**
 * Forsoker lamna over sessionen till ett annat PromptForge-fonster som ligger
 * under muspekaren. Returnerar false om det inte fanns nagot dar, och da far
 * anroparen i stallet oppna ett nytt fonster.
 */
ipcMain.handle('session:dock', (event, payload) => {
  const target = findDockTarget(BrowserWindow.fromWebContents(event.sender))
  if (!target) return false

  sessionOwner.set(payload.id, target.webContents.id)
  target.webContents.send('session:adopt', {
    ...payload,
    buffer: ptys.scrollback(payload.id),
  })
  target.focus()
  return true
})

ipcMain.handle('session:pendingAdopt', event => {
  const payload = pendingAdopt.get(event.sender.id)
  if (!payload) return null

  pendingAdopt.delete(event.sender.id)
  // Scrollbacken bor i huvudprocessen just for det har: utan den skulle ett
  // utdraget fonster oppna en tom terminal och all text vara borta.
  return { ...payload, buffer: ptys.scrollback(payload.id) }
})

// --- Fonster ----------------------------------------------------------------

function windowOf (event) {
  return BrowserWindow.fromWebContents(event.sender)
}

ipcMain.on('window:minimize', event => {
  const win = windowOf(event)
  if (win) win.minimize()
})

ipcMain.on('window:close', event => {
  const win = windowOf(event)
  if (win) win.close()
})

ipcMain.on('window:closeConfirmed', event => {
  const win = windowOf(event)
  if (!win) return
  confirmedClose.add(win)
  win.close()
})

ipcMain.on('window:toggleMaximize', event => {
  const win = windowOf(event)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})

ipcMain.handle('window:isMaximized', event => {
  const win = windowOf(event)
  return Boolean(win && win.isMaximized())
})

// --- Aviseringar ------------------------------------------------------------

/**
 * Aviseringen ritas som ett eget litet fonster nere till hoger pa skarmen, inte
 * som en Windows-avisering.
 *
 * Windows kraver att ett skrivbordsprogram har en genvag i Start-menyn med
 * matchande app-identitet innan det far visa systemaviseringar, och vagrar
 * annars tyst. Ett eget fonster gar alltid att visa, ser ut som resten av
 * programmet och foljer valt tema.
 */
let toastWindow = null
let toastTarget = null

// Huvudprocessen kan inte lasa granssnittets tema eller sprak, men behover bada
// nar den visar en notis pa eget initiativ — till exempel om en uppdatering.
// Renderaren rapporterar darfor in dem nar de andras.
let reportedUi = {
  colors: {
    chrome: '#161923',
    line: '#272c3d',
    text: '#e6e8f0',
    muted: '#868da5',
    accent: '#7c9cff',
    hover: 'rgba(255, 255, 255, 0.08)',
  },
  strings: {
    updateTitle: 'Uppdatering klar',
    updateBody: 'Klicka for att starta om och installera',
  },
}

ipcMain.on('ui:report', (event, payload) => {
  if (payload && payload.colors) reportedUi.colors = { ...reportedUi.colors, ...payload.colors }
  if (payload && payload.strings) reportedUi.strings = { ...reportedUi.strings, ...payload.strings }
})

function closeToast () {
  if (toastWindow && !toastWindow.isDestroyed()) toastWindow.destroy()
  toastWindow = null
  toastTarget = null
}

function showToast (owner, payload) {
  // En ny notis ersatter den gamla. Att stapla dem skulle sluta med att halva
  // skarmen tacks nar man varit borta lange.
  closeToast()

  // Fonstret ar avsiktligt storre an kortet. Skuggan ritas inuti fonstret, och
  // utan marginal runtom kapas den tvart vid kanten.
  const width = 392
  const height = 126
  const area = screen.getPrimaryDisplay().workArea

  toastWindow = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 6,
    // Extra luft nedtill sa att kortet inte klistrar sig mot aktivitetsfaltet.
    y: area.y + area.height - height - 26,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'toast.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Rutan visas utan att klickas, sa Chromium skulle annars vagra spela
      // upp ljudet.
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  // Over aven helskarmsfonster, annars vore den meningslos just nar man som
  // mest behover den.
  toastWindow.setAlwaysOnTop(true, 'screen-saver')

  // Marginalen runt kortet ar genomskinlig men skulle anda svalja klick.
  // Sidan slar pa traffytan igen nar pekaren nar sjalva kortet.
  toastWindow.setIgnoreMouseEvents(true, { forward: true })

  toastWindow.loadFile(path.join(__dirname, '..', 'renderer', 'toast.html'), {
    query: {
      title: String(payload.title || 'PromptForge'),
      body: String(payload.body || ''),
      sound: payload.sound ? '1' : '0',
      accent: String(payload.color || ''),
      chrome: String(payload.chrome || ''),
      line: String(payload.line || ''),
      text: String(payload.text || ''),
      muted: String(payload.muted || ''),
      hover: String(payload.hover || ''),
    },
  })

  // showInactive sa att den inte stjal fokus fran det man haller pa med.
  toastWindow.once('ready-to-show', () => {
    if (toastWindow && !toastWindow.isDestroyed()) toastWindow.showInactive()
  })

  toastTarget = { owner, id: payload.id, update: Boolean(payload.update) }

  // Ingen tidsgrans: rutan star kvar tills man klickar. Var man borta nar den
  // kom vore en avisering som redan hunnit forsvinna meningslos.

  // Blinkningen i aktivitetsfaltet slutar sa fort man tittar pa fonstret.
  if (owner && !owner.isDestroyed()) owner.flashFrame(true)
}

ipcMain.on('notify:session', (event, payload) => {
  showToast(BrowserWindow.fromWebContents(event.sender), payload)
})

ipcMain.on('toast:interactive', (event, active) => {
  if (!toastWindow || toastWindow.isDestroyed()) return
  toastWindow.setIgnoreMouseEvents(!active, { forward: true })
})

ipcMain.on('toast:dismiss', () => closeToast())

ipcMain.on('toast:open', () => {
  const target = toastTarget
  closeToast()
  if (!target) return

  // Uppdateringsnotisen leder inte till en flik utan till en omstart.
  if (target.update) {
    autoUpdater.quitAndInstall()
    return
  }

  if (!target.owner || target.owner.isDestroyed()) return
  if (target.owner.isMinimized()) target.owner.restore()
  target.owner.focus()
  target.owner.webContents.send('session:focus', { id: target.id })
})

// --- Uppdateringar ----------------------------------------------------------

/**
 * Hamtar nya versioner fran GitHub Releases.
 *
 * Fungerar bara i den installerade versionen — i utvecklingslage finns ingen
 * installation att byta ut, och electron-updater vagrar med ratta.
 */
function setupAutoUpdate () {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', () => {
    const owner = BrowserWindow.getAllWindows()
      .find(win => win.webContents.id === primaryWindowId)

    showToast(owner, {
      update: true,
      title: reportedUi.strings.updateTitle,
      body: reportedUi.strings.updateBody,
      sound: true,
      color: reportedUi.colors.accent,
      ...reportedUi.colors,
    })
  })

  // Ett misslyckat uppdateringsforsok far aldrig sanka programmet. Natverket
  // kan vara nere, och da ska man anda kunna jobba.
  autoUpdater.on('error', () => {})

  autoUpdater.checkForUpdates().catch(() => {})

  // Kollar igen med jamna mellanrum, sa att en app som star oppen i dagar anda
  // hittar nya versioner.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

// --- Urklipp och lankar -----------------------------------------------------

// Electrons egen urklippsmodul i stallet for navigator.clipboard: sidan kors
// over file:// och slipper da fragor om behorighet.
ipcMain.on('clipboard:write', (event, text) => clipboard.writeText(String(text)))
ipcMain.handle('clipboard:read', () => clipboard.readText())

ipcMain.on('link:open', (event, url) => {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return
  }

  // Bara webbadresser. Andra scheman skulle lata utdata i en terminal starta
  // godtyckliga program pa datorn — och utdata kommer inte alltid fran nagot
  // man litar pa.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
  shell.openExternal(parsed.href)
})

// --- Dialoger ---------------------------------------------------------------

// Anvandaren pekar ut sjalva programfilen, men det ar mappen som ska in i PATH.
ipcMain.handle('dialog:pickExe', async event => {
  const result = await dialog.showOpenDialog(windowOf(event), {
    title: 'Valj programfil',
    properties: ['openFile'],
    filters: [{ name: 'Program', extensions: ['exe', 'cmd', 'bat', 'ps1'] }],
  })
  if (result.canceled || !result.filePaths.length) return null

  const file = result.filePaths[0]
  return { dir: path.dirname(file), name: path.parse(file).name }
})

ipcMain.handle('dialog:pickFolder', async event => {
  const result = await dialog.showOpenDialog(windowOf(event), {
    title: 'Valj startmapp',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:pickImage', async event => {
  const result = await dialog.showOpenDialog(windowOf(event), {
    title: 'Valj bakgrundsbild',
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})
