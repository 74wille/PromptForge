; Lägger till "Öppna i PromptForge" i Utforskarens högerklicksmeny, och tar bort
; posten igen vid avinstallation.
;
; Utan det här måste varje användare köra tools\install-context-menu.ps1 för hand
; efter installationen, vilket ingen gör — menyn såg helt enkelt ut att saknas.
;
; Allt skrivs under HKCU. Installationen är per användare (nsis.perMachine är
; false), så programfilen ligger i användarens egen AppData och posten hör hemma
; i samma användares gren. Då behövs heller inga administratörsrättigheter.
;
; OBS: på Windows 11 hamnar egna poster i den längre menyn under
; "Visa fler alternativ" (eller Skift+högerklick). Den korta förstahandsmenyn är
; reserverad för paketerade shell-tillägg.

!macro customInstall
  ; Background = högerklick på skrivbordet eller på tom yta i en öppen mapp.
  ; %V är mappen man står i.
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\PromptForge" "" "Öppna i PromptForge"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\PromptForge" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\PromptForge\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'

  ; Directory = högerklick på själva mappikonen. %1 är den mappen.
  WriteRegStr HKCU "Software\Classes\Directory\shell\PromptForge" "" "Öppna i PromptForge"
  WriteRegStr HKCU "Software\Classes\Directory\shell\PromptForge" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\PromptForge\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\PromptForge"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\PromptForge"
!macroend
