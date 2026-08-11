'use strict'

const fs = require('fs')
const path = require('path')

const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'

// Det absoluta minimum varje session behover. Utan system32 fungerar inte ens
// `where`, `dir` eller natverksanrop — det ar inte ett "verktyg" man valjer bort.
const BASE_PATH_DIRS = [
  path.join(SYSTEM_ROOT, 'system32'),
  SYSTEM_ROOT,
  path.join(SYSTEM_ROOT, 'System32', 'Wbem'),
  path.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0'),
]

function expand (p) {
  return p.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
}

function dirHasExe (dir, exe) {
  try {
    return fs.statSync(path.join(dir, exe)).isFile()
  } catch {
    return false
  }
}

// Samma verktyg kan heta olika saker beroende pa hur det installerats — npm
// lagger t.ex. en .cmd-omslagning dar en riktig installer lagger en .exe.
function exeNames (spec) {
  return Array.isArray(spec.exe) ? spec.exe : [spec.exe]
}

function dirHasAny (dir, exes) {
  return exes.some(exe => dirHasExe(dir, exe))
}

// Sista utvagen: leta igenom PATH som Windows redan gett oss. Fangar upp allt
// som ar installerat pa en plats vi inte gissat pa.
function findOnInheritedPath (exes) {
  for (const raw of (process.env.PATH || '').split(path.delimiter)) {
    if (!raw) continue
    const dir = expand(raw)
    if (dirHasAny(dir, exes)) return path.normalize(dir)
  }
  return null
}

// For verktyg som installeras i en versionsnumrerad mapp (Python, JDK).
// Nyaste versionen vinner, darfor sorteras listan bakland.
function scanVersionedDirs ({ base, suffix, exes }) {
  const root = expand(base)
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  const names = entries.filter(e => e.isDirectory()).map(e => e.name).sort().reverse()
  for (const name of names) {
    const dir = suffix ? path.join(root, name, suffix) : path.join(root, name)
    if (dirHasAny(dir, exes)) return dir
  }
  return null
}

function locate (spec) {
  const exes = exeNames(spec)

  for (const candidate of spec.candidates || []) {
    const dir = expand(candidate)
    if (dirHasAny(dir, exes)) return path.normalize(dir)
  }
  for (const scan of spec.scan || []) {
    const dir = scanVersionedDirs({ ...scan, exes })
    if (dir) return path.normalize(dir)
  }
  if (spec.searchPath !== false) return findOnInheritedPath(exes)
  return null
}

// --- Skal -------------------------------------------------------------------
// Du kan bara kora ETT skal per session. Darfor radioknappar i granssnittet.

const SHELL_SPECS = [
  {
    id: 'cmd',
    name: 'Command Prompt',
    exe: 'cmd.exe',
    args: [],
    candidates: [path.join(SYSTEM_ROOT, 'system32')],
    searchPath: false,
  },
  {
    id: 'powershell',
    name: 'Windows PowerShell',
    exe: 'powershell.exe',
    args: ['-NoLogo'],
    candidates: [path.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0')],
    searchPath: false,
  },
  {
    id: 'pwsh',
    name: 'PowerShell 7',
    exe: 'pwsh.exe',
    args: ['-NoLogo'],
    candidates: ['%ProgramFiles%\\PowerShell\\7'],
  },
  {
    id: 'bash',
    name: 'Git Bash',
    // --login kor /etc/profile, vilket ar det som far bash att bete sig som
    // riktiga Git Bash och inte ett naket skal.
    exe: 'bash.exe',
    args: ['--login', '-i'],
    candidates: ['%ProgramFiles%\\Git\\bin', '%LOCALAPPDATA%\\Programs\\Git\\bin'],
  },
]

// --- Verktyg ----------------------------------------------------------------
// Du kan valja hur manga som helst. Darfor kryssrutor.
// `dirs` laggs till i PATH, `env` satter extra miljovariabler.

const TOOL_SPECS = [
  {
    id: 'git',
    name: 'Git',
    description: 'git-kommandot',
    exe: 'git.exe',
    candidates: ['%ProgramFiles%\\Git\\cmd', '%LOCALAPPDATA%\\Programs\\Git\\cmd'],
  },
  {
    id: 'git-unix',
    name: 'Unix-verktyg',
    description: 'ls, grep, sed, curl m.fl. fran Git for Windows',
    exe: 'ls.exe',
    candidates: ['%ProgramFiles%\\Git\\usr\\bin', '%LOCALAPPDATA%\\Programs\\Git\\usr\\bin'],
    searchPath: false,
  },
  {
    id: 'node',
    name: 'Node.js',
    description: 'node, npm och npx',
    exe: 'node.exe',
    candidates: ['%ProgramFiles%\\nodejs', '%LOCALAPPDATA%\\Programs\\nodejs'],
    // Globalt installerade npm-paket hamnar har och ar varldelosa utan mappen.
    extraDirs: ['%APPDATA%\\npm'],
  },
  {
    id: 'python',
    name: 'Python',
    description: 'python och pip',
    exe: 'python.exe',
    scan: [
      { base: '%LOCALAPPDATA%\\Programs\\Python' },
      { base: '%ProgramFiles%', suffix: '' },
    ],
    extraDirs: ['%APPDATA%\\Python\\Scripts'],
    subDirs: ['Scripts'],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'claude-kommandot',
    // Installeraren lagger en .exe i ~/.local/bin, npm-varianten en .cmd i APPDATA.
    exe: ['claude.exe', 'claude.cmd'],
    candidates: ['%USERPROFILE%\\.local\\bin', '%APPDATA%\\npm'],
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    description: 'gh-kommandot',
    exe: ['gh.exe'],
    candidates: ['%ProgramFiles%\\GitHub CLI'],
  },
  {
    id: 'dotnet',
    name: '.NET SDK',
    description: 'dotnet-kommandot',
    exe: 'dotnet.exe',
    candidates: ['%ProgramFiles%\\dotnet'],
  },
  {
    id: 'java',
    name: 'Java (JDK)',
    description: 'java och javac',
    exe: 'java.exe',
    scan: [
      { base: '%ProgramFiles%\\Eclipse Adoptium', suffix: 'bin' },
      { base: '%ProgramFiles%\\Java', suffix: 'bin' },
      { base: '%ProgramFiles%\\Microsoft', suffix: 'bin' },
    ],
    // JAVA_HOME pekar pa mappen OVANFOR bin — nastan alla byggverktyg kraver det.
    envFrom: dir => ({ JAVA_HOME: path.dirname(dir) }),
  },
  {
    id: 'go',
    name: 'Go',
    description: 'go-kommandot',
    exe: 'go.exe',
    candidates: ['%ProgramFiles%\\Go\\bin'],
    envFrom: () => ({ GOPATH: expand('%USERPROFILE%\\go') }),
    extraDirs: ['%USERPROFILE%\\go\\bin'],
  },
  {
    id: 'rust',
    name: 'Rust',
    description: 'cargo och rustc',
    exe: 'cargo.exe',
    candidates: ['%USERPROFILE%\\.cargo\\bin'],
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    description: 'ffmpeg och ffprobe',
    exe: 'ffmpeg.exe',
  },
  {
    id: '7zip',
    name: '7-Zip',
    description: '7z-kommandot',
    exe: '7z.exe',
    candidates: ['%ProgramFiles%\\7-Zip'],
  },
]

function resolveShells () {
  return SHELL_SPECS.map(spec => {
    const dir = locate(spec)
    return {
      id: spec.id,
      name: spec.name,
      args: spec.args,
      available: Boolean(dir),
      exe: dir ? path.join(dir, spec.exe) : null,
    }
  })
}

function resolveTools () {
  return TOOL_SPECS.map(spec => {
    const dir = locate(spec)
    const dirs = []
    if (dir) {
      dirs.push(dir)
      for (const sub of spec.subDirs || []) {
        const full = path.join(dir, sub)
        if (fs.existsSync(full)) dirs.push(full)
      }
      for (const extra of spec.extraDirs || []) {
        const full = expand(extra)
        if (fs.existsSync(full)) dirs.push(full)
      }
    }
    return {
      id: spec.id,
      name: spec.name,
      description: spec.description || '',
      available: Boolean(dir),
      dir,
      dirs,
      env: dir && spec.envFrom ? spec.envFrom(dir) : {},
    }
  })
}

module.exports = { BASE_PATH_DIRS, resolveShells, resolveTools, expand }
