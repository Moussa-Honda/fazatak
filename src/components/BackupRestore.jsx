import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_FILE_NAME,
  checkBackupExists,
  createBackup,
  deleteBackup,
  formatDate,
  formatFileSize,
  restoreBackup,
  restoreBackupFromText,
  shareBackup
} from '../services/backupService';

const BackupRestore = ({ isOpen, onClose }) => {
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [backupInfo, setBackupInfo] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);

  async function refreshBackupInfo() {
    const info = await checkBackupExists();
    setBackupInfo(info);
  }

  useEffect(() => {
    let cancelled = false;

    if (isOpen) {
      checkBackupExists().then((info) => {
        if (!cancelled) setBackupInfo(info);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const runAction = async (actionName, action) => {
    setLoading(actionName);
    setError('');
    setMessage('');

    try {
      const result = await action();
      await refreshBackupInfo();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading('');
    }
  };

  const handleCreateBackup = async () => {
    const result = await runAction('backup', createBackup);
    if (result) {
      setMessage(`تم حفظ وتحديث النسخة على الجهاز. عدد السجلات: ${result.recordsCount}`);
    }
  };

  const handleShareBackup = async () => {
    const result = await runAction('share', shareBackup);
    if (result?.downloaded) {
      setMessage('تم تحديث النسخة وتنزيلها على الجهاز.');
    } else if (result) {
      setMessage('تم تحديث النسخة وفتح خيارات المشاركة.');
    }
  };

  const handleDelete = async () => {
    if (!confirm('هل تريد حذف النسخة المحفوظة على الجهاز؟')) return;

    const result = await runAction('delete', deleteBackup);
    if (result) {
      setBackupInfo(null);
      setMessage('تم حذف النسخة المحفوظة.');
    }
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    setError('');
    setMessage('');

    try {
      const text = await file.text();
      setPendingRestore({
        type: 'file',
        fileName: file.name,
        text
      });
    } catch (err) {
      setError('تعذر قراءة ملف النسخة: ' + err.message);
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestore) return;

    const restoreSource = pendingRestore;
    setPendingRestore(null);

    const result = await runAction('restore', async () => {
      if (restoreSource.type === 'file') {
        return restoreBackupFromText(restoreSource.text);
      }

      return restoreBackup();
    });

    if (result) {
      setMessage(`تمت الاستعادة بنجاح. عدد السجلات: ${result.recordsCount}. سيتم إعادة تحميل التطبيق...`);
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  if (!isOpen) return null;

  const isBusy = Boolean(loading);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center modal-safe-area" dir="rtl">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-full overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">النسخ الاحتياطي الأوفلاين</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 grid place-items-center"
            aria-label="إغلاق"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm leading-6">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-sm leading-6">
            {message}
          </div>
        )}

        <div className="mb-5 p-4 bg-slate-800 rounded-xl border border-slate-700/60 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-400 text-sm">اسم الملف</span>
            <span className="text-white font-bold text-sm text-left break-all" dir="ltr">{BACKUP_FILE_NAME}</span>
          </div>

          {backupInfo ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-500">آخر تحديث</p>
                <p className="text-emerald-300">{formatDate(backupInfo.exportedAt || backupInfo.updatedAt)}</p>
              </div>
              <div>
                <p className="text-slate-500">الحجم</p>
                <p className="text-white">{formatFileSize(backupInfo.size)}</p>
              </div>
              <div>
                <p className="text-slate-500">الجداول</p>
                <p className="text-white">{backupInfo.tablesCount}</p>
              </div>
              <div>
                <p className="text-slate-500">السجلات</p>
                <p className="text-white">{backupInfo.recordsCount}</p>
              </div>
            </div>
          ) : (
            <p className="text-amber-300 text-sm">لا توجد نسخة محفوظة على الجهاز.</p>
          )}

          <p className="text-slate-500 text-xs leading-5">
            يتم استخدام ملف واحد فقط، وكل عملية حفظ تكتب فوق النسخة السابقة بنفس الاسم.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCreateBackup}
            disabled={isBusy}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v12m0 0 4-4m-4 4-4-4" />
            </svg>
            {loading === 'backup' ? 'جاري الحفظ...' : 'حفظ / تحديث النسخة'}
          </button>

          <button
            onClick={handleShareBackup}
            disabled={isBusy}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            {loading === 'share' ? 'جاري تجهيز المشاركة...' : 'مشاركة واتساب / Google Drive'}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setPendingRestore({ type: 'device', fileName: BACKUP_FILE_NAME })}
              disabled={isBusy || !backupInfo}
              className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-bold disabled:opacity-40 border border-slate-700"
            >
              استعادة من الجهاز
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-bold disabled:opacity-40 border border-slate-700"
            >
              استيراد ملف
            </button>
          </div>

          {backupInfo && (
            <button
              onClick={handleDelete}
              disabled={isBusy}
              className="w-full bg-rose-500/15 text-rose-300 border border-rose-500/30 py-3 rounded-xl font-bold disabled:opacity-50"
            >
              حذف النسخة من الجهاز
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileSelected}
          className="hidden"
        />
      </div>

      {pendingRestore && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center modal-safe-area" dir="rtl">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-xl font-bold text-rose-300 mb-4">تأكيد الاستعادة</h3>
            <p className="text-slate-300 text-sm leading-6 mb-6">
              سيتم استبدال البيانات الحالية ببيانات النسخة:
              <br />
              <span className="text-white font-bold break-all" dir="ltr">{pendingRestore.fileName}</span>
              <br /><br />
              <span className="text-rose-300">سيتم إلغاء العملية بالكامل إذا فشل التحقق أثناء الاستيراد.</span>
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setPendingRestore(null)}
                disabled={isBusy}
                className="flex-1 py-3 bg-slate-700 text-white rounded-xl font-bold disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={confirmRestore}
                disabled={isBusy}
                className="flex-1 py-3 bg-rose-500 text-white rounded-xl font-bold disabled:opacity-50"
              >
                {loading === 'restore' ? 'جاري...' : 'استعادة'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupRestore;
