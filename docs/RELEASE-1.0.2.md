# Windows release 1.0.2 ? 2026-10-21

Give the customer **Washing-Bay-Management-System-1.0.2-Setup-x64.exe**, from the workspace's release folder. Do not distribute archived installers, the generated uninstaller, or unpacked verification files.

- Size: 113652027 bytes.
- SHA-256: `d11fbd45240ebba0c0d04d492d4b73febbd87a736f84531b28ed35d449a91c85`.
- Target: Windows x64; Electron 44.7.0; application version 1.0.2.
- Signing: unsigned. No certificate was introduced.

## Older artifacts

The original 1.0.0 installer has the unbranded/default icon and fails the current Washing Bay resource check. The original 1.0.1 installer has the Washing Bay logo at all seven sizes but predates password recovery and schema-11 restore compatibility. Both installers, matching blockmaps, and the old unpacked build were moved intact to `release-archive/2026-10-21-before-1.0.2`. All four original installer/blockmap checksums were rechecked against that archive's manifest.

An initial 1.0.2 build candidate passed packaged tests but retained an unused older renderer bundle in staging. It was preserved in `release-archive/2026-10-21-1.0.2-build-candidates/attempt-1` with a DO-NOT-DISTRIBUTE notice. Renderer staging now clears only its checked build-output directory; package verification rejects stale or missing renderer files.

## Checks passed

- TypeScript typecheck and production build.
- All 155 automated tests, including recovery, schema-11 restores, invalid backup rejection, migration failure, staged tampering and interrupted-restore recovery.
- Three desktop workflows against the final unpacked Windows package: persisted financial/backup/restore workflow, navigation/export/window behavior, and username-free password recovery with a saved replacement code followed by successful sign-in.
- Real PE icon groups and referenced RT_ICON resources match the existing Washing Bay ICO at 16, 24, 32, 48, 64, 128 and 256 pixels for the application, installer and generated uninstaller. All three have Windows version resources 1.0.2.0.
- A compile-time NSIS include verified and retained the generated uninstaller before the standard builder script embedded it. It adds no runtime install/uninstall actions.
- Package ASAR contents match current main, preload, authentication, recovery, database migration and renderer sources; Windows SQLite is included. No business databases, test fixtures, secrets or development dependencies are packaged.
- The final installer was read-only extracted with 7-Zip. The embedded application executable, app.asar and native Windows SQLite binary have identical SHA-256 hashes to the tested unpacked files. The 7-Zip trailing-data warning is expected when reading an embedded 7z stream inside NSIS; extraction completed successfully.
- Desktop/Start Menu shortcuts are enabled and the standard NSIS template targets icon index 0 in the branded application executable. The packaged window icon and stable com.washbay.manager taskbar identity match the builder configuration.

## Scope and Windows limits

Tests used isolated temporary databases. No business data was opened or changed. No applications were installed or uninstalled, and no Git commands were run.

Actual installed shortcut/taskbar rendering, existing Windows icon-cache refresh, clean-machine installation, cross-version upgrade, and SmartScreen/antivirus behavior were not verified. Perform those checks in a disposable Windows account before broad deployment. Existing pinned shortcuts may require re-pinning after an update. This build remains unsigned.

Machine-readable hashes and icon evidence are in `release-verification/1.0.2/release-verification.json`. The customer installer and checksum file are in `release`.
