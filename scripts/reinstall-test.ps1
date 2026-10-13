param([Parameter(Mandatory=$true)][string]$Installer, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$resolvedDestination = [IO.Path]::GetFullPath($Destination)
$temporaryDirectory = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $resolvedDestination.StartsWith($temporaryDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path (Split-Path $resolvedDestination) -Leaf).StartsWith('wash-bay-install-test-')) {
    throw 'Installation QA can only replace its own temporary installation.'
}
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Installer is missing.' }
$process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$resolvedDestination" -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)." }
