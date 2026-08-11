'use strict'

const { EventEmitter } = require('events')

// node-pty ar projektets enda nativa beroende, och det knepigaste med hela bygget.
// @lydell-forken levererar fardigbyggda binarer som separata plattformspaket, sa
// varken Python eller Visual Studio Build Tools behovs. Originalet star kvar som
// reserv for den som redan kompilerat det sjalv.
function loadPty () {
  const candidates = ['@lydell/node-pty', 'node-pty']
  const problems = []
  for (const name of candidates) {
    try {
      return require(name)
    } catch (err) {
      problems.push(`  ${name}: ${err.message}`)
    }
  }
  throw new Error('Kunde inte ladda node-pty:\n' + problems.join('\n'))
}

// Hur mycket utdata som sparas per session. Rackligt for att en utdragen flik
// ska fa med sig sin historik, utan att minnet vaxer obegransat.
const SCROLLBACK_LIMIT = 512 * 1024

class PtyManager extends EventEmitter {
  constructor () {
    super()
    this.sessions = new Map()
    this.buffers = new Map()
    this.nextId = 1
    this.pty = null
  }

  spawn ({ shell, env, cwd, cols, rows }) {
    if (!this.pty) this.pty = loadPty()

    const id = String(this.nextId++)
    const proc = this.pty.spawn(shell.exe, shell.args || [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || process.env.USERPROFILE || process.env.HOME,
      env,
      useConpty: true,
    })

    proc.onData(data => {
      const buffered = (this.buffers.get(id) || '') + data
      this.buffers.set(id, buffered.length > SCROLLBACK_LIMIT
        ? buffered.slice(-SCROLLBACK_LIMIT)
        : buffered)
      this.emit('data', id, data)
    })

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.emit('exit', id, exitCode)
    })

    this.sessions.set(id, proc)
    return id
  }

  // Allt som sessionen skrivit ut hittills, sa att ett nytt fonster kan spela
  // upp historiken i stallet for att oppna en tom terminal.
  scrollback (id) {
    return this.buffers.get(id) || ''
  }

  write (id, data) {
    const proc = this.sessions.get(id)
    if (proc) proc.write(data)
  }

  // Om storleken inte skickas vidare till pty:n radbryter skalet pa fel kolumn
  // och allt ser trasigt ut. Latt att glomma, svart att felsoka.
  resize (id, cols, rows) {
    const proc = this.sessions.get(id)
    if (!proc) return
    try {
      proc.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      // Processen hann do mellan resize och anropet — ofarligt.
    }
  }

  kill (id) {
    const proc = this.sessions.get(id)
    this.buffers.delete(id)
    if (!proc) return
    try {
      proc.kill()
    } catch {
      // Redan dod.
    }
    this.sessions.delete(id)
  }

  killAll () {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}

module.exports = PtyManager
