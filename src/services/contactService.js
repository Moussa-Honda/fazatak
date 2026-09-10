import { Capacitor } from '@capacitor/core';
import { sanitizePhoneNumber } from '../utils/phoneUtils.js';

/**
 * فك ترميز Quoted-Printable (خاصة للنصوص العربية في vCard 2.1)
 */
export const decodeQuotedPrintable = (str) => {
  if (!str) return '';
  const normalized = str.replace(/=\r?\n/g, '');
  try {
    const uriEncoded = normalized.replace(/=([0-9A-Fa-f]{2})/g, '%$1');
    return decodeURIComponent(uriEncoded);
  } catch {
    return normalized.replace(/=([0-9A-Fa-f]{2})/g, '');
  }
};

/**
 * فحص ما إذا كان المتصفح/النظام يدعم Contact Picker API مباشرة
 */
export const isWebContactsSupported = () => {
  return typeof window !== 'undefined' && 
         'contacts' in navigator && 
         typeof navigator.contacts?.select === 'function';
};

/**
 * فحص ما إذا كان التطبيق يعمل كحزمة Native (Capacitor)
 */
export const isNativePlatform = () => {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
};

/**
 * استرداد جهة اتصال مباشرة عبر النظام/المتصفح
 */
export const pickContactDirectly = async () => {
  // 1. إذا كان التطبيق مثبتاً كـ Native عبر Capacitor
  if (isNativePlatform()) {
    try {
      const { Contacts } = await import('@capacitor-community/contacts');
      const result = await Contacts.pickContact({
        projection: {
          name: true,
          phones: true
        }
      });
      if (result && result.contact) {
        const contact = result.contact;
        const rawPhone = contact.phones?.[0]?.number || '';
        const name = contact.name?.display || contact.name?.given || '';
        return {
          name: name.trim(),
          phone: sanitizePhoneNumber(rawPhone)
        };
      }
      return null;
    } catch (nativeError) {
      console.warn('Native contacts error:', nativeError);
      throw nativeError;
    }
  }

  // 2. إذا كان المتصفح يدعم Contact Picker API في PWA (مثل Android Chrome)
  if (isWebContactsSupported()) {
    try {
      let props = ['name', 'tel'];
      if ('getProperties' in navigator.contacts) {
        try {
          const supportedProps = await navigator.contacts.getProperties();
          if (Array.isArray(supportedProps) && supportedProps.length > 0) {
            props = ['name', 'tel'].filter(p => supportedProps.includes(p));
            if (props.length === 0) props = ['name', 'tel'];
          }
        } catch {
          // ignore getProperties errors
        }
      }

      const contacts = await navigator.contacts.select(props, { multiple: false });
      if (contacts && contacts.length > 0) {
        const c = contacts[0];
        const name = c.name?.[0] || '';
        const rawPhone = c.tel?.[0] || '';
        return {
          name: name.trim(),
          phone: sanitizePhoneNumber(rawPhone)
        };
      }
      return null;
    } catch (e) {
      if (e.name === 'AbortError') {
        // قام المستخدم بإلغاء الاختيار
        return null;
      }
      console.warn('Web Contact Picker error:', e);
      throw e;
    }
  }

  // إذا لم يكن مدعوماً
  return { unsupported: true };
};

/**
 * تحليل ملف vCard (.vcf) واستخراج جميع جهات الاتصال منه
 * يدعم vCard 2.1, 3.0, 4.0 والنصوص العربية ذات الترميز Quoted-Printable أو UTF-8
 */
export const parseVCard = (vcfContent) => {
  if (!vcfContent || typeof vcfContent !== 'string') return [];

  // دمج الأسطر الملتوية (Unfolding folded lines: RFC 2425)
  const unfolded = vcfContent.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const contacts = [];
  let currentContact = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VCARD') {
      currentContact = { name: '', phones: [] };
      continue;
    }

    if (upper === 'END:VCARD') {
      if (currentContact && (currentContact.name || currentContact.phones.length > 0)) {
        const primaryPhone = currentContact.phones[0] || '';
        contacts.push({
          name: currentContact.name || 'جهة اتصال',
          phone: sanitizePhoneNumber(primaryPhone),
          allPhones: currentContact.phones.map(p => sanitizePhoneNumber(p))
        });
      }
      currentContact = null;
      continue;
    }

    if (!currentContact) continue;

    // استخراج الاسم المنسق FN
    if (line.startsWith('FN:') || line.startsWith('FN;')) {
      const parts = line.split(':');
      const params = parts[0];
      const value = parts.slice(1).join(':');

      let decodedName = value;
      if (params.toUpperCase().includes('ENCODING=QUOTED-PRINTABLE')) {
        decodedName = decodeQuotedPrintable(value);
      }
      currentContact.name = decodedName.trim();
    }
    // استخراج الاسم المركب N في حال عدم وجود FN
    else if (!currentContact.name && (line.startsWith('N:') || line.startsWith('N;'))) {
      const parts = line.split(':');
      const params = parts[0];
      const value = parts.slice(1).join(':');

      let decodedValue = value;
      if (params.toUpperCase().includes('ENCODING=QUOTED-PRINTABLE')) {
        decodedValue = decodeQuotedPrintable(value);
      }

      // N يكون عادة بالترتيب: Family;Given;Middle;Prefix;Suffix
      const nameParts = decodedValue.split(';').map(p => p.trim()).filter(Boolean);
      if (nameParts.length > 0) {
        // ترتيب الاسم طبيعياً: الأول ثم الأخير
        const formatted = nameParts.reverse().join(' ').trim();
        currentContact.name = formatted;
      }
    }
    // استخراج رقم الهاتف TEL
    else if (line.startsWith('TEL:') || line.startsWith('TEL;')) {
      const parts = line.split(':');
      const rawNumber = parts.slice(1).join(':').replace(/^tel:/i, '').trim();
      if (rawNumber) {
        currentContact.phones.push(rawNumber);
      }
    }
  }

  // في حال وجود جهة اتصال واحدة بدون علامة END:VCARD
  if (currentContact && (currentContact.name || currentContact.phones.length > 0)) {
    const primaryPhone = currentContact.phones[0] || '';
    contacts.push({
      name: currentContact.name || 'جهة اتصال',
      phone: sanitizePhoneNumber(primaryPhone),
      allPhones: currentContact.phones.map(p => sanitizePhoneNumber(p))
    });
  }

  return contacts;
};

/**
 * تحليل نص جهة اتصال منسوخ (من واتساب أو رسائل أو جهات الاتصال)
 * يستخرج الاسم ورقم الهاتف بذكاء
 */
export const parseContactText = (text) => {
  if (!text || typeof text !== 'string') return null;

  // البحث عن رقم هاتف محلي أو دولي
  // يدعم: 05xxxxxxxx, +966xxxxxxxx, 966xxxxxxxx, أو أي رقم من 8 إلى 14 خانة
  const phoneRegex = /(?:\+?966|00966|0)?5\d{8}|\+?\d{8,15}/g;
  const match = text.match(phoneRegex);

  let phone = '';
  let name = '';

  if (match && match.length > 0) {
    phone = sanitizePhoneNumber(match[0]);
    name = text
      .replace(match[0], '')
      .replace(/^(الاسم|الاسم الكريم|اسم العميل|الاسم:|اسم:|Name:|Contact:)/gi, '')
      .replace(/(رقم الهاتف|الهاتف|الجوال|جوال|موبايل|Phone|Mobile|Tel):?/gi, '');
    
    ['-', ':', '_', '|', '/', '\\'].forEach((delim) => {
      name = name.split(delim).join(' ');
    });
    name = name.trim();
  } else {
    // إذا لم يتم العثور على رقم صريح، نأخذ النص كاسم
    name = text.trim();
  }

  return {
    name: name || '',
    phone: phone || ''
  };
};
