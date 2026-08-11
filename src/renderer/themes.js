'use strict'

/**
 * Ett tema styr två saker samtidigt: terminalens ANSI-palett (`term`) och
 * programmets egna färger (`ui`). Därför byter hela fönstret utseende när du
 * väljer tema, inte bara textytan.
 *
 * `ui.hover` finns med eftersom en genomskinlig vit överlagring fungerar i
 * mörka teman men blir osynlig i ljusa — den måste vändas.
 */
const THEMES = {
  midnight: {
    name: 'Midnight',
    ui: {
      bg: '#0f1117', chrome: '#161923', raised: '#1d2130', line: '#272c3d',
      text: '#e6e8f0', muted: '#868da5', accent: '#7c9cff',
      accentSoft: 'rgba(124, 156, 255, 0.16)', hover: 'rgba(255, 255, 255, 0.08)',
    },
    term: {
      background: '#0f1117', foreground: '#e6e8f0', cursor: '#7c9cff',
      selectionBackground: 'rgba(124,156,255,0.28)',
      black: '#1d2130', red: '#ff6b81', green: '#7ee0a5', yellow: '#ffd479',
      blue: '#7c9cff', magenta: '#c08cff', cyan: '#6fdbe8', white: '#d5d9e6',
      brightBlack: '#5a6178', brightRed: '#ff8fa0', brightGreen: '#9df0bd',
      brightYellow: '#ffe4a3', brightBlue: '#a3bbff', brightMagenta: '#d5b0ff',
      brightCyan: '#9aeaf3', brightWhite: '#ffffff',
    },
  },

  ember: {
    name: 'Ember',
    ui: {
      bg: '#1a1210', chrome: '#221715', raised: '#2c1f1b', line: '#3a2823',
      text: '#f2e4d8', muted: '#a08878', accent: '#ff9f57',
      accentSoft: 'rgba(255, 159, 87, 0.16)', hover: 'rgba(255, 255, 255, 0.08)',
    },
    term: {
      background: '#1a1210', foreground: '#f2e4d8', cursor: '#ff9f57',
      selectionBackground: 'rgba(255,159,87,0.28)',
      black: '#2a1e1a', red: '#ff6f5e', green: '#c3d47a', yellow: '#ffb454',
      blue: '#e69a6a', magenta: '#f08a8a', cyan: '#d9c07a', white: '#e8d8c8',
      brightBlack: '#6b5449', brightRed: '#ff9184', brightGreen: '#d9e89c',
      brightYellow: '#ffcd85', brightBlue: '#f0b98d', brightMagenta: '#ffabab',
      brightCyan: '#eddaa0', brightWhite: '#fff5eb',
    },
  },

  forest: {
    name: 'Forest',
    ui: {
      bg: '#0e1613', chrome: '#141d19', raised: '#1c2823', line: '#26332d',
      text: '#dbe8df', muted: '#7d9689', accent: '#66d9a0',
      accentSoft: 'rgba(102, 217, 160, 0.16)', hover: 'rgba(255, 255, 255, 0.08)',
    },
    term: {
      background: '#0e1613', foreground: '#dbe8df', cursor: '#66d9a0',
      selectionBackground: 'rgba(102,217,160,0.26)',
      black: '#1b2a24', red: '#e8797f', green: '#66d9a0', yellow: '#d6c77a',
      blue: '#6fb2cf', magenta: '#b391d9', cyan: '#6fd3c7', white: '#cddbd2',
      brightBlack: '#4e6459', brightRed: '#f39aa0', brightGreen: '#8fe8ba',
      brightYellow: '#e8dc9f', brightBlue: '#94cbe3', brightMagenta: '#ccb0ea',
      brightCyan: '#95e5da', brightWhite: '#f0f7f3',
    },
  },

  grape: {
    name: 'Grape',
    ui: {
      bg: '#14101c', chrome: '#1b1626', raised: '#241e33', line: '#312845',
      text: '#e8e2f5', muted: '#948aad', accent: '#c08cff',
      accentSoft: 'rgba(192, 140, 255, 0.18)', hover: 'rgba(255, 255, 255, 0.08)',
    },
    term: {
      background: '#14101c', foreground: '#e8e2f5', cursor: '#c08cff',
      selectionBackground: 'rgba(192,140,255,0.3)',
      black: '#241e33', red: '#ff7a9c', green: '#8ce0b0', yellow: '#f2cd7a',
      blue: '#8fa8ff', magenta: '#c08cff', cyan: '#7fd8e8', white: '#ddd6ec',
      brightBlack: '#5f5578', brightRed: '#ff9db6', brightGreen: '#a8ebc7',
      brightYellow: '#ffdf9e', brightBlue: '#adbfff', brightMagenta: '#d9b3ff',
      brightCyan: '#a3e6f2', brightWhite: '#ffffff',
    },
  },

  paper: {
    name: 'Paper',
    ui: {
      bg: '#f7f5f0', chrome: '#eeebe4', raised: '#e3dfd6', line: '#d5d0c4',
      text: '#2c2a26', muted: '#6d6a63', accent: '#3b6ea8',
      accentSoft: 'rgba(59, 110, 168, 0.14)', hover: 'rgba(0, 0, 0, 0.07)',
    },
    term: {
      background: '#f7f5f0', foreground: '#2c2a26', cursor: '#3b6ea8',
      selectionBackground: 'rgba(59,110,168,0.22)',
      black: '#2c2a26', red: '#b23c3c', green: '#3f7d3f', yellow: '#9a7215',
      blue: '#3b6ea8', magenta: '#8a4b96', cyan: '#28776f', white: '#d9d5cc',
      brightBlack: '#6d6a63', brightRed: '#cf5b5b', brightGreen: '#559a55',
      brightYellow: '#b68d2c', brightBlue: '#5488c0', brightMagenta: '#a568b0',
      brightCyan: '#3f9288', brightWhite: '#ffffff',
    },
  },
}

// --- Eget tema --------------------------------------------------------------

function hexToRgb (hex) {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

function toHex (n) {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
}

function mixHex (from, to, amount) {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  return '#' +
    toHex(a.r + (b.r - a.r) * amount) +
    toHex(a.g + (b.g - a.g) * amount) +
    toHex(a.b + (b.b - a.b) * amount)
}

function rgba (hex, alpha) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Grov ljushet, tillräcklig för att avgöra om bakgrunden är ljus eller mörk.
function isLight (hex) {
  const { r, g, b } = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

const DEFAULT_CUSTOM = {
  background: '#12141c',
  foreground: '#e6e8f0',
  accent: '#7c9cff',
}

/**
 * Bygger ett helt tema av tre valda färger.
 *
 * Att låta användaren peka ut alla sexton ANSI-färger vore mest exakt men
 * ohanterligt. I stället härleds programmets nyanser ur bakgrunden, och
 * ANSI-paletten lånas från Midnight eller Paper beroende på om bakgrunden är
 * mörk eller ljus — så att röd, grön och gul syns mot den du valt.
 */
function buildCustomTheme (custom) {
  const { background, foreground, accent } = { ...DEFAULT_CUSTOM, ...custom }
  const light = isLight(background)
  const toward = light ? '#000000' : '#ffffff'
  const base = light ? THEMES.paper : THEMES.midnight

  return {
    name: 'Egen',
    ui: {
      bg: background,
      chrome: mixHex(background, toward, 0.06),
      raised: mixHex(background, toward, 0.12),
      line: mixHex(background, toward, 0.18),
      text: foreground,
      muted: mixHex(foreground, background, 0.45),
      accent,
      accentSoft: rgba(accent, 0.16),
      hover: light ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.08)',
    },
    term: {
      ...base.term,
      background,
      foreground,
      cursor: accent,
      selectionBackground: rgba(accent, 0.28),
    },
  }
}

// Färger man kan märka en flik med. Håller sig medvetet till toner som syns
// mot både ljusa och mörka teman.
const TAB_COLORS = [
  '#ff6b81', '#ff9f57', '#ffd479', '#7ee0a5',
  '#6fdbe8', '#7c9cff', '#c08cff', '#adb6cc',
]

const CURSORS = ['bar', 'block', 'underline']
