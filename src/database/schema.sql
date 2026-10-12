
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

    CREATE TABLE IF NOT EXISTS service_prices (
      id INTEGER PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      vehicle_type_id INTEGER NOT NULL
        REFERENCES vehicle_types(id) ON DELETE CASCADE,
      price REAL NOT NULL CHECK (price >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (service_id, vehicle_type_id)
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