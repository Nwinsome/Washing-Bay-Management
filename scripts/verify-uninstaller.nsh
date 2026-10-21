; Build-time only. The first NSIS pass generates the uninstaller; the second
; pass verifies its PE icon resources and retains evidence before embedding it.
; No custom install/uninstall actions are added to the customer application.
!ifndef BUILD_UNINSTALLER
  !ifdef UNINSTALLER_OUT_FILE
    !system 'node "${PROJECT_DIR}\scripts\verify-windows-icons.cjs" "${UNINSTALLER_OUT_FILE}" --capture-uninstaller' = 0
  !endif
!endif
