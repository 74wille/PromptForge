# PromptForge

En anpassningsbar Windows-terminal där du kryssar i vilka verktyg som ska
finnas tillgängliga i sessionen — och stylar fönstret som du vill.

## Idén

Om ett kommando "fungerar" i en prompt avgörs nästan alltid av **PATH**.
PromptForge letar upp vilka verktyg som faktiskt är installerade på datorn,
visar dem som kryssrutor, och bygger sedan en PATH från grunden av exakt de du
valt. Ett verktyg du inte kryssat i är genuint otillgängligt i den sessionen.

Två axlar som är lätta att blanda ihop:

- **Skal** — cmd, PowerShell eller Git Bash. Ett per session (radioknappar).
- **Verktyg** — git, node, python, java … Hur många som helst (kryssrutor).

"Git Bash" är båda: `bash` är skalet, `git` är verktyget.

## Kom igång

```
npm install
npm start
```

Kräver Node.js. Om Electron inte startar efter `npm install`, se
felsökningen längst ned.

## Kortkommandon

| Tangenter | Gör |
| --- | --- |
| `Ctrl+C` | Kopierar markeringen |
| `Ctrl+V` / högerklick | Klistrar in |
| `Ctrl+A` | Markerar det du skrivit på raden |
| `Ctrl+Break` | Avbryter det som körs |
| `Shift+Enter` | Ny rad utan att skicka iväg kommandot |
| `Ctrl+Shift+T` | Ny session |
| `Ctrl+Shift+W` | Stäng session |
| `Ctrl+Shift+E` | Öppna Miljö |
| `Ctrl+,` | Öppna Utseende |
| `Esc` | Stäng dialogruta |

Fönsterkommandona använder medvetet `Ctrl+Shift` — skalen äger redan de enkla
kombinationerna, `Ctrl+W` raderar till exempel ett ord i bash.

`Ctrl+C`, `Ctrl+V` och `Ctrl+A` betyder samma sak här som i resten av Windows,
utan undantag eller specialfall. Priset är att programmet som körs aldrig ser
dem: `Ctrl+C` avbryter inte längre, `Ctrl+A` hoppar inte till radens början, och
`Ctrl+V` klistrar in text även i program som gör något eget med tangenten.

`Ctrl+Break` avbryter i stället för `Ctrl+C`, och `Home` hoppar till radens
början. Allt med `Shift` eller `Alt` går orört vidare till programmet.

## Mus

**Klicka i raden du skriver** så flyttas markören dit. Terminalen äger inte
radredigeringen — skalet gör det — så klicket översätts till lika många
piltangenter. Det sker bara när klicket ligger på markörens rad, ingenting är
markerat, och programmet inte tagit över musen själv. Fungerar därför på
enradiga prompter, men inte i program som Claude Code som tolkar musen på egen
hand.

**Klicka på en URL** för att öppna den i webbläsaren. Bara `http` och `https` —
andra scheman skulle låta terminalutdata starta program på datorn.

## Typsnitt

Sex typsnitt följer med programmet och behöver inte installeras: **JetBrains
Mono, Cascadia Code, IBM Plex Mono, Iosevka, Fira Code** och **Geist Mono**.
Alla är släppta under SIL Open Font License 1.1, som uttryckligen tillåter att
de paketeras och distribueras med en applikation. Licenstexten för varje familj
ligger i `src/renderer/fonts/`.

Bara latinsk teckenuppsättning tas med — resten skulle mångdubbla storleken
utan att synas i en terminal.

Utöver dem listas Windows egna — Consolas, Cascadia Mono och Lucida Console —
men bara om de faktiskt är installerade. Det avgörs genom att bredden på `i` och
`W` mäts mot varandra: en familj som saknas faller tyst tillbaka på ett
proportionellt typsnitt, och då skiljer sig bredderna åt.

## Bygga en installerbar version

```
npm run icon    # ritar om build/icon.ico vid behov
npm run dist    # bygger dist/PromptForge Setup <version>.exe
```

`@lydell/node-pty` packas medvetet upp utanför asar-arkivet — nativa
`.node`-filer går inte att läsa inifrån ett arkiv, och sessionerna skulle inte
starta.

Kör om `tools\install-context-menu.ps1` efter en installation. Skriptet väljer
den installerade appen före ett lokalt bygge, och bygget före utvecklingsläget.

## Uppbyggnad

| Fil | Ansvar |
| --- | --- |
| `src/main/main.js` | Electron-appen, fönstret och all IPC |
| `src/main/tools.js` | Katalog över skal och verktyg + hittar dem på disk |
| `src/main/env.js` | Bygger PATH och miljövariabler för en session |
| `src/main/ptyManager.js` | Startar och sköter pty-processerna |
| `src/preload/preload.js` | Den enda bryggan mellan renderare och Node |
| `src/renderer/` | Gränssnittet och xterm.js-terminalerna |

Renderaren kör utan Node-åtkomst (`contextIsolation`), så node-pty och
filsystemet är inlåsta i huvudprocessen.

## Flikar

Högerklick på en flik ger **byt namn** och åtta **färger** att märka den med.
Färgen tonas in i flikens bakgrund så att den går att känna igen i ögonvrån.

Det finns medvetet inget kryss i fliken. Att stänga en session dödar det som
körs i den, och det ska inte kunna hända av ett slarvigt klick — stäng ligger i
högerklicksmenyn och på `Ctrl+Shift+W`.

Med **Återställ flikar vid start** påslaget kommer programmet ihåg vilka flikar
som var uppe när du stängde och öppnar dem igen — samma skal, verktyg,
startmapp, namn och färger.

Värt att vara tydlig med: **själva processerna återuppstår inte.** En session är
en levande process i Windows, och den dör när programmet stängs. Ett avbrutet
`npm install` fortsätter alltså inte. Det som sparas är uppsättningen bakom
fliken, inte vad som körde i den.

## Egna verktyg

Hittas inte ett program automatiskt kan du peka ut det själv under
**Miljö → Egna verktyg**. Du väljer programfilen, men det är *mappen* som
läggs till i PATH — så allt som ligger bredvid följer med. Egna verktyg sparas
mellan omstarter.

Använder du samma verktyg ofta är det värt att lägga in det i katalogen i
stället, så hittas det automatiskt även på en annan dator.

## Lägga till ett verktyg i katalogen

Lägg till ett objekt i `TOOL_SPECS` i `src/main/tools.js`:

```js
{
  id: 'deno',
  name: 'Deno',
  description: 'deno-kommandot',
  exe: 'deno.exe',
  candidates: ['%USERPROFILE%\\.deno\\bin'],
}
```

Hittas verktyget inte via `candidates` söker programmet igenom den ärvda PATH
efter `exe`, så det mesta som redan är installerat dyker upp automatiskt.

Behöver verktyget en miljövariabel, lägg till `envFrom`:

```js
envFrom: dir => ({ JAVA_HOME: path.dirname(dir) })
```

## Felsökning

**node-pty går inte att ladda.** Projektet använder `@lydell/node-pty`, som
levererar färdigbyggda binärer som separata plattformspaket — därför behövs
varken Python eller Visual Studio Build Tools. Originalpaketet `node-pty`
kräver kompilering och undviks medvetet.

**Electron startar inte efter `npm install`.** npm 11 blockerar
installationsskript som standard, och det är det skriptet som laddar ner
Electrons binär. Kör det manuellt:

```
node node_modules/electron/install.js
```

## Vidare

- Spara en fliks historik till en textfil
- Egna teman som JSON-filer, i stället för de fem inbyggda
- Dela upp fönstret i flera terminaler sida vid sida
- Sökning i scrollbacken
