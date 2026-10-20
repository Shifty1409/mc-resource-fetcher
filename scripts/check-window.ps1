# Probe top-level windows: existence, visibility, size, title.
# ASCII-only on purpose (PowerShell 5.1 mis-reads UTF-8 without BOM).
# Usage: powershell -NoProfile -File scripts\check-window.ps1 [-TitleLike Minecraft] [-Pid 1234] [-All]
param(
  [string]$TitleLike = 'Minecraft',
  [int]$ProcId = 0,
  [switch]$All
)

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinProbe {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<string> Find(string like, int pidFilter, bool all) {
    var result = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pidFilter != 0 && pid != (uint)pidFilter) return true;
      int len = GetWindowTextLength(h);
      string title = "";
      if (len > 0) {
        var sb = new StringBuilder(len + 1);
        GetWindowText(h, sb, sb.Capacity);
        title = sb.ToString();
      }
      if (!all) {
        if (title.Length == 0) return true;
        if (pidFilter == 0 && like.Length > 0 && title.IndexOf(like, StringComparison.OrdinalIgnoreCase) < 0) return true;
      }
      RECT r; GetWindowRect(h, out r);
      result.Add(string.Format("hwnd=0x{0:X} pid={1} visible={2} iconic={3} size={4}x{5} title={6}",
        h.ToInt64(), pid, IsWindowVisible(h), IsIconic(h), r.Right - r.Left, r.Bottom - r.Top, title));
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
"@

$found = [WinProbe]::Find($TitleLike, $ProcId, $All.IsPresent)
if ($found.Count -eq 0) {
  Write-Output "NO_WINDOW"
} else {
  foreach ($line in $found) { Write-Output $line }
}
