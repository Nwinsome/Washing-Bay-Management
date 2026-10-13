# Phase 12 validation record

## Improvements and confirmed fixes

- Added Windows x64 NSIS packaging with product/version metadata, current-user directory selection, desktop/Start Menu shortcuts and uninstall. User data is outside installed files and is retained on uninstall. Automatic post-install launch is disabled.
- Used an explicit runtime staging tree and package-file allowlist. Checked the final archive for operational databases, test fixtures, secrets and development dependencies. Included the unpacked Windows Node-API SQLite binary and verified it in Electron 44.7.
- Fixed setup accepting image signatures without verifying that Electron can decode the image.
- Fixed setup failing to revalidate its trusted sender after asynchronous password hashing.
- Preserved the original `wash-bay-manager` user-data directory despite the installer product-name change. Added explicit full-directory QA isolation.
- Converted low-level database/system errors to readable messages while retaining trusted closing-rule validation messages. Corrected packaged startup guidance to recommend reinstalling while keeping records.
- Added a production content security policy that blocks network connections, external scripts and frames; all rendered application assets remain local.
- Added real Electron integration workflows, packaged/installed test runners, installation safety checks and deployment/acceptance documentation. Corrected stale README claims and one invalid text-encoding byte.

## Files

Modified: `main.js`, `tests/setup.test.cjs`, `package.json`, `package-lock.json`, `vite.config.ts`, `index.html`, `.gitignore`, `README.md`; regenerated `dist/index.html` (existing compiled JS/CSS remain applicable).

Created: `electron-builder.cjs`, `playwright.config.cjs`, `desktop-tests/workflow.spec.cjs`, `scripts/prepare-desktop.cjs`, `scripts/check-sqlite.cjs`, `scripts/test-packaged.cjs`, `scripts/verify-package.cjs`, `scripts/reinstall-test.ps1`, `scripts/test-installation.ps1`, `docs/WINDOWS-ACCEPTANCE.md`, this validation record. Generated `.desktop-app` staging and `release` artifacts are build outputs, not operational data.

## Results

- Backend suite: **142/142 passed**, including four added setup/data-directory regression tests; no skipped tests.
- Real Electron desktop suite: **2/2 passed** against the source application with production assets.
- Packaged executable: **2/2 passed**, including setup, authenticated financial workflow, backup/isolated restore, persisted restart, navigation, logo, CSV download, PDF generation and resizing.
- TypeScript check: passed. Production build: passed.
- Native SQLite: version 3.53.4 successfully exercised in Electron 44.7.0, Windows x64.
- Final unpacked archive: **84 entries checked**; runtime files/native binary present; forbidden records/secrets/development dependencies absent.
- Runtime dependency audit: **0 reported vulnerabilities**. Build-tool dependency audit: eight moderate advisories in the packaging dependency chain; these packages are excluded from the installer runtime. No high/critical advisories were reported.
- Installer: generated at `release/Washing-Bay-Management-System-1.0.0-Setup-x64.exe`, **112,490,283 bytes**. SHA-256: `EAB29B348EDC8F0190373FE64A95D23A0C4038EBF1AFECA290E1386701DD1AC9`.
- Actual Windows current-user installation: passed in a temporary directory; application executable, uninstall registration and desktop/Start Menu shortcuts verified.
- Installed executable: **2/2 desktop workflows passed**, including first-run setup and a same-version installer reinstallation followed by unchanged restored financial totals/settings/closing snapshots.
- Actual silent uninstall: passed; uninstall registration and shortcuts removed, isolated SQLite database retained byte-for-byte. The QA installation/data directory is retained under the system temporary directory for inspection. No pre-existing installation was replaced.

There are **144 distinct automated tests**: 142 backend tests plus two desktop workflows. The final two desktop workflows passed on source, packaged and installed distributions (**148 successful test executions across those final runs**). Additional installation/shortcut/uninstall checks passed outside the test-runner count. Native dialog choices were mocked; actual dialogs and physical printing were not manually tested. No operational database was restored/reset and no Git commands were run.

## Financial interpretation

The integration fixture explicitly reconciles 9,511 pesewas of completed charges, 4,502 collected, 5,009 outstanding, 1,000 confirmed worker earnings, 500 actual worker payouts, 150 net paid expenses and 1,501 company credit outstanding. Cash is 1,000 received minus 500 payouts minus 150 expenses plus an explicitly counted 1,000 opening float = 1,350 expected/count cash. These are test-only values, not business balances or defaults. Retry keys, expense reversals and company allocation links are checked for single counting; saved closings and reports survive backup/restore and restart unchanged.

Current amounts use exact integer pesewas. Historical records and legacy warnings remain intact. Completion and receipt dates remain separate. Salary configuration creates no inferred accrual/payout. No net profit, refund, depreciation, inventory cost or unconfigured compensation figure is invented.

## Remaining acceptance and limitations

The installer is unsigned and uses the default Electron icon; a reviewed branded icon/signing certificate are still needed. Windows x64 is the sole configured target and automatic updates are not implemented. Native dialogs, physical printing, high-DPI/keyboard usability, offline acceptance with networking disconnected, antivirus behavior and a clean-machine/business acceptance pass remain manual checks. Backups are unencrypted and only the validated compatible application format is accepted. Build-tool moderate advisories remain unresolved. This record does not declare production readiness.
