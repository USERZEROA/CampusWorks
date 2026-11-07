[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$cacheDirectory = Join-Path $workspaceRoot '.cache'
$configurationPath = Join-Path $cacheDirectory 'ai-provider.xml'
$statusPath = Join-Path $cacheDirectory 'ai-provider-dialog.status.json'
[System.IO.Directory]::CreateDirectory($cacheDirectory) | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Set-DialogStatus([string] $Status) {
  [System.IO.File]::WriteAllText($statusPath, ('{"status":"' + $Status + '"}'), $utf8)
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CampusWorksProviderWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window); }'
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'CampusWorks API Key'
  $form.ClientSize = New-Object System.Drawing.Size(540, 218)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $true
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $heading = New-Object System.Windows.Forms.Label
  $heading.Text = 'Save your API key securely on this computer'
  $heading.Location = New-Object System.Drawing.Point(22, 18)
  $heading.Size = New-Object System.Drawing.Size(495, 27)
  $heading.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
  $form.Controls.Add($heading)
  $label = New-Object System.Windows.Forms.Label
  $label.Text = 'API key'
  $label.Location = New-Object System.Drawing.Point(22, 66)
  $label.Size = New-Object System.Drawing.Size(90, 27)
  $form.Controls.Add($label)
  $apiKeyInput = New-Object System.Windows.Forms.TextBox
  $apiKeyInput.Location = New-Object System.Drawing.Point(112, 63)
  $apiKeyInput.Size = New-Object System.Drawing.Size(405, 27)
  $apiKeyInput.UseSystemPasswordChar = $true
  $apiKeyInput.MaxLength = 8192
  $form.Controls.Add($apiKeyInput)
  $message = New-Object System.Windows.Forms.Label
  $message.Text = 'Encrypted for your Windows account. This window makes no API calls.'
  $message.Location = New-Object System.Drawing.Point(22, 111)
  $message.Size = New-Object System.Drawing.Size(495, 39)
  $message.ForeColor = [System.Drawing.Color]::DarkSlateGray
  $form.Controls.Add($message)
  $saveButton = New-Object System.Windows.Forms.Button
  $saveButton.Text = 'Save securely'
  $saveButton.Location = New-Object System.Drawing.Point(262, 164)
  $saveButton.Size = New-Object System.Drawing.Size(135, 34)
  $form.Controls.Add($saveButton)
  $cancelButton = New-Object System.Windows.Forms.Button
  $cancelButton.Text = 'Cancel'
  $cancelButton.Location = New-Object System.Drawing.Point(409, 164)
  $cancelButton.Size = New-Object System.Drawing.Size(108, 34)
  $form.Controls.Add($cancelButton)
  $form.AcceptButton = $saveButton
  $form.CancelButton = $cancelButton
  $script:saved = $false
  $saveButton.Add_Click({
    try {
      $apiKey = $apiKeyInput.Text.Trim()
      if ($apiKey.Length -lt 8 -or $apiKey -match '[\r\n]') {
        $message.Text = 'Enter a valid API key without line breaks.'
        $message.ForeColor = [System.Drawing.Color]::DarkRed
        return
      }
      $secureKey = ConvertTo-SecureString -String $apiKey -AsPlainText -Force
      $settings = [pscustomobject]@{ Version = 2; ApiKey = $secureKey }
      $temporaryPath = $configurationPath + '.tmp'
      $settings | Export-Clixml -LiteralPath $temporaryPath -Encoding UTF8
      Move-Item -LiteralPath $temporaryPath -Destination $configurationPath -Force
      $apiKeyInput.Clear()
      $apiKey = $null
      $script:saved = $true
      Set-DialogStatus 'saved'
      $form.Close()
    } catch {
      $message.Text = 'The key could not be encrypted and saved. No credential was printed.'
      $message.ForeColor = [System.Drawing.Color]::DarkRed
    }
  })
  $cancelButton.Add_Click({ $form.Close() })
  $form.Add_Shown({
    # Restore the interactive form even when its console helper starts hidden.
    [CampusWorksProviderWindow]::ShowWindowAsync($form.Handle, 9) | Out-Null
    [CampusWorksProviderWindow]::SetForegroundWindow($form.Handle) | Out-Null
    Set-DialogStatus 'open'
    $form.Activate()
    $apiKeyInput.Focus()
  })
  $form.Add_FormClosed({ if (!$script:saved) { Set-DialogStatus 'cancelled' } })
  [void] $form.ShowDialog()
  $form.Dispose()
} catch {
  Set-DialogStatus 'error'
  exit 1
}
