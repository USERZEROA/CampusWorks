[CmdletBinding(DefaultParameterSetName = 'Single')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Single')]
    [ValidatePattern('^CW-DEMO-[a-f0-9]{12}:[a-zA-Z0-9_-]{1,60}$')]
    [string]$TitleToken,
    [Parameter(Mandatory = $true, ParameterSetName = 'Persistent')]
    [switch]$Persistent
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class CampusWorksDemoWindow {
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint first, uint second, bool attach);

    public static IntPtr Find(string token) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((handle, parameter) => {
            if (!IsWindowVisible(handle)) return true;
            StringBuilder title = new StringBuilder(2048);
            GetWindowText(handle, title, title.Capacity);
            if (title.ToString().StartsWith("[" + token + "] ", StringComparison.Ordinal)) {
                found = handle;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool Activate(IntPtr target) {
        if (target == IntPtr.Zero) return false;
        if (GetForegroundWindow() == target && IsZoomed(target)) return true;
        uint ignored;
        uint callerThread = GetCurrentThreadId();
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint targetThread = GetWindowThreadProcessId(target, out ignored);
        bool joinedForeground = false;
        bool joinedTarget = false;
        try {
            if (foregroundThread != 0 && callerThread != foregroundThread)
                joinedForeground = AttachThreadInput(callerThread, foregroundThread, true);
            if (targetThread != 0 && targetThread != callerThread && targetThread != foregroundThread)
                joinedTarget = AttachThreadInput(callerThread, targetThread, true);
            if (!IsZoomed(target)) ShowWindow(target, 3);
            BringWindowToTop(target);
            SetForegroundWindow(target);
            return GetForegroundWindow() == target;
        } finally {
            if (joinedTarget) AttachThreadInput(callerThread, targetThread, false);
            if (joinedForeground) AttachThreadInput(callerThread, foregroundThread, false);
        }
    }
}
'@

function Invoke-DemoWindow([string]$Token) {
    if ($Token -notmatch '^CW-DEMO-[a-f0-9]{12}:[a-zA-Z0-9_-]{1,60}$') {
        return @{ found = $false; foreground = $false; maximized = $false }
    }
    $targetWindow = [CampusWorksDemoWindow]::Find($Token)
    $foregroundConfirmed = [CampusWorksDemoWindow]::Activate($targetWindow)
    return @{
        found = ($targetWindow -ne [IntPtr]::Zero)
        foreground = $foregroundConfirmed
        maximized = (($targetWindow -ne [IntPtr]::Zero) -and [CampusWorksDemoWindow]::IsZoomed($targetWindow))
    }
}

if ($Persistent) {
    while ($null -ne ($requestToken = [Console]::ReadLine())) {
        if ($requestToken -eq '__CLOSE__') { break }
        $responseLine = Invoke-DemoWindow $requestToken | ConvertTo-Json -Compress
        [Console]::WriteLine($responseLine)
        [Console]::Out.Flush()
    }
} else {
    Invoke-DemoWindow $TitleToken | ConvertTo-Json -Compress
}
