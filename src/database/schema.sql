
    CREATE TABLE IF NOT EXISTS business_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      business_name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      tax_rate REAL NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
      logo_path TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier'
        CHECK (role IN ('admin', 'manager', 'cashier')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicle_types (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE,
      email TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      vehicle_type_id INTEGER REFERENCES vehicle_types(id) ON DELETE SET NULL,
      registration_number TEXT NOT NULL UNIQUE,
      make TEXT,
      model TEXT,
      color TEXT,
      year INTEGER CHECK (year IS NULL OR year BETWEEN 1886 AND 9999),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      job_title TEXT,
      hire_date TEXT,
      pay_rate REAL NOT NULL DEFAULT 0 CHECK (pay_rate >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      duration_minutes INTEGER CHECK (
        duration_minutes IS NULL OR duration_minutes >= 0
      ),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS service_definitions (
      service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('washing','blowing','carpet_cleaning','other'))
    );
    -- Classify recognized legacy names without changing names, prices or transactions.
    INSERT OR IGNORE INTO service_definitions(service_id,kind)
      SELECT id, CASE lower(trim(name))
        WHEN 'washing' THEN 'washing' WHEN 'wash' THEN 'washing'
        WHEN 'blowing' THEN 'blowing' WHEN 'blow' THEN 'blowing'
        WHEN 'carpet cleaning' THEN 'carpet_cleaning' ELSE 'other' END FROM services;
    CREATE TRIGGER IF NOT EXISTS classify_new_service AFTER INSERT ON services BEGIN
      INSERT INTO service_definitions(service_id,kind) VALUES(NEW.id,
        CASE lower(trim(NEW.name)) WHEN 'washing' THEN 'washing' WHEN 'wash' THEN 'washing'
        WHEN 'blowing' THEN 'blowing' WHEN 'blow' THEN 'blowing'
        WHEN 'carpet cleaning' THEN 'carpet_cleaning' ELSE 'other' END);
    END;
    CREATE TRIGGER IF NOT EXISTS preserve_service_definition BEFORE UPDATE OF kind ON service_definitions
      WHEN OLD.kind!='other' AND NEW.kind!=OLD.kind
      BEGIN SELECT RAISE(ABORT,'An established service classification cannot be changed.'); END;

    CREATE TABLE IF NOT EXISTS service_prices (
      id INTEGER PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      vehicle_type_id INTEGER NOT NULL
        REFERENCES vehicle_types(id) ON DELETE CASCADE,
      price REAL NOT NULL CHECK (price >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (service_id, vehicle_type_id)
    );

    -- Optional general price; existing vehicle-specific prices remain untouched.
    CREATE TABLE IF NOT EXISTS service_default_prices (
      service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
      price REAL NOT NULL CHECK (price >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      transaction_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
      subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
      discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
      tax REAL NOT NULL DEFAULT 0 CHECK (tax >= 0),
      total REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transaction_services (
      id INTEGER PRIMARY KEY,
      transaction_id INTEGER NOT NULL
        REFERENCES transactions(id) ON DELETE CASCADE,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      service_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      line_total REAL NOT NULL CHECK (line_total >= 0)
    );

    -- New lines keep a stable reporting classification. Legacy lines are not rewritten.
    CREATE TABLE IF NOT EXISTS transaction_service_details (
      transaction_service_id INTEGER PRIMARY KEY REFERENCES transaction_services(id) ON DELETE CASCADE,
      service_kind TEXT NOT NULL CHECK (service_kind IN ('washing','blowing','carpet_cleaning','other'))
    );
    CREATE VIEW IF NOT EXISTS visit_service_records AS
      SELECT l.*, coalesce(d.service_kind,
        CASE lower(trim(l.service_name)) WHEN 'washing' THEN 'washing' WHEN 'wash' THEN 'washing'
          WHEN 'blowing' THEN 'blowing' WHEN 'blow' THEN 'blowing'
          WHEN 'carpet cleaning' THEN 'carpet_cleaning' ELSE 'other' END) AS service_kind,
        CASE WHEN d.transaction_service_id IS NULL THEN 1 ELSE 0 END AS legacy_record
      FROM transaction_services l LEFT JOIN transaction_service_details d ON d.transaction_service_id=l.id;
    CREATE TRIGGER IF NOT EXISTS snapshot_service_kind AFTER INSERT ON transaction_services BEGIN
      INSERT INTO transaction_service_details(transaction_service_id,service_kind)
        VALUES(NEW.id,coalesce((SELECT kind FROM service_definitions WHERE service_id=NEW.service_id),
          CASE lower(trim(NEW.service_name)) WHEN 'washing' THEN 'washing' WHEN 'wash' THEN 'washing'
          WHEN 'blowing' THEN 'blowing' WHEN 'blow' THEN 'blowing'
          WHEN 'carpet cleaning' THEN 'carpet_cleaning' ELSE 'other' END));
    END;
    CREATE TRIGGER IF NOT EXISTS exclusive_vehicle_service BEFORE INSERT ON transaction_service_details
      WHEN NEW.service_kind IN ('washing','blowing') AND EXISTS (
        SELECT 1 FROM visit_service_records existing JOIN transaction_services incoming
          ON incoming.id=NEW.transaction_service_id AND existing.transaction_id=incoming.transaction_id
        WHERE existing.id!=incoming.id AND existing.service_kind IN ('washing','blowing'))
      BEGIN SELECT RAISE(ABORT,'Choose either washing or blowing for one vehicle visit, never both.'); END;
    CREATE TRIGGER IF NOT EXISTS preserve_service_kind BEFORE UPDATE ON transaction_service_details
      BEGIN SELECT RAISE(ABORT,'Recorded service classifications are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS preserve_visit_service BEFORE UPDATE OF transaction_id,service_id,service_name ON transaction_services
      WHEN EXISTS(SELECT 1 FROM transaction_service_details WHERE transaction_service_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Recorded visit service identity is immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS exclusive_vehicle_service_update BEFORE UPDATE OF transaction_id,service_id,service_name ON transaction_services
      WHEN coalesce((SELECT kind FROM service_definitions WHERE service_id=NEW.service_id),
        CASE lower(trim(NEW.service_name)) WHEN 'washing' THEN 'washing' WHEN 'wash' THEN 'washing'
          WHEN 'blowing' THEN 'blowing' WHEN 'blow' THEN 'blowing' ELSE 'other' END) IN ('washing','blowing')
        AND EXISTS(SELECT 1 FROM visit_service_records WHERE transaction_id=NEW.transaction_id
          AND id!=OLD.id AND service_kind IN ('washing','blowing'))
      BEGIN SELECT RAISE(ABORT,'Choose either washing or blowing for one vehicle visit, never both.'); END;

    -- Explicit service compensation; no rule is inferred from workers.pay_rate.
    -- Fixed: amount per service unit. Percentage: percent of the service line total.
    CREATE TABLE IF NOT EXISTS service_compensation_rules (
      service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK (method IN ('fixed', 'percentage')),
      rate REAL NOT NULL CHECK (rate >= 0 AND (method != 'percentage' OR rate <= 100)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Assignments belong to a service line within one visit, never a worker role.
    -- Keep names, rules and calculated earnings independent of later edits.
    CREATE TABLE IF NOT EXISTS transaction_service_workers (
      id INTEGER PRIMARY KEY,
      transaction_service_id INTEGER NOT NULL REFERENCES transaction_services(id) ON DELETE RESTRICT,
      worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
      worker_name TEXT NOT NULL,
      compensation_method TEXT CHECK (compensation_method IN ('fixed', 'percentage')),
      compensation_rate REAL,
      earnings REAL CHECK (earnings IS NULL OR earnings >= 0),
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (transaction_service_id),
      CHECK ((compensation_method IS NULL AND compensation_rate IS NULL AND earnings IS NULL)
        OR (compensation_method IS NOT NULL AND compensation_rate IS NOT NULL AND earnings IS NOT NULL
          AND compensation_rate >= 0 AND (compensation_method != 'percentage' OR compensation_rate <= 100)))
    );
    CREATE INDEX IF NOT EXISTS idx_transaction_service_workers_worker
      ON transaction_service_workers(worker_id);

    -- Legacy visit-level assignments are retained without guessing service allocation.
    CREATE TABLE IF NOT EXISTS transaction_workers (
      transaction_id INTEGER NOT NULL
        REFERENCES transactions(id) ON DELETE CASCADE,
      worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (transaction_id, worker_id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      transaction_id INTEGER NOT NULL
        REFERENCES transactions(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK (amount > 0),
      method TEXT NOT NULL
        CHECK (method IN ('cash', 'card', 'mobile_money', 'bank_transfer', 'other')),
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
      received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS worker_payments (
      id INTEGER PRIMARY KEY,
      worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      period_start TEXT,
      period_end TEXT,
      notes TEXT,
      paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_method TEXT,
      expense_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_closings (
      id INTEGER PRIMARY KEY,
      closing_date TEXT NOT NULL UNIQUE,
      opening_balance REAL NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
      expected_cash REAL NOT NULL DEFAULT 0 CHECK (expected_cash >= 0),
      actual_cash REAL NOT NULL DEFAULT 0 CHECK (actual_cash >= 0),
      variance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id
      ON vehicles(customer_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_type_id
      ON vehicles(vehicle_type_id);
    CREATE INDEX IF NOT EXISTS idx_service_prices_vehicle_type_id
      ON service_prices(vehicle_type_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_customer_id
      ON transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_vehicle_id
      ON transactions(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at
      ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_transaction_services_transaction_id
      ON transaction_services(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transaction_workers_worker_id
      ON transaction_workers(worker_id);
    CREATE INDEX IF NOT EXISTS idx_payments_transaction_id
      ON payments(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_worker_payments_worker_id
      ON worker_payments(worker_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_expense_date
      ON expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
      ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
      ON audit_logs(created_at);

    -- Additive vehicle metadata: partial contacts do not require fictional customers
    -- or edits to customer records shared by other vehicles.
    CREATE TABLE IF NOT EXISTS vehicle_record_state (
      vehicle_id INTEGER PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      contact_override INTEGER NOT NULL DEFAULT 0 CHECK (contact_override IN (0,1)),
      customer_name TEXT,
      customer_phone TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO vehicle_record_state(vehicle_id) SELECT id FROM vehicles;
    CREATE VIEW IF NOT EXISTS vehicle_registry AS
      SELECT v.*,upper(replace(replace(v.registration_number,' ',''),'-','')) AS plate_key,
        coalesce(s.is_active,1) AS is_active,s.updated_at,
        CASE WHEN s.contact_override=1 THEN s.customer_name ELSE c.full_name END AS customer_name,
        CASE WHEN s.contact_override=1 THEN s.customer_phone ELSE c.phone END AS customer_phone,
        vt.name AS vehicle_type_name
      FROM vehicles v LEFT JOIN vehicle_record_state s ON s.vehicle_id=v.id
        LEFT JOIN customers c ON c.id=v.customer_id LEFT JOIN vehicle_types vt ON vt.id=v.vehicle_type_id;
    CREATE TRIGGER IF NOT EXISTS initialize_vehicle_state AFTER INSERT ON vehicles BEGIN
      INSERT INTO vehicle_record_state(vehicle_id) VALUES(NEW.id);
    END;
    CREATE TRIGGER IF NOT EXISTS unique_normalized_vehicle_insert BEFORE INSERT ON vehicles
      WHEN EXISTS(SELECT 1 FROM vehicle_registry WHERE plate_key=upper(replace(replace(NEW.registration_number,' ',''),'-','')))
      BEGIN SELECT RAISE(ABORT,'This number plate is already registered. Reuse or activate the existing vehicle.'); END;
    CREATE TRIGGER IF NOT EXISTS unique_normalized_vehicle_update BEFORE UPDATE OF registration_number ON vehicles
      WHEN upper(replace(replace(NEW.registration_number,' ',''),'-',''))!=upper(replace(replace(OLD.registration_number,' ',''),'-',''))
        AND EXISTS(SELECT 1 FROM vehicle_registry WHERE id!=OLD.id AND plate_key=upper(replace(replace(NEW.registration_number,' ',''),'-','')))
      BEGIN SELECT RAISE(ABORT,'This number plate is already registered.'); END;
    CREATE TRIGGER IF NOT EXISTS unique_active_vehicle BEFORE UPDATE OF is_active ON vehicle_record_state
      WHEN NEW.is_active=1 AND OLD.is_active=0 AND EXISTS(
        SELECT 1 FROM vehicle_registry existing JOIN vehicle_registry incoming ON incoming.id=NEW.vehicle_id
        WHERE existing.id!=incoming.id AND existing.plate_key=incoming.plate_key AND existing.is_active=1)
      BEGIN SELECT RAISE(ABORT,'Another active vehicle already has this number plate.'); END;

    CREATE TABLE IF NOT EXISTS transaction_vehicle_snapshots (
      transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      registration_number TEXT NOT NULL,
      vehicle_type_name TEXT,
      make TEXT,model TEXT,color TEXT,
      customer_name TEXT,customer_phone TEXT,
      provenance TEXT NOT NULL CHECK (provenance IN ('migration','recorded'))
    );
    -- For old visits only the currently stored details are knowable. Never invent
    -- earlier values; mark these explicitly as migration snapshots.
    INSERT OR IGNORE INTO transaction_vehicle_snapshots
      SELECT t.id,v.registration_number,v.vehicle_type_name,v.make,v.model,v.color,
        coalesce(c.full_name,v.customer_name),coalesce(c.phone,v.customer_phone),'migration'
      FROM transactions t JOIN vehicle_registry v ON v.id=t.vehicle_id
        LEFT JOIN customers c ON c.id=t.customer_id;
    CREATE TRIGGER IF NOT EXISTS snapshot_visit_vehicle AFTER INSERT ON transactions
      WHEN NEW.vehicle_id IS NOT NULL BEGIN
      INSERT INTO transaction_vehicle_snapshots
        SELECT NEW.id,v.registration_number,v.vehicle_type_name,v.make,v.model,v.color,
          coalesce(c.full_name,v.customer_name),coalesce(c.phone,v.customer_phone),'recorded'
        FROM vehicle_registry v LEFT JOIN customers c ON c.id=NEW.customer_id WHERE v.id=NEW.vehicle_id;
    END;
    CREATE TRIGGER IF NOT EXISTS preserve_visit_vehicle_snapshot BEFORE UPDATE ON transaction_vehicle_snapshots
      BEGIN SELECT RAISE(ABORT,'Historical vehicle snapshots are immutable.'); END;

    -- Operational metadata extends the existing transaction, never duplicates it.
    CREATE TABLE IF NOT EXISTS visit_details (
      transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE RESTRICT,
      arrival_at TEXT NOT NULL,
      started_at TEXT,completed_at TEXT,cancelled_at TEXT,
      currency TEXT NOT NULL,
      total_pesewas INTEGER NOT NULL CHECK (typeof(total_pesewas)='integer' AND total_pesewas>=0 AND total_pesewas<=9007199254740991),
      creation_key TEXT UNIQUE,
      creation_payload TEXT
    );
    CREATE TABLE IF NOT EXISTS visit_status_events (
      id INTEGER PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      from_status TEXT,to_status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visit_events_transaction ON visit_status_events(transaction_id,id);
    CREATE TABLE IF NOT EXISTS payment_receipts (
      payment_id INTEGER PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
      submission_key TEXT NOT NULL UNIQUE,
      submission_payload TEXT NOT NULL,
      amount_pesewas INTEGER NOT NULL CHECK (typeof(amount_pesewas)='integer' AND amount_pesewas>0 AND amount_pesewas<=9007199254740991)
    );
    CREATE VIEW IF NOT EXISTS visit_balances AS
      SELECT t.id,coalesce(d.total_pesewas,cast(round(t.total*100) AS INTEGER)) AS total_pesewas,
        coalesce(p.paid_pesewas,0) AS paid_pesewas,
        CASE WHEN t.status='cancelled' THEN 0 ELSE max(0,coalesce(d.total_pesewas,cast(round(t.total*100) AS INTEGER))-coalesce(p.paid_pesewas,0)) END AS outstanding_pesewas
      FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id
      LEFT JOIN (SELECT p.transaction_id,sum(coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER))) AS paid_pesewas
        FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id WHERE p.status='completed' GROUP BY p.transaction_id) p ON p.transaction_id=t.id;
    CREATE TRIGGER IF NOT EXISTS validate_new_vehicle_visit BEFORE INSERT ON visit_details
      WHEN NEW.creation_key IS NOT NULL BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND vehicle_id IS NOT NULL)
        AND (SELECT count(*) FROM visit_service_records WHERE transaction_id=NEW.transaction_id AND service_kind IN ('washing','blowing'))!=1
        THEN RAISE(ABORT,'A vehicle visit requires exactly one washing or blowing service.') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND vehicle_id IS NULL)
        AND EXISTS(SELECT 1 FROM visit_service_records WHERE transaction_id=NEW.transaction_id AND service_kind IN ('washing','blowing'))
        THEN RAISE(ABORT,'Washing and blowing visits require a registered vehicle.') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM visit_service_records l WHERE l.transaction_id=NEW.transaction_id AND l.service_kind IN ('washing','blowing')
        AND NOT EXISTS(SELECT 1 FROM transaction_service_workers a JOIN workers w ON w.id=a.worker_id AND w.is_active=1 WHERE a.transaction_service_id=l.id))
        THEN RAISE(ABORT,'Assign an active worker to the selected vehicle service.') END;
    END;

    CREATE TABLE IF NOT EXISTS vehicle_type_state (
      vehicle_type_id INTEGER PRIMARY KEY REFERENCES vehicle_types(id) ON DELETE CASCADE,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO vehicle_type_state(vehicle_type_id) SELECT id FROM vehicle_types;
    CREATE TRIGGER IF NOT EXISTS initialize_vehicle_type_state AFTER INSERT ON vehicle_types BEGIN
      INSERT INTO vehicle_type_state(vehicle_type_id) VALUES(NEW.id);
    END;
    CREATE VIEW IF NOT EXISTS vehicle_category_catalog AS
      SELECT t.*,coalesce(s.is_active,1) AS is_active FROM vehicle_types t
      LEFT JOIN vehicle_type_state s ON s.vehicle_type_id=t.id;
    CREATE TABLE IF NOT EXISTS vehicle_category_presets (
      preset_name TEXT PRIMARY KEY,
      vehicle_type_id INTEGER NOT NULL REFERENCES vehicle_types(id) ON DELETE RESTRICT
    );
    CREATE TRIGGER IF NOT EXISTS prevent_duplicate_category_insert BEFORE INSERT ON vehicle_types
      WHEN EXISTS(SELECT 1 FROM vehicle_types WHERE lower(replace(replace(name,' ',''),'×','x'))=lower(replace(replace(NEW.name,' ',''),'×','x')))
      BEGIN SELECT RAISE(ABORT,'A vehicle category with this name already exists.'); END;
    CREATE TRIGGER IF NOT EXISTS prevent_duplicate_category_update BEFORE UPDATE OF name ON vehicle_types
      WHEN NEW.name!=OLD.name AND EXISTS(SELECT 1 FROM vehicle_types WHERE id!=OLD.id AND lower(replace(replace(name,' ',''),'×','x'))=lower(replace(replace(NEW.name,' ',''),'×','x')))
      BEGIN SELECT RAISE(ABORT,'A vehicle category with this name already exists.'); END;

    CREATE TABLE IF NOT EXISTS service_roles (
      service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('main','vehicle_extra','independent')),
      code TEXT NOT NULL CHECK (code IN ('washing','blowing','engine_wash','under_wash','carpet_cleaning','other'))
    );
    INSERT OR IGNORE INTO service_roles(service_id,role,code)
      SELECT s.id,CASE WHEN d.kind IN ('washing','blowing') THEN 'main'
        WHEN lower(trim(s.name)) IN ('engine wash','engine washing','under wash','under washing') THEN 'vehicle_extra' ELSE 'independent' END,
        CASE WHEN d.kind!='other' THEN d.kind WHEN lower(trim(s.name)) IN ('engine wash','engine washing') THEN 'engine_wash'
          WHEN lower(trim(s.name)) IN ('under wash','under washing') THEN 'under_wash' ELSE 'other' END
      FROM services s JOIN service_definitions d ON d.service_id=s.id;
    CREATE TRIGGER IF NOT EXISTS classify_service_role AFTER INSERT ON services BEGIN
      INSERT INTO service_roles(service_id,role,code) VALUES(NEW.id,
        CASE WHEN lower(trim(NEW.name)) IN ('wash','washing','blow','blowing') THEN 'main'
          WHEN lower(trim(NEW.name)) IN ('engine wash','engine washing','under wash','under washing') THEN 'vehicle_extra' ELSE 'independent' END,
        CASE lower(trim(NEW.name)) WHEN 'wash' THEN 'washing' WHEN 'washing' THEN 'washing'
          WHEN 'blow' THEN 'blowing' WHEN 'blowing' THEN 'blowing' WHEN 'engine wash' THEN 'engine_wash' WHEN 'engine washing' THEN 'engine_wash'
          WHEN 'under wash' THEN 'under_wash' WHEN 'under washing' THEN 'under_wash' WHEN 'carpet cleaning' THEN 'carpet_cleaning' ELSE 'other' END);
    END;
    CREATE TRIGGER IF NOT EXISTS sync_service_definition_role AFTER UPDATE OF kind ON service_definitions
      WHEN NEW.kind!='other' BEGIN
      UPDATE service_roles SET role=CASE WHEN NEW.kind IN ('washing','blowing') THEN 'main' ELSE 'independent' END,code=NEW.kind WHERE service_id=NEW.service_id;
    END;
    CREATE TABLE IF NOT EXISTS service_category_options (
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      vehicle_type_id INTEGER NOT NULL REFERENCES vehicle_types(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('available','unavailable','unconfigured')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (service_id,vehicle_type_id)
    );
    CREATE TABLE IF NOT EXISTS transaction_service_roles (
      transaction_service_id INTEGER PRIMARY KEY REFERENCES transaction_services(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('main','vehicle_extra','independent')),
      code TEXT NOT NULL CHECK (code IN ('washing','blowing','engine_wash','under_wash','carpet_cleaning','other'))
    );
    CREATE TRIGGER IF NOT EXISTS snapshot_service_role AFTER INSERT ON transaction_services BEGIN
      INSERT INTO transaction_service_roles(transaction_service_id,role,code)
        SELECT NEW.id,role,code FROM service_roles WHERE service_id=NEW.service_id;
    END;
    CREATE TRIGGER IF NOT EXISTS preserve_service_role_snapshot BEFORE UPDATE ON transaction_service_roles
      BEGIN SELECT RAISE(ABORT,'Recorded service roles are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS validate_extra_service_visit BEFORE INSERT ON visit_details
      WHEN NEW.creation_key IS NOT NULL AND EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND vehicle_id IS NULL)
        AND EXISTS(SELECT 1 FROM transaction_services l JOIN transaction_service_roles r ON r.transaction_service_id=l.id
          WHERE l.transaction_id=NEW.transaction_id AND r.role='vehicle_extra')
      BEGIN SELECT RAISE(ABORT,'Engine Wash and Under Wash require a vehicle visit with a main service.'); END;

    -- Phase 7: additive financial records. No retrospective accrual or default rates.
    CREATE TABLE IF NOT EXISTS category_compensation_rules (
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      vehicle_type_id INTEGER NOT NULL REFERENCES vehicle_types(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK(method IN ('fixed','percentage','unconfigured')),
      rate_units INTEGER CHECK(rate_units IS NULL OR (typeof(rate_units)='integer' AND rate_units>=0 AND rate_units<=9007199254740991)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(service_id,vehicle_type_id),
      CHECK((method='unconfigured' AND rate_units IS NULL) OR (method IN ('fixed','percentage') AND rate_units IS NOT NULL)),
      CHECK(method!='percentage' OR rate_units<=10000)
    );
    CREATE TABLE IF NOT EXISTS worker_salary_agreements (
      worker_id INTEGER PRIMARY KEY REFERENCES workers(id) ON DELETE RESTRICT,
      arrangement TEXT NOT NULL CHECK(arrangement IN ('service','daily_salary','monthly_salary')),
      amount_pesewas INTEGER CHECK(amount_pesewas IS NULL OR (typeof(amount_pesewas)='integer' AND amount_pesewas>0 AND amount_pesewas<=9007199254740991)),
      updated_at TEXT NOT NULL,
      CHECK((arrangement='service' AND amount_pesewas IS NULL) OR (arrangement!='service' AND amount_pesewas IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS visit_category_snapshots (
      transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE RESTRICT,
      vehicle_type_id INTEGER REFERENCES vehicle_types(id) ON DELETE SET NULL,
      category_name TEXT
    );
    CREATE TRIGGER IF NOT EXISTS record_visit_category AFTER INSERT ON transactions BEGIN
      INSERT INTO visit_category_snapshots SELECT NEW.id,v.vehicle_type_id,c.name
        FROM vehicles v LEFT JOIN vehicle_types c ON c.id=v.vehicle_type_id WHERE v.id=NEW.vehicle_id;
    END;
    CREATE TABLE IF NOT EXISTS worker_service_earnings (
      transaction_service_id INTEGER PRIMARY KEY REFERENCES transaction_services(id) ON DELETE RESTRICT,
      worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
      worker_name TEXT NOT NULL,service_name TEXT NOT NULL,category_name TEXT,
      state TEXT NOT NULL CHECK(state IN ('confirmed','unconfigured','salary','review')),
      method TEXT CHECK(method IN ('fixed','percentage')),
      rate_units INTEGER CHECK(rate_units IS NULL OR (typeof(rate_units)='integer' AND rate_units>=0 AND rate_units<=9007199254740991)),
      charge_pesewas INTEGER CHECK(charge_pesewas IS NULL OR (typeof(charge_pesewas)='integer' AND charge_pesewas>=0 AND charge_pesewas<=9007199254740991)),
      quantity INTEGER CHECK(quantity IS NULL OR (typeof(quantity)='integer' AND quantity>0)),
      earned_pesewas INTEGER CHECK(earned_pesewas IS NULL OR (typeof(earned_pesewas)='integer' AND earned_pesewas>=0 AND earned_pesewas<=9007199254740991)),
      arrangement TEXT NOT NULL,salary_pesewas INTEGER,
      rule_source TEXT,reason TEXT,completed_at TEXT NOT NULL,
      CHECK((state='confirmed' AND method IS NOT NULL AND rate_units IS NOT NULL AND earned_pesewas IS NOT NULL AND charge_pesewas IS NOT NULL AND quantity IS NOT NULL)
        OR (state!='confirmed' AND earned_pesewas IS NULL)),
      CHECK(method!='percentage' OR rate_units<=10000)
    );
    CREATE INDEX IF NOT EXISTS idx_worker_earnings_date ON worker_service_earnings(worker_id,completed_at);
    CREATE TRIGGER IF NOT EXISTS immutable_worker_earning BEFORE UPDATE ON worker_service_earnings
      WHEN NOT(NEW.worker_id IS NULL AND OLD.worker_id IS NOT NULL AND NEW.transaction_service_id=OLD.transaction_service_id
        AND NEW.worker_name=OLD.worker_name AND NEW.service_name=OLD.service_name AND NEW.state=OLD.state
        AND NEW.earned_pesewas IS OLD.earned_pesewas AND NEW.rate_units IS OLD.rate_units AND NEW.method IS OLD.method
        AND NEW.charge_pesewas IS OLD.charge_pesewas AND NEW.quantity IS OLD.quantity AND NEW.completed_at=OLD.completed_at
        AND NEW.arrangement=OLD.arrangement AND NEW.salary_pesewas IS OLD.salary_pesewas AND NEW.category_name IS OLD.category_name
        AND NEW.rule_source IS OLD.rule_source AND NEW.reason IS OLD.reason)
      BEGIN SELECT RAISE(ABORT,'Completed worker earnings are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS retain_worker_earning BEFORE DELETE ON worker_service_earnings
      BEGIN SELECT RAISE(ABORT,'Completed worker earnings must be preserved.'); END;
    CREATE TABLE IF NOT EXISTS worker_payout_receipts (
      worker_payment_id INTEGER PRIMARY KEY REFERENCES worker_payments(id) ON DELETE RESTRICT,
      submission_key TEXT NOT NULL UNIQUE,submission_payload TEXT NOT NULL,
      amount_pesewas INTEGER NOT NULL CHECK(typeof(amount_pesewas)='integer' AND amount_pesewas>0 AND amount_pesewas<=9007199254740991),
      method TEXT NOT NULL CHECK(method IN ('cash','card','mobile_money','bank_transfer','other')),
      reference TEXT,currency TEXT NOT NULL CHECK(currency='GHS')
    );
    CREATE TRIGGER IF NOT EXISTS immutable_worker_payout_receipt BEFORE UPDATE ON worker_payout_receipts
      BEGIN SELECT RAISE(ABORT,'Worker payout receipts are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS retain_worker_payout_receipt BEFORE DELETE ON worker_payout_receipts
      BEGIN SELECT RAISE(ABORT,'Worker payout receipts must be preserved.'); END;
    CREATE TRIGGER IF NOT EXISTS preserve_verified_worker_payment BEFORE UPDATE ON worker_payments
      WHEN EXISTS(SELECT 1 FROM worker_payout_receipts WHERE worker_payment_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Verified worker payouts are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS completed_work_required BEFORE INSERT ON worker_service_earnings
      WHEN NOT EXISTS(SELECT 1 FROM transaction_services l JOIN transactions t ON t.id=l.transaction_id
        WHERE l.id=NEW.transaction_service_id AND t.status='completed')
      BEGIN SELECT RAISE(ABORT,'Worker earnings require completed work.'); END;
    CREATE TRIGGER IF NOT EXISTS preserve_earned_visit_status BEFORE UPDATE OF status ON transactions
      WHEN NEW.status!='completed' AND EXISTS(SELECT 1 FROM transaction_services l JOIN worker_service_earnings e ON e.transaction_service_id=l.id WHERE l.transaction_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Visits with completed earnings cannot be reopened or cancelled.'); END;
    CREATE TRIGGER IF NOT EXISTS preserve_earned_service_charge BEFORE UPDATE OF quantity,unit_price,line_total ON transaction_services
      WHEN EXISTS(SELECT 1 FROM worker_service_earnings WHERE transaction_service_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Completed service charges are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS preserve_recorded_visit_category BEFORE UPDATE ON visit_category_snapshots
      WHEN NOT(NEW.transaction_id=OLD.transaction_id AND NEW.category_name IS OLD.category_name AND NEW.vehicle_type_id IS NULL AND OLD.vehicle_type_id IS NOT NULL)
      BEGIN SELECT RAISE(ABORT,'Recorded visit categories are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS validate_worker_payout_balance BEFORE INSERT ON worker_payout_receipts BEGIN
      SELECT CASE WHEN NEW.amount_pesewas+coalesce((SELECT sum(r.amount_pesewas) FROM worker_payout_receipts r JOIN worker_payments p ON p.id=r.worker_payment_id
        WHERE p.worker_id=(SELECT worker_id FROM worker_payments WHERE id=NEW.worker_payment_id)),0)
        >coalesce((SELECT sum(e.earned_pesewas) FROM worker_service_earnings e WHERE e.state='confirmed'
          AND e.worker_id=(SELECT worker_id FROM worker_payments WHERE id=NEW.worker_payment_id)),0)
        THEN RAISE(ABORT,'Worker payout exceeds confirmed payable earnings.') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM worker_payments p LEFT JOIN worker_payout_receipts r ON r.worker_payment_id=p.id
        WHERE p.worker_id=(SELECT worker_id FROM worker_payments WHERE id=NEW.worker_payment_id) AND p.id!=NEW.worker_payment_id AND r.worker_payment_id IS NULL)
        THEN RAISE(ABORT,'Historical worker payments require reconciliation.') END;
    END;
