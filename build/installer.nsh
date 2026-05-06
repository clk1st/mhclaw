; NSIS 自定义脚本 —— 解决 "应用正在运行,请先关闭" 的体验坑。
;
; Electron 应用有多个进程(主进程 mhwork.exe + 渲染子进程 + Gateway 子进程
; ELECTRON_RUN_AS_NODE),电脑小白不会挨个去任务管理器 kill。这里在安装/卸载
; 前静默强杀所有相关进程,用户双击安装器就能一路过。

!macro customInit
  ; 安装前:kill 所有 mhwork 相关进程(忽略错误,没运行时 taskkill 会返 128,无影响)
  nsExec::Exec 'taskkill /F /T /IM "mhwork.exe"'
  nsExec::Exec 'taskkill /F /IM "Update.exe"'
  ; 给 OS 一点时间释放文件句柄,否则紧接着的文件写入可能被文件锁挡住
  Sleep 800
!macroend

!macro customUnInit
  ; 卸载前:同样清干净
  nsExec::Exec 'taskkill /F /T /IM "mhwork.exe"'
  Sleep 500
!macroend
