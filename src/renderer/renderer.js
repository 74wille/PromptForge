'use strict'

/* global Terminal, FitAddon, Unicode11Addon, WebLinksAddon, THEMES, TAB_COLORS,
          CURSORS, LANGUAGES, setLanguage, translateDocument, t */

// UMD-bundlarna lägger sig som globaler och exporterar klassen inuti ett objekt.
// Äldre versioner lägger den direkt — ta höjd för båda.
const FitAddonClass = (typeof FitAddon === 'object' && FitAddon.FitAddon) || FitAddon
const Unicode11Class = typeof Unicode11Addon !== 'undefined'
  ? ((typeof Unicode11Addon === 'object' && Unicode11Addon.Unicode11Addon) || Unicode11Addon)
  : null
const WebLinksClass = typeof WebLinksAddon !== 'undefined'
  ? ((typeof WebLinksAddon === 'object' && WebLinksAddon.WebLinksAddon) || WebLinksAddon)
  : null

const DEFAULT_PREFS = {
  lang: 'sv',
  theme: 'forest',
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  fontSize: 15,
  lineHeight: 1,
  opacity: 70,
  blur: 10,
  cursorStyle: 'bar',
  // Följer med programmet. Egna val ersätter den med en absolut sökväg.
  image: 'background.jpg',
  restoreTabs: true,
  notify: true,
  sound: true,
  custom: { ...DEFAULT_CUSTOM },
  imageX: 50,
  imageY: 50,
  imageZoom: 100,
}

const state = {
  shells: [],
  tools: [],
  home: '',
  selectedShell: null,
  selectedTools: new Set(),
  // Startmapp för nya sessioner. null betyder hemmappen.
  cwd: null,
  // Kommando som körs automatiskt när en session öppnas. Styrs av kryssrutan
  // "Starta sessionen med Claude" och är förvalt.
  command: 'claude',
  // Verktyg användaren pekat ut själv. Id:t är prefixat "custom:" så att de kan
  // dela markeringsmängd med katalogens verktyg utan att krocka.
  customTools: [],
  sessions: new Map(),
  activeId: null,
  // Falskt i fönster som skapats genom att en flik dragits ut.
  primary: true,
  prefs: { ...DEFAULT_PREFS },
}

const el = id => document.getElementById(id)

// --- Sparade inställningar --------------------------------------------------

function loadSaved () {
  try {
    const saved = JSON.parse(localStorage.getItem('promptforge') || '{}')
    if (saved.prefs) state.prefs = { ...DEFAULT_PREFS, ...saved.prefs }
    if (Array.isArray(saved.tools)) state.selectedTools = new Set(saved.tools)
    if (Array.isArray(saved.customTools)) state.customTools = saved.customTools
    if (saved.shell) state.selectedShell = saved.shell
    if (saved.cwd) state.cwd = saved.cwd
    if (typeof saved.command === 'string') state.command = saved.command
  } catch {
    // Trasig eller tom lagring — kör på standardvärden.
  }
}

function save () {
  localStorage.setItem('promptforge', JSON.stringify({
    prefs: state.prefs,
    tools: [...state.selectedTools],
    customTools: state.customTools,
    shell: state.selectedShell,
    cwd: state.cwd,
    command: state.command,
  }))
}

// Vilka flikar som är uppe lagras separat från övriga inställningar, eftersom
// listan skrivs om vid varje öppnad och stängd session.
//
// Bara huvudfönstret skriver. Alla fönster delar samma localStorage, så ett
// utdraget fönster skulle annars skriva över listan med sin enda flik.
function persistOpenSessions () {
  if (!state.primary) return

  // Ordningen läses ur topbaren, inte ur state.sessions — det är DOM:en som
  // ändras när man drar om flikarna.
  const open = orderedSessions()
    .filter(session => !session.dead)
    // Inget defaultName sparas — det delas ut på nytt av huvudprocessen när
    // sessionen startas om.
    .map(session => ({ setup: session.setup, name: session.name, color: session.color }))
  localStorage.setItem('promptforge.tabs', JSON.stringify(open))
}

function orderedSessions () {
  const sessions = [...state.sessions.values()]
  return [...el('session-tabs').children]
    .map(tab => sessions.find(session => session.tab === tab))
    .filter(Boolean)
}

// --- Tema -------------------------------------------------------------------

function theme () {
  if (state.prefs.theme === 'custom') return buildCustomTheme(state.prefs.custom)
  return THEMES[state.prefs.theme] || THEMES.midnight
}

/**
 * Gör en Windows-sökväg till en giltig file-URL.
 *
 * Sökvägen måste kodas per mappnamn. Rakt av i en URL bryter `#` av resten som
 * ett fragment och `?` som en frågesträng, så en bild som heter "#bg.png"
 * försvinner spårlöst. Citattecken skulle dessutom bryta CSS:ens url("…").
 *
 * Kolonet i enhetsbeteckningen måste däremot lämnas orört — `file:///C%3A/…`
 * går inte att öppna.
 */
function imageSrc () {
  if (!state.prefs.image) return ''

  // Den medföljande bakgrunden anges relativt sidan och behöver varken
  // file://-prefix eller kodning. Egna val är alltid absoluta Windows-sökvägar.
  if (!/^[A-Za-z]:[\\/]/.test(state.prefs.image)) return state.prefs.image

  const parts = state.prefs.image.replace(/\\/g, '/').split('/')
  const encoded = parts.map((part, index) => {
    const escaped = encodeURIComponent(part)
    return index === 0 ? escaped.replace(/%3A/gi, ':') : escaped
  })

  return `file:///${encoded.join('/')}`
}

function imageUrl () {
  const src = imageSrc()
  return src ? `url("${src}")` : ''
}

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// Bakgrunden görs halvgenomskinlig när opaciteten är under 100 %, så att en
// vald bild slår igenom teckenrutorna.
function backgroundWithAlpha () {
  const base = theme().term.background
  const alpha = state.prefs.opacity / 100
  if (alpha >= 1) return base

  const hex = base.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`
}

function terminalTheme () {
  return { ...theme().term, background: backgroundWithAlpha() }
}

/**
 * Bakgrundsbilden ritas på tre ställen — terminalen, förhandsvisningen och
 * miniatyren — och måste beskäras likadant på alla tre.
 *
 * Zoomen görs med `transform` i stället för `background-size`, eftersom `cover`
 * inte går att multiplicera med ett tal. Origo följer det valda läget, så att
 * man zoomar in mot just den punkt man pekat ut i stället för mot mitten.
 */
function paintImage (node, { blur, fillEmpty }) {
  const { prefs } = state
  const position = `${prefs.imageX}% ${prefs.imageY}%`

  node.style.backgroundImage = imageUrl()
  node.style.backgroundPosition = position
  node.style.transformOrigin = position
  node.style.transform = prefs.imageZoom > 100 ? `scale(${prefs.imageZoom / 100})` : ''
  node.style.filter = blur ? `blur(${blur}px)` : ''

  // Utan bild fylls ytan med temats färg, annars skulle genomskinligheten
  // avslöja fönstrets råa bakgrund.
  if (fillEmpty) {
    node.style.backgroundColor = prefs.image ? 'transparent' : theme().term.background
  }
}

// Huvudprocessen visar notiser på eget initiativ, till exempel när en
// uppdatering hämtats, men känner varken till temat eller språket. Den får dem
// rapporterade i stället.
function reportUi () {
  const styles = getComputedStyle(document.documentElement)
  const colors = {}
  for (const name of ['chrome', 'line', 'text', 'muted', 'accent', 'hover']) {
    colors[name] = styles.getPropertyValue(`--${name}`).trim()
  }

  window.forge.reportUi({
    colors,
    strings: { updateTitle: t('update.title'), updateBody: t('update.body') },
  })
}

// Skriver om CSS-variablerna så att hela programmet byter färg, inte bara
// terminalytan.
function applyThemeVariables () {
  const { ui } = theme()
  const root = document.documentElement.style
  root.setProperty('--bg', ui.bg)
  root.setProperty('--chrome', ui.chrome)
  root.setProperty('--raised', ui.raised)
  root.setProperty('--line', ui.line)
  root.setProperty('--text', ui.text)
  root.setProperty('--muted', ui.muted)
  root.setProperty('--accent', ui.accent)
  root.setProperty('--accent-soft', ui.accentSoft)
  root.setProperty('--hover', ui.hover)
}

// --- Utseende ---------------------------------------------------------------

function applyLook () {
  const { prefs } = state
  applyThemeVariables()

  const termTheme = terminalTheme()
  for (const session of state.sessions.values()) {
    session.term.options.theme = termTheme
    session.term.options.fontFamily = prefs.fontFamily
    session.term.options.fontSize = prefs.fontSize
    session.term.options.lineHeight = prefs.lineHeight
    session.term.options.cursorStyle = prefs.cursorStyle
    fitSession(session)
  }

  reportUi()
  ensureFontLoaded(prefs.fontFamily, prefs.fontSize)
  paintImage(el('backdrop'), { blur: prefs.blur, fillEmpty: true })

  el('font-size-out').textContent = prefs.fontSize
  el('line-height-out').textContent = Number(prefs.lineHeight).toFixed(2)
  el('opacity-out').textContent = `${prefs.opacity}%`
  el('blur-out').textContent = `${prefs.blur}px`

  // Utan session finns ingen xterm-yta som lägger på den halvgenomskinliga
  // bakgrunden. Tomläget målar därför samma ton själv, annars ser bakgrunden
  // helt annorlunda ut innan man startat sin första prompt.
  el('empty-state').style.backgroundColor = backgroundWithAlpha()

  ensureImageSize()
  renderCrop()

  renderPreview()
  save()
}

// Förhandsvisningen speglar terminalen exakt: samma lager, samma färger, samma
// typsnitt. Poängen är att slippa stänga inställningarna för att se resultatet.
function renderPreview () {
  const { prefs } = state
  const term = theme().term

  paintImage(el('preview-backdrop'), { blur: prefs.blur, fillEmpty: true })

  const text = el('preview-text')
  text.style.backgroundColor = backgroundWithAlpha()
  text.style.color = term.foreground
  text.style.fontFamily = prefs.fontFamily
  text.style.fontSize = `${prefs.fontSize}px`
  text.style.lineHeight = String(prefs.lineHeight)

  const piece = (content, color) => {
    const node = document.createElement('span')
    node.textContent = content
    if (color) node.style.color = color
    return node
  }

  const cursor = document.createElement('span')
  cursor.className = `preview-cursor preview-cursor--${prefs.cursorStyle}`
  cursor.style.background = term.cursor

  text.replaceChildren(
    piece('~/promptforge', term.blue), piece(' $ ', term.brightBlack), piece('git status\n'),
    piece('On branch '), piece('main\n', term.green),
    piece(' M ', term.yellow), piece('src/main/env.js\n'),
    piece('?? ', term.red), piece('README.md\n'),
    piece('~/promptforge', term.blue), piece(' $ ', term.brightBlack), cursor,
  )
}

function themeEntries () {
  const entries = Object.entries(THEMES).map(([id, item]) => ({ id, item, label: item.name }))
  // Det egna temat byggs om varje gång, så att färgprovet i kortet följer
  // väljarna medan man drar i dem.
  entries.push({
    id: 'custom',
    item: buildCustomTheme(state.prefs.custom),
    label: t('theme.custom'),
  })
  return entries
}

// --- Beskärningsruta --------------------------------------------------------

let imageSize = null
let loadedImagePath

// Bildens proportioner måste vara kända innan en ruta ritad på den går att
// räkna om till zoom och läge, så filen läses in en gång per vald bild.
function ensureImageSize () {
  if (loadedImagePath === state.prefs.image) return
  loadedImagePath = state.prefs.image
  imageSize = null

  if (!state.prefs.image) {
    renderCrop()
    return
  }

  const img = new Image()
  img.onload = () => {
    if (loadedImagePath !== state.prefs.image) return
    imageSize = { w: img.naturalWidth, h: img.naturalHeight }
    renderCrop()
  }
  img.onerror = () => renderCrop()
  img.src = imageSrc()
}

// Hur stor del av bilden som ryms i terminalen vid zoom 1, uttryckt i andelar.
function coverFractions () {
  const host = el('terminal-host').getBoundingClientRect()
  const viewAspect = host.width / Math.max(1, host.height)
  const imageAspect = imageSize.w / imageSize.h
  return {
    w: Math.min(1, viewAspect / imageAspect),
    h: Math.min(1, imageAspect / viewAspect),
  }
}

function cropFromPrefs () {
  const base = coverFractions()
  const zoom = Math.max(1, state.prefs.imageZoom / 100)
  const w = base.w / zoom
  const h = base.h / zoom
  return {
    w,
    h,
    x: (state.prefs.imageX / 100) * (1 - w),
    y: (state.prefs.imageY / 100) * (1 - h),
  }
}

function prefsFromCrop (crop) {
  const base = coverFractions()
  state.prefs.imageZoom = Math.round((base.w / crop.w) * 100)
  // När rutan fyller hela bredden finns inget läge att välja — då är 50 %
  // enda meningsfulla värdet i stället för en division med noll.
  state.prefs.imageX = 1 - crop.w > 0.0001 ? Math.round((crop.x / (1 - crop.w)) * 100) : 50
  state.prefs.imageY = 1 - crop.h > 0.0001 ? Math.round((crop.y / (1 - crop.h)) * 100) : 50
}

function renderCrop () {
  const stage = el('crop-stage')
  const hasImage = Boolean(state.prefs.image && imageSize)

  el('image-thumb').classList.toggle('has-image', hasImage)
  stage.hidden = !hasImage
  el('crop-hint').hidden = !hasImage
  if (!hasImage) return

  // Scenen ges exakt bildens proportioner. Då kan rutans läge och storlek
  // läsas rakt av som andelar av bilden, utan omräkning för brevlådekanter.
  const area = el('image-thumb').getBoundingClientRect()

  // Med stängd dialogruta är ytan noll bred. Att räkna på det gav en scen utan
  // storlek, som sedan låg kvar osynlig när man väl öppnade inställningarna.
  if (area.width < 20 || area.height < 20) return

  const aspect = imageSize.w / imageSize.h
  let width = area.width - 14
  let height = width / aspect
  if (height > area.height - 14) {
    height = area.height - 14
    width = height * aspect
  }

  stage.style.width = `${Math.round(width)}px`
  stage.style.height = `${Math.round(height)}px`
  stage.style.backgroundImage = imageUrl()

  const crop = cropFromPrefs()
  const box = el('crop-box')
  box.style.left = `${crop.x * 100}%`
  box.style.top = `${crop.y * 100}%`
  box.style.width = `${crop.w * 100}%`
  box.style.height = `${crop.h * 100}%`
}

let drag = null

function stagePoint (event) {
  const rect = el('crop-stage').getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  }
}

el('crop-box').addEventListener('pointerdown', event => {
  if (event.target === el('crop-handle')) return
  event.preventDefault()
  const crop = cropFromPrefs()
  const point = stagePoint(event)
  drag = { mode: 'move', crop, grabX: point.x - crop.x, grabY: point.y - crop.y }
  el('crop-box').setPointerCapture(event.pointerId)
})

el('crop-handle').addEventListener('pointerdown', event => {
  event.preventDefault()
  event.stopPropagation()
  drag = { mode: 'resize', crop: cropFromPrefs() }
  el('crop-handle').setPointerCapture(event.pointerId)
})

window.addEventListener('pointermove', event => {
  if (!drag) return

  const point = stagePoint(event)
  const base = coverFractions()
  const crop = drag.crop

  if (drag.mode === 'move') {
    crop.x = clamp(point.x - drag.grabX, 0, 1 - crop.w)
    crop.y = clamp(point.y - drag.grabY, 0, 1 - crop.h)
  } else {
    // Rutan måste behålla terminalens proportioner, annars skulle bilden
    // förvrängas. Bredden styr, höjden följer med. Zoom 3 ger minsta rutan.
    let width = clamp(point.x - crop.x, base.w / 3, Math.min(base.w, 1 - crop.x))
    let height = width * (base.h / base.w)
    if (crop.y + height > 1) {
      height = 1 - crop.y
      width = height * (base.w / base.h)
    }
    crop.w = width
    crop.h = height
  }

  prefsFromCrop(crop)
  applyLook()
})

window.addEventListener('pointerup', () => { drag = null })

function renderThemeGrid () {
  el('theme-list').replaceChildren(...themeEntries().map(({ id, item, label }) => {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'theme-card' + (state.prefs.theme === id ? ' is-selected' : '')

    // Rutan får temats bakgrundsfärg, prickarna dess accent- och ANSI-färger,
    // och strecket textfärgen. Tidigare låg färgerna som lika breda fält, och
    // eftersom bakgrunden dominerade såg alla mörka teman likadana ut.
    const swatch = document.createElement('div')
    swatch.className = 'theme-swatch'
    swatch.style.background = item.term.background

    for (const color of [item.ui.accent, item.term.green, item.term.yellow, item.term.red]) {
      const dot = document.createElement('span')
      dot.className = 'theme-dot'
      dot.style.background = color
      swatch.append(dot)
    }

    const line = document.createElement('span')
    line.className = 'theme-line'
    line.style.background = item.term.foreground
    swatch.append(line)

    const name = document.createElement('span')
    name.textContent = label

    card.append(swatch, name)
    card.addEventListener('click', () => {
      state.prefs.theme = id
      applyLook()
      renderThemeGrid()
    })
    return card
  }))

  el('custom-colors').hidden = state.prefs.theme !== 'custom'
  el('custom-bg').value = state.prefs.custom.background
  el('custom-fg').value = state.prefs.custom.foreground
  el('custom-accent').value = state.prefs.custom.accent
}

function renderSegmented (containerId, items, current, onSelect) {
  el(containerId).replaceChildren(...items.map(item => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'segment' + (item.id === current ? ' is-selected' : '')
    button.textContent = item.name
    button.addEventListener('click', () => onSelect(item.id))
    return button
  }))
}

function renderLookPanel () {
  renderThemeGrid()

  renderSegmented('cursor-list', CURSORS.map(id => ({ id, name: t(`cursor.${id}`) })),
    state.prefs.cursorStyle, id => {
      state.prefs.cursorStyle = id
      applyLook()
      renderLookPanel()
    })

  renderSegmented('lang-list', LANGUAGES, state.prefs.lang, id => {
    state.prefs.lang = id
    save()
    applyLanguage()
  })

  el('font-family').value = state.prefs.fontFamily
  el('font-size').value = state.prefs.fontSize
  el('line-height').value = state.prefs.lineHeight
  el('opacity').value = state.prefs.opacity
  el('blur').value = state.prefs.blur
}

// --- Typsnitt ---------------------------------------------------------------

// Medvetet en kort, utvald lista. Att räkna upp alla installerade typsnitt med
// fast breddsteg gav mest gamla systemtypsnitt som ingen vill koda i.
//
// Cascadia Mono först, eftersom den är standardvalet. Saknas den på datorn
// faller valet på nästa i listan, och då är ett medföljande typsnitt bättre än
// ett till som kanske inte heller finns.
//
// De med `bundled` följer med programmet och finns därför alltid. Resten är
// Windows egna, och visas bara om de faktiskt är installerade.
const FAVOURITE_FONTS = [
  { name: 'Cascadia Mono', value: 'Cascadia Mono, Consolas, monospace' },
  { name: 'JetBrains Mono', value: "'JetBrains Mono', monospace", bundled: true },
  { name: 'Cascadia Code', value: "'Cascadia Code', monospace", bundled: true },
  { name: 'IBM Plex Mono', value: "'IBM Plex Mono', monospace", bundled: true },
  { name: 'Iosevka', value: "'Iosevka', monospace", bundled: true },
  { name: 'Fira Code', value: "'Fira Code', monospace", bundled: true },
  { name: 'Geist Mono', value: "'Geist Mono', monospace", bundled: true },
  { name: 'Consolas', value: 'Consolas, monospace' },
  { name: 'Lucida Console', value: "'Lucida Console', monospace" },
]

const measure = document.createElement('canvas').getContext('2d')

let loadedFontKey = null

/**
 * De medföljande typsnitten läses in asynkront, som alla webbtypsnitt.
 *
 * Innan filen är läst mäter xterm teckenbredden mot ett annat typsnitt, och
 * rutnätet hamnar fel tills något råkar rita om. Därför räknas storleken om så
 * fort typsnittet är på plats.
 */
function ensureFontLoaded (family, size) {
  const descriptor = `${size}px ${family}`
  if (descriptor === loadedFontKey) return
  loadedFontKey = descriptor

  document.fonts.load(descriptor)
    .then(() => {
      for (const session of state.sessions.values()) fitSession(session)
    })
    .catch(() => {})
}

/**
 * Windows registrerar inte vilka typsnitt som har fast breddsteg, så det enda
 * pålitliga sättet är att mäta: `i` och `W` är olika breda i proportionella
 * typsnitt och exakt lika breda i monospace.
 *
 * Saknas typsnittet faller webbläsaren tillbaka på ett proportionellt
 * standardtypsnitt, vilket ger olika bredder — så samma test sållar bort
 * familjer som inte går att använda.
 */
function isMonospace (family) {
  measure.font = `16px "${family.replace(/"/g, '')}"`
  const narrow = measure.measureText('i').width
  const wide = measure.measureText('W').width
  return Boolean(narrow) && Boolean(wide) && Math.abs(narrow - wide) < 0.1
}

function loadFontChoices () {
  // Systemtypsnitten kontrolleras innan de listas — annars hade man kunnat
  // välja ett typsnitt och tyst få ett helt annat. De medföljande behöver
  // ingen kontroll, de finns per definition.
  const options = FAVOURITE_FONTS
    .filter(favourite => favourite.bundled || isMonospace(favourite.name))
    .map(favourite => new Option(favourite.name, favourite.value))

  const select = el('font-family')
  select.replaceChildren(...options)

  // Ett sparat typsnitt som avinstallerats får inte tyst falla tillbaka på
  // webbläsarens standard — då hade rutan visat fel namn mot vad man ser.
  if (options.length && !options.some(option => option.value === state.prefs.fontFamily)) {
    state.prefs.fontFamily = options[0].value
  }
}

// --- Språk ------------------------------------------------------------------

function applyLanguage () {
  setLanguage(state.prefs.lang)
  translateDocument()

  // Text som byggs vid körning måste ritas om — translateDocument når bara
  // element med data-i18n.
  renderEnvPanel()
  renderLookPanel()
  updateCwd()
  updateMaximizeTitle()
  el('restore-tabs').checked = state.prefs.restoreTabs !== false
  el('notify-done').checked = state.prefs.notify !== false
  el('notify-sound').checked = state.prefs.sound !== false
  el('start-claude').checked = state.command === 'claude'
  for (const session of state.sessions.values()) renderTab(session)
}

// --- Miljöpanelen -----------------------------------------------------------

function buildOption ({ type, group, name, note, checked, disabled, onChange, onRemove }) {
  const label = document.createElement('label')
  label.className = 'option' + (checked ? ' is-selected' : '') + (disabled ? ' is-missing' : '')

  const input = document.createElement('input')
  input.type = type
  if (group) input.name = group
  input.checked = checked
  input.disabled = disabled

  const body = document.createElement('span')
  body.className = 'option-body'
  const nameNode = document.createElement('span')
  nameNode.className = 'option-name'
  nameNode.textContent = name
  const noteNode = document.createElement('span')
  noteNode.className = 'option-note'
  noteNode.textContent = disabled ? t('tool.missing') : note
  body.append(nameNode, noteNode)

  input.addEventListener('change', () => onChange(input.checked))
  label.append(input, body)

  if (onRemove) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'option-remove'
    remove.textContent = '×'
    // Knappen ligger inuti en <label>, så klicket skulle annars också
    // trigga kryssrutan.
    remove.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      onRemove()
    })
    label.append(remove)
  }

  return label
}

function renderEnvPanel () {
  el('shell-list').replaceChildren(...state.shells.map(shell => buildOption({
    type: 'radio',
    group: 'shell',
    name: shell.name,
    note: '',
    checked: state.selectedShell === shell.id,
    disabled: !shell.available,
    onChange: () => {
      state.selectedShell = shell.id
      save()
      renderEnvPanel()
    },
  })))

  el('tool-list').replaceChildren(...state.tools.map(tool => buildOption({
    type: 'checkbox',
    name: tool.name,
    note: tool.description,
    checked: state.selectedTools.has(tool.id),
    disabled: !tool.available,
    onChange: checked => {
      if (checked) state.selectedTools.add(tool.id)
      else state.selectedTools.delete(tool.id)
      save()
      renderEnvPanel()
    },
  })))

  renderCustomTools()

  const found = state.tools.filter(tool => tool.available).length
  el('env-foot').textContent = t('env.foot', { found, total: state.tools.length })
}

function renderCustomTools () {
  el('custom-list').replaceChildren(...state.customTools.map(tool => buildOption({
    type: 'checkbox',
    name: tool.name,
    note: tool.dir,
    checked: state.selectedTools.has(tool.id),
    onChange: checked => {
      if (checked) state.selectedTools.add(tool.id)
      else state.selectedTools.delete(tool.id)
      save()
      renderEnvPanel()
    },
    onRemove: () => {
      state.customTools = state.customTools.filter(item => item.id !== tool.id)
      state.selectedTools.delete(tool.id)
      save()
      renderEnvPanel()
    },
  })))
}

function updateCwd () {
  el('cwd-value').textContent = state.cwd || state.home || '~'
}

// --- Sessioner --------------------------------------------------------------

function fitSession (session) {
  if (!session.wrap.classList.contains('is-active')) return
  try {
    session.fit.fit()
    window.forge.resize(session.id, session.term.cols, session.term.rows)
  } catch {
    // Fönstret kan vara för litet för att räkna ut en giltig storlek.
  }
}

// En "setup" är allt som behövs för att starta en session igen. Det är den här
// lilla klumpen som sparas i en profil och som återställs vid uppstart — inte
// själva processen, som dör med programmet.
function currentSetup () {
  const toolIds = [...state.selectedTools].filter(id => !id.startsWith('custom:'))

  // Ska sessionen starta med Claude måste verktyget också ligga i PATH, annars
  // möts man av "not recognized" i stället för en prompt.
  if (state.command === 'claude' && !toolIds.includes('claude') &&
      state.tools.some(tool => tool.id === 'claude' && tool.available)) {
    toolIds.push('claude')
  }

  return {
    shellId: state.selectedShell,
    toolIds,
    extraDirs: state.customTools
      .filter(tool => state.selectedTools.has(tool.id))
      .map(tool => tool.dir),
    cwd: state.cwd,
    command: state.command,
  }
}

// Visas som verktygstips på fliken. Själva namnet är numrerat i stället, se
// nextSessionName.
function setupLabel (setup) {
  const shell = state.shells.find(item => item.id === setup.shellId)
  const count = setup.toolIds.length + setup.extraDirs.length
  return `${shell ? shell.name : '?'}${count ? ` · ${count}` : ''}`
}


function renderTab (session) {
  const tab = session.tab
  tab.className = 'session-tab' +
    (session.id === state.activeId ? ' is-active' : '') +
    (session.dead ? ' is-dead' : '') +
    (session.color ? ' has-color' : '')
  // Utan vald färg får fliken ändå en prick, men vit och utan bakgrundston.
  // Klassen has-color är det som slår på tonen, så den sätts bara vid ett
  // faktiskt färgval.
  tab.style.setProperty('--tab-color', session.color || '#ffffff')

  const parts = []
  const dot = document.createElement('span')
  dot.className = 'session-dot'
  parts.push(dot)

  const name = document.createElement('span')
  name.className = 'session-name'
  name.textContent = session.name || session.defaultName
  parts.push(name)

  // Medvetet inget kryss i fliken. Att stänga en session dödar det som körs i
  // den, och det ska inte kunna hända av ett slarvigt klick — stäng ligger i
  // högerklicksmenyn och på Ctrl+Shift+W.
  tab.replaceChildren(...parts)
}

function startRename (session) {
  const label = session.tab.querySelector('.session-name')
  if (!label) return

  const input = document.createElement('input')
  input.className = 'session-rename'
  input.value = session.name || session.defaultName
  label.replaceWith(input)
  input.focus()
  input.select()

  let settled = false
  const finish = commit => {
    if (settled) return
    settled = true
    if (commit) {
      const value = input.value.trim()
      // Samma namn som standardnamnet räknas som "inget eget namn", så att
      // fliken följer med om förutsättningarna ändras.
      session.name = value && value !== session.defaultName ? value : null
    }
    renderTab(session)
    persistOpenSessions()
  }

  input.addEventListener('click', event => event.stopPropagation())
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    }
  })
}

function setActive (id) {
  state.activeId = id
  for (const session of state.sessions.values()) {
    session.wrap.classList.toggle('is-active', session.id === id)
    renderTab(session)
  }

  const session = state.sessions.get(id)
  if (session) {
    fitSession(session)
    session.term.focus()
  }
  el('empty-state').classList.toggle('is-hidden', state.sessions.size > 0)
}

function closeSession (id) {
  const session = state.sessions.get(id)
  if (!session) return

  window.forge.kill(id)
  session.term.dispose()
  session.wrap.remove()
  session.tab.remove()
  state.sessions.delete(id)

  if (state.activeId === id) {
    setActive([...state.sessions.keys()].pop() || null)
  }
  el('empty-state').classList.toggle('is-hidden', state.sessions.size > 0)
  persistOpenSessions()
}

function buildTerminal () {
  const wrap = document.createElement('div')
  wrap.className = 'term-wrap'
  el('terminals').append(wrap)

  const term = new Terminal({
    theme: terminalTheme(),
    fontFamily: state.prefs.fontFamily,
    fontSize: state.prefs.fontSize,
    lineHeight: state.prefs.lineHeight,
    cursorStyle: state.prefs.cursorStyle,
    cursorBlink: true,
    // Krävs för att bakgrundsbilden ska synas genom teckenrutorna.
    allowTransparency: true,
    // Unicode11-tillägget bygger på xterms experimentella API.
    allowProposedApi: true,
    scrollback: 5000,
  })

  const fit = new FitAddonClass()
  term.loadAddon(fit)

  // Rätt teckenbredd för ramar och emoji — annars hamnar allt som Claude Code
  // och liknande verktyg ritar i otakt.
  if (Unicode11Class) {
    term.loadAddon(new Unicode11Class())
    term.unicode.activeVersion = '11'
  }

  // Länkar öppnas i systemets webbläsare via huvudprocessen, som också
  // kontrollerar att adressen faktiskt är en webbadress.
  if (WebLinksClass) {
    term.loadAddon(new WebLinksClass((event, uri) => window.forge.openLink(uri)))
  }

  term.open(wrap)

  // Måste vara synlig innan fit() kan mäta upp räknat radantal.
  wrap.classList.add('is-active')
  fit.fit()

  return { wrap, term, fit }
}

// Kopplar ihop en redan startad pty med en flik och en terminal i det här
// fönstret. Delas av nya sessioner och av flikar som dragits hit.
// Går via term.paste och inte via en rå skrivning till pty:n, eftersom xterm
// då sköter bracketed paste — det är så program som Claude Code skiljer
// inklistrad text från text man tryckt fram tecken för tecken.
async function pasteInto (term) {
  const text = await window.forge.paste()
  if (!text) return

  // Avslutande radbrytningar tas bort. De blir ett vagnretur i terminalen,
  // alltså samma sak som att trycka Enter, så en kopierad rad hade skickats
  // iväg direkt i stället för att hamna i inmatningen.
  term.paste(text.replace(/[\r\n]+$/, ''))
}

/**
 * Markerar det man skrivit på raden — inte hela terminalen.
 *
 * Terminalen vet inte var inmatningen börjar, bara vad som står på skärmen.
 * Prompten hittas därför genom att leta efter det första `>`, `$` eller `#`
 * före markören, vilket täcker cmd, PowerShell och bash.
 *
 * Har raden radbrutits gås den bakåt till sin första rad, så att hela den
 * inskrivna texten kommer med och inte bara sista skärmraden.
 */
function selectInput (term) {
  const buffer = term.buffer.active
  let startRow = buffer.baseY + buffer.cursorY

  while (startRow > 0) {
    const line = buffer.getLine(startRow)
    if (!line || !line.isWrapped) break
    startRow--
  }

  const first = buffer.getLine(startRow)
  if (!first) return false

  const cursorRow = buffer.baseY + buffer.cursorY
  const text = first.translateToString(false)
  const beforeCursor = startRow === cursorRow ? text.slice(0, buffer.cursorX) : text

  // Icke-girigt: det första tecknet räknas som promptens slut. Annars hade
  // "echo a > b.txt" börjat markeringen vid omdirigeringen i stället.
  const prompt = /^.*?[>$#]\s?/.exec(beforeCursor)
  const startColumn = prompt ? prompt[0].length : 0

  const length = (cursorRow - startRow) * term.cols + buffer.cursorX - startColumn
  if (length <= 0) return false

  term.select(startColumn, startRow, length)
  return true
}

/**
 * Flyttar skalets markör dit man klickade.
 *
 * Terminalen äger inte radredigeringen — skalet gör det — så klicket kan inte
 * flytta markören direkt. I stället räknas kolumnskillnaden ut och skickas som
 * lika många piltangenter, vilket är samma tangenter man annars hade tryckt.
 *
 * Tre villkor måste vara uppfyllda, och inget av dem är överdriven försiktighet:
 * har programmet tagit över musen tolkar det klicket självt, har man markerat
 * text var klicket en markering, och ligger klicket på en annan rad än markören
 * går skillnaden inte att uttrycka i vänster och höger.
 */
function moveCursorToClick (id, term, wrap, event) {
  if (term.modes && term.modes.mouseTrackingMode !== 'none') return
  if (term.hasSelection()) return

  const screen = wrap.querySelector('.xterm-screen')
  if (!screen) return

  const box = screen.getBoundingClientRect()
  const cellWidth = box.width / term.cols
  const cellHeight = box.height / term.rows
  if (!cellWidth || !cellHeight) return

  const buffer = term.buffer.active
  // Har man rullat upp i historiken stämmer inte raderna mot markören.
  if (buffer.viewportY !== buffer.baseY) return

  const row = Math.floor((event.clientY - box.top) / cellHeight)
  if (row !== buffer.cursorY) return

  const column = Math.floor((event.clientX - box.left) / cellWidth)
  const steps = column - buffer.cursorX
  if (steps === 0) return

  const key = steps > 0 ? '\x1b[C' : '\x1b[D'
  window.forge.write(id, key.repeat(Math.min(Math.abs(steps), 500)))
}

function registerSession (id, parts, config, meta) {
  const { wrap, term, fit } = parts

  term.onData(data => window.forge.write(id, data))

  // Enter betyder "nu väntar jag på svar". onKey används i stället för onData
  // eftersom den senare även bär sekvenser xterm skickar själv — bland annat
  // när rutan får eller tappar fokus, vilket gjorde att ett klick i terminalen
  // räknades som inmatning.
  term.onKey(({ domEvent }) => {
    if (domEvent.key === 'Enter' && !domEvent.shiftKey) session.submittedAt = Date.now()
  })

  // Urklippet hanteras här i stället för av xterm, eftersom Ctrl+C måste kunna
  // betyda två olika saker beroende på om något är markerat.
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown') return true

    // Shift+Enter ska ge en ny rad i stället för att skicka iväg kommandot.
    // Escape följt av radbrytning är sekvensen TUI-program som Claude Code
    // tolkar som just det — vanlig Enter skickar bara radbrytningen.
    if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey) {
      window.forge.write(id, '\x1b\r')
      return false
    }

    // Ctrl+Break skickar avbrottssignalen, eftersom Ctrl+C nu alltid kopierar.
    // Ingen tangent tas ifrån något program — Break används inte till annat.
    if (event.ctrlKey && (event.key === 'Pause' || event.key === 'Cancel')) {
      window.forge.write(id, '\x03')
      return false
    }

    // Bara rena Ctrl-kombinationer tas. Allt med Shift eller Alt går orört
    // vidare till programmet som körs.
    if (!event.ctrlKey || event.altKey || event.shiftKey) return true

    const key = event.key.toLowerCase()

    if (key === 'c') {
      // En avslutande radbrytning skulle bli ett Enter om texten klistras in
      // någon annanstans, så den tas bort.
      if (term.hasSelection()) {
        window.forge.copy(term.getSelection().replace(/[\r\n]+$/, ''))
        term.clearSelection()
      }
      return false
    }

    if (key === 'v') {
      // preventDefault hindrar webbläsaren från att klistra in en gång till
      // efter oss — utan den hamnade texten dubbelt.
      event.preventDefault()
      pasteInto(term)
      return false
    }

    if (key === 'a') {
      if (!selectInput(term)) term.selectAll()
      return false
    }

    return true
  })

  wrap.addEventListener('contextmenu', event => {
    event.preventDefault()
    pasteInto(term)
  })

  // Ett klick som föregåtts av en musrörelse var en markering, inte en
  // pekning. xterm hinner rensa markeringen innan click, så avståndet mäts
  // i stället för att fråga efter markeringen efteråt.
  let pressedAt = null
  wrap.addEventListener('mousedown', event => {
    pressedAt = { x: event.clientX, y: event.clientY }
  })

  wrap.addEventListener('click', event => {
    const from = pressedAt
    pressedAt = null
    if (event.button !== 0 || !from) return
    if (Math.abs(event.clientX - from.x) > 3 || Math.abs(event.clientY - from.y) > 3) return

    moveCursorToClick(id, term, wrap, event)
  })

  const tab = document.createElement('div')
  tab.className = 'session-tab'
  // Uppsättningen bakom fliken syns som verktygstips nu när namnet är numrerat.
  tab.title = setupLabel(config)
  tab.addEventListener('click', () => setActive(id))
  tab.addEventListener('contextmenu', event => {
    event.preventDefault()
    openTabMenu(id, event.clientX, event.clientY)
  })
  tab.addEventListener('pointerdown', event => beginTabDrag(id, event))
  el('session-tabs').append(tab)

  const session = {
    id, term, fit, wrap, tab,
    name: (meta && meta.name) || null,
    color: (meta && meta.color) || null,
    // Namnet kommer alltid från huvudprocessen, som är den enda som ser
    // samtliga fönsters flikar.
    defaultName: (meta && meta.defaultName) || 'Session',
    setup: config,
    dead: false,
    // När du senast tryckte Enter. Nollställs när en avisering gått ut.
    submittedAt: null,
  }

  // Program säger till att de är klara med terminalklockan eller med en
  // OSC-sekvens. Claude Code använder klockan.
  term.onBell(() => notifySession(session))

  term.parser.registerOscHandler(9, data => {
    notifySession(session, String(data))
    return true
  })

  // OSC 777 har formatet "notify;titel;text".
  term.parser.registerOscHandler(777, data => {
    const parts = String(data).split(';')
    notifySession(session, parts.slice(2).join(';') || parts[1] || '')
    return true
  })

  state.sessions.set(id, session)
  renderTab(session)
  setActive(id)
  persistOpenSessions()
  return session
}

function notifySession (session, body) {
  if (state.prefs.notify === false) return

  // Tittar man redan på fliken har man ju sett det. Aviseringen ska bara komma
  // när uppmärksamheten är någon annanstans.
  if (document.hasFocus() && state.activeId === session.id) return

  // Rutan ritas av huvudprocessen och känner inte till temat, så färgerna
  // skickas med.
  const styles = getComputedStyle(document.documentElement)
  window.forge.notifySession({
    id: session.id,
    title: session.name || session.defaultName,
    body: body || t('notify.body'),
    sound: state.prefs.sound !== false,
    color: session.color || styles.getPropertyValue('--accent').trim() || '#7c9cff',
    chrome: styles.getPropertyValue('--chrome').trim() || '#161923',
    line: styles.getPropertyValue('--line').trim() || '#272c3d',
    text: styles.getPropertyValue('--text').trim() || '#e6e8f0',
    muted: styles.getPropertyValue('--muted').trim() || '#868da5',
    hover: styles.getPropertyValue('--hover').trim() || 'rgba(255, 255, 255, 0.08)',
  })
}

async function newSession (setup, meta) {
  const config = setup || currentSetup()
  if (!config.shellId) return

  const parts = buildTerminal()

  let started
  try {
    started = await window.forge.spawn({ ...config, cols: parts.term.cols, rows: parts.term.rows })
  } catch (err) {
    parts.term.write(`\r\n\x1b[31m${t('session.failed')}\x1b[0m\r\n${err.message}\r\n`)
    return
  }

  registerSession(started.id, parts, config, { ...meta, defaultName: started.defaultName })

  // Startkommandot skickas som om man skrivit det själv. Skalet buffrar
  // inmatningen tills prompten är redo, så ingen väntan behövs.
  if (config.command) window.forge.write(started.id, `${config.command}\r`)
}

// Tar emot en session som hör hemma i ett annat fönster. Processen lever redan
// — det enda som saknas här är en terminal att visa den i.
function adoptSession (payload) {
  const parts = buildTerminal()
  // Historiken kommer från huvudprocessen — annars hade fönstret öppnat en tom
  // terminal och all text varit borta.
  if (payload.buffer) parts.term.write(payload.buffer)

  const session = registerSession(payload.id, parts, payload.setup, payload)
  fitSession(session)
  return session
}

// Ett fönster som just skapats genom att en flik dragits ut.
async function adoptPending () {
  const payload = await window.forge.pendingAdopt()
  if (!payload) return false
  adoptSession(payload)
  return true
}

// En flik som dragits hit från ett annat fönster medan vi redan kör.
window.forge.onAdopt(payload => adoptSession(payload))

// Huvudprocessen talar om när det här fönstret är det som skulle ta emot en
// flik som dras just nu.
window.forge.onDockTarget(({ active }) => {
  document.querySelector('.topbar').classList.toggle('is-dock-target', active)
})

function sessionPayload (session) {
  return {
    id: session.id,
    setup: session.setup,
    name: session.name,
    color: session.color,
    defaultName: session.defaultName,
  }
}

// Ett utdraget fönster utan flikar kvar har inget syfte.
function closeIfEmpty () {
  if (state.primary || state.sessions.size > 0) return
  window.forge.window.confirmClose()
}

// --- Dra ut en flik ---------------------------------------------------------

let tabDrag = null

function beginTabDrag (id, event) {
  if (event.button !== 0) return

  const session = state.sessions.get(id)
  if (!session) return

  const box = session.tab.getBoundingClientRect()
  tabDrag = {
    id,
    startX: event.clientX,
    startY: event.clientY,
    // Var i fliken man tog tag, så att den inte hoppar till pekaren.
    grabX: event.clientX - box.left,
    grabY: event.clientY - box.top,
    width: box.width,
    height: box.height,
    active: false,
    outside: false,
    placeholder: null,
    pointerId: event.pointerId,
  }

  // Pekarfångst krävs för att vi ska fortsätta få rörelser och släpp även när
  // pekaren lämnat fönstret — annars går fliken inte att släppa på ett annat.
  try {
    el('session-tabs').setPointerCapture(event.pointerId)
  } catch {
    // Pekaren har redan släppts.
  }
}

// Lyfter fliken ur raden och lämnar en lucka på dess plats.
//
// Själva fliken göms och ritas i stället av huvudprocessen i ett eget litet
// fönster ovanpå skrivbordet. Webbinnehåll kan inte ritas utanför sitt fönster,
// så en flik som flyttades inuti gränssnittet klipptes bort i samma stund som
// pekaren lämnade programmet.
function liftTab (drag, session) {
  const placeholder = document.createElement('div')
  placeholder.className = 'tab-placeholder'
  placeholder.style.width = `${drag.width}px`
  session.tab.after(placeholder)
  drag.placeholder = placeholder

  session.tab.hidden = true
  document.body.classList.add('is-pulling-tab')

  const styles = getComputedStyle(document.documentElement)
  window.forge.dragStart({
    label: session.name || session.defaultName,
    color: session.color || '#ffffff',
    chrome: styles.getPropertyValue('--raised').trim() || '#1d2130',
    text: styles.getPropertyValue('--text').trim() || '#e6e8f0',
    width: drag.width,
    grabX: drag.grabX,
    grabY: drag.grabY,
  })
}

// Flyttar luckan dit fliken hamnar om man släpper nu.
function movePlaceholder (drag, pointerX) {
  const strip = el('session-tabs')
  const placeholder = drag.placeholder
  if (placeholder.parentElement !== strip) strip.append(placeholder)

  for (const child of [...strip.children]) {
    if (child === placeholder) continue

    const box = child.getBoundingClientRect()
    const middle = box.left + box.width / 2
    const position = child.compareDocumentPosition(placeholder)

    if (pointerX < middle && (position & Node.DOCUMENT_POSITION_FOLLOWING)) {
      strip.insertBefore(placeholder, child)
      return
    }
    if (pointerX > middle && (position & Node.DOCUMENT_POSITION_PRECEDING)) {
      strip.insertBefore(placeholder, child.nextSibling)
      return
    }
  }
}

function isLeavingWindow (event) {
  const strip = el('session-tabs').getBoundingClientRect()

  const outsideWindow = event.clientX < 0 || event.clientY < 0 ||
                        event.clientX > window.innerWidth ||
                        event.clientY > window.innerHeight

  return outsideWindow || event.clientY > strip.bottom + 26
}

// Sätter tillbaka fliken i raden där luckan står och städar bort spåren.
function dropTab (drag, session) {
  window.forge.dragEnd()

  drag.placeholder.hidden = false
  el('session-tabs').insertBefore(session.tab, drag.placeholder)
  drag.placeholder.remove()
  session.tab.hidden = false
}

window.addEventListener('pointermove', event => {
  if (!tabDrag) return

  const session = state.sessions.get(tabDrag.id)
  if (!session) {
    tabDrag = null
    return
  }

  // Liten tröskel så att ett vanligt klick inte råkar räknas som en dragning.
  if (!tabDrag.active) {
    if (Math.abs(event.clientX - tabDrag.startX) < 5 &&
        Math.abs(event.clientY - tabDrag.startY) < 5) return
    tabDrag.active = true
    liftTab(tabDrag, session)
  }

  // Fliken lämnar fönstret antingen genom att dras under raden eller genom att
  // dras ut ur fönstret helt — det senare är hur man drar över till ett annat
  // fönster, och det är en rörelse i sidled på samma höjd.
  tabDrag.outside = isLeavingWindow(event)

  // Luckan försvinner när fliken är på väg ut, och kommer tillbaka om man drar
  // in igen. Det är den enda signal som behövs nu när fliken ritas som ett
  // eget fönster vid pekaren.
  tabDrag.placeholder.hidden = tabDrag.outside

  if (!tabDrag.outside) movePlaceholder(tabDrag, event.clientX)
})

// Avbryts dragningen av systemet ska fliken tillbaka i raden, inte bli kvar
// svävande.
window.addEventListener('pointercancel', () => {
  const drag = tabDrag
  tabDrag = null
  if (!drag || !drag.active) return

  document.body.classList.remove('is-pulling-tab')
  const session = state.sessions.get(drag.id)
  if (session) dropTab(drag, session)
})

window.addEventListener('pointerup', async event => {
  const drag = tabDrag
  tabDrag = null
  if (!drag) return

  try {
    el('session-tabs').releasePointerCapture(drag.pointerId)
  } catch {
    // Fångsten kan redan ha släppts.
  }

  if (!drag.active) return
  document.body.classList.remove('is-pulling-tab')

  const session = state.sessions.get(drag.id)
  if (!session) return

  // Fliken läggs alltid tillbaka i raden först, så att uppstädningen ser
  // likadan ut oavsett vad som händer sedan.
  dropTab(drag, session)

  // Räknas om här också. Sista rörelsen utanför fönstret kan ha uteblivit, och
  // då hade drag.outside varit inaktuell.
  if (!drag.outside && !isLeavingWindow(event)) {
    persistOpenSessions()
    return
  }

  const payload = sessionPayload(session)

  // Ligger pekaren över ett annat PromptForge-fönsters topbar hamnar fliken
  // där. Det är så man drar tillbaka en utdragen flik.
  if (await window.forge.dockSession(payload)) {
    releaseSession(drag.id)
    closeIfEmpty()
    return
  }

  // Annars blir den ett eget fönster — om det finns någon flik kvar att lämna.
  if (state.sessions.size > 1) {
    await window.forge.detachSession(payload)
    releaseSession(drag.id)
  } else {
    persistOpenSessions()
  }
})

async function detachSession (id) {
  const session = state.sessions.get(id)
  if (!session) return

  // Sista fliken har ingenstans att ta vägen — resultatet vore bara ett tomt
  // fönster kvar bredvid det nya.
  if (state.sessions.size < 2) return

  await window.forge.detachSession(sessionPayload(session))
  releaseSession(id)
}

// Som closeSession, men processen lever vidare — den har bara bytt fönster.
function releaseSession (id) {
  const session = state.sessions.get(id)
  if (!session) return

  session.term.dispose()
  session.wrap.remove()
  session.tab.remove()
  state.sessions.delete(id)

  if (state.activeId === id) setActive([...state.sessions.keys()].pop() || null)
  el('empty-state').classList.toggle('is-hidden', state.sessions.size > 0)
  persistOpenSessions()
}

// --- Högerklicksmeny på flikar ----------------------------------------------

let menuSessionId = null

function renderTabColors () {
  const session = state.sessions.get(menuSessionId)
  const swatches = [null, ...TAB_COLORS].map(color => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ctx-color' +
      (color ? '' : ' ctx-color--none') +
      (session && session.color === color ? ' is-selected' : '')
    if (color) button.style.background = color
    button.title = color || t('tab.noColor')
    button.addEventListener('click', () => {
      if (session) {
        session.color = color
        renderTab(session)
        persistOpenSessions()
      }
      closeTabMenu()
    })
    return button
  })
  el('tab-colors').replaceChildren(...swatches)
}

function openTabMenu (id, x, y) {
  menuSessionId = id
  renderTabColors()

  const menu = el('tab-menu')
  menu.hidden = false

  // Måste mätas efter att den blivit synlig, annars är bredden noll och menyn
  // hamnar utanför fönstret.
  const box = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - box.width - 6))}px`
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - box.height - 6))}px`
}

function closeTabMenu () {
  el('tab-menu').hidden = true
  menuSessionId = null
}

for (const item of document.querySelectorAll('#tab-menu .ctx-item')) {
  item.addEventListener('click', () => {
    const session = state.sessions.get(menuSessionId)
    const action = item.dataset.action
    closeTabMenu()
    if (!session) return
    if (action === 'rename') startRename(session)
    else if (action === 'detach') detachSession(session.id)
    else if (action === 'close') closeSession(session.id)
  })
}

window.addEventListener('mousedown', event => {
  const menu = el('tab-menu')
  if (!menu.hidden && !menu.contains(event.target)) closeTabMenu()
})

window.addEventListener('blur', closeTabMenu)

// --- Dialoger ---------------------------------------------------------------

const settingsModal = el('settings-modal')
const confirmModal = el('confirm-modal')

function setSettingsTab (name) {
  for (const tab of settingsModal.querySelectorAll('.modal-tab')) {
    tab.classList.toggle('is-active', tab.dataset.tab === name)
  }
  for (const panel of settingsModal.querySelectorAll('[data-tab-panel]')) {
    panel.hidden = panel.dataset.tabPanel !== name
  }
}

function openSettings (tab) {
  if (tab) setSettingsTab(tab)
  if (!settingsModal.open) settingsModal.showModal()
  // Måste ritas om nu när ytan äntligen har en storlek att mäta.
  renderCrop()
}

for (const tab of settingsModal.querySelectorAll('.modal-tab')) {
  tab.addEventListener('click', () => {
    setSettingsTab(tab.dataset.tab)
    renderCrop()
  })
}

for (const modal of [settingsModal, confirmModal]) {
  for (const button of modal.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => modal.close())
  }

  // Ett klick på backdropen räknas som träff på själva <dialog>-elementet.
  // Jämför mot rutans yta för att skilja utanför från inuti.
  modal.addEventListener('click', event => {
    if (event.target !== modal) return
    const box = modal.getBoundingClientRect()
    const inside = event.clientX >= box.left && event.clientX <= box.right &&
                   event.clientY >= box.top && event.clientY <= box.bottom
    if (!inside) modal.close()
  })

  // Ge tangentbordet tillbaka till terminalen när rutan stängs.
  modal.addEventListener('close', () => {
    const session = state.sessions.get(state.activeId)
    if (session) session.term.focus()
  })
}

el('open-settings').addEventListener('click', () => openSettings())
el('env-apply').addEventListener('click', () => {
  settingsModal.close()
  newSession()
})

el('add-custom').addEventListener('click', async () => {
  const picked = await window.forge.pickExe()
  if (!picked) return

  // Mappen är nyckeln, inte filen — två program i samma mapp är samma PATH-post.
  const id = `custom:${picked.dir.toLowerCase()}`
  if (!state.customTools.some(tool => tool.id === id)) {
    state.customTools.push({ id, name: picked.name, dir: picked.dir })
  }
  state.selectedTools.add(id)
  save()
  renderEnvPanel()
})

// --- Startmapp --------------------------------------------------------------

el('pick-cwd').addEventListener('click', async () => {
  const folder = await window.forge.pickFolder()
  if (!folder) return
  state.cwd = folder
  save()
  updateCwd()
})

el('reset-cwd').addEventListener('click', () => {
  state.cwd = null
  save()
  updateCwd()
})

el('restore-tabs').addEventListener('change', event => {
  state.prefs.restoreTabs = event.target.checked
  save()
})

el('notify-done').addEventListener('change', event => {
  state.prefs.notify = event.target.checked
  save()
})

el('notify-sound').addEventListener('change', event => {
  state.prefs.sound = event.target.checked
  save()
})

el('start-claude').addEventListener('change', event => {
  state.command = event.target.checked ? 'claude' : ''
  save()
})

// Klick på en avisering tar upp fönstret — då ska rätt flik ligga framme.
window.forge.onFocusSession(({ id }) => {
  if (state.sessions.has(id)) setActive(id)
})

// --- Fönsterknappar ---------------------------------------------------------

function updateMaximizeTitle () {
  const maximized = document.body.classList.contains('is-maximized')
  const label = t(maximized ? 'topbar.restore' : 'topbar.maximize')
  el('win-max').title = label
  el('win-max').setAttribute('aria-label', label)
}

function setMaximizedFlag (maximized) {
  document.body.classList.toggle('is-maximized', maximized)
  updateMaximizeTitle()
}

el('win-min').addEventListener('click', () => window.forge.window.minimize())
el('win-max').addEventListener('click', () => window.forge.window.toggleMaximize())
el('win-close').addEventListener('click', () => window.forge.window.close())
window.forge.window.onStateChange(({ maximized }) => setMaximizedFlag(maximized))

// Stängning bekräftas här i stället för i huvudprocessen, så att rutan följer
// programmets eget utseende och språk.
window.forge.window.onConfirmClose(() => {
  const count = state.sessions.size
  el('confirm-body').textContent = count === 0
    ? t('confirm.body')
    : t(count === 1 ? 'confirm.bodySessions' : 'confirm.bodySessionsPlural', { count })

  closeTabMenu()
  if (settingsModal.open) settingsModal.close()
  if (!confirmModal.open) confirmModal.showModal()
})

el('confirm-cancel').addEventListener('click', () => confirmModal.close())
el('confirm-ok').addEventListener('click', () => window.forge.window.confirmClose())

// --- Övriga händelser -------------------------------------------------------

// Hur länge utdata måste tystna för att något ska räknas som klart, och hur
// länge det måste ha hållit på innan det är värt en avisering.
const IDLE_MS = 3000
const MIN_WORK_MS = 4000

/**
 * Avgör när något du bett om blivit klart, utan att programmet behöver säga till.
 *
 * Terminalklockan vore exaktare, men den kräver att programmet är inställt på
 * att ringa i den — Claude Code gör det inte som standard.
 *
 * Klockan startar när du trycker Enter och stannar när utdata tystnat. Det
 * mäter precis rätt sak: hur länge du väntat sedan du bad om något. Att i
 * stället mäta från sessionens första utdata gav minutlånga tider, eftersom
 * program som Claude Code ritar om sig med jämna mellanrum.
 */
function markActivity (session) {
  clearTimeout(session.idleTimer)

  session.idleTimer = setTimeout(() => {
    if (!session.submittedAt) return

    const waited = Date.now() - session.submittedAt
    session.submittedAt = null

    // Gick det fort behövde du aldrig veta om det.
    if (waited >= MIN_WORK_MS) notifySession(session)
  }, IDLE_MS)
}

window.forge.onData(({ id, data }) => {
  const session = state.sessions.get(id)
  if (!session) return

  session.term.write(data)
  markActivity(session)
})

window.forge.onExit(({ id, code }) => {
  const session = state.sessions.get(id)
  if (!session) return
  session.dead = true
  renderTab(session)
  persistOpenSessions()
  session.term.write(`\r\n\x1b[90m${t('session.exited', { code })}\x1b[0m\r\n`)
})

// Utforskarens "Öppna i PromptForge" när programmet redan kör.
window.forge.onOpenFolder(folder => {
  newSession({ ...currentSetup(), cwd: folder })
})

window.addEventListener('resize', () => {
  const session = state.sessions.get(state.activeId)
  if (session) fitSession(session)
  // Terminalens proportioner styr beskärningsrutans form, så den måste ritas om.
  renderCrop()
})

// Måste wrappas: annars skickas klickhändelsen in som `setup`, och den har
// inget shellId — sessionen skulle avbrytas tyst.
el('new-session').addEventListener('click', () => newSession())

el('font-family').addEventListener('change', event => {
  state.prefs.fontFamily = event.target.value
  applyLook()
})

for (const [id, key, cast] of [
  ['font-size', 'fontSize', Number],
  ['line-height', 'lineHeight', Number],
  ['opacity', 'opacity', Number],
  ['blur', 'blur', Number],
]) {
  el(id).addEventListener('input', event => {
    state.prefs[key] = cast(event.target.value)
    applyLook()
  })
}

for (const [id, key] of [
  ['custom-bg', 'background'],
  ['custom-fg', 'foreground'],
  ['custom-accent', 'accent'],
]) {
  el(id).addEventListener('input', event => {
    state.prefs.custom = { ...state.prefs.custom, [key]: event.target.value }
    applyLook()
    renderThemeGrid()
  })
}

el('pick-image').addEventListener('click', async () => {
  const file = await window.forge.pickImage()
  if (file) {
    state.prefs.image = file
    applyLook()
  }
})

el('clear-image').addEventListener('click', () => {
  state.prefs.image = null
  applyLook()
})

// Ctrl+Shift i stället för Ctrl, eftersom skalen redan äger de enkla
// kombinationerna — Ctrl+W raderar t.ex. ett ord i bash.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el('tab-menu').hidden) {
    closeTabMenu()
    return
  }
  if (!event.ctrlKey || event.altKey) return

  const key = event.key.toLowerCase()
  if (event.shiftKey && key === 't') {
    event.preventDefault()
    newSession()
  } else if (event.shiftKey && key === 'w') {
    event.preventDefault()
    if (state.activeId) closeSession(state.activeId)
  } else if (event.shiftKey && key === 'e') {
    event.preventDefault()
    openSettings('env')
  } else if (!event.shiftKey && key === ',') {
    event.preventDefault()
    openSettings('look')
  }
}, true)

// --- Start ------------------------------------------------------------------

async function init () {
  loadSaved()
  setLanguage(state.prefs.lang)
  setMaximizedFlag(await window.forge.window.isMaximized())

  const info = await window.forge.describe()
  state.shells = info.shells
  state.tools = info.tools
  state.home = info.home || ''
  state.primary = info.primary !== false

  const chosen = state.shells.find(shell => shell.id === state.selectedShell && shell.available)
  if (!chosen) {
    const fallback = state.shells.find(shell => shell.available)
    state.selectedShell = fallback ? fallback.id : null
  }

  for (const id of [...state.selectedTools]) {
    if (id.startsWith('custom:')) {
      if (!state.customTools.some(tool => tool.id === id)) state.selectedTools.delete(id)
    } else if (!state.tools.some(tool => tool.id === id && tool.available)) {
      state.selectedTools.delete(id)
    }
  }

  loadFontChoices()

  // Väntar in det valda typsnittet innan första terminalen skapas — annars
  // mäts rutnätet mot ett annat typsnitt och kolumnerna hamnar fel.
  try {
    await document.fonts.load(`${state.prefs.fontSize}px ${state.prefs.fontFamily}`)
  } catch {
    // Saknas typsnittet ritas det med reservtypsnittet, vilket är fullt dugligt.
  }

  applyLanguage()
  applyLook()

  // Ett utdraget fönster tar över sin flik och ska varken återställa gamla
  // flikar eller öppna nya.
  if (await adoptPending()) return

  if (info.launchCwd) {
    // Startad från högerklicksmenyn: öppna den mappen i stället för att
    // återställa gamla flikar. Man bad om en prompt just här.
    await newSession({ ...currentSetup(), cwd: info.launchCwd })
  } else {
    await restoreTabs()
  }
}

// Processerna går inte att återuppliva — de dog med programmet. Det som
// återställs är uppsättningen bakom varje flik, plus namn och färg, så att man
// får tillbaka samma arbetsyta med färska sessioner.
async function restoreTabs () {
  if (state.prefs.restoreTabs === false) return

  let saved = []
  try {
    saved = JSON.parse(localStorage.getItem('promptforge.tabs') || '[]')
  } catch {
    return
  }

  for (const item of saved) {
    if (!item || !item.setup) continue
    // Ett skal kan ha avinstallerats sedan sist — hoppa över den fliken i
    // stället för att fylla skärmen med felmeddelanden.
    if (!state.shells.some(shell => shell.id === item.setup.shellId && shell.available)) continue

    // Flikar sparade innan startmappen fanns saknar cwd. Låt dem följa den
    // nuvarande inställningen i stället för att alltid hamna i hemmappen.
    const setup = { ...item.setup, cwd: item.setup.cwd || state.cwd }
    await newSession(setup, { name: item.name, color: item.color })
  }
}

init()
