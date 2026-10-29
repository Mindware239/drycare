; DryCare runs on 64-bit Windows 10 and Windows 11 only (Electron/Chromium and PostgreSQL 17 need Windows 10+).
; Stop early with a clear message instead of installing an app that cannot start.
!include WinVer.nsh
!include x64.nsh

!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "DryCare needs 64-bit Windows 10 or Windows 11.$\r$\n$\r$\nThis PC is running 32-bit Windows, so DryCare cannot be installed here.$\r$\n$\r$\nTip: staff phones and tablets can still use DryCare in the browser over the shop Wi-Fi."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "DryCare needs Windows 10 or Windows 11.$\r$\n$\r$\nThis PC is running an older version of Windows that no longer receives security updates, so DryCare cannot be installed here.$\r$\n$\r$\nTip: staff phones and tablets can still use DryCare in the browser over the shop Wi-Fi."
    Abort
  ${EndIf}
!macroend
