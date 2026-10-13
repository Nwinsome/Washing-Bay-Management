# Washing-Bay-Management

An Electron, React and TypeScript desktop application with local SQLite storage.

## Run in PowerShell

```powershell
npm.cmd run dev
```

This starts Vite and opens Electron after the renderer is ready. To use the built application:

```powershell
npm.cmd run build
npm.cmd start
```

## Setup, login and overview

On first use, complete business setup and create an administrator. Then sign in with that account. Only active administrators can access the overview. Passwords are verified against bcrypt hashes in the main process; no password hashes or session tokens are sent to the renderer. Sessions stay in memory, belong to one Electron window, expire after 30 minutes without a protected API request, and end on sign-out, full navigation, renderer failure or app closure. Five unsuccessful credential checks block further attempts in that window for one minute.

The dashboard reads existing records; it does not create example transactions. It shows work completed today, registered vehicles waiting/in progress, actual completed payments received today, outstanding balances excluding cancelled work, expenses, customers, active workers/services, and the eight most recent transactions. Dates use Africa/Accra (UTC). Cancelling work does not erase previously received payments; refunds are a separate workflow. Legacy visits use their creation date when a completion timestamp was never recorded. Collected payments are not accounting profit. The stored business currency is respected; new setups use GHS.

The services panel configures independent prices. Visit entry is on the **Visits** page. Choose exactly one Washing OR Blowing service for a registered vehicle visit, never both. Carpet cleaning remains independently priced and optional, including standalone carpet cleaning without a vehicle. Workers can wash on one visit and blow on another. User management, compensation configuration screens, password recovery, and other operational screens are not implemented in this phase. There is no default login or password bypass. A business with no usable administrator requires a separately designed recovery workflow; setup is not reset automatically.

## Vehicle categories and flexible service pricing

Application initialization applies `schema.sql` and `catalog.sql` together in a SQLite transaction. The catalogue adds only the 43 vehicle category names supplied by the business and the four vehicle service names: Wash, Blow, Engine Wash and Under Wash. It contains no prices, customers, workers, visits or payments. Existing Washing/Blowing service classifications and recognized Engine/Under Wash services are reused. Existing category names match without case/space differences (including 4×4/4x4). Preset-to-category ID bindings ensure that renaming or deactivating a supplied category does not cause its original name to be recreated on later launches. Existing duplicates are retained for review rather than merged or deleted.

On **Overview**, the **Services, categories and pricing** panel provides a searchable category/service matrix and price editor. Each category/service combination can have an administrator-entered GHS price, be marked **Unavailable**, or explicitly set **Not configured**. A configured GHS 0 is a valid free service. Unavailable and unconfigured entries cannot be charged; changing their status does not delete the prior price row. New vehicle service charges require an explicit price for that category: legacy general vehicle-service prices are preserved but no longer used as automatic fallbacks. Independent services such as carpet cleaning can retain a general price without a vehicle registration. Existing non-GHS business currencies are preserved; new price writes remain blocked until GHS pricing is intentionally configured.

The same panel lets administrators add, rename, deactivate or reactivate categories. Registration and visit category selectors are searchable. Inactive categories are omitted from new registration choices and cannot be used for new visits; vehicles already referencing an inactive category can still have their other details edited. Renaming retains IDs and category-specific prices, while historical visit category names remain in snapshots.

Wash and Blow are alternative main services. Engine Wash and Under Wash are optional vehicle extras that require a vehicle visit with exactly one main service, and are not offered as standalone non-vehicle work. Each chosen main/extra/independent service is stored as a separate line with its own original price and worker assignment and is shown in visit/payment details. Workers can be shared across lines or different workers can perform them. Stable `service_roles` and `transaction_service_roles` metadata extend the existing service classifications without rebuilding or changing historical service/price tables. `service_category_options` stores category availability separately from price amounts. Catalogue migrations never copy prices from photographs or seed default prices.

## Customer visits and payments

Open **Visits** to find an existing vehicle by normalized plate or register a new vehicle with its first visit. New vehicle registration and visit creation commit together or roll back together. Choose exactly one vehicle service, optionally add independently priced services, and assign an active worker to the vehicle service. Carpet cleaning can be recorded without registration and supports an optional worker where applicable. Workers may serve multiple visits; no permanent service role or invented commission is applied. Prices appear automatically in GHS, and saving checks that the reviewed service/worker/compensation details still match current configuration.

Visits start **Waiting** (the existing database status `pending`). Waiting can move to In progress, Completed or Cancelled; In progress can move to Completed or Cancelled. Completed and Cancelled are terminal in this phase. Arrival, start, completion and cancellation times plus an append-only status history are recorded in Ghana/UTC time. Work completion does not require payment and payment does not complete work. Historical names, assignments, prices, configured earnings and vehicle snapshots remain stored values.

The payment form records full or partial amounts actually received, using cash, card, mobile money, bank transfer or other, with date and optional reference. Unpaid visits simply have no received payment. Multiple receipts can be recorded up to the outstanding balance. Amounts are entered in GHS and sent as integer pesewas; `visit_details.total_pesewas` and `payment_receipts.amount_pesewas` are authoritative for new records. Existing REAL amount columns remain intact for compatibility. Legacy balances derive cents from their stored amounts without rewriting them. Pending, failed and refunded legacy payments are not counted as received/credited payments.

Creation and payment submission keys are unique. Retrying the same key/payload returns the existing record; reusing a key for different details fails. Payment writes use immediate SQLite transactions and check the current outstanding balance inside the transaction. Mutation, receipt/metadata and audit records commit atomically. The interface disables duplicate submissions while saving and retains the same payload/key for retry. A new key represents a separate intentional receipt; no unsupported matching or splitting rules are inferred from amount/reference alone.

Cancelled work has no collectible outstanding balance, but existing receipts remain in history and collected totals. Cancellation does not refund money. Refunds, reopening terminal visits, company/customer credit-account terms, shared earnings, taxes/discount entry and shared payroll workflows require separately confirmed rules. Worker service payouts are available in Worker Earnings. There is no existing company credit ledger to extend; the company table alone is not treated as an accounting policy. Existing currency is never changed automatically: this new pricing/payment workflow accepts GHS only; legacy records in another currency remain readable, and conversion needs explicit configuration.

The additive tables `visit_details`, `visit_status_events`, and `payment_receipts` extend the existing `transactions`, `transaction_services`, `transaction_service_workers`, and `payments` records; they do not create duplicate visits. `visit_balances` provides integer totals, paid amounts and outstanding balances. Existing credentials, businesses, vehicles, workers, prices, transactions and payments are untouched by schema reapplication. New records cannot be deleted through this API. The former direct `transactions:create` endpoint rejects requests so it cannot bypass the new lifecycle; transaction reads and pricing quotes remain available for historical compatibility. Old records without tracked events/timestamps are identified as legacy rather than assigned fictional history.

## Workers management

Open **Workers** in the dashboard navigation to register, search, edit, activate or deactivate workers. Registration requires a full name and phone number; email, descriptive job title and hire date are optional. The directory searches name, phone, email and job title, filters by status, and displays 50 workers per page. New workers are active and available to the service assignment picker. Deactivation removes them from new assignment choices while preserving historical visits and payments. Reactivation makes them available again. Editing details does not change the worker ID, status or existing pay rate.

Worker registration uses the existing `workers` table and never creates login accounts or permanent service restrictions. No schema change or migration is needed for this module. Every workers IPC operation checks the trusted application sender and current active administrator session before validating input; SQL values use bound parameters. Mutations and audit entries commit atomically. There is no worker deletion endpoint. Historical assignment names, service prices, rules and earnings remain stored separately from editable worker details. Multiple workers can be assigned across the service lines of one visit (for example, washing and carpet cleaning); washing and blowing remain mutually exclusive on a single vehicle visit.

Compensation configuration, earnings history and service payouts are available in Worker Earnings. Assigning multiple workers to the same service line remains future work. The current service-line model supports one assigned worker per line. Worker-management tests use isolated in-memory fixtures and never seed the real business database.

## Vehicle registration and management

Open **Vehicles** from the sidebar to add, search, edit, archive or activate registered vehicles. Number plate and an existing configurable vehicle category are required; make, model, colour and customer name/phone are optional. The supplied category names are initialized without prices; additional categories can be added from the registration form. The directory searches plates, names and phone numbers, filters by status/type, and displays 50 vehicles per page. Entering a plate checks for returning vehicles automatically and offers their existing record.

New plate displays are uppercase with collapsed spaces. Matching ignores case, spaces and hyphens. New registrations and plate changes are checked by authenticated IPC and SQLite triggers, including matches with archived records: reactivate and reuse those records instead of registering again. Existing legacy vehicles are never merged or automatically archived; ambiguous normalized matches are shown for review. New plates support ASCII letters, digits, spaces and hyphens; existing plate text remains untouched by migration.

The existing `vehicles`, `vehicle_types`, `customers` and `transactions` tables remain intact. Additive `vehicle_record_state` stores archive status and optional vehicle-specific contact details. Legacy contacts come from the existing customer link unless explicitly edited in the Vehicles form. Phone-only contacts do not require a fabricated customer name, and editing contacts does not alter shared customer records or create customer accounts. Registration never creates transactions, payments or fictional customer rows. Archive and activate operations preserve vehicle IDs and all visit links; no vehicle deletion endpoint is exposed.

In the existing visit form, find a registered vehicle by plate and use its recorded type for pricing. New visits can reuse the same active vehicle repeatedly; archived vehicles cannot be selected for new visits. Independent service prices and worker assignments are retained. `transaction_vehicle_snapshots` preserves the plate, type name, details and contact recorded for each linked visit; transaction reads and recent dashboard visits use snapshots. Migration captures the currently available details for older linked visits with `provenance='migration'`; it cannot recover changes made before snapshots existed. Reapplying the schema never replaces these snapshots. Database initialization now applies the schema atomically. Other business and financial records remain untouched.

## Service assignments and compensation model

Each visit has one `transactions` record and separate `transaction_services` lines. `transaction_service_workers` links a worker to an individual line and stores the worker name, compensation method/rate and calculated earnings at recording time. It does not restrict which services a worker may perform. Existing `transaction_workers` visit-level links remain untouched; their service allocation cannot be inferred.

`service_definitions` gives each service a stable classification: washing, blowing, carpet cleaning or other. Recognized existing names (Wash/Washing, Blow/Blowing, Carpet cleaning, ignoring case and outer whitespace) are classified without rewriting business records; custom names can be classified through service configuration. Established classifications remain fixed even after renaming. The interface uses one radio group for washing/blowing, the quote/create API rejects multiple vehicle services, and a SQLite trigger rejects conflicting service lines, including writes outside the API.

New lines snapshot their classification in `transaction_service_details`. Future reports should read `visit_service_records` and the stored assignment/price/earning records, rather than join current service prices or infer services from worker roles. Legacy lines retain their original records and names; the reporting view identifies them with `legacy_record=1` and uses their recorded service names for classification. Old visits containing both washing and blowing remain readable as historical exceptions and must not be merged, split or repriced. New visits cannot record that combination.

The prepared `service_compensation_rules` model supports an explicitly configured fixed amount per service unit or a percentage of that service's line total, rounded to the nearest currency cent. No compensation rules are seeded, and `workers.pay_rate` is not reinterpreted. An assigned service without a rule has NULL compensation and earnings (unconfigured), distinct from an explicit zero rate. The current recording flow uses one unit per selected service. These assignment-time values remain estimates for compatibility; Worker Earnings uses separate immutable completion-time snapshots. Worker payments remain separate from earned amounts. Completed assignment snapshots are read from their stored records, never recalculated from current prices or rules. The schema additions are safe to apply repeatedly and do not reset existing tables or business data.

## Worker earnings and compensation

Open **Worker Earnings** from the sidebar to configure compensation, search workers, filter activity dates, inspect completed-service breakdowns and payment history, and record worker payouts. Activity is paginated in groups of 50. Date filters affect displayed activity totals; payable balances always include all confirmed work and verified payouts. Inactive workers retain their earned balances.

Configure a general fixed GHS amount per service or percentage of that service's recorded charge. Category rules override the general rule; **Use general rule** removes an override and **Unconfigured** explicitly prevents fallback. No rules, rates or amounts are seeded. Fixed amounts use integer pesewas; percentage rates use integer basis points (two decimal places of percent, 0–100%). Percentage earnings round to the nearest pesewa, with half pesewas rounded up, using BigInt arithmetic. Explicit zero rules are valid and distinct from missing rules. The existing general-rule table remains intact; unsupported legacy precision is flagged as unconfigured rather than silently rounded into earnings.

Completion atomically records an immutable snapshot per assigned service line in `worker_service_earnings`, including worker/service/category names, recorded charge, quantity, compensation rule, arrangement and earned pesewas. Pending, in-progress and cancelled work does not accrue earnings. Repeated completion cannot accrue again. Rules and worker arrangements applicable at completion determine confirmed earnings. The original assignment-time estimates remain preserved for compatibility and are labelled as estimates in Visits. New visits also snapshot their category, so later vehicle/category edits cannot change the category used for compensation. Missing rules remain unconfigured, rather than confirmed zero earnings. Customer receipts never determine worker earnings.

Daily and monthly salary agreements accept an explicitly entered amount. Salary work excludes per-service accrual and retains the agreement snapshot separately from service balances. **Automatic salary accrual and salary payouts are unavailable:** the system lacks attendance, payable-day/period, effective-date and proration rules. No salary obligations are generated. Returning to service compensation affects future completions without changing history.

Payouts reuse `worker_payments`, with additive `worker_payout_receipts` for integer pesewas, GHS currency, method, reference and a unique submission key. Immediate transactions commit payment, receipt and audit together and enforce both the current confirmed balance and earnings available by the payment date. Overpayment, future dates and invalid amounts are rejected. Retrying the same key/payload returns the same payout; changing the payload with that key fails. The renderer retains a pending key when a request fails. New keys represent separate intentional payouts; amount/reference alone cannot identify duplicates. Advances, salary payouts and automatic expense posting are unsupported. Worker earnings, worker payouts, customer collections and business expenses remain distinct.

Older completed visits are not recalculated using current rules. Existing estimates and visit-level assignments are preserved. Completed service assignments without a completion ledger are flagged for review and excluded from confirmed earnings. Historical worker payments without verified receipts appear as unclassified amounts with unverified currency. **New payouts for those workers are blocked pending a separately defined reconciliation workflow**, preventing old payments from being misclassified or counted twice. Unknown historical categories require review when category overrides could change compensation. Initialization is additive and idempotent. All earnings IPCs, including reads, require the trusted sender and an active administrator session.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Tests use in-memory SQLite databases and mocked Electron/file storage. They do not open your business database. The test helper requires Node.js with `node:module.stripTypeScriptTypes` support (tested with Node 24).

Normal application launches use Electron's existing user-data database. `WASH_BAY_DATABASE_PATH` overrides the database path for isolated testing; this does not redirect business logo storage.
