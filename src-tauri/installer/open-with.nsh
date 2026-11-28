!define BLACK_HOLE_PROGID "BlackHole.QuickEdit"
!define BLACK_HOLE_CAPABILITIES "Software\BlackHole\QuickEdit\Capabilities"

!macro BLACK_HOLE_ADD EXT
  WriteRegStr HKCU "${BLACK_HOLE_OPEN_WITH}\SupportedTypes" "${EXT}" ""
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithProgids" "${BLACK_HOLE_PROGID}" ""
  WriteRegStr HKCU "${BLACK_HOLE_CAPABILITIES}\FileAssociations" "${EXT}" "${BLACK_HOLE_PROGID}"
!macroend

!macro BLACK_HOLE_REMOVE EXT
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${BLACK_HOLE_PROGID}"
  DeleteRegKey /ifempty HKCU "Software\Classes\${EXT}\OpenWithProgids"
!macroend

!macro BLACK_HOLE_TYPES ACTION
  !insertmacro ${ACTION} ".txt"
  !insertmacro ${ACTION} ".md"
  !insertmacro ${ACTION} ".py"
  !insertmacro ${ACTION} ".json"
  !insertmacro ${ACTION} ".html"
  !insertmacro ${ACTION} ".htm"
  !insertmacro ${ACTION} ".css"
  !insertmacro ${ACTION} ".js"
  !insertmacro ${ACTION} ".ts"
  !insertmacro ${ACTION} ".ino"
  !insertmacro ${ACTION} ".rs"
  !insertmacro ${ACTION} ".png"
  !insertmacro ${ACTION} ".jpg"
  !insertmacro ${ACTION} ".jpeg"
  !insertmacro ${ACTION} ".gif"
  !insertmacro ${ACTION} ".webp"
  !insertmacro ${ACTION} ".bmp"
  !insertmacro ${ACTION} ".ico"
  !insertmacro ${ACTION} ".avif"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !define BLACK_HOLE_OPEN_WITH "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "${BLACK_HOLE_OPEN_WITH}" "FriendlyAppName" "Black Hole"
  WriteRegStr HKCU "${BLACK_HOLE_OPEN_WITH}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\${BLACK_HOLE_PROGID}" "" "Black Hole"
  WriteRegStr HKCU "Software\Classes\${BLACK_HOLE_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "${BLACK_HOLE_CAPABILITIES}" "ApplicationName" "Black Hole"
  WriteRegStr HKCU "${BLACK_HOLE_CAPABILITIES}" "ApplicationDescription" "Edition rapide de code et apercu des images"
  WriteRegStr HKCU "${BLACK_HOLE_CAPABILITIES}" "ApplicationIcon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  !insertmacro BLACK_HOLE_TYPES BLACK_HOLE_ADD
  WriteRegStr HKCU "Software\RegisteredApplications" "Black Hole" "${BLACK_HOLE_CAPABILITIES}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  !undef BLACK_HOLE_OPEN_WITH
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\RegisteredApplications" "Black Hole"
  DeleteRegKey HKCU "${BLACK_HOLE_CAPABILITIES}"
  DeleteRegKey /ifempty HKCU "Software\BlackHole\QuickEdit"
  DeleteRegKey /ifempty HKCU "Software\BlackHole"
  !insertmacro BLACK_HOLE_TYPES BLACK_HOLE_REMOVE
  DeleteRegKey HKCU "Software\Classes\${BLACK_HOLE_PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
