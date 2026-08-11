'use strict'

// Innehåll och färger kommer som frågeparametrar från huvudprocessen, som är
// den enda som vet vilken session notisen gäller och vilket tema som är valt.
const params = new URLSearchParams(location.search)

const root = document.documentElement.style
for (const name of ['chrome', 'line', 'text', 'muted', 'accent', 'hover']) {
  root.setProperty(`--${name}`, params.get(name) || '')
}

document.getElementById('title').textContent = params.get('title') || 'PromptForge'
document.getElementById('text').textContent = params.get('body') || ''

// Får inte heta "toast" — det namnet är upptaget av bryggan window.toast.
const card = document.getElementById('toast')

// Uttoningen får spelas färdigt innan fönstret stängs.
function leave (action) {
  card.classList.add('is-leaving')
  setTimeout(action, 160)
}

card.addEventListener('click', () => leave(() => window.toast.open()))

// Utan detta skulle den genomskinliga ytan runt kortet svälja klick på det som
// råkar ligga under notisen.
card.addEventListener('mouseenter', () => window.toast.setInteractive(true))
card.addEventListener('mouseleave', () => window.toast.setInteractive(false))

document.getElementById('close').addEventListener('click', event => {
  // Krysset ligger inuti rutan, så klicket skulle annars även öppna sessionen.
  event.stopPropagation()
  leave(() => window.toast.dismiss())
})

/**
 * Ljudet genereras i stället för att buntas som fil: inga licenser, ingen extra
 * vikt, och tonerna går att finjustera.
 *
 * Två mjuka sinustoner i en stigande kvart, G5 följt av C6. Kort och lågt — det
 * ska märkas utan att avbryta.
 */
if (params.get('sound') === '1') {
  try {
    const context = new AudioContext()

    const play = (frequency, delay, length) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency

      // Mjuk in- och uttoning. Utan den hörs ett klick i båda ändar, och det
      // är just det som får korta ljud att kännas skarpa.
      const start = context.currentTime + delay
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length)

      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + length + 0.03)
    }

    context.resume().then(() => {
      play(784, 0, 0.3)
      play(1046.5, 0.085, 0.4)
    })
  } catch {
    // Utan ljud visas rutan ändå.
  }
}
