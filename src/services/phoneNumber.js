export const normalizePhone = (phone) => {
  if (!phone) return '';
  return String(phone)
    .trim()
    .replace(/[\u0660-\u0669]/g, (digit) => digit.charCodeAt(0) - 1632)
    .replace(/[\u06F0-\u06F9]/g, (digit) => digit.charCodeAt(0) - 1776)
    .replace(/[^\d+]/g, '');
};

export const toE164Phone = (phone) => {
  const raw = normalizePhone(phone);
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw new Error('يرجى إدخال رقم هاتف صحيح');
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('966')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+966${digits.slice(1)}`;
  if (digits.startsWith('5') && digits.length === 9) return `+966${digits}`;
  throw new Error('أدخل رقم الهاتف بصيغة دولية أو رقم جوال سعودي صحيح');
};
