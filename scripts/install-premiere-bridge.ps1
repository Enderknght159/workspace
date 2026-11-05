# Installs the Workspace CEP panel into Premiere Pro.
# Run once. Writes only to the current user's Adobe CEP folder and HKCU.

$ErrorActionPreference = 'Stop'
$source = Resolve-Path (Join-Path $PSScriptRoot '..\integrations\premiere\cep')
$destination = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.workspace.premierebridge'

if (-not (Test-Path $source)) {
  throw "Bridge files not found: $source"
}

if (Test-Path $destination) {
  Remove-Item $destination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item (Join-Path $source '*') $destination -Recurse -Force

# The panel is unsigned, so CEP requires PlayerDebugMode.
foreach ($version in 9..12) {
  $path = "HKCU:\Software\Adobe\CSXS.$version"
  if (-not (Test-Path $path)) {
    New-Item -Path $path -Force | Out-Null
  }
  Set-ItemProperty -Path $path -Name 'PlayerDebugMode' -Value '1' -Type String
}

Write-Host ''
Write-Host 'Workspace Premiere Bridge installed.' -ForegroundColor Green
Write-Host 'Open Premiere, then: Window > Extensions > Workspace Bridge'
Write-Host 'Enter the office folder path once, then click Save.'
Write-Host ''
Write-Host "Path: $destination"
