; Windows scales dialog units and fonts with DPI; brand text stays native text.
!define MUI_UI "${__FILEDIR__}\compact-ui.dll"
!define MUI_UI_HEADERIMAGE_RIGHT "${__FILEDIR__}\compact-ui.dll"
!define MUI_HEADERIMAGE_BITMAP_STRETCH "AspectFitHeight"
!define MUI_HEADERIMAGE_UNBITMAP_STRETCH "AspectFitHeight"
!define MUI_CUSTOMFUNCTION_GUIINIT HearthAppearanceInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.HearthAppearanceInit

Var HearthBrandFont
Var HearthSidebarFont

!macro HearthAppearanceCallbacks PREFIX
Function ${PREFIX}HearthAppearanceInit
  GetDlgItem $0 $HWNDPARENT 1047
  CreateFont $HearthBrandFont "Segoe UI" "11" "700"
  SendMessage $0 ${WM_SETFONT} $HearthBrandFont 0
  SetCtlColors $0 "252525" "FFFFFF"
FunctionEnd
!macroend
!macro HearthFullPageBrand PAGE
  ; Welcome and finish pages share the same compact sidebar and native text.
  GetDlgItem $0 $HWNDPARENT 1047
  ShowWindow $0 ${SW_HIDE}

  ; MUI's image starts at a fixed 193u height; fit it to the compact full page.
  System::Alloc 16
  Pop $0
  System::Call 'user32::GetClientRect(p $mui.${PAGE}Page, p r0)'
  System::Call '*$0(i, i, i, i .r1)'
  System::Call 'user32::GetWindowRect(p $mui.${PAGE}Page.Image, p r0)'
  System::Call '*$0(i .r2, i, i .r3, i)'
  IntOp $3 $3 - $2
  System::Call 'user32::SetWindowPos(p $mui.${PAGE}Page.Image, p 0, i 0, i 0, i r3, i r1, i 6)'
  System::Free $0
  ${NSD_FreeImage} $mui.${PAGE}Page.Image.Bitmap
  ${NSD_SetStretchedImage} $mui.${PAGE}Page.Image "$PLUGINSDIR\modern-wizard.bmp" $mui.${PAGE}Page.Image.Bitmap

  ${NSD_CreateLabel} 12u 54u 94u 15u "Pi Hearth"
  Pop $0
  CreateFont $HearthSidebarFont "Segoe UI" "14" "700"
  SendMessage $0 ${WM_SETFONT} $HearthSidebarFont 0
  SetCtlColors $0 "252525" "F4F3F1"
  System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 19)'
  ${NSD_CreateLabel} 14u 70u 90u 12u "AI 编程工作台"
  Pop $0
  SetCtlColors $0 "727272" "F4F3F1"
  System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 19)'
!macroend

!macro HearthAppearanceFunctions
!insertmacro HearthAppearanceCallbacks ""
!insertmacro HearthAppearanceCallbacks "un."

Function HearthWelcomeShow
  !insertmacro HearthFullPageBrand Welcome
FunctionEnd

Function HearthWelcomeLeave
  ; The normal header returns when advancing to a settings or maintenance page.
  GetDlgItem $0 $HWNDPARENT 1047
  ShowWindow $0 ${SW_SHOW}
FunctionEnd

Function HearthFinishShow
  !insertmacro HearthFullPageBrand Finish

  ; Group the completion choices using the current native checkbox height.
  ${If} $mui.FinishPage.Run P<> 0
  ${AndIf} $mui.FinishPage.ShowReadme P<> 0
    System::Alloc 16
    Pop $0
    System::Call 'user32::GetWindowRect(p $mui.FinishPage.Run, p r0)'
    System::Call 'user32::MapWindowPoints(p 0, p $mui.FinishPage, p r0, i 2)'
    System::Call '*$0(i .r1, i .r2, i, i .r3)'
    IntOp $3 $3 - $2
    IntOp $3 $3 * 7
    IntOp $3 $3 / 5
    IntOp $2 $2 + $3
    System::Call 'user32::SetWindowPos(p $mui.FinishPage.ShowReadme, p 0, i r1, i r2, i 0, i 0, i 21)'
    System::Free $0
  ${EndIf}
FunctionEnd
!macroend
