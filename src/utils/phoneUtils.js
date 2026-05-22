// Phone number sanitization utilities
export const sanitizePhoneNumber = (phone) => {
  if (!phone) return '';
  
  // Strip all non-numeric characters except +
  let sanitized = phone.replace(/[^0-9+]/g, '');
  
  // If starts with 00966, replace 00 with +
  if (sanitized.startsWith('00966')) {
    sanitized = '+966' + sanitized.substring(5);
  }
  // If starts with 05, replace 0 with +966
  else if (sanitized.startsWith('05')) {
    sanitized = '+966' + sanitized.substring(1);
  }
  // If exactly 9 digits starting with 5, prepend +966
  else if (/^5\d{8}$/.test(sanitized)) {
    sanitized = '+966' + sanitized;
  }
  // If starts with 966 but no +, add +
  else if (sanitized.startsWith('966') && !sanitized.startsWith('+966')) {
    sanitized = '+' + sanitized;
  }
  
  return sanitized;
};

// Format phone for display
export const formatPhoneForDisplay = (phone) => {
  if (!phone) return '';
  
  // If starts with +966, format as +966 5X XXX XXXX
  if (phone.startsWith('+966')) {
    const rest = phone.substring(4);
    if (rest.length === 9) {
      return `+966 ${rest.substring(0, 1)}${rest.substring(1, 3)} ${rest.substring(3, 6)} ${rest.substring(6)}`;
    }
  }
  
  return phone;
};

// Format for WhatsApp (strip + and everything non-numeric)
export const formatForWhatsApp = (phone) => {
  if (!phone) return '';
  const sanitized = sanitizePhoneNumber(phone);
  return sanitized.replace(/\D/g, '');
};

export default {
  sanitizePhoneNumber,
  formatPhoneForDisplay,
  formatForWhatsApp
};

