import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import CryptoJS from 'crypto-js';

const BACKUP_KEY = 'FAZATAK_SECURE_KEY_2026';
const DB_NAME = 'fazatak_db';

let sqlite = null;
let db = null;
let initPromise = null;

export const initDatabase = async () => {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      sqlite = new SQLiteConnection(CapacitorSQLite);
    
    // 1. Consistency Check
    try { await sqlite.checkConnectionsConsistency(); } catch (e) {}

    // 2. Identify Platform
    let platform = 'android';
    try {
      const platformResult = await sqlite.getPlatform();
      platform = platformResult.platform;
    } catch (e) {}
    
    if (platform === 'web') {
      await sqlite.initWebStore();
    }
    
    // 3. Robust Connection Logic
    try {
      const isConn = await sqlite.isConnection(DB_NAME, false);
      if (isConn.result) {
        db = await sqlite.retrieveConnection(DB_NAME, false);
        console.log('Retrieved existing connection');
      } else {
        db = await sqlite.createConnection(DB_NAME, false, 'secret', 1, false);
        console.log('Created new connection');
      }
    } catch (err) {
      console.error('Connection error, attempting fallback...', err);
      // Fallback: try to retrieve anyway if isConnection failed
      try {
        db = await sqlite.retrieveConnection(DB_NAME, false);
      } catch (e) {
        db = await sqlite.createConnection(DB_NAME, false, 'secret', 1, false);
      }
    }
    
    // 4. Guaranteed Open
    try {
      await db.open();
    } catch (e) {
      // Ignore "already open" errors as they are non-fatal
      if (!e.message.toLowerCase().includes('already open')) {
        console.warn('Database open warning (non-fatal):', e.message);
      }
    }
    
    await createTables();
    return db;
    } catch (error) {
      console.error('Database initialization error:', error);
      initPromise = null; // Allow retry
      throw error;
    }
  })();

  return initPromise;
};

const createTables = async () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      is_blacklisted INTEGER DEFAULT 0,
      is_vip INTEGER DEFAULT 0,
      late_payments INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      manager_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_manually_flagged_as_overdue INTEGER DEFAULT 0,
      FOREIGN KEY (manager_id) REFERENCES managers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      capital_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      guarantor_name TEXT,
      guarantor_phone TEXT,
      creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      due_date DATE NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'postponed')),
      actual_paid REAL DEFAULT 0,
      receipt_image_path TEXT,
      paid_at DATETIME,
      is_late INTEGER DEFAULT 0,
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT DEFAULT 'أخرى',
      date DATE DEFAULT CURRENT_DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES 
      ('whatsapp_template', 'مرحباً [الاسم]، نذكركم بموعد دفع القسط بمبلغ [المبلغ] ريال بتاريخ [التاريخ]. شكراً لتعاونكم.'),
      ('biometric_enabled', 'true'),
      ('quick_payment_mode', 'false'),
      ('privacy_mode', 'false'),
      ('hijri_calendar', 'false'),
      ('salary_day_sync', 'false'),
      ('friday_quiet_mode', 'false'),
      ('auto_append_iban', 'false'),
      ('iban_number', ''),
      ('account_type', 'individual'),
      ('business_name', ''),
      ('business_contact', ''),
      ('show_details_on_pdf', 'false'),
      ('show_general_customers', 'true'),
      ('overdue_threshold_days', '30'),
      ('stagnancy_threshold_days', '90');

    CREATE TABLE IF NOT EXISTS portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capital REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date DATE DEFAULT CURRENT_DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
    );
  `;
  
  await db.execute(schema);

  // Ensure manager_id column exists for existing users
  try {
    await db.execute('ALTER TABLE customers ADD COLUMN manager_id INTEGER');
  } catch (e) {}

  // Ensure is_manually_flagged_as_overdue column exists for existing users
  try {
    await db.execute('ALTER TABLE customers ADD COLUMN is_manually_flagged_as_overdue INTEGER DEFAULT 0');
  } catch (e) {}

  // Ensure is_deleted and deleted_at columns exist
  try {
    await db.execute('ALTER TABLE customers ADD COLUMN is_deleted INTEGER DEFAULT 0');
    await db.execute('ALTER TABLE customers ADD COLUMN deleted_at DATETIME');
  } catch (e) {}
};

export const getDatabase = async () => {
  if (!db) {
    console.log('Database not ready, initializing...');
    await initDatabase();
  }
  return db;
};

// Customer Operations
export const customerService = {
  async create(customer) {
    const database = await getDatabase();
    const sql = `INSERT INTO customers (name, phone, is_blacklisted, is_vip, status, manager_id, is_manually_flagged_as_overdue) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const result = await database.run(sql, [
      customer.name, 
      customer.phone || null, 
      customer.is_blacklisted ? 1 : 0, 
      customer.is_vip ? 1 : 0, 
      customer.status || 'active',
      customer.manager_id || null,
      customer.is_manually_flagged_as_overdue ? 1 : 0
    ]);
    return result.changes?.lastId || result.lastId;
  },

  async getAll(activeOnly = false, managerId = null, includeDeleted = false) {
    const database = await getDatabase();
    let sql = `SELECT * FROM customers WHERE 1=1`;
    
    if (!includeDeleted) {
      sql += ` AND (is_deleted IS NULL OR is_deleted = 0)`;
      if (activeOnly) sql += ` AND status = 'active'`;
    }
    
    if (managerId === 'personal') {
      sql += ` AND (manager_id IS NULL OR manager_id = '' OR manager_id = 0)`;
    } else if (managerId !== null && managerId !== undefined) {
      sql += ` AND manager_id = ${managerId}`;
    }
    
    sql += ` ORDER BY created_at DESC`;
    const result = await database.query(sql);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM customers WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async update(id, customer) {
    const database = await getDatabase();
    // Prevent data loss by merging with existing data
    const existing = await this.getById(id);
    if (!existing) {
      console.warn(`Attempted to update non-existent customer: ${id}`);
      return;
    }

    const data = { ...existing, ...customer };
    const sql = `UPDATE customers SET name = ?, phone = ?, is_blacklisted = ?, is_vip = ?, status = ?, manager_id = ?, is_manually_flagged_as_overdue = ? WHERE id = ?`;
    
    // Crucial: preserve manager_id if not explicitly changing it
    const finalManagerId = (customer.manager_id !== undefined) ? customer.manager_id : existing.manager_id;
    const finalFlagged = (customer.is_manually_flagged_as_overdue !== undefined) ? customer.is_manually_flagged_as_overdue : existing.is_manually_flagged_as_overdue;

    await database.run(sql, [
      data.name, 
      data.phone, 
      data.is_blacklisted ? 1 : 0, 
      data.is_vip ? 1 : 0, 
      data.status || 'active', 
      finalManagerId || null,
      finalFlagged ? 1 : 0,
      id
    ]);
  },

  async delete(id) {
    const isRecycleBinEnabled = await settingsService.get('recycle_bin_enabled');
    if (isRecycleBinEnabled === 'true') {
      // Soft delete
      const database = await getDatabase();
      await database.run(`UPDATE customers SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    } else {
      await this.hardDelete(id);
    }
  },

  async hardDelete(id) {
    const database = await getDatabase();
    // Delete all installments for all contracts of this customer
    await database.run(`DELETE FROM installments WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id = ?)`, [id]);
    // Delete all contracts for this customer
    await database.run(`DELETE FROM contracts WHERE customer_id = ?`, [id]);
    // Delete the customer
    await database.run(`DELETE FROM customers WHERE id = ?`, [id]);
  },

  async restore(id) {
    const database = await getDatabase();
    await database.run(`UPDATE customers SET is_deleted = 0, deleted_at = NULL WHERE id = ?`, [id]);
  },

  async autoCleanupDeletedCustomers() {
    try {
      const database = await getDatabase();
      const result = await database.query(`SELECT id FROM customers WHERE is_deleted = 1 AND deleted_at <= date('now', '-7 days')`);
      if (result.values && result.values.length > 0) {
        for (const row of result.values) {
          await this.hardDelete(row.id);
        }
        console.log(`Auto-cleaned ${result.values.length} deleted customers.`);
      }
    } catch (e) {
      console.error('Auto cleanup error:', e);
    }
  },

  async incrementLatePayments(customerId) {
    const database = await getDatabase();
    await database.run(`UPDATE customers SET late_payments = late_payments + 1 WHERE id = ?`, [customerId]);
  },

  async getCreditScore(customerId) {
    const customer = await this.getById(customerId);
    if (!customer) return 'C';
    const late = customer.late_payments || 0;
    if (late === 0) return 'A';
    if (late <= 2) return 'B';
    return 'C';
  },

  // Auto-archive a customer when all their contracts are completed/paid
  async checkAndArchive(customerId) {
    try {
      const customer = await this.getById(customerId);
      if (!customer) return;

      const database = await getDatabase();
    const result = await database.query(
        `SELECT COUNT(*) as active_count FROM contracts WHERE customer_id = ? AND status = 'active'`,
        [customerId]
      );
      const activeCount = result.values?.[0]?.active_count ?? 1;

      if (activeCount === 0 && customer.status === 'active') {
        await db.run(`UPDATE customers SET status = 'archived' WHERE id = ?`, [customerId]);
        console.log(`Customer ${customerId} auto-archived after early settlement.`);
      }
    } catch (err) {
      // Non-fatal: log but don't re-throw so the settlement still reports success
      console.warn('checkAndArchive error (non-fatal):', err);
    }
  }
};

// Contract Operations
export const contractService = {
  async create(contract) {
    const database = await getDatabase();
    const sql = `INSERT INTO contracts (customer_id, title, capital_amount, total_amount, discount_amount, guarantor_name, guarantor_phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const result = await database.run(sql, [
      contract.customer_id, 
      contract.title, 
      contract.capital_amount || 0, 
      contract.total_amount,
      contract.discount_amount || 0, 
      contract.guarantor_name || null, 
      contract.guarantor_phone || null, 
      contract.status || 'active'
    ]);
    return result.changes?.lastId || result.lastId;
  },

  async getByCustomerId(customerId) {
    const database = await getDatabase();
    const sql = `
      SELECT c.*, 
        (SELECT SUM(amount) FROM installments WHERE contract_id = c.id) as total_installments,
        (SELECT SUM(actual_paid) FROM installments WHERE contract_id = c.id) as total_paid
      FROM contracts c
      WHERE c.customer_id = ?
      ORDER BY c.creation_date DESC
    `;
    const result = await database.query(sql, [customerId]);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM contracts WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async update(id, contract) {
    const database = await getDatabase();
    // Prevent data loss by merging with existing data
    const existing = await this.getById(id);
    if (!existing) return;

    const data = { ...existing, ...contract };
    const sql = `UPDATE contracts SET title = ?, capital_amount = ?, total_amount = ?, discount_amount = ?, guarantor_name = ?, guarantor_phone = ?, status = ? WHERE id = ?`;
    await database.run(sql, [
      data.title, 
      data.capital_amount, 
      data.total_amount, 
      data.discount_amount || 0, 
      data.guarantor_name, 
      data.guarantor_phone, 
      data.status || 'active', 
      id
    ]);
  },

  async delete(id) {
    const database = await getDatabase();
    // Delete all installments for this contract
    await database.run(`DELETE FROM installments WHERE contract_id = ?`, [id]);
    // Delete the contract
    await database.run(`DELETE FROM contracts WHERE id = ?`, [id]);
  },

  async applyEarlySettlement(contractId, discountAmount) {
    const database = await getDatabase();
    // Get contract and remaining installments
    const contract = await this.getById(contractId);
    if (!contract) throw new Error('Contract not found: ' + contractId);

    const installments = await installmentService.getByContractId(contractId);
    const unpaidInstallments = installments.filter(i => i.status !== 'paid');

    // Update contract with discount and mark as completed
    await database.run(
      `UPDATE contracts SET discount_amount = ?, status = 'completed' WHERE id = ?`,
      [discountAmount, contractId]
    );

    // Mark all unpaid installments as paid
    for (const inst of unpaidInstallments) {
      await database.run(
        `UPDATE installments SET status = 'paid', actual_paid = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [inst.amount, inst.id]
      );
    }

    // Auto-archive customer if no more active contracts (non-fatal if it fails)
    await customerService.checkAndArchive(contract.customer_id);
  },

  async getRemainingBalance(contractId) {
    const contract = await this.getById(contractId);
    if (!contract) return 0;

    const installments = await installmentService.getByContractId(contractId);
    const totalPaid = installments.reduce((sum, i) => sum + (i.actual_paid || 0), 0);
    const discount = contract.discount_amount || 0;

    return (contract.total_amount || 0) - totalPaid - discount;
  },

  async getTotalRemainingByCustomer(customerId) {
    const contracts = await this.getByCustomerId(customerId);
    let totalRemaining = 0;
    for (const contract of contracts) {
      if (contract.status === 'active') {
        totalRemaining += await this.getRemainingBalance(contract.id);
      }
    }
    return totalRemaining;
  }
};

// Installment Operations
export const installmentService = {
  async create(installment) {
    const database = await getDatabase();
    const sql = `INSERT INTO installments (contract_id, amount, due_date, status) VALUES (?, ?, ?, ?)`;
    const result = await database.run(sql, [
      installment.contract_id, 
      installment.amount, 
      installment.due_date, 
      installment.status || 'pending'
    ]);
    return result.changes?.lastId || result.lastId;
  },

  async getByContractId(contractId) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM installments WHERE contract_id = ? ORDER BY due_date ASC`, [contractId]);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM installments WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async pay(id, actualPaid, receiptPath = null, discount = 0) {
    const installment = await this.getById(id);
    if (!installment) return;

    const database = await getDatabase();
    const totalPaid = actualPaid + discount;
    const currentRemaining = installment.amount - (installment.actual_paid || 0);
    let remaining = totalPaid - currentRemaining;
    
    if (remaining >= 0) {
      // Fully paid or overpaid
      await database.run(
        `UPDATE installments SET status = 'paid', actual_paid = ?, receipt_image_path = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`, 
        [installment.amount, receiptPath, id]
      );
      
      // Distribute excess if any
      if (remaining > 0) {
        const pending = await database.query(
          `SELECT * FROM installments WHERE contract_id = ? AND status = 'pending' AND id != ? ORDER BY due_date ASC`,
          [installment.contract_id, id]
        );
        
        for (const next of pending.values || []) {
          if (remaining <= 0) break;
          const nextRemaining = next.amount - (next.actual_paid || 0);
          const toApply = Math.min(remaining, nextRemaining);
          const newPaid = (next.actual_paid || 0) + toApply;
          
          if (newPaid >= next.amount) {
            await database.run(`UPDATE installments SET status = 'paid', actual_paid = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`, [next.amount, next.id]);
          } else {
            await database.run(`UPDATE installments SET actual_paid = ? WHERE id = ?`, [newPaid, next.id]);
          }
          remaining -= toApply;
        }
      }
    } else {
      // Shortage (partial payment)
      const shortage = Math.abs(remaining);
      const nextPendingResult = await database.query(
        `SELECT * FROM installments WHERE contract_id = ? AND status = 'pending' AND id != ? ORDER BY due_date ASC LIMIT 1`,
        [installment.contract_id, id]
      );
      
      if (nextPendingResult.values?.length > 0) {
        const next = nextPendingResult.values[0];
        // Carry over to next
        await database.run(`UPDATE installments SET amount = amount + ? WHERE id = ?`, [shortage, next.id]);
        // Mark current as paid with what was actually paid
        await database.run(
          `UPDATE installments SET status = 'paid', actual_paid = ?, receipt_image_path = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [(installment.actual_paid || 0) + actualPaid, receiptPath, id]
        );
      } else {
        // Last installment or no next pending, keep as pending and update paid amount
        await database.run(
          `UPDATE installments SET actual_paid = ?, receipt_image_path = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [(installment.actual_paid || 0) + actualPaid, receiptPath, id]
        );
      }
    }
  },

  async undoPay(id) {
    const database = await getDatabase();
    
    // Get installment details first
    const installment = await this.getById(id);
    if (!installment) return;

    // 1. Reset installment status
    const sql = `UPDATE installments SET status = 'pending', actual_paid = 0, paid_at = NULL, receipt_image_path = NULL WHERE id = ?`;
    await database.run(sql, [id]);

    // 2. Reactivate the contract
    await database.run(`UPDATE contracts SET status = 'active' WHERE id = ?`, [installment.contract_id]);

    // 3. Reactivate the customer
    const contract = await contractService.getById(installment.contract_id);
    if (contract) {
      await database.run(`UPDATE customers SET status = 'active' WHERE id = ?`, [contract.customer_id]);
      console.log(`Customer ${contract.customer_id} and Contract ${contract.id} reactivated after undo payment.`);
    }
  },

  async getUpcoming(days = 7) {
    const database = await getDatabase();
    const sql = `
      SELECT i.*, c.title as contract_title, cu.name as customer_name, cu.phone as customer_phone, m.name as manager_name
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN managers m ON cu.manager_id = m.id
      WHERE i.status = 'pending' 
      AND c.status = 'active'
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
      AND i.due_date BETWEEN date('now') AND date('now', '+${days} days')
      ORDER BY i.due_date ASC
    `;
    const result = await database.query(sql);
    return result.values || [];
  },

  async getOverdue() {
    const database = await getDatabase();
    const sql = `
      SELECT i.*, c.title as contract_title, cu.name as customer_name, cu.phone as customer_phone, m.name as manager_name
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN managers m ON cu.manager_id = m.id
      WHERE i.status = 'pending' 
      AND c.status = 'active'
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
      AND i.due_date < date('now')
      ORDER BY i.due_date ASC
    `;
    const result = await database.query(sql);
    return result.values || [];
  }
};

// Expense Operations
export const expenseService = {
  async create(expense) {
    const database = await getDatabase();
    const sql = `INSERT INTO expenses (description, amount, category, date) VALUES (?, ?, ?, ?)`;
    const result = await database.run(sql, [
      expense.description, 
      expense.amount, 
      expense.category || 'أخرى', 
      expense.date || new Date().toISOString().split('T')[0]
    ]);
    return result.changes?.lastId || result.lastId;
  },

  async getAll() {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM expenses ORDER BY date DESC, created_at DESC`);
    return result.values || [];
  },

  async getByCategory(category) {
    const database = await getDatabase();
    if (category === 'الكل') return await this.getAll();
    const result = await database.query(`SELECT * FROM expenses WHERE category = ? ORDER BY date DESC`, [category]);
    return result.values || [];
  },

  async update(id, expense) {
    const database = await getDatabase();
    const existing = await database.query(`SELECT * FROM expenses WHERE id = ?`, [id]);
    const current = existing.values?.[0];
    if (!current) return;

    const data = { ...current, ...expense };
    await database.run(`UPDATE expenses SET description = ?, amount = ?, category = ?, date = ? WHERE id = ?`,
      [data.description, data.amount, data.category, data.date, id]);
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(`DELETE FROM expenses WHERE id = ?`, [id]);
  },

  async getTotal() {
    const database = await getDatabase();
    const result = await database.query(`SELECT SUM(amount) as total FROM expenses`);
    return Math.round(result.values?.[0]?.total || 0);
  },

  async getTotalByCategory(category) {
    const result = await db.query(`SELECT SUM(amount) as total FROM expenses WHERE category = ?`, [category]);
    return Math.round(result.values?.[0]?.total || 0);
  }
};

// Settings Operations
export const settingsService = {
  async get(key) {
    const database = await getDatabase();
    const result = await database.query(`SELECT value FROM settings WHERE key = ?`, [key]);
    return result.values?.[0]?.value || null;
  },

  async set(key, value) {
    const database = await getDatabase();
    await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
  },

  async getWhatsAppTemplate() {
    return await this.get('whatsapp_template') || 'مرحباً [الاسم]، نذكركم بموعد دفع القسط بمبلغ [المبلغ] ريال بتاريخ [التاريخ]. شكراً لتعاونكم.';
  },

  async isBiometricEnabled() {
    return (await this.get('biometric_enabled')) !== 'false';
  }
};

// Dashboard Statistics
export const dashboardService = {
  async getStats() {
    const database = await getDatabase();
    // Only sum total_amount for contracts that are still 'active'
    const totalInstallments = await database.query(`
      SELECT SUM(c.total_amount) as total 
      FROM contracts c
      JOIN customers cu ON c.customer_id = cu.id
      WHERE c.status = 'active' 
      AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    // Only sum payments for installments belonging to 'active' contracts of personal customers
    const totalPaid = await database.query(`
      SELECT SUM(i.actual_paid) as total 
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      WHERE c.status = 'active' AND i.status = 'paid' 
      AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    const totalInstallmentsValue = totalInstallments.values?.[0]?.total || 0;
    const totalPaidValue = totalPaid.values?.[0]?.total || 0;

    return {
      totalInstallments: totalInstallmentsValue,
      totalPaid: totalPaidValue,
      totalRemaining: Math.max(0, totalInstallmentsValue - totalPaidValue)
    };
  },

  async getManagerStats() {
    const database = await getDatabase();
    
    // Get stats only from active contracts linked to managers (visible in UI)
    // This ensures stats match what's actually displayed in the managers section
    const totalInstallments = await database.query(`
      SELECT SUM(c.total_amount) as total 
      FROM contracts c
      JOIN customers cu ON c.customer_id = cu.id
      JOIN managers m ON cu.manager_id = m.id
      WHERE c.status = 'active' 
      AND cu.manager_id IS NOT NULL 
      AND cu.manager_id != 0 
      AND cu.manager_id != ''
      AND cu.status != 'archived'
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    const totalPaid = await database.query(`
      SELECT SUM(i.actual_paid) as total 
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      JOIN managers m ON cu.manager_id = m.id
      WHERE c.status = 'active' AND i.status = 'paid' 
      AND cu.manager_id IS NOT NULL 
      AND cu.manager_id != 0 
      AND cu.manager_id != ''
      AND cu.status != 'archived'
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    const totalInstallmentsValue = totalInstallments.values?.[0]?.total || 0;
    const totalPaidValue = totalPaid.values?.[0]?.total || 0;

    return {
      managerTotalInstallments: totalInstallmentsValue,
      managerTotalPaid: totalPaidValue,
      managerTotalRemaining: Math.max(0, totalInstallmentsValue - totalPaidValue)
    };
  }

};

// Portfolio Operations
export const portfolioService = {
  async create(portfolio) {
    const database = await getDatabase();
    const sql = `INSERT INTO portfolios (name, capital, description) VALUES (?, ?, ?)`;
    const result = await database.run(sql, [
      portfolio.name, 
      portfolio.capital, 
      portfolio.description || null
    ]);
    return result.changes?.lastId || result.lastId;
  },

  async getAll() {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM portfolios ORDER BY created_at DESC`);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM portfolios WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async update(id, portfolio) {
    const database = await getDatabase();
    const existing = await this.getById(id);
    if (!existing) return;

    const data = { ...existing, ...portfolio };
    const sql = `UPDATE portfolios SET name = ?, capital = ?, description = ? WHERE id = ?`;
    await database.run(sql, [data.name, data.capital, data.description, id]);
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(`DELETE FROM portfolios WHERE id = ?`, [id]);
  }
};

// Portfolio Expense Operations
export const portfolioExpenseService = {
  async create(expense) {
    const database = await getDatabase();
    const sql = `INSERT INTO portfolio_expenses (portfolio_id, amount, description, date) VALUES (?, ?, ?, ?)`;
    const result = await database.run(sql, [
      expense.portfolio_id, 
      expense.amount, 
      expense.description || null, 
      expense.date || new Date().toISOString().split('T')[0]
    ]);
    return result.changes?.lastId || result.lastId;
  },

  async getByPortfolioId(portfolioId) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM portfolio_expenses WHERE portfolio_id = ? ORDER BY date DESC, created_at DESC`, [portfolioId]);
    return result.values || [];
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(`DELETE FROM portfolio_expenses WHERE id = ?`, [id]);
  },

  async getStats(portfolioId) {
    const database = await getDatabase();
    const result = await database.query(`SELECT SUM(amount) as total FROM portfolio_expenses WHERE portfolio_id = ?`, [portfolioId]);
    return result.values?.[0]?.total || 0;
  }
};

// Manager Operations
export const managerService = {
  async create(manager) {
    const database = await getDatabase();
    const sql = `INSERT INTO managers (name, phone) VALUES (?, ?)`;
    const result = await database.run(sql, [manager.name, manager.phone || null]);
    return result.changes?.lastId || result.lastId;
  },

  async getAllWithStats() {
    const database = await getDatabase();
    const sql = `
      SELECT 
        m.*,
        (
          SELECT COALESCE(SUM(c.total_amount), 0)
          FROM contracts c
          JOIN customers cu ON c.customer_id = cu.id
          WHERE cu.manager_id = m.id
          AND c.status = 'active'
          AND cu.status != 'archived'
          AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
          AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
        ) as total_contracts,
        (
          SELECT COALESCE(SUM(i.actual_paid), 0)
          FROM installments i
          JOIN contracts c2 ON i.contract_id = c2.id
          JOIN customers cu2 ON c2.customer_id = cu2.id
          WHERE cu2.manager_id = m.id 
          AND c2.status = 'active'
          AND cu2.status != 'archived'
          AND (cu2.is_manually_flagged_as_overdue IS NULL OR cu2.is_manually_flagged_as_overdue = 0)
          AND (cu2.is_deleted IS NULL OR cu2.is_deleted = 0)
        ) as total_paid
      FROM managers m
      ORDER BY m.created_at DESC
    `;
    const result = await database.query(sql);
    
    return (result.values || []).map(m => ({
      ...m,
      total_remaining: Math.max(0, m.total_contracts - m.total_paid)
    }));
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM managers WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(`DELETE FROM managers WHERE id = ?`, [id]);
  },

  async getManagersWithOverdueCount(overdueThreshold = 30) {
    const database = await getDatabase();
    try {
      const sql = `
        SELECT 
          m.*,
          (
            SELECT COUNT(DISTINCT cu.id)
            FROM customers cu
            LEFT JOIN contracts c ON cu.id = c.customer_id
            LEFT JOIN installments i ON c.id = i.contract_id
            WHERE cu.manager_id = m.id 
            AND c.status = 'active'
            AND cu.status != 'archived'
            AND (
              cu.is_manually_flagged_as_overdue = 1
              OR (i.status = 'pending' AND i.due_date < date('now', '-${overdueThreshold} days'))
            )
            AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
          ) as customer_count,
          (
            SELECT COALESCE(SUM(c.total_amount), 0)
            FROM contracts c
            JOIN customers cu ON c.customer_id = cu.id
            WHERE cu.manager_id = m.id
            AND c.status = 'active'
            AND cu.status != 'archived'
            AND EXISTS (
              SELECT 1 FROM installments i 
              WHERE i.contract_id = c.id 
              AND (
                cu.is_manually_flagged_as_overdue = 1
                OR (i.status = 'pending' AND i.due_date < date('now', '-${overdueThreshold} days'))
              )
            )
            AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
          ) as total_contracts,
          (
            SELECT COALESCE(SUM(i.actual_paid), 0)
            FROM installments i
            JOIN contracts c ON i.contract_id = c.id
            JOIN customers cu ON c.customer_id = cu.id
            WHERE cu.manager_id = m.id
            AND c.status = 'active'
            AND cu.status != 'archived'
            AND EXISTS (
              SELECT 1 FROM installments i2
              WHERE i2.contract_id = c.id
              AND (
                cu.is_manually_flagged_as_overdue = 1
                OR (i2.status = 'pending' AND i2.due_date < date('now', '-${overdueThreshold} days'))
              )
            )
            AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
          ) as total_paid
        FROM managers m
        WHERE (
          SELECT COUNT(*) 
          FROM customers cu 
          LEFT JOIN contracts c ON cu.id = c.customer_id
          LEFT JOIN installments i ON c.id = i.contract_id
          WHERE cu.manager_id = m.id 
          AND c.status = 'active'
          AND cu.status != 'archived'
          AND (
            cu.is_manually_flagged_as_overdue = 1
            OR (i.status = 'pending' AND i.due_date < date('now', '-${overdueThreshold} days'))
          )
          AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
        ) > 0
      `;
      const result = await database.query(sql);
      return (result.values || []).map(m => ({
        ...m,
        total_remaining: Math.max(0, (m.total_contracts || 0) - (m.total_paid || 0))
      }));
    } catch (error) {
      console.error('getManagersWithOverdueCount error:', error);
      return [];
    }
  }
};
