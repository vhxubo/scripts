#Requires AutoHotkey v2.0
#SingleInstance Force

;@Ahk2Exe-SetName BackDimmer
;@Ahk2Exe-SetVersion 1.0.0
;@Ahk2Exe-SetDescription BackDimmer - Background dimming tool
;@Ahk2Exe-SetCompanyName vhxubo.com

; --- Settings ---
AppName := "BackDimmer"
AppVersion := "v1.0.0"
IniFile := AppName ".ini"

; --- Config Initialization ---
if !FileExist(IniFile) {
    FileAppend("[Settings]`nbackcolor=000000`ntransparency=180`nversion=" AppVersion, IniFile)
}

BackColor := IniRead(IniFile, "Settings", "backcolor", "000000")
Trans     := IniRead(IniFile, "Settings", "transparency", 180)

; --- Monitor Geometry Logic ---
vX := SysGet(76)
vY := SysGet(77)
vW := SysGet(78)
vH := SysGet(79)

; Aggressive redundancy to eliminate scaling gaps
FinalW := vW * 1.5
FinalH := vH * 1.5
FinalX := vX - 100
FinalY := vY - 100

; --- Create UI Layer ---
BgGui := Gui("-Caption +ToolWindow +E0x20", AppName "Window")
BgGui.BackColor := BackColor

; Show layer without stealing focus
BgGui.Show("x" FinalX " y" FinalY " w" FinalW " h" FinalH " NoActivate")
WinSetTransparent(Trans, BgGui.Hwnd)

; --- Forced Bottom Logic ---
SetTimer(MaintainBottom, 500)

MaintainBottom() {
    try {
        ; HWND_BOTTOM = 1, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE = 0x13
        DllCall("SetWindowPos", "Ptr", BgGui.Hwnd, "Ptr", 1, "Int", 0, "Int", 0, "Int", 0, "Int", 0, "UInt", 0x13)
    }
}

; --- Tray Menu ---
A_TrayMenu.Delete()
A_TrayMenu.Add(AppName " " AppVersion, (*) => ({}))
A_TrayMenu.Disable(AppName " " AppVersion)
A_TrayMenu.Add() 
A_TrayMenu.Add("Edit Config", (*) => Run(IniFile))
A_TrayMenu.Add("Reload Script", (*) => Reload())
A_TrayMenu.Add("Exit", (*) => ExitApp())