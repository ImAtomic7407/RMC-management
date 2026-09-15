const { Database } = require('sqlite3');
import * as fs from 'fs';
import * as path from 'path';

const dbFiles = [
  'A:/RMC_Local_Installer/data/exam.db',
  'A:/RMC_Local_Installer/Examination/data/exam.db',
  'A:/RMC_Local_Installer/Examination/examination-backend/prisma/dev.db',
  'A:/RMC_Local_Installer/Examination/examination-backend/prisma/prisma/dev.db',
  'A:/RMC_Local_Installer/portable_suite/data/rmc_pro_database.db',
  'A:/RMC_Local_Installer/data/rmc_pro_database.db',
  'A:/RMC_Local_Installer/payload/server/rmc_pro_database.db',
  'A:/RMC_Local_Installer/portable_suite/server/rmc_pro_database.db',
];

async function inspectDb(file: string) {
  if (!fs.existsSync(file)) {
    console.log(`File does not exist: ${file}`);
    return;
  }
  const stats = fs.statSync(file);
  console.log(`\n=========================================`);
  console.log(`DB FILE: ${file} (Size: ${stats.size} bytes)`);
  console.log(`=========================================`);

  return new Promise<void>((resolve) => {
    const db = new Database(file, (err: any) => {
      if (err) {
        console.log(`Failed to open: ${err.message}`);
        resolve();
        return;
      }
      db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err: any, tables: any[]) => {
        if (err) {
          console.log(`Failed to query tables: ${err.message}`);
          db.close();
          resolve();
          return;
        }

        let pending = tables.length;
        if (pending === 0) {
          db.close();
          resolve();
          return;
        }

        tables.forEach((t) => {
          const tableName = t.name;
          db.all(`SELECT COUNT(*) as count FROM "${tableName}"`, [], (err: any, rows: any[]) => {
            if (!err) {
              const count = rows[0]?.count;
              if (count > 0) {
                console.log(`  Table ${tableName}: ${count} rows`);
                if (tableName === 'exams' || tableName === 'test_launches') {
                  db.all(`SELECT * FROM "${tableName}"`, [], (err: any, records: any[]) => {
                    if (!err && records.length > 0) {
                      console.log(`    Records in ${tableName}:`, records.map(r => ({ id: r.id, title: r.title, status: r.status, created_by: r.created_by })));
                    }
                  });
                }
                if (tableName === 'question_papers' || tableName === 'test_papers') {
                  db.all(`SELECT * FROM "${tableName}"`, [], (err: any, records: any[]) => {
                    if (!err && records.length > 0) {
                      console.log(`    Records in ${tableName}:`, records.map(r => ({ id: r.id, title: r.title, created_by: r.created_by })));
                    }
                  });
                }
              }
            }
            pending--;
            if (pending === 0) {
              setTimeout(() => {
                db.close();
                resolve();
              }, 200);
            }
          });
        });
      });
    });
  });
}

async function run() {
  for (const file of dbFiles) {
    await inspectDb(file);
  }
}

run();
