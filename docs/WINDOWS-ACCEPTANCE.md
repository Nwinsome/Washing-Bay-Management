# Windows deployment acceptance

## Verification completed

On this Windows x64 environment, 142 backend tests and two Electron workflows passed; the workflows were repeated successfully on source, unpacked packaged and installed builds. The actual installer created the executable, uninstall registration and desktop/Start Menu shortcuts in a temporary installation. A same-version reinstall preserved the isolated financial database; uninstall removed registration/shortcuts and preserved isolated SQLite data. This does not replace a clean-machine or different-version upgrade acceptance pass. See [the validation record](PHASE12-VALIDATION.md) for exact files, artifact hash and financial fixture reconciliation.

## Automated coverage

The backend suite validates authentication, input validation, dates, precise money, visit/pricing rules, payment idempotency, worker accrual and actual payouts, signed expense reversals, company allocations, report calculations, historical closing locks, additive migrations and backup integrity/crash recovery. Desktop tests use **temporary databases only**, with the real Electron main process, preload bridge and compiled renderer.

Desktop workflow coverage: setup with a decodable logo; login; category/prices; worker/vehicle registration; Wash with Engine/Under extras and a separate Blow visit; completion; partial/full receipts; company credit and idempotent allocated payment; configured service earnings and idempotent payout; corrected expense; explicitly counted opening cash; closing and duplicate/backdated rejection; dashboard/report reconciliation; verified backup; password/confirmation-gated isolated restore; restored authentication, financial snapshots and restart persistence. Navigation coverage includes every dashboard page, category search, logo display, real CSV download, print-to-PDF, 800×600 resize, logout and unauthorized reports.

Native folder selections and restore consent use deterministic substitutes in automated tests. Logo upload uses the actual file input with a generated test PNG. Printing verifies PDF generation, not a physical printer or print dialog. All amounts are explicit **test fixtures**, never packaged or inserted into operational data. Backend tests separately cover late receipts on a later date; desktop tests verify closed-date rejection and frozen snapshots without changing the computer clock.

## Manual acceptance before distribution

- Install on a clean Windows x64 account; verify installer title, directory selection, Start Menu/desktop shortcuts, uninstall entry and first-run setup. Check behavior without administrator privileges.
- Create administrator credentials. Confirm wrong-password handling, logout, inactivity timeout, account update/session invalidation and restart login. No default password should work.
- Check logo selection/cancellation, damaged-image rejection, replacement/removal and logo display on Settings.
- Check forms, keyboard navigation, all category/worker/vehicle dropdowns, long names, minimum window size and high-DPI displays.
- Disconnect networking and repeat visits, receipts, expenses, closing, company allocation, reporting and backup. Verify no remote asset dependency.
- Open native backup/verification dialogs; test cancellation, external destinations, read-only/disk-full destinations, missing logos and corrupt/incompatible backups.
- On disposable data, test restore cancellations, wrong confirmation/password, replacement, safety-backup location, restored login and interrupted recovery. Never use operational data for destructive acceptance tests.
- Open the print dialog and check an actual printed report/company statement; verify titles, dates, pagination and GHS amounts. Open CSV in the business's spreadsheet software and verify exact values/formula-safe text.
- Install an update over disposable data; compare financial records/settings/closing snapshots and backups. Uninstall and confirm user data survives; reinstall and confirm it is discovered again.
- Check antivirus/SmartScreen behavior. Supply a reviewed branded icon and Windows signing certificate before public distribution.

## Limitations and accounting rules

Windows x64 is the configured target. The current installer is unsigned and uses the existing Washing Bay logo. The original 1.0.0 installer used the default icon; see [current release verification](RELEASE-1.0.2.md) for the new build. No automatic updater is implemented. Clean-machine acceptance, actual native dialogs, physical printing, access permissions and long-running acceptance remain necessary after automated desktop checks.

Current ledgers use integer pesewas. Legacy REAL amounts remain intact and carry reconciliation warnings where required. Opening cash must be explicit or carried from a verified closing. Company credit is debt, not collection. Receipt dates and completion dates are distinct. Salary accrual/payout, refunds, full accrual accounting and net profit remain unimplemented; reports label cash movement/recorded outflow differences instead. Backups are not encrypted or cryptographically signed; only the application's compatible validated format is accepted.
