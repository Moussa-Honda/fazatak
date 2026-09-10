import { exportData } from './backupService';

export const GOOGLE_CLIENT_ID = '597146195568-mkdtembb730lqo0bbngopr5desv7s5ur.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient = null;
let currentAccessToken = null;
let tokenExpiresAt = 0;

/**
 * التأكد من تحميل سكربت Google Identity Services
 */
const ensureGisScriptLoaded = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('البيئة الحالية غير مدعومة'));
    if (window.google?.accounts?.oauth2) return resolve();

    const existingScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('تعذر تحميل مكتبة جوجل للمصادقة')));
      // في حالة كان السكربت انتهى من التحميل قبل الربط
      if (window.google?.accounts?.oauth2) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('تعذر تحميل مكتبة جوجل للمصادقة'));
    document.head.appendChild(script);
  });
};

export const googleDriveService = {
  /**
   * الحصول على توكن الوصول من حساب Google
   */
  async getAccessToken(promptConsent = false) {
    await ensureGisScriptLoaded();

    // إذا كان التوكن الحالي ساري المفعول ولم يطلب إعادة الموافقة
    const now = Date.now();
    if (!promptConsent && currentAccessToken && tokenExpiresAt > now + 60000) {
      return currentAccessToken;
    }

    return new Promise((resolve, reject) => {
      try {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            if (response.error) {
              console.error('[GoogleDrive] Auth error:', response);
              return reject(new Error(response.error_description || response.error || 'تم إلغاء تسجيل الدخول'));
            }
            if (response.access_token) {
              currentAccessToken = response.access_token;
              // التوكن صالح عادة لـ 3600 ثانية
              const expiresInMs = (Number(response.expires_in) || 3500) * 1000;
              tokenExpiresAt = Date.now() + expiresInMs;
              resolve(currentAccessToken);
            } else {
              reject(new Error('لم يتم استلام رمز الوصول من Google'));
            }
          }
        });

        tokenClient.requestAccessToken({ prompt: promptConsent ? 'select_account' : '' });
      } catch (err) {
        console.error('[GoogleDrive] initTokenClient failed:', err);
        reject(err);
      }
    });
  },

  /**
   * رفع النسخة الاحتياطية الحالية إلى Google Drive
   */
  async uploadBackup() {
    const token = await this.getAccessToken();
    const backupData = await exportData();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `Fazatak_Backup_${timestamp}.json`;
    const fileContent = JSON.stringify(backupData, null, 2);

    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      description: `نسخة احتياطية لتطبيق فزتك - ${new Date().toLocaleString('ar-SA')}`
    };

    const boundary = '-------FazatakBackupBoundary' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`
      },
      body: multipartRequestBody
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      const msg = errorJson.error?.message || `فشل الرفع برمز حالة ${response.status}`;
      throw new Error(`خطأ في Google Drive: ${msg}`);
    }

    const createdFile = await response.json();
    const recordsCount = Object.values(backupData.counts || {}).reduce((acc, c) => acc + c, 0);

    return {
      success: true,
      fileId: createdFile.id,
      fileName: createdFile.name,
      recordsCount,
      createdAt: new Date().toISOString()
    };
  },

  /**
   * جلب قائمة النسخ الاحتياطية السابقة من Google Drive
   */
  async listBackups(limit = 10) {
    const token = await this.getAccessToken();

    const query = "name contains 'Fazatak_Backup' and trashed = false";
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&pageSize=${limit}&fields=files(id,name,size,createdTime,modifiedTime)`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      throw new Error(errorJson.error?.message || 'تعذر جلب النسخ من Google Drive');
    }

    const data = await response.json();
    return data.files || [];
  },

  /**
   * تنزيل محتوى نسخة احتياطية من Google Drive
   */
  async downloadBackup(fileId) {
    const token = await this.getAccessToken();

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error('تعذر تنزيل ملف النسخة من Google Drive');
    }

    return await response.json();
  }
};
