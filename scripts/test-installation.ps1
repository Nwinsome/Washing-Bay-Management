$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installer = Join-Path $workspace 'release/Washing-Bay-Management-System-1.0.0-Setup-x64.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Build the installer first.' }
$guid = & node -e "const {UUID}=require('builder-util-runtime');console.log(UUID.v5('com.washbay.manager',UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')));"
if ($LASTEXITCODE -ne 0) { throw 'Could not determine the installer identity.' }
$registryKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$shortcutName = 'Washing Bay Management System.lnk'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) $shortcutName
$menuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) $shortcutName
if ((Test-Path -LiteralPath $registryKey) -or
    (Test-Path -LiteralPath "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid") -or
    (Test-Path -LiteralPath "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$guid") -or
    (Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $menuShortcut)) {
    throw 'A matching installation or shortcut already exists. Use a disposable Windows account; existing installations will not be replaced.'
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('wash-bay-install-test-' + [Guid]::NewGuid())
$installation = Join-Path $testRoot 'application'
$qaData = Join-Path $testRoot 'data'
New-Item -ItemType Directory -Path $qaData -Force | Out-Null
$oldExecutable = $env:WASH_BAY_PACKAGED_EXE
$oldInstaller = $env:WASH_BAY_TEST_INSTALLER
$oldUserData = $env:WASH_BAY_USER_DATA_PATH
$oldDatabase = $env:WASH_BAY_DATABASE_PATH
$installed = $false
try {
    $env:WASH_BAY_USER_DATA_PATH = $qaData
    $env:WASH_BAY_DATABASE_PATH = Join-Path $qaData 'test.sqlite'
    & (Join-Path $PSScriptRoot 'reinstall-test.ps1') -Installer $installer -Destination $installation
    $installed = $true
    $executable = Join-Path $installation 'Washing Bay Management System.exe'
    if (-not (Test-Path -LiteralPath $executable)) { throw 'Installed executable is missing.' }
    if (-not (Test-Path -LiteralPath $registryKey)) { throw 'Uninstall registration is missing.' }
    if (-not (Test-Path -LiteralPath $desktopShortcut) -or -not (Test-Path -LiteralPath $menuShortcut)) { throw 'Installation shortcuts are missing.' }
    $env:WASH_BAY_PACKAGED_EXE = $executable
    $env:WASH_BAY_TEST_INSTALLER = $installer
    & node (Join-Path $PSScriptRoot 'test-packaged.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application workflow tests failed.' }
    Write-Output 'Installed first-run, financial workflow, same-version update persistence and desktop tests passed.'
    # A disposable SQLite database in isolated user data must survive uninstall.
    & node -e "const Database=require('better-sqlite3');const d=new Database(process.env.WASH_BAY_DATABASE_PATH);d.exec('CREATE TABLE preserved_test(value INTEGER); INSERT INTO preserved_test VALUES(12345)');d.close();"
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated persistence probe.' }
    $before = (Get-FileHash -LiteralPath $env:WASH_BAY_DATABASE_PATH -Algorithm SHA256).Hash
    $uninstaller = Join-Path $installation 'Uninstall Washing Bay Management System.exe'
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
    if ($uninstall.ExitCode -ne 0) { throw 'Uninstall failed.' }
    Start-Sleep -Seconds 3
    if ((Test-Path -LiteralPath $registryKey) -or (Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $menuShortcut)) { throw 'Uninstall left registration or shortcuts.' }
    if ((Get-FileHash -LiteralPath $env:WASH_BAY_DATABASE_PATH -Algorithm SHA256).Hash -ne $before) { throw 'Uninstall changed isolated user data.' }
    $installed = $false
    Write-Output 'Uninstall removed registration/shortcuts and preserved the isolated database.'
} finally {
    if ($installed) { Write-Warning "Installation QA did not finish. Temporary installation retained at $installation; remove it with its own uninstaller." }
    $env:WASH_BAY_PACKAGED_EXE = $oldExecutable
    $env:WASH_BAY_TEST_INSTALLER = $oldInstaller
    $env:WASH_BAY_USER_DATA_PATH = $oldUserData
    $env:WASH_BAY_DATABASE_PATH = $oldDatabase
}
