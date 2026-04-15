# MatSlop UI Test Script — takes screenshots at each step for verification
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-ui.ps1

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UITest {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, IntPtr e);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    public const int LEFTDOWN = 0x02;
    public const int LEFTUP = 0x04;
    public const uint KEYDOWN = 0x0000;
    public const uint KEYUP = 0x0002;
    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(150);
        mouse_event(LEFTDOWN, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(50);
        mouse_event(LEFTUP, 0, 0, 0, IntPtr.Zero);
    }
    public static void KeyPress(byte vk) {
        keybd_event(vk, 0, KEYDOWN, IntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        keybd_event(vk, 0, KEYUP, IntPtr.Zero);
    }
    public static void KeyCombo(byte mod, byte key) {
        keybd_event(mod, 0, KEYDOWN, IntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        keybd_event(key, 0, KEYDOWN, IntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        keybd_event(key, 0, KEYUP, IntPtr.Zero);
        System.Threading.Thread.Sleep(30);
        keybd_event(mod, 0, KEYUP, IntPtr.Zero);
    }
}
"@

$VK_CONTROL = 0x11
$VK_F5 = 0x74
$VK_RETURN = 0x0D
$VK_TAB = 0x09

$screenshotDir = "C:\Users\benki\Documents\RES\projects\MatSlop\test-screenshots"
New-Item -ItemType Directory -Path $screenshotDir -Force | Out-Null
# Clean old screenshots
Get-ChildItem $screenshotDir -Filter "*.png" | Remove-Item -Force

function Take-Screenshot($name) {
    Start-Sleep -Milliseconds 300
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $path = "$screenshotDir\$name.png"
    $bitmap.Save($path)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "  Screenshot: $name"
}

function Focus-MatSlop {
    Get-Process | Where-Object { $_.MainWindowTitle -like '*MatSlop*' } | ForEach-Object {
        [UITest]::SetForegroundWindow($_.MainWindowHandle) | Out-Null
    }
    Start-Sleep -Milliseconds 500
}

function Send-Keys($keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 200
}

# Wait for app
Write-Host "Waiting for MatSlop to launch..."
for ($i = 0; $i -lt 30; $i++) {
    $proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*MatSlop*' }
    if ($proc) { break }
    Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 3
Focus-MatSlop

# ==========================================
# TEST 1: Initial state
# ==========================================
Write-Host "TEST 1: Initial state"
Take-Screenshot "01-initial"

# ==========================================
# TEST 2: Create new .m script via toolbar dropdown
# ==========================================
Write-Host "TEST 2: Create new .m script"
Focus-MatSlop
# Click the New File icon button in toolbar (first icon, ~x=73, y=28)
[UITest]::Click(73, 28)
Start-Sleep -Milliseconds 500
Take-Screenshot "02-new-m-script"

# ==========================================
# TEST 3: Type code in .m script
# ==========================================
Write-Host "TEST 3: Type code in .m script"
Focus-MatSlop
# Click in editor area
[UITest]::Click(400, 200)
Start-Sleep -Milliseconds 500
Send-Keys "x = 1:10;"
Send-Keys "{ENTER}"
Send-Keys "y = x .{^} 2;"
Send-Keys "{ENTER}"
Send-Keys "disp(y)"
Start-Sleep -Milliseconds 500
Take-Screenshot "03-typed-code"

# ==========================================
# TEST 4: Run .m script with F5
# ==========================================
Write-Host "TEST 4: Run .m script with F5"
Focus-MatSlop
[UITest]::KeyPress($VK_F5)
Start-Sleep -Seconds 3
Take-Screenshot "04-after-run"

# ==========================================
# TEST 5: Create new live script via dropdown
# ==========================================
Write-Host "TEST 5: Create new live script"
Focus-MatSlop
# Click the dropdown chevron next to New File (small arrow, ~x=90, y=28)
[UITest]::Click(90, 28)
Start-Sleep -Milliseconds 500
Take-Screenshot "05-dropdown-open"

# Click "Live Script (.mls)" in dropdown (second item, ~x=130, y=60)
[UITest]::Click(130, 60)
Start-Sleep -Milliseconds 800
Take-Screenshot "06-new-livescript"

# ==========================================
# TEST 6: Type code in live script cell
# ==========================================
Write-Host "TEST 6: Type in live script cell"
Focus-MatSlop
# Click in the code cell (center of editor area)
[UITest]::Click(300, 120)
Start-Sleep -Milliseconds 500
Send-Keys "x = 0:0.1:10;"
Send-Keys "{ENTER}"
Send-Keys "y = sin(x);"
Send-Keys "{ENTER}"
Send-Keys "plot(x, y)"
Start-Sleep -Milliseconds 500
Take-Screenshot "07-livescript-with-code"

# ==========================================
# TEST 7: Run live script cell with cell play button
# ==========================================
Write-Host "TEST 7: Run live script cell"
Focus-MatSlop
# Click Run All button at top of live script (the PlayCircle "Run All" button)
# It should be in the ls-toolbar area, roughly x=105, y=75
[UITest]::Click(105, 75)
Start-Sleep -Seconds 4
Take-Screenshot "08-livescript-after-run"

# ==========================================
# TEST 8: Run live script with F5 (should trigger Run All)
# ==========================================
Write-Host "TEST 8: Run live script with F5"
Focus-MatSlop
[UITest]::KeyPress($VK_F5)
Start-Sleep -Seconds 4
Take-Screenshot "09-livescript-f5-run"

# ==========================================
# TEST 9: Check command window output
# ==========================================
Write-Host "TEST 9: Check command window"
# Click on Command Window panel area (bottom of screen)
[UITest]::Click(400, 330)
Start-Sleep -Milliseconds 500
Take-Screenshot "10-command-window"

# ==========================================
# TEST 10: Check workspace panel
# ==========================================
Write-Host "TEST 10: Check workspace"
# Workspace is on the right side
Take-Screenshot "11-workspace"

Write-Host ""
Write-Host "=== ALL TESTS COMPLETE ==="
Write-Host "Screenshots saved to: $screenshotDir"
Write-Host "Review each screenshot to verify correct behavior."
