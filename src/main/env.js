'use strict'

const path = require('path')
const { BASE_PATH_DIRS } = require('./tools')

// Variabler som hor till PromptForge egen process och inte ska folja med in i
// sessionen. PATH bygger vi sjalva; resten pekar pa Electron eller Node.
const OWN_PROCESS_VARS = ['PATH', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'PROMPTFORGE']

// Markorer som ett program satter for att tala om for sina egna underprocesser
// att de kors inuti en pagaende session. Arvs de vidare tror programmet att det
// startats av sig sjalvt och beter sig fel — Claude Code stanger t.ex. av
// transkriptsparandet. De ar knutna till EN korning och ska aldrig arvas.
//
// Detta ar samma tanke som med PATH: en ny session ska vara ren, inte en kopia
// av vad som rakade galla i processen som startade PromptForge.
const SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
  'TERM_SESSION_ID',
  'VSCODE_INJECTION',
  'VSCODE_NONCE',
  'VSCODE_SHELL_INTEGRATION',

  // NO_COLOR sags av nastan alla CLI-verktyg och stanger av all fargsattning,
  // oavsett vad COLORTERM lovar. Verktyg som startar underprocesser satter den
  // ofta at dem — Claude Code gor det — sa den lacker in i varje session om vi
  // arver den. Vi bygger PATH sjalva och lovar truecolor; da vore det
  // motsagelsefullt att slappa igenom en flagga som forbjuder just det.
  'NO_COLOR',
  'FORCE_COLOR',
]

const STRIPPED = new Set([...OWN_PROCESS_VARS, ...SESSION_MARKERS])

/**
 * Bygger miljon for en ny session.
 *
 * Hela poangen med programmet sitter har: PATH byggs fran grunden av de verktyg
 * anvandaren kryssat i, i stallet for att arva systemets fulla PATH. Ett verktyg
 * som inte ar valt ar darfor genuint otillgangligt i sessionen.
 */
function buildEnvironment (selectedIds, allTools, extraDirs = []) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED.has(key.toUpperCase())) env[key] = value
  }

  const dirs = []
  for (const id of selectedIds) {
    const tool = allTools.find(t => t.id === id)
    if (!tool || !tool.available) continue
    for (const dir of tool.dirs) {
      if (!dirs.includes(dir)) dirs.push(dir)
    }
    Object.assign(env, tool.env)
  }

  // Mappar som anvandaren pekat ut sjalv, for verktyg katalogen inte kanner till.
  for (const dir of extraDirs) {
    if (dir && !dirs.includes(dir)) dirs.push(dir)
  }

  // Valda verktyg forst sa att de vinner over eventuella systemversioner.
  for (const dir of BASE_PATH_DIRS) {
    if (!dirs.includes(dir)) dirs.push(dir)
  }

  env.PATH = dirs.join(path.delimiter)
  env.PROMPTFORGE = '1'

  // Program valjer fargdjup efter vad terminalen sager sig klara. Utan de har
  // tva faller de flesta tillbaka pa 16 farger — eller ingen alls. COLORTERM ar
  // det som far verktyg som Claude Code att anvanda hela 24-bitarspaletten.
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'

  return env
}

module.exports = { buildEnvironment }
