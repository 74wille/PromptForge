<#
  Lagger till "Oppna i PromptForge" i Utforskarens hogerklicksmeny.

    powershell -ExecutionPolicy Bypass -File tools\install-context-menu.ps1
    powershell -ExecutionPolicy Bypass -File tools\install-context-menu.ps1 -Uninstall

  Allt skrivs under HKCU, sa inga administratorsrattigheter behovs.

  OBS: pa Windows 11 hamnar egna poster i den langre menyn under
  "Visa fler alternativ" (eller Skift+hogerklick). Den korta forstahandsmenyn
  ar reserverad for paketerade shell-tillagg.
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

# Den installerade appen forst, sedan ett lokalt bygge, sist utvecklingslaget.
# Ordningen spelar roll: en installerad app har en stabil sokvag som overlever
# att projektmappen flyttas.
$installed = Join-Path $env:LOCALAPPDATA 'Programs\PromptForge\PromptForge.exe'
$built = Join-Path $projectRoot 'dist\win-unpacked\PromptForge.exe'
$electron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'

if (Test-Path $installed) {
  $exe = $installed
  $appArg = $null
} elseif (Test-Path $built) {
  $exe = $built
  $appArg = $null
} elseif (Test-Path $electron) {
  # I utvecklingslage startas appen som "electron.exe <projektmapp> <mappen>".
  $exe = $electron
  $appArg = $projectRoot
} elseif ($Uninstall) {
  $exe = $null
  $appArg = $null
} else {
  throw "Hittar varken installerad PromptForge, ett bygge eller Electron.`nKor 'npm install' eller 'npm run dist' forst."
}

# Programmets egen ikon om den byggts, annars sjalva exe-filen.
$icon = Join-Path $projectRoot 'build\icon.ico'
if (-not (Test-Path $icon)) { $icon = $exe }

# Skrivs som teckenkoder for att etiketten ska bli ratt oavsett hur filen tolkas.
$label = "$([char]0x00D6)ppna i PromptForge"

# Background = hogerklick pa skrivbordet eller i en oppen mapp (%V ar mappen).
# Directory  = hogerklick pa sjalva mappikonen (%1 ar mappen).
$targets = @(
  @{ Key = 'HKCU:\Software\Classes\Directory\Background\shell\PromptForge'; Arg = '%V' },
  @{ Key = 'HKCU:\Software\Classes\Directory\shell\PromptForge';            Arg = '%1' }
)

foreach ($target in $targets) {
  if ($Uninstall) {
    if (Test-Path $target.Key) { Remove-Item $target.Key -Recurse -Force }
    continue
  }

  New-Item -Path $target.Key -Force | Out-Null
  New-ItemProperty -Path $target.Key -Name '(Default)' -Value $label -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $target.Key -Name 'Icon' -Value $icon -PropertyType String -Force | Out-Null

  $commandKey = Join-Path $target.Key 'command'
  New-Item -Path $commandKey -Force | Out-Null

  if ($appArg) {
    $command = '"{0}" "{1}" "{2}"' -f $exe, $appArg, $target.Arg
  } else {
    $command = '"{0}" "{1}"' -f $exe, $target.Arg
  }
  New-ItemProperty -Path $commandKey -Name '(Default)' -Value $command -PropertyType String -Force | Out-Null
}

if ($Uninstall) {
  Write-Output 'Hogerklicksmenyn borttagen.'
} else {
  Write-Output 'Tillagt. Hogerklicka pa skrivbordet och valj "Visa fler alternativ".'
}
