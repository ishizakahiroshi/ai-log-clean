Option Explicit

' run-hidden.vbs --- generic launcher that runs a PowerShell script hidden
' (no console flash) for Task Scheduler use. Pattern borrowed from
' ShotTTL\scripts\windows\run-hidden.vbs but generalized: the target .ps1
' is passed as the first argument so this single VBS can serve multiple
' scheduled tasks (codex-cleanup-old-sessions, ai-wrappers-cleanup-old-sessions, ...).
'
' Usage from Task Scheduler:
'   Program:   wscript.exe
'   Arguments: "<install-dir>\run-hidden.vbs" "<install-dir>\target.ps1" [extra args...]
'
' Behaviour:
'   - Window style 0 keeps the PowerShell window hidden.
'   - bWaitOnReturn = True so the PowerShell exit code propagates to Task Scheduler.
'   - Arguments are quoted with the CommandLineToArgvW convention so quotes and
'     backslashes survive the wscript -> powershell hop.
'   - Uses absolute powershell.exe path to avoid PATH hijacking.
'   - Logs missing-script errors to %APPDATA%\run-hidden\logs\.

Dim shell, fso
Dim psScript, powerShellExe
Dim arguments, extraArguments, command
Dim exitCode, i, argArray

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count < 1 Then
    LogStartupError "missing script argument (usage: run-hidden.vbs <script.ps1> [args...])"
    WScript.Quit 2
End If

psScript = WScript.Arguments(0)
If Not fso.FileExists(psScript) Then
    LogStartupError "script not found: " & psScript
    WScript.Quit 2
End If

' Use the absolute system path only. Falling back to a bare "powershell.exe"
' would resolve via PATH, opening a PATH-hijacking surface in environments
' where an attacker can drop a binary earlier in PATH than System32.
powerShellExe = fso.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(powerShellExe) Then
    LogStartupError "powershell.exe not found at " & powerShellExe & " (refusing PATH fallback)"
    WScript.Quit 2
End If

' Collect remaining arguments (skip index 0 = the .ps1 path itself)
ReDim argArray(WScript.Arguments.Count - 2)
For i = 1 To WScript.Arguments.Count - 1
    argArray(i - 1) = WScript.Arguments(i)
Next
extraArguments = JoinArguments(argArray)

arguments = "-NoProfile -ExecutionPolicy Bypass -File " & Quote(psScript)
If Len(extraArguments) > 0 Then
    arguments = arguments & " " & extraArguments
End If
command = Quote(powerShellExe) & " " & arguments

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

' CommandLineToArgvW-compatible quoting
Function Quote(value)
    Dim s, i2, ch, backslashes, j, result
    s = CStr(value)
    result = Chr(34)
    i2 = 1
    Do While i2 <= Len(s)
        backslashes = 0
        Do While i2 <= Len(s) And Mid(s, i2, 1) = "\"
            backslashes = backslashes + 1
            i2 = i2 + 1
        Loop
        If i2 > Len(s) Then
            For j = 1 To backslashes * 2
                result = result & "\"
            Next
        ElseIf Mid(s, i2, 1) = Chr(34) Then
            For j = 1 To backslashes * 2
                result = result & "\"
            Next
            result = result & "\" & Chr(34)
            i2 = i2 + 1
        Else
            For j = 1 To backslashes
                result = result & "\"
            Next
            result = result & Mid(s, i2, 1)
            i2 = i2 + 1
        End If
    Loop
    result = result & Chr(34)
    Quote = result
End Function

Function JoinArguments(values)
    Dim result, k
    result = ""
    For k = LBound(values) To UBound(values)
        If Len(result) > 0 Then result = result & " "
        result = result & Quote(CStr(values(k)))
    Next
    JoinArguments = result
End Function

Sub LogStartupError(message)
    Dim appData, logDir, logFile, stream, stamp
    On Error Resume Next
    appData = shell.ExpandEnvironmentStrings("%APPDATA%")
    If Len(appData) = 0 Or appData = "%APPDATA%" Then Exit Sub

    logDir = fso.BuildPath(appData, "run-hidden\logs")
    If Not fso.FolderExists(fso.BuildPath(appData, "run-hidden")) Then
        fso.CreateFolder fso.BuildPath(appData, "run-hidden")
    End If
    If Not fso.FolderExists(logDir) Then
        fso.CreateFolder logDir
    End If

    stamp = FormatDateTime(Now, vbGeneralDate)
    logFile = fso.BuildPath(logDir, "run-hidden_" & Year(Now) & Right("0" & Month(Now), 2) & Right("0" & Day(Now), 2) & ".log")
    Set stream = fso.OpenTextFile(logFile, 8, True)
    If Not stream Is Nothing Then
        stream.WriteLine stamp & " [ERROR] " & message
        stream.Close
    End If
    On Error Goto 0
End Sub
