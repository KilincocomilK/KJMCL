; Keep the standard installer lifecycle; only interactive manual uninstall asks about data.
; Never pass --delete-app-data to electron-builder's broad profile deletion routine.
!macro customUnInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "请使用交互式卸载选择数据保留方式。KJMCL 不支持 --delete-app-data 参数。"
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
        MessageBox MB_OK|MB_ICONEXCLAMATION "无法打开数据保留选项，卸载已取消。数据未自动删除。"
        Abort
      ${EndIf}
      ${If} $R0 != 0
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
