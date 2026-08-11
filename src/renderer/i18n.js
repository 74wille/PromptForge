'use strict'

/**
 * Översättningar. Svenska är standard; engelska finns som alternativ.
 *
 * Nycklarna används på två sätt: `data-i18n` i HTML för statisk text, och
 * `t('nyckel', { variabel })` i JavaScript för text som byggs vid körning.
 */
const STRINGS = {
  sv: {
    'topbar.newSession': 'Ny session (Ctrl+Shift+T)',
    'topbar.settings': 'Inställningar (Ctrl+,)',
    'topbar.minimize': 'Minimera',
    'topbar.maximize': 'Maximera',
    'topbar.restore': 'Återställ',
    'topbar.close': 'Stäng',

    'empty.title': 'Ingen session igång',
    'empty.body': 'Välj skal och verktyg under <strong>kugghjulet</strong>, tryck sedan <strong>+</strong>.',

    'settings.env': 'Miljö',
    'settings.look': 'Utseende',
    'settings.close': 'Stäng',

    'env.shell': 'Skal',
    'env.shellHint': 'Ett per session.',
    'env.cwd': 'Startmapp',
    'env.cwdHint': 'Mappen nya sessioner öppnas i.',
    'env.pickFolder': 'Välj mapp',
    'env.resetFolder': 'Hemmapp',
    'env.restoreTabs': 'Återställ flikar vid start',
    'env.command': 'Vid start',
    'env.commandHint': 'Körs så fort en ny session öppnas.',
    'env.startClaude': 'Starta sessionen med Claude',

    'notify.title': 'Aviseringar',
    'notify.hint': 'Visas när ett program säger till att det är klart, och bara när du tittar någon annanstans.',
    'notify.enabled': 'Avisera när något blir klart',
    'notify.sound': 'Spela upp ett ljud',
    'update.title': 'Uppdatering klar',
    'update.body': 'Klicka för att starta om och installera',
    'notify.body': 'Klar och väntar på dig!',
    'env.tools': 'Verktyg',
    'env.toolsHint': 'Bara ikryssade hamnar i PATH.',
    'env.custom': 'Egna verktyg',
    'env.customHint': 'Peka ut en programfil som inte hittades automatiskt.',
    'env.addCustom': 'Lägg till verktyg…',
    'env.apply': 'Ny session med dessa val',
    'env.foot': '{found} av {total} verktyg hittades på datorn.',

    'look.preview': 'Förhandsvisning',
    'look.theme': 'Tema',
    'theme.custom': 'Egen',
    'custom.background': 'Bakgrund',
    'custom.foreground': 'Text',
    'custom.accent': 'Accent',
    'look.font': 'Typsnitt',
    'look.family': 'Familj',
    'look.size': 'Storlek',
    'look.lineHeight': 'Radhöjd',
    'look.cursor': 'Markör',
    'look.background': 'Bakgrund',
    'look.opacity': 'Genomskinlighet',
    'look.blur': 'Suddighet',
    'look.pickImage': 'Välj bild',
    'look.clearImage': 'Ta bort',
    'look.noImage': 'Ingen bild vald',
    'look.crop': 'Dra rutan för att välja vilken del av bilden som visas, och hörnet för att ändra storlek.',
    'look.language': 'Språk',
    'look.done': 'Klar',
    'look.footNote': 'Ändringar syns direkt i terminalen bakom.',

    'cursor.bar': 'Streck',
    'cursor.block': 'Block',
    'cursor.underline': 'Understruken',

    'tool.missing': 'inte installerat',

    'tab.rename': 'Byt namn',
    'tab.detach': 'Flytta till nytt fönster',
    'tab.color': 'Färg',
    'tab.close': 'Stäng flik',
    'tab.noColor': 'Ingen färg',

    'confirm.title': 'Stänga PromptForge?',
    'confirm.body': 'Alla sessioner avslutas och det som körs i dem avbryts.',
    'confirm.bodySessions': 'Du har {count} session igång. Den avslutas och det som körs i den avbryts.',
    'confirm.bodySessionsPlural': 'Du har {count} sessioner igång. De avslutas och det som körs i dem avbryts.',
    'confirm.cancel': 'Avbryt',
    'confirm.confirm': 'Stäng ändå',

    'session.exited': '[sessionen avslutades med kod {code}]',
    'session.failed': 'Kunde inte starta sessionen:',
  },

  en: {
    'topbar.newSession': 'New session (Ctrl+Shift+T)',
    'topbar.settings': 'Settings (Ctrl+,)',
    'topbar.minimize': 'Minimise',
    'topbar.maximize': 'Maximise',
    'topbar.restore': 'Restore',
    'topbar.close': 'Close',

    'empty.title': 'No session running',
    'empty.body': 'Pick a shell and tools under the <strong>gear</strong>, then press <strong>+</strong>.',

    'settings.env': 'Environment',
    'settings.look': 'Appearance',
    'settings.close': 'Close',

    'env.shell': 'Shell',
    'env.shellHint': 'One per session.',
    'env.cwd': 'Start folder',
    'env.cwdHint': 'The folder new sessions open in.',
    'env.pickFolder': 'Pick folder',
    'env.resetFolder': 'Home folder',
    'env.restoreTabs': 'Restore tabs on start',
    'env.command': 'On start',
    'env.commandHint': 'Runs as soon as a new session opens.',
    'env.startClaude': 'Start the session with Claude',

    'notify.title': 'Notifications',
    'notify.hint': 'Shown when a program signals it is done, and only when you are looking elsewhere.',
    'notify.enabled': 'Notify when something finishes',
    'notify.sound': 'Play a sound',
    'update.title': 'Update ready',
    'update.body': 'Click to restart and install',
    'notify.body': 'Done and waiting for you!',
    'env.tools': 'Tools',
    'env.toolsHint': 'Only ticked ones end up on PATH.',
    'env.custom': 'Your own tools',
    'env.customHint': 'Point to a program that was not found automatically.',
    'env.addCustom': 'Add tool…',
    'env.apply': 'New session with these',
    'env.foot': 'Found {found} of {total} tools on this machine.',

    'look.preview': 'Preview',
    'look.theme': 'Theme',
    'theme.custom': 'Custom',
    'custom.background': 'Background',
    'custom.foreground': 'Text',
    'custom.accent': 'Accent',
    'look.font': 'Font',
    'look.family': 'Family',
    'look.size': 'Size',
    'look.lineHeight': 'Line height',
    'look.cursor': 'Cursor',
    'look.background': 'Background',
    'look.opacity': 'Opacity',
    'look.blur': 'Blur',
    'look.pickImage': 'Pick image',
    'look.clearImage': 'Remove',
    'look.noImage': 'No image selected',
    'look.crop': 'Drag the box to choose which part of the image shows, and the corner to resize it.',
    'look.language': 'Language',
    'look.done': 'Done',
    'look.footNote': 'Changes apply live to the terminal behind.',

    'cursor.bar': 'Bar',
    'cursor.block': 'Block',
    'cursor.underline': 'Underline',

    'tool.missing': 'not installed',

    'tab.rename': 'Rename',
    'tab.detach': 'Move to new window',
    'tab.color': 'Colour',
    'tab.close': 'Close tab',
    'tab.noColor': 'No colour',

    'confirm.title': 'Close PromptForge?',
    'confirm.body': 'All sessions end and anything running in them is stopped.',
    'confirm.bodySessions': 'You have {count} session running. It ends and anything running in it is stopped.',
    'confirm.bodySessionsPlural': 'You have {count} sessions running. They end and anything running in them is stopped.',
    'confirm.cancel': 'Cancel',
    'confirm.confirm': 'Close anyway',

    'session.exited': '[session ended with code {code}]',
    'session.failed': 'Could not start the session:',
  },
}

const LANGUAGES = [
  { id: 'sv', name: 'Svenska' },
  { id: 'en', name: 'English' },
]

let activeLanguage = 'sv'

function setLanguage (lang) {
  activeLanguage = STRINGS[lang] ? lang : 'sv'
}

function t (key, vars) {
  // Faller tillbaka på svenska om en nyckel saknas i det valda språket, och på
  // nyckeln själv om den saknas överallt — då syns felet direkt i gränssnittet.
  const text = STRINGS[activeLanguage][key] ?? STRINGS.sv[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match))
}

// Skriver om all statisk text i dokumentet till det aktiva språket.
function translateDocument () {
  document.documentElement.lang = activeLanguage

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n)
  }
  for (const node of document.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.dataset.i18nHtml)
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle)
    node.setAttribute('aria-label', t(node.dataset.i18nTitle))
  }
}
