# Windows branding (1.0.2)

The source logo is `assets/washing-bay-logo.png`. Regenerate the Windows icon with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-windows-icon.ps1
```

The ICO contains 16, 24, 32, 48, 64, 128 and 256 pixel images, preserving the source aspect ratio and transparency. `main.js` uses the icon for the application window and the existing application ID for Windows taskbar grouping. Electron-builder embeds the same icon in the application executable, installer and uninstaller. Desktop and Start Menu shortcuts use the branded executable.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run dist:win
npm.cmd run verify:package
npm.cmd run test:packaged
```

The installer is `release/Washing-Bay-Management-System-1.0.2-Setup-x64.exe`. The NSIS build-time include verifies and retains the generated uninstaller in `release-verification/1.0.2` before embedding it; it adds no install or uninstall actions. Package verification compares the archived icon with the source ICO, checks the actual Windows icon groups and referenced resources in the application executable, installer and generated uninstaller, checks the packaged version and rejects bundled databases and development files, and compares the packaged recovery/main/preload/migration files with current source. Packaged desktop tests exercise the real password-recovery interface with temporary data.

The superseded 1.0.0 installer used an unbranded/default icon; 1.0.1 contained all Washing Bay icon sizes but predates recovery and schema-11 backup compatibility. Both installers, their blockmaps and the old unpacked build are preserved in `release-archive/2026-10-21-before-1.0.2`, outside `release`. The archive includes original SHA-256 checksums.

The historical `wash-bay-manager` user-data directory, application ID and database behavior are retained. Do not run installation QA against an existing business installation; desktop tests use temporary databases. No installer is automatically installed by the build. The release remains unsigned. Windows may cache old shortcut/taskbar icons, especially for existing pinned shortcuts; re-pin the updated installed executable if necessary. Visual shell acceptance should be performed after installing in a disposable Windows account.
