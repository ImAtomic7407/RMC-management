const path = require('path');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function isSafeIdentifier(identifier) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier);
}

function makeQuoteIdentifier(dialect) {
  const quote = dialect === 'mysql' ? '`' : '"';
  return (identifier) => {
    if (!isSafeIdentifier(identifier)) {
      throw new Error(`Unsafe SQL identifier: ${identifier}`);
    }
    return `${quote}${identifier}${quote}`;
  };
}

function detectDialect() {
  return normalizeText(process.env.RMC_DB_DIALECT || process.env.DB_DIALECT || 'sqlite').toLowerCase();
}

function getMysqlConfig() {
  const host = normalizeText(process.env.MYSQL_HOST || process.env.DB_HOST);
  const user = normalizeText(process.env.MYSQL_USER || process.env.DB_USER);
  const password = String(process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '');
  const database = normalizeText(process.env.MYSQL_DATABASE || process.env.DB_NAME);
  const port = Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306);
  const ssl = normalizeText(process.env.MYSQL_SSL || '').toLowerCase();

  if (!host || !user || !database) {
    throw new Error('MySQL config missing. Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.');
  }

  return {
    host,
    user,
    password,
    database,
    port: Number.isFinite(port) ? port : 3306,
    ssl: ssl === 'true' || ssl === '1' ? {} : undefined
  };
}

async function createDb(options) {
  const dialect = detectDialect();
  const quoteIdentifier = makeQuoteIdentifier(dialect);

  if (dialect === 'mysql') {
    const mysql = require('mysql2/promise');
    const config = getMysqlConfig();
    const pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
      namedPlaceholders: false
    });

    async function run(sql, params = []) {
      const [result] = await pool.execute(sql, params);
      return {
        lastID: Number(result?.insertId || 0),
        changes: Number(result?.affectedRows || 0),
        raw: result
      };
    }

    async function all(sql, params = []) {
      const [rows] = await pool.execute(sql, params);
      return Array.isArray(rows) ? rows : [];
    }

    async function get(sql, params = []) {
      const rows = await all(sql, params);
      return rows[0] || null;
    }

    async function tableExists(tableName) {
      if (!isSafeIdentifier(tableName)) return false;
      const row = await get(
        `SELECT 1 AS ok
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name = ?
         LIMIT 1`,
        [tableName]
      );
      return Boolean(row?.ok);
    }

    async function ensureColumn(tableName, columnName, columnDefinition) {
      if (!isSafeIdentifier(tableName) || !isSafeIdentifier(columnName)) {
        throw new Error('Invalid table or column name.');
      }
      const row = await get(
        `SELECT 1 AS ok
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND column_name = ?
         LIMIT 1`,
        [tableName, columnName]
      );
      if (row?.ok) return;
      await run(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnDefinition}`);
    }

    async function beginTransaction() {
      await run('START TRANSACTION');
    }
    async function commit() {
      await run('COMMIT');
    }
    async function rollback() {
      await run('ROLLBACK');
    }

    return {
      dialect,
      quoteIdentifier,
      run,
      get,
      all,
      tableExists,
      ensureColumn,
      beginTransaction,
      commit,
      rollback,
      close: async () => pool.end(),
      defaults: options?.defaults || {}
    };
  }

  const sqlite3 = require('sqlite3').verbose();
  const dbFile = options?.sqliteFile;
  if (!dbFile) {
    throw new Error('sqliteFile is required for sqlite mode.');
  }
  const sqlite = new sqlite3.Database(dbFile, (err) => {
    if (err) {
      console.error('Database Connection Error:', err.message);
    } else {
      console.log('Connected to the RMC SQLite database.');
    }
  });

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqlite.run(sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ lastID: this.lastID, changes: this.changes, raw: this });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqlite.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row || null);
      });
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqlite.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  async function tableExists(tableName) {
    if (!isSafeIdentifier(tableName)) return false;
    const row = await get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName]
    );
    return Boolean(row?.name);
  }

  async function ensureColumn(tableName, columnName, columnDefinition) {
    if (!isSafeIdentifier(tableName) || !isSafeIdentifier(columnName)) {
      throw new Error('Invalid table or column name.');
    }
    const columns = await all(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
    if (columns.some((column) => column.name === columnName)) return;
    await run(
      `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnDefinition}`
    );
  }

  async function beginTransaction() {
    await run('BEGIN IMMEDIATE TRANSACTION');
  }
  async function commit() {
    await run('COMMIT');
  }
  async function rollback() {
    await run('ROLLBACK');
  }

  return {
    dialect,
    quoteIdentifier,
    run,
    get,
    all,
    tableExists,
    ensureColumn,
    beginTransaction,
    commit,
    rollback,
    close: async () => sqlite.close(),
    defaults: options?.defaults || {}
  };
}

module.exports = {
  createDb,
  detectDialect,
  isSafeIdentifier,
  normalizeText,
  makeQuoteIdentifier
};
