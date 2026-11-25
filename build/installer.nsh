!define MUI_BGCOLOR "252824"
!define MUI_TEXTCOLOR "F4F0E6"
!define MUI_INSTFILESPAGE_COLORS "F4F0E6 20231F"
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH "AspectFitHeight"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH "AspectFitHeight"
!define MUI_CUSTOMFUNCTION_GUIINIT kjmclWizardInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.kjmclWizardInit

Var kjmclBodyFont
Var kjmclTitleFont

!macro kjmclWizardFunctions PREFIX GUIEND
  Function ${PREFIX}kjmclWizardInit
    InitPluginsDir
    File "/oname=$PLUGINSDIR\kjmcl-wizard.otf" "${BUILD_RESOURCES_DIR}\wizard-pixel.otf"
    System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\kjmcl-wizard.otf", i 0x10, p 0)'
    CreateFont $kjmclBodyFont "KJMCL Wizard Pixel" 9 400
    CreateFont $kjmclTitleFont "KJMCL Wizard Pixel" 15 400
    SetCtlColors $HWNDPARENT F4F0E6 252824
    SetCtlColors $mui.Branding.Text F4F0E6 252824
    SetCtlColors $mui.Branding.Background F4F0E6 252824
    SendMessage $mui.Branding.Text ${WM_SETTEXT} 0 "STR: "
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
    System::Call 'uxtheme::SetWindowTheme(p $mui.Button.Next, w "DarkMode_Explorer", p 0)'
    System::Call 'uxtheme::SetWindowTheme(p $mui.Button.Back, w "DarkMode_Explorer", p 0)'
    System::Call 'uxtheme::SetWindowTheme(p $mui.Button.Cancel, w "DarkMode_Explorer", p 0)'
    ; Other locales retain the native font for their complete character set.
    ${If} $LANGUAGE == 2052
    ${OrIf} $LANGUAGE == 1033
      SendMessage $mui.Button.Next ${WM_SETFONT} $kjmclBodyFont 1
      SendMessage $mui.Button.Back ${WM_SETFONT} $kjmclBodyFont 1
      SendMessage $mui.Button.Cancel ${WM_SETFONT} $kjmclBodyFont 1
      SendMessage $mui.Header.Text ${WM_SETFONT} $kjmclBodyFont 1
      SendMessage $mui.Header.SubText ${WM_SETFONT} $kjmclBodyFont 1
    ${EndIf}
  FunctionEnd

  Function ${GUIEND}
    System::Call 'gdi32::DeleteObject(p $kjmclTitleFont)'
    System::Call 'gdi32::DeleteObject(p $kjmclBodyFont)'
    System::Call 'gdi32::RemoveFontResourceExW(w "$PLUGINSDIR\kjmcl-wizard.otf", i 0x10, p 0)'
  FunctionEnd

  !ifndef INSTALL_MODE_PER_ALL_USERS
    Function ${PREFIX}kjmclMode
      SetCtlColors $MultiUser.InstallModePage F4F0E6 252824
      SetCtlColors $MultiUser.InstallModePage.Text F4F0E6 252824
      SetCtlColors $MultiUser.InstallModePage.AllUsers F4F0E6 252824
      SetCtlColors $MultiUser.InstallModePage.CurrentUser F4F0E6 252824
      SetCtlColors $RadioButtonLabel1 FFA153 252824
    FunctionEnd
  !endif

  Function ${PREFIX}kjmclWelcome
    ${If} $LANGUAGE == 2052
      !ifdef BUILD_UNINSTALLER
        SendMessage $mui.WelcomePage.Title ${WM_SETTEXT} 0 "STR:卸载 KJMCL"
        SendMessage $mui.WelcomePage.Text ${WM_SETTEXT} 0 "STR:卸载时可选择保留或删除游戏数据。"
      !else
        SendMessage $mui.WelcomePage.Title ${WM_SETTEXT} 0 "STR:安装 KJMCL"
        SendMessage $mui.WelcomePage.Text ${WM_SETTEXT} 0 "STR:选择安装位置后开始安装。"
      !endif
    ${EndIf}
    ${If} $LANGUAGE == 2052
    ${OrIf} $LANGUAGE == 1033
      SendMessage $mui.WelcomePage.Title ${WM_SETFONT} $kjmclTitleFont 1
      SendMessage $mui.WelcomePage.Text ${WM_SETFONT} $kjmclBodyFont 1
    ${EndIf}
  FunctionEnd

  Function ${PREFIX}kjmclFinish
    ${If} $LANGUAGE == 2052
      !ifdef BUILD_UNINSTALLER
        SendMessage $mui.FinishPage.Title ${WM_SETTEXT} 0 "STR:已卸载 KJMCL"
      !else
        SendMessage $mui.FinishPage.Title ${WM_SETTEXT} 0 "STR:安装完成"
      !endif
      ; The native restart instructions and choices are required when Windows requests a reboot.
      IfRebootFlag +2 0
        ShowWindow $mui.FinishPage.Text ${SW_HIDE}
    ${EndIf}
    ${If} $LANGUAGE == 2052
    ${OrIf} $LANGUAGE == 1033
      SendMessage $mui.FinishPage.Title ${WM_SETFONT} $kjmclTitleFont 1
      SendMessage $mui.FinishPage.Text ${WM_SETFONT} $kjmclBodyFont 1
    ${EndIf}
  FunctionEnd
!macroend

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro kjmclWizardFunctions "un." un.onGUIEnd
  !else
    !insertmacro kjmclWizardFunctions "" .onGUIEnd
  !endif
!macroend

!macro customWelcomePage
  Function kjmclWelcomePre
    ${If} ${isUpdated}
    ${OrIf} ${UAC_IsInnerInstance}
      Abort
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE kjmclWelcomePre
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW kjmclWelcome
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.kjmclWelcome
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customInstallMode
  !ifdef BUILD_UNINSTALLER
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.kjmclMode
  !else
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW kjmclMode
  !endif
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function kjmclStartApp
      StrCpy $1 ""
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION kjmclStartApp
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW kjmclFinish
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUninstallPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.kjmclFinish
!macroend

; Only interactive manual uninstall asks about data.
; Never pass --delete-app-data to electron-builder's broad profile deletion routine.
!macro customUnInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "请打开卸载向导选择是否保留游戏数据。"
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ${IfNot} ${Silent}
      ClearErrors
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --kjmcl-uninstall-data' $R0
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONEXCLAMATION "无法打开数据选项，卸载已取消。"
        Abort
      ${EndIf}
      ${If} $R0 != 0
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
