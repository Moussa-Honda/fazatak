import moment from 'moment-hijri';

moment.locale('ar-SA');

export const toHijriDate = (gregorianDate) => {
  try {
    if (!gregorianDate) return '';
    const date = moment(gregorianDate);
    if (!date.isValid()) return '';
    
    // moment-hijri tokens: iYYYY, iMM, iDD
    return date.format('iDD/iMM/iYYYY') + ' هـ';
  } catch (error) {
    console.error('Hijri date conversion error:', error);
    return '';
  }
};

export const getDefaultDueDate = () => {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 27);
  return nextMonth.toISOString().split('T')[0];
};

export default {
  toHijriDate,
  getDefaultDueDate
};
