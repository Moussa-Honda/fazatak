import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { settingsService, installmentService, managerService } from '../services/database';

export const PDF_MODES = {
  GLOBAL_STATEMENT:    'GLOBAL_STATEMENT',
  CONTRACT_STATEMENT:  'CONTRACT_STATEMENT',
  INSTALLMENT_RECEIPT: 'INSTALLMENT_RECEIPT',
  CUSTODY_STATEMENT:  'CUSTODY_STATEMENT',
};

const fmt     = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (d) => {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  } catch { return String(d); }
};
const today = () => fmtDate(new Date().toISOString());

const getPaidAmount = (installment) => {
  const actualPaid = Number(installment?.actual_paid || 0);
  const status = String(installment?.status || '').trim().toLowerCase();
  return status === 'paid' && actualPaid <= 0
    ? Number(installment?.amount || 0)
    : actualPaid;
};

const loadSettings = async () => {
  try {
    return {
      businessName:    (await settingsService.get('business_name'))      || '',
      businessContact: (await settingsService.get('business_contact'))   || '',
      taxNumber:       (await settingsService.get('tax_number'))          || '',
      showDetails:     (await settingsService.get('show_details_on_pdf')) === 'true',
      ibanNumber:      (await settingsService.get('iban_number'))         || '',
    };
  } catch { return { businessName:'', businessContact:'', taxNumber:'', showDetails:false, ibanNumber:'' }; }
};

// ─── Shared CSS ───────────────────────────────────────────────────────────────
const BASE_CSS = `
  @font-face { font-family:'Amiri'; src:url('/fonts/Amiri-Regular.ttf') format('truetype'); }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Amiri','Arial Unicode MS',sans-serif; direction:rtl; background:#fff;
         width:794px; color:#1e1e1e; }
  .header { background:#4b4b4b; color:#fff; padding:18px 24px 14px;
            display:flex; justify-content:space-between; align-items:flex-start; }
  .header .title { font-size:22px; font-weight:bold; }
  .header .sub   { font-size:11px; margin-top:4px; opacity:.85; }
  .header .co    { font-size:15px; text-align:left; line-height:1.7; }
  .header .co small { display:block; font-size:10px; opacity:.85; }
  .divider { height:1px; background:#ddd; margin:0 24px; }
  .info { display:flex; justify-content:space-between; padding:14px 24px; }
  .info-col { display:flex; flex-direction:column; gap:6px; }
  .lbl { font-size:10px; color:#888; }
  .val { font-size:13px; font-weight:bold; }
  table { width:calc(100% - 48px); margin:0 24px; border-collapse:collapse; }
  th { background:#4b4b4b; color:#fff; padding:9px 10px; font-size:11px; text-align:center; vertical-align:middle; }
  td { padding:8px 10px; font-size:11px; border:1px solid #ddd; text-align:center; vertical-align:middle; }
  tr:nth-child(even) td { background:#f5f5f5; }
  .totals { margin:12px 24px 0; border:1px solid #ddd; border-radius:4px; overflow:hidden; }
  .tot-row { display:flex; justify-content:space-between; padding:8px 14px; font-size:11px; }
  .tot-row.grand { background:#4b4b4b; color:#fff; font-size:13px; font-weight:bold; }
  .green { color:#0c8c50; }
  .red   { color:#dc2626; }
  .amber { color:#b47800; }
  .footer { display:flex; justify-content:space-between; padding:12px 24px 0; border-top:1px solid #ccc; margin:18px 24px 0; }
  .iban  { font-size:10px; color:#555; margin-top:4px; direction:ltr; text-align:right; }
  .sig-line { border-top:1px solid #999; width:120px; margin-top:16px; }
  .strip { background:#4b4b4b; color:#fff; text-align:center; padding:10px; font-size:13px; margin-top:14px; }
  /* Receipt */
  .receipt-amt-label { text-align:center; font-size:13px; padding:10px 0 6px; }
  .receipt-amt-box { border:2px solid #0c8c50; background:#ebfff5; border-radius:6px;
                     margin:0 80px; padding:12px 0; text-align:center;
                     font-size:28px; font-weight:bold; color:#0c8c50; }
  .detail-card { margin:14px 24px 0; border:1px solid #ddd; border-radius:4px; background:#f5f5f5; }
  .detail-row  { display:flex; justify-content:space-between; padding:8px 14px; font-size:12px; border-bottom:1px solid #e0e0e0; }
  .detail-row:last-child { border-bottom:none; }
  .detail-label { color:#888; font-size:10px; }
  .sigs { display:flex; justify-content:space-between; padding:14px 24px 0; }
  .sig-block { text-align:center; font-size:11px; }
`;

// ─── HTML builders ────────────────────────────────────────────────────────────
const wrap = (body) => `
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><style>${BASE_CSS}</style></head>
<body>${body}</body></html>`;

const businessDetailsHTML = (s) => {
  if (!s.showDetails) return '';

  const lines = [
    s.businessName ? `<div>${s.businessName}</div>` : '',
    s.businessContact ? `<small>جوال: ${s.businessContact}</small>` : '',
    s.taxNumber ? `<small>الرقم الضريبي: ${s.taxNumber}</small>` : '',
  ].filter(Boolean);

  return lines.join('');
};

const headerHTML = (title, sub, s, managedBy = null) => `
<div class="header">
  <div>
    <div class="title">${title}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
    ${managedBy ? `<div class="sub" style="font-size:9px; opacity:0.7; margin-top:2px;">هذا الحساب يدار بالنيابة بواسطة: ${managedBy}</div>` : ''}
  </div>
  <div class="co">${businessDetailsHTML(s)}</div>
</div>`;

const footerHTML = (iban) => `
<div class="footer">
  <div><div>توقيع الإدارة</div><div class="sig-line"></div></div>
  <div style="text-align:left"><div>معلومات الدفع</div>${iban ? `<div class="iban">IBAN: ${iban}</div>` : ''}</div>
</div>
<div class="strip">شكراً لتعاملكم معنا</div>`;

const totalsHTML = (total, paid, remain) => `
<div class="totals">
  <div class="tot-row"><span>إجمالي العقد :</span><span>${fmt(Math.round(total))} SAR</span></div>
  <div class="tot-row"><span>إجمالي المدفوع :</span><span class="green">${fmt(Math.round(paid))} SAR</span></div>
  <div class="tot-row grand"><span>المتبقي :</span><span>${fmt(Math.round(remain))} SAR</span></div>
</div>`;

// ─── Mode 1: Global Summary ───────────────────────────────────────────────────
const buildGlobalHTML = async (customer, contracts, s, managedBy = null) => {
  let rows = '', grandTotal = 0, grandPaid = 0, grandRemain = 0;
  for (const c of contracts) {
    if (!c?.id) continue;
    let insts = [];
    try { insts = (await installmentService.getByContractId(c.id)) || []; } catch { /* Keep the statement printable if installments fail to load. */ }
    const total  = c.total_amount   || 0;
    const disc   = c.discount_amount || 0;
    const paid   = insts.reduce((s, i) => s + getPaidAmount(i), 0);
    const remain = Math.max(0, total - paid - disc);
    rows += `<tr>
      <td>${c.title || '#' + c.id}</td>
      <td>${fmt(Math.round(total))} SAR</td>
      <td class="green">${fmt(Math.round(paid))} SAR</td>
      <td class="${remain > 0 ? 'red' : 'green'}">${fmt(Math.round(remain))} SAR</td>
    </tr>`;
    grandTotal += total; grandPaid += paid; grandRemain += remain;
  }
  return wrap(`
    ${headerHTML('كشف حساب شامل', `العميل: ${customer?.name || ''}`, s, managedBy)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">اسم العميل</div><div class="val">${customer?.name || '—'}</div>
        <div class="lbl">رقم الجوال</div><div class="val">${customer?.phone || '—'}</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ الكشف</div><div class="val">${today()}</div>
        <div class="lbl">عدد العقود</div><div class="val">${contracts.length}</div>
      </div>
    </div>
    <div class="divider" style="margin-bottom:10px"></div>
    <table><thead><tr><th>اسم العقد</th><th>إجمالي العقد</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">لا توجد عقود</td></tr>'}</tbody></table>
    ${totalsHTML(grandTotal, grandPaid, grandRemain)}
    ${footerHTML(s.ibanNumber)}`);
};

// ─── Mode 2: Contract Detail ──────────────────────────────────────────────────
const ORDINAL_UNITS = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
const COMPOUND_ORDINAL_UNITS = ['', 'الحادي', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع'];
const ORDINAL_TENS = ['', '', 'العشرون', 'الثلاثون', 'الأربعون', 'الخمسون', 'الستون', 'السبعون', 'الثمانون', 'التسعون'];
const CARDINAL_UNITS = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const CARDINAL_TEENS = ['', '', '', '', '', '', '', '', '', '', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const CARDINAL_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const CARDINAL_HUNDREDS = ['', 'المائة', 'المائتان', 'الثلاثمائة', 'الأربعمائة', 'الخمسمائة', 'الستمائة', 'السبعمائة', 'الثمانمائة', 'التسعمائة'];
const CARDINAL_SCALES = [
  { value: 1000000000000000, singular: 'الكوادريليون', dual: 'الكوادريليونان', plural: 'كوادريليونات', counted: 'كوادريليون' },
  { value: 1000000000000, singular: 'التريليون', dual: 'التريليونان', plural: 'تريليونات', counted: 'تريليون' },
  { value: 1000000000, singular: 'المليار', dual: 'الملياران', plural: 'مليارات', counted: 'مليار' },
  { value: 1000000, singular: 'المليون', dual: 'المليونان', plural: 'ملايين', counted: 'مليون' },
  { value: 1000, singular: 'الألف', dual: 'الألفان', plural: 'آلاف', counted: 'ألف' },
];

const getArabicOrdinalUnder100 = (number) => {
  if (number <= 10) return ORDINAL_UNITS[number];
  if (number < 20) return `${COMPOUND_ORDINAL_UNITS[number - 10]} عشر`;
  const unit = number % 10;
  const ten = Math.floor(number / 10);
  return unit === 0 ? ORDINAL_TENS[ten] : `${COMPOUND_ORDINAL_UNITS[unit]} وال${ORDINAL_TENS[ten].slice(2)}`;
};

const getArabicCardinalUnder100 = (number) => {
  if (number < 10) return CARDINAL_UNITS[number];
  if (number < 20) return CARDINAL_TEENS[number];
  const unit = number % 10;
  const ten = Math.floor(number / 10);
  return unit === 0 ? CARDINAL_TENS[ten] : `${CARDINAL_UNITS[unit]} و${CARDINAL_TENS[ten]}`;
};

const getArabicCardinalUnder1000 = (number) => {
  if (number < 100) return getArabicCardinalUnder100(number);
  const hundred = Math.floor(number / 100);
  const remainder = number % 100;
  return remainder === 0 ? CARDINAL_HUNDREDS[hundred] : `${CARDINAL_HUNDREDS[hundred]} و${getArabicCardinalUnder100(remainder)}`;
};

const getArabicScaleText = (count, scale) => {
  if (count === 1) return scale.singular;
  if (count === 2) return scale.dual;
  if (count <= 10) return `${getArabicCardinal(count)} ${scale.plural}`;
  return `${getArabicCardinal(count)} ${scale.counted}`;
};

const getArabicCardinal = (number) => {
  if (number < 1000) return getArabicCardinalUnder1000(number);
  const scale = CARDINAL_SCALES.find(item => number >= item.value);
  if (!scale) return fmt(number);
  const count = Math.floor(number / scale.value);
  const remainder = number % scale.value;
  const scaleText = getArabicScaleText(count, scale);
  return remainder === 0 ? scaleText : `${scaleText} و${getArabicCardinal(remainder)}`;
};

const getArabicOrdinal = (number) => {
  const value = Number(number);
  if (!Number.isFinite(value) || value < 1) return String(number || '');
  const normalized = Math.trunc(value);
  if (normalized < 100) return getArabicOrdinalUnder100(normalized);
  const remainder = normalized % 100;
  return remainder === 0
    ? getArabicCardinal(normalized)
    : `${getArabicCardinal(normalized - remainder)} و${getArabicOrdinalUnder100(remainder)}`;
};

const buildContractHTML = async (customer, contract, s, managedBy = null) => {
  let insts = [];
  try { insts = (await installmentService.getByContractId(contract.id)) || []; } catch { /* Keep the statement printable if installments fail to load. */ }
  const total  = contract.total_amount   || 0;
  const disc   = contract.discount_amount || 0;
  const paid   = insts.reduce((s, i) => s + getPaidAmount(i), 0);
  const remain = Math.max(0, total - paid - disc);

  const rows = insts.map((inst, idx) => {
    const paidAmount = getPaidAmount(inst);
    const remainingAmount = Math.max(0, Number(inst.amount || 0) - paidAmount);
    const isPartial = inst.status !== 'paid' && paidAmount > 0 && remainingAmount > 0;
    const cls = inst.status === 'paid' ? 'green' : inst.status === 'postponed' || isPartial ? 'amber' : 'red';
    const lbl = inst.status === 'paid' ? 'مدفوع' : inst.status === 'postponed' ? 'مؤجل' : isPartial ? 'مدفوع جزئياً' : 'متبقي';
    const amount = inst.status === 'paid' ? paidAmount : remainingAmount || inst.amount;
    const amountText = isPartial
      ? `${fmt(Math.round(amount || 0))} SAR<br><small class="green">مدفوع: ${fmt(Math.round(paidAmount))} SAR</small>`
      : `${fmt(Math.round(amount || 0))} SAR`;
    return `<tr>
      <td>القسط ${getArabicOrdinal(idx + 1)}</td>
      <td>${fmtDate(inst.due_date)}</td>
      <td>${amountText}</td>
      <td class="${cls}">${lbl}</td>
    </tr>`;
  }).join('');

  return wrap(`
    ${headerHTML('كشف حساب عقد', `العقد: ${contract.title || '#'+contract.id}`, s, managedBy)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">اسم العميل</div><div class="val">${customer?.name || '—'}</div>
        <div class="lbl">رقم الجوال</div><div class="val">${customer?.phone || '—'}</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ الكشف</div><div class="val">${today()}</div>
        <div class="lbl">إجمالي العقد</div><div class="val">${fmt(Math.round(total))} SAR</div>
      </div>
    </div>
    <div class="divider" style="margin-bottom:10px"></div>
    <table><thead><tr><th>وصف القسط</th><th>تاريخ الاستحقاق</th><th>المبلغ</th><th>الحالة</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">لا توجد أقساط</td></tr>'}</tbody></table>
    ${totalsHTML(total, paid, remain)}
    ${footerHTML(s.ibanNumber)}`);
};

// ─── Mode 3: Receipt ──────────────────────────────────────────────────────────
const buildReceiptHTML = (customer, installment, contract, s, managedBy = null) => {
  const amt = Math.round(installment.actual_paid || installment.amount || 0);
  return wrap(`
    ${headerHTML('سند قبض', `رقم الإيصال: ${installment.id}-${new Date().getFullYear()}`, s, managedBy)}
    <div class="receipt-amt-label">تم استلام مبلغ وقدره</div>
    <div class="receipt-amt-box">${fmt(amt)} SAR</div>
    <div class="detail-card">
      <div class="detail-row"><span class="detail-label">اسم العميل</span><span>${customer?.name || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">اسم العقد</span><span>${contract?.title || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">وصف القسط</span><span>القسط #${installment.id}</span></div>
      <div class="detail-row"><span class="detail-label">تاريخ الاستحقاق</span><span>${fmtDate(installment.due_date)}</span></div>
      <div class="detail-row"><span class="detail-label">تاريخ السداد</span><span>${fmtDate(installment.paid_at) || today()}</span></div>
      <div class="detail-row"><span class="detail-label">المبلغ المسدد</span><span class="green">${fmt(amt)} SAR</span></div>
    </div>
    <div class="sigs">
      <div class="sig-block"><div>توقيع المستلم</div><div class="sig-line" style="margin:auto;margin-top:16px"></div></div>
      <div class="sig-block"><div>توقيع العميل</div><div class="sig-line" style="margin:auto;margin-top:16px"></div></div>
    </div>
    ${s.ibanNumber ? `<div style="text-align:center;font-size:10px;color:#555;margin-top:10px;direction:ltr">IBAN: ${s.ibanNumber}</div>` : ''}
    <div class="strip">شكراً لتعاملكم معنا</div>`);
};

// ─── Mode 4: Custody Statement ──────────────────────────────────────────────
const buildCustodyHTML = (custody, expenses, s) => {
  const totalSpent = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const remaining = (custody.capital || 0) - totalSpent;

  const rows = expenses.map((exp) => `
    <tr>
      <td>${fmtDate(exp.date)}</td>
      <td>${exp.description || '—'}</td>
      <td class="red">${fmt(exp.amount)} SAR</td>
    </tr>
  `).join('');

  return wrap(`
    ${headerHTML('كشف حساب عُهدة', `المسؤول: ${custody.name || ''}`, s)}
    <div class="info">
      <div class="info-col">
        <div class="lbl">اسم المسؤول</div><div class="val">${custody.name || '—'}</div>
        <div class="lbl">المبلغ المسلم</div><div class="val">${fmt(custody.capital)} SAR</div>
      </div>
      <div class="info-col" style="text-align:left">
        <div class="lbl">تاريخ التقرير</div><div class="val">${today()}</div>
        <div class="lbl">إجمالي العمليات</div><div class="val">${expenses.length}</div>
      </div>
    </div>

    <div class="totals" style="background:#f8fafc; border-color:#e2e8f0; margin-bottom:20px">
      <div class="tot-row"><span class="lbl">إجمالي العهدة :</span><span class="val" style="color:#1e293b">${fmt(custody.capital)} SAR</span></div>
      <div class="tot-row"><span class="lbl">إجمالي المنصرف :</span><span class="val red">${fmt(totalSpent)} SAR</span></div>
      <div class="tot-row grand" style="background:${remaining < 0 ? '#be123c' : '#047857'}">
        <span>المتبقي :</span>
        <span>${fmt(remaining)} SAR</span>
      </div>
    </div>

    <div style="padding:0 24px 8px; font-weight:bold; font-size:12px; color:#4b4b4b">سجل المصروفات بالتفصيل:</div>
    <table>
      <thead>
        <tr>
          <th style="width:120px">التاريخ</th>
          <th>البيان / الوصف</th>
          <th style="width:120px">المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" style="text-align:center; padding:20px; color:#888">لا توجد مصروفات مسجلة</td></tr>'}
      </tbody>
    </table>
    ${footerHTML(s.ibanNumber)}
  `);
};

// ─── HTML → PDF via html2canvas ───────────────────────────────────────────────
const renderHTMLtoPDF = async (htmlString) => {
  // Create hidden container
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;z-index:-1;';
  container.innerHTML = htmlString;
  document.body.appendChild(container);

  // Wait for Amiri font to load
  try { await document.fonts.ready; } catch { /* Continue rendering with fallback fonts. */ }

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: 794,
      logging: false,
    });

    const imgData  = canvas.toDataURL('image/jpeg', 0.92);
    const imgW     = 210;                             // A4 width mm
    const imgH     = (canvas.height / canvas.width) * imgW;
    const pageH    = 297;                             // A4 height mm
    const doc      = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    let yOffset = 0;
    while (yOffset < imgH) {
      if (yOffset > 0) doc.addPage();
      doc.addImage(imgData, 'JPEG', 0, -yOffset, imgW, imgH);
      yOffset += pageH;
    }

    return doc;
  } finally {
    document.body.removeChild(container);
  }
};

// ─── Save & Share ─────────────────────────────────────────────────────────────
const saveAndShare = async (doc, fileName) => {
  const blob = doc.output('blob');

  if (!Capacitor.isNativePlatform()) {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: fileName,
          text: fileName,
          files: [file]
        });
        return true;
      } catch (err) {
        if (err.name === 'AbortError' || err.message?.includes('canceled') || err.message?.includes('cancelled')) {
          return true;
        }
      }
    }

    // Web fallback: download / view in browser
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  const b64 = doc.output('datauristring').split(',')[1];
  await Filesystem.writeFile({ path: fileName, data: b64, directory: Directory.Documents });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Documents });
  try {
    await Share.share({ title: fileName, text: fileName, url: uri, dialogTitle: 'مشاركة الملف' });
  } catch (err) {
    // If user canceled sharing, we don't treat it as a hard error
    if (err.message?.includes('canceled') || err.message?.includes('cancelled')) {
      return true; 
    }
    throw err;
  }
  return true;
};

// ─── Main dispatcher ──────────────────────────────────────────────────────────
export const generatePDF = async (customer, mode, specificData = {}) => {
  try {
    if (!customer) { alert('بيانات العميل غير متوفرة'); return false; }
    const s    = await loadSettings();
    const date = today();
    const safe = (customer.name || 'عميل').replace(/[^\w\u0600-\u06FF]/g, '_');
    let html, fileName;

    let managedBy = null;
    if (customer.manager_id) {
      try {
        const manager = await managerService.getById(customer.manager_id);
        if (manager) managedBy = manager.name;
      } catch (e) { console.warn('Could not fetch manager info for PDF', e); }
    }

    if (mode === PDF_MODES.GLOBAL_STATEMENT) {
      const { contracts = [] } = specificData;
      html     = await buildGlobalHTML(customer, contracts, s, managedBy);
      fileName = `كشف_شامل_${safe}_${date}.pdf`;

    } else if (mode === PDF_MODES.CONTRACT_STATEMENT) {
      const { contract } = specificData;
      if (!contract) { alert('بيانات العقد غير متوفرة'); return false; }
      html     = await buildContractHTML(customer, contract, s, managedBy);
      fileName = `كشف_عقد_${(contract.title||'').replace(/\s/g,'_')}_${date}.pdf`;

    } else if (mode === PDF_MODES.INSTALLMENT_RECEIPT) {
      const { installment, contract } = specificData;
      if (!installment) { alert('بيانات القسط غير متوفرة'); return false; }
      html     = buildReceiptHTML(customer, installment, contract || {}, s, managedBy);
      fileName = `إيصال_${installment.id}_${safe}_${date}.pdf`;

    } else if (mode === PDF_MODES.CUSTODY_STATEMENT) {
      const custody = customer; // In this mode, the first arg is the custody object
      const expenses = specificData || [];
      html = buildCustodyHTML(custody, expenses, s);
      fileName = `كشف_عهدة_${(custody.name || 'عُهدة').replace(/\s/g, '_')}_${date}.pdf`;

    } else { return false; }

    const doc = await renderHTMLtoPDF(html);
    return await saveAndShare(doc, fileName);

  } catch (err) {
    console.error('[PDF]', err);
    alert('حدث خطأ أثناء إنشاء PDF: ' + (err?.message || 'خطأ'));
    return false;
  }
};

export const generatePDFStatement = (customer, contracts) =>
  generatePDF(customer, PDF_MODES.GLOBAL_STATEMENT, { contracts });

export default generatePDF;
