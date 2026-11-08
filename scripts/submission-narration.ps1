param(
  [Parameter(Mandatory = $true)][string]$PlanPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$planFile = [IO.Path]::GetFullPath($PlanPath)
$audioDirectory = [IO.Path]::GetFullPath($OutputDirectory)
foreach ($candidatePath in @($planFile, $audioDirectory)) {
  if (-not $candidatePath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use repository-local narration input and output paths.'
  }
}
[void][IO.Directory]::CreateDirectory($audioDirectory)
$plan = Get-Content -LiteralPath $planFile -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $englishVoices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith('en') })
  if ($englishVoices.Count -eq 0) { throw 'Install an English Windows speech voice before recording narration.' }
  $preferredVoice = $englishVoices | Where-Object { $_.VoiceInfo.Name -eq 'Microsoft Zira Desktop' } | Select-Object -First 1
  if (-not $preferredVoice) { $preferredVoice = $englishVoices[0] }
  $speaker.SelectVoice($preferredVoice.VoiceInfo.Name)
  $speaker.Rate = 1
  $speaker.Volume = 100
  $audioItems = @()
  foreach ($segment in $plan.segments) {
    if ($segment.id -notmatch '^[a-z0-9-]+$' -or [string]::IsNullOrWhiteSpace($segment.narration)) { throw 'Invalid narration segment.' }
    $audioPath = Join-Path $audioDirectory ($segment.id + '.wav')
    $speaker.SetOutputToWaveFile($audioPath)
    $speaker.Speak([string]$segment.narration)
    $speaker.SetOutputToNull()
    $audioItems += @{ id = $segment.id; path = $audioPath }
  }
  $manifest = @{ voice = $preferredVoice.VoiceInfo.Name; culture = $preferredVoice.VoiceInfo.Culture.Name; rate = 1; offline = $true; files = $audioItems }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $audioDirectory 'narration-source.json') -Encoding UTF8
} finally { $speaker.Dispose() }
Write-Output ('Created offline English narration for ' + $plan.segments.Count + ' scenes.')
