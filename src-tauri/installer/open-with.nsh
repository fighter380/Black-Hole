!macro BLACK_HOLE_SUPPORT EXT
  WriteRegStr HKCU "${BLACK_HOLE_OPEN_WITH}\SupportedTypes" "${EXT}" ""
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !define BLACK_HOLE_OPEN_WITH "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "${BLACK_HOLE_OPEN_WITH}" "FriendlyAppName" "Black Hole"
  WriteRegStr HKCU "${BLACK_HOLE_OPEN_WITH}\shell\open\command" "" '$"$INSTDIR\${MAINBINARYNAME}.exe$" $"%1$"'
  !insertmacro BLACK_HOLE_SUPPORT ".txt"
  !insertmacro BLACK_HOLE_SUPPORT ".md"
  !insertmacro BLACK_HOLE_SUPPORT ".py"
  !insertmacro BLACK_HOLE_SUPPORT ".json"
  !insertmacro BLACK_HOLE_SUPPORT ".html"
  !insertmacro BLACK_HOLE_SUPPORT ".htm"
  !insertmacro BLACK_HOLE_SUPPORT ".css"
  !insertmacro BLACK_HOLE_SUPPORT ".js"
  !insertmacro BLACK_HOLE_SUPPORT ".ts"
  !insertmacro BLACK_HOLE_SUPPORT ".ino"
  !insertmacro BLACK_HOLE_SUPPORT ".rs"
  !undef BLACK_HOLE_OPEN_WITH
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
!macroend
