import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getDatabase } from './database';

export const BACKUP_FILE_NAME = 'Fazatak_Main_Backup.json';

const BACKUP_DIRECTORY = Directory.Documents;
const BACKUP_VERSION = '2.0-offline';

const TABLES = [
  { name: 'settings', orderBy: 'key' },
  { name: 'managers', orderBy: 'id' },
  { name: 'customers', orderBy: 'id' },
  { name: 'contracts', orderBy: 'id' },
  { name: 'installments', orderBy: 'id' },
  { name: 'expenses', orderBy: 'id' },
  { name: 'portfolios', orderBy: 'id' },
  { name: 'portfolio_expenses', orderBy: 'id' },
  { name: 'customer_month_statuses', orderBy: 'id' },
  { name: 'installment_postponements', orderBy: 'id' }
];

const LEGACY_TABLE_ALIASES = {
  payments: 'installments',
  custody: 'portfolios',
  custody_expenses: 'portfolio_expenses'
};

const quoteIdentifier = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

const getErrorMessage = (error) => error?.message || String(error);

const getBackupFileOptions = () => ({
  path: BACKUP_FILE_NAME,
  directory: BACKUP_DIRECTORY
});

const normalizeBackupTables = (tables = {}) => {
  const normalized = { ...tables };

  for (const [legacyName, currentName] of Object.entries(LEGACY_TABLE_ALIASES)) {
    if (normalized[currentName] === undefined && Array.isArray(normalized[legacyName])) {
      normalized[currentName] = normalized[legacyName];
    }
  }

  return normalized;
};

const getTableColumns = async (db, tableName) => {
  const result = await db.query(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return (result.values || []).map((column) => column.name);
};

const getRowCount = async (db, tableName) => {
  const result = await db.query(`SELECT COUNT(*) as count FROM ${quoteIdentifier(tableName)}`);
  return Number(result.values?.[0]?.count || 0);
};

const getBackupRowsCount = (tables) => {
  return TABLES.reduce((total, table) => total + (tables[table.name]?.length || 0), 0);
};

const assertBackupShape = (backup) => {
  if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
    throw new Error('ملف النسخة تالف أو غير صالح');
  }

  const normalizedTables = normalizeBackupTables(backup.tables);
  const includedTables = TABLES.filter((table) => normalizedTables[table.name] !== undefined);

  if (includedTables.length === 0) {
    throw new Error('ملف النسخة لا يحتوي على جداول قابلة للاستعادة');
  }

  for (const table of includedTables) {
    const rows = normalizedTables[table.name];

    if (!Array.isArray(rows)) {
      throw new Error(`بيانات جدول ${table.name} غير صالحة`);
    }

    const hasInvalidRow = rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row));
    if (hasInvalidRow) {
      throw new Error(`يوجد صف غير صالح في جدول ${table.name}`);
    }
  }

  return {
    ...backup,
    tables: normalizedTables
  };
};

const parseBackupText = (text) => {
  try {
    return assertBackupShape(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('ملف النسخة ليس ملف JSON صالح', { cause: error });
    }
    throw error;
  }
};

export const exportData = async () => {
  const db = await getDatabase();
  const tables = {};
  const counts = {};

  for (const table of TABLES) {
    try {
      const tableName = quoteIdentifier(table.name);
      const orderBy = quoteIdentifier(table.orderBy);
      const result = await db.query(`SELECT * FROM ${tableName} ORDER BY ${orderBy}`);
      tables[table.name] = result.values || [];
      counts[table.name] = tables[table.name].length;
    } catch (error) {
      console.warn(`Skipping table ${table.name}:`, getErrorMessage(error));
      tables[table.name] = [];
      counts[table.name] = 0;
    }
  }

  return {
    app: 'fazatak',
    version: BACKUP_VERSION,
    fileName: BACKUP_FILE_NAME,
    exportedAt: new Date().toISOString(),
    counts,
    tables
  };
};

const readLocalBackupText = async () => {
  if (!Capacitor.isNativePlatform()) {
    const cached = localStorage.getItem('fazatak_web_backup_cache');
    if (!cached) throw new Error('لا توجد نسخة احتياطية محفوظة محلياً');
    return cached;
  }

  const file = await Filesystem.readFile({
    ...getBackupFileOptions(),
    encoding: Encoding.UTF8
  });

  return file.data;
};

const verifySavedBackup = (sourceBackup, savedBackup) => {
  for (const table of TABLES) {
    const sourceCount = sourceBackup.tables[table.name]?.length || 0;
    const savedCount = savedBackup.tables[table.name]?.length || 0;

    if (sourceCount !== savedCount) {
      throw new Error(`فشل التحقق من جدول ${table.name}`);
    }
  }
};

const writeLocalBackup = async (backup) => {
  const jsonString = JSON.stringify(backup, null, 2);

  if (!Capacitor.isNativePlatform()) {
    localStorage.setItem('fazatak_web_backup_cache', jsonString);
    const savedBackup = parseBackupText(jsonString);
    verifySavedBackup(backup, savedBackup);
    return { size: jsonString.length, mtime: Date.now() };
  }

  try {
    await Filesystem.requestPermissions();
  } catch {
    // Some platforms do not need explicit storage permission.
  }

  await Filesystem.writeFile({
    ...getBackupFileOptions(),
    data: jsonString,
    encoding: Encoding.UTF8,
    recursive: true
  });

  const savedBackup = parseBackupText(await readLocalBackupText());
  verifySavedBackup(backup, savedBackup);

  return Filesystem.stat(getBackupFileOptions());
};

export const importData = async (backup) => {
  const validBackup = assertBackupShape(backup);
  const db = await getDatabase();
  const tableColumns = {};
  const importedTables = TABLES.filter((table) => Array.isArray(validBackup.tables[table.name]));
  let transactionStarted = false;

  try {
    for (const table of importedTables) {
      tableColumns[table.name] = await getTableColumns(db, table.name);
    }

    await db.beginTransaction();
    transactionStarted = true;

    for (const table of [...importedTables].reverse()) {
      await db.run(`DELETE FROM ${quoteIdentifier(table.name)}`, [], false);
    }

    for (const table of importedTables) {
      try {
        await db.run('DELETE FROM sqlite_sequence WHERE name = ?', [table.name], false);
      } catch {
        // sqlite_sequence exists only after AUTOINCREMENT tables have rows.
      }
    }

    for (const table of importedTables) {
      const rows = validBackup.tables[table.name];
      const allowedColumns = new Set(tableColumns[table.name]);

      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => allowedColumns.has(column));

        if (columns.length === 0) {
          throw new Error(`لا توجد أعمدة صالحة للاستيراد في جدول ${table.name}`);
        }

        const placeholders = columns.map(() => '?').join(',');
        const columnList = columns.map(quoteIdentifier).join(',');
        const values = columns.map((column) => row[column] ?? null);

        await db.run(
          `INSERT INTO ${quoteIdentifier(table.name)} (${columnList}) VALUES (${placeholders})`,
          values,
          false
        );
      }
    }

    for (const table of importedTables) {
      const expectedCount = validBackup.tables[table.name].length;
      const actualCount = await getRowCount(db, table.name);

      if (actualCount !== expectedCount) {
        throw new Error(`فشل التحقق بعد الاستيراد لجدول ${table.name}`);
      }
    }

    await db.commitTransaction();
    transactionStarted = false;

    return {
      tablesCount: importedTables.length,
      recordsCount: getBackupRowsCount(validBackup.tables),
      exportedAt: validBackup.exportedAt
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await db.rollbackTransaction();
      } catch (rollbackError) {
        console.warn('Rollback failed:', getErrorMessage(rollbackError));
      }
    }

    console.error('Data import error:', error);
    throw new Error('فشل استيراد البيانات: ' + getErrorMessage(error), { cause: error });
  }
};

const downloadBackupInBrowser = async () => {
  if (typeof document === 'undefined') return false;

  const backup = await exportData();
  const backupText = JSON.stringify(backup, null, 2);
  const blob = new Blob([backupText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = BACKUP_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return true;
};

export const createBackup = async () => {
  try {
    const backup = await exportData();
    const stat = await writeLocalBackup(backup);

    return {
      success: true,
      fileName: BACKUP_FILE_NAME,
      size: stat.size || JSON.stringify(backup).length,
      tablesCount: TABLES.length,
      recordsCount: getBackupRowsCount(backup.tables),
      exportedAt: backup.exportedAt,
      updatedAt: stat.mtime ? new Date(stat.mtime).toISOString() : backup.exportedAt
    };
  } catch (error) {
    console.error('Backup creation error:', error);
    throw new Error('فشل إنشاء النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const shareBackup = async () => {
  try {
    const backup = await createBackup();

    if (!Capacitor.isNativePlatform()) {
      const jsonString = JSON.stringify(backup, null, 2);
      const file = new File([jsonString], BACKUP_FILE_NAME, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: BACKUP_FILE_NAME,
            text: 'نسخة احتياطية من بيانات أقساطي',
            files: [file]
          });
          return {
            ...backup,
            shared: true
          };
        } catch (err) {
          if (err.name === 'AbortError') return { ...backup, shared: true };
        }
      }

      const downloaded = await downloadBackupInBrowser();
      return {
        ...backup,
        shared: false,
        downloaded: Boolean(downloaded)
      };
    }

    const { uri } = await Filesystem.getUri(getBackupFileOptions());
    const canShare = await Share.canShare().catch(() => ({ value: false }));

    if (!canShare.value) {
      const downloaded = await downloadBackupInBrowser();
      if (!downloaded) throw new Error('المشاركة غير مدعومة على هذا الجهاز');

      return {
        ...backup,
        shared: false,
        downloaded: true
      };
    }

    await Share.share({
      title: BACKUP_FILE_NAME,
      text: 'نسخة احتياطية من بيانات أقساطي',
      url: uri,
      files: [uri],
      dialogTitle: 'مشاركة النسخة الاحتياطية'
    });

    return {
      ...backup,
      shared: true
    };
  } catch (error) {
    console.error('Backup share error:', error);
    throw new Error('فشل مشاركة النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const restoreBackup = async () => {
  try {
    return {
      success: true,
      ...(await importData(parseBackupText(await readLocalBackupText())))
    };
  } catch (error) {
    console.error('Backup restore error:', error);
    throw new Error('فشل الاستعادة: ' + getErrorMessage(error), { cause: error });
  }
};

export const restoreBackupFromText = async (text) => {
  try {
    return {
      success: true,
      ...(await importData(parseBackupText(text)))
    };
  } catch (error) {
    console.error('Backup file restore error:', error);
    throw new Error('فشل استيراد ملف النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const deleteBackup = async () => {
  try {
    await Filesystem.deleteFile(getBackupFileOptions());
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes('exist') || message.includes('not found')) {
      return { success: true };
    }

    console.error('Backup delete error:', error);
    throw new Error('فشل حذف النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const checkBackupExists = async () => {
  try {
    const stat = await Filesystem.stat(getBackupFileOptions());
    const backup = parseBackupText(await readLocalBackupText());

    return {
      name: BACKUP_FILE_NAME,
      size: stat.size || JSON.stringify(backup).length,
      createdAt: stat.ctime ? new Date(stat.ctime).toISOString() : backup.exportedAt,
      updatedAt: stat.mtime ? new Date(stat.mtime).toISOString() : backup.exportedAt,
      exportedAt: backup.exportedAt,
      tablesCount: TABLES.filter((table) => Array.isArray(backup.tables[table.name])).length,
      recordsCount: getBackupRowsCount(backup.tables),
      uri: stat.uri
    };
  } catch (error) {
    console.warn('No readable local backup:', getErrorMessage(error));
    return null;
  }
};

export const formatFileSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatDate = (date) => {
  if (!date) return 'غير متوفر';
  return new Date(date).toLocaleString('ar-SA');
};

export const getBusinessRecordsCount = (backupOrPayload) => {
  if (!backupOrPayload) return 0;
  const counts = backupOrPayload.counts || {};
  const tables = backupOrPayload.tables || {};

  const getCount = (name) => {
    if (counts[name] !== undefined) return Number(counts[name]) || 0;
    if (Array.isArray(tables[name])) return tables[name].length;
    return 0;
  };

  return (
    getCount('managers') +
    getCount('customers') +
    getCount('contracts') +
    getCount('installments') +
    getCount('expenses') +
    getCount('portfolios') +
    getCount('portfolio_expenses') +
    getCount('customer_month_statuses') +
    getCount('installment_postponements')
  );
};
