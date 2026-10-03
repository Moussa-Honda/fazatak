import { useState } from 'react';

const formatAmount = (value) => new Intl.NumberFormat('ar-SA', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
}).format(value);

const ZakatCalculator = () => {
  const [amount, setAmount] = useState('20000');
  const [rate, setRate] = useState('2.5');

  const numericAmount = Math.max(0, Number(amount) || 0);
  const numericRate = Math.max(0, Number(rate) || 0);
  const zakatAmount = (numericAmount * numericRate) / 100;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-slate-900 p-4" dir="rtl">
      <div className="mx-auto w-full max-w-xl space-y-5 pb-8">
        <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-slate-800 to-slate-900 p-6 shadow-lg">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-500/20 text-2xl">ز</span>
            <div>
              <p className="text-sm font-bold text-emerald-300">حاسبة الزكاة</p>
              <h1 className="mt-1 text-2xl font-black text-white">احسب المبلغ المستحق</h1>
              <p className="mt-2 text-xs leading-5 text-slate-400">أدخل المبلغ ونسبة الزكاة لمعرفة الناتج مباشرة.</p>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-300">المبلغ</span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="w-full rounded-2xl border border-slate-600 bg-slate-950 px-4 py-4 pl-16 text-lg font-bold text-white outline-none transition-colors focus:border-emerald-400"
                  placeholder="مثال: 20000"
                />
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">ر.س</span>
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-300">نسبة الزكاة</span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-600 bg-slate-950 px-4 py-4 pl-12 text-lg font-bold text-white outline-none transition-colors focus:border-emerald-400"
                  placeholder="2.5"
                />
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">%</span>
              </div>
            </label>
          </div>
        </div>

        <div className="rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 to-slate-800 p-6 text-center shadow-lg">
          <p className="text-sm font-bold text-amber-300">مقدار الزكاة</p>
          <p className="mt-3 text-5xl font-black tracking-tight text-white">{formatAmount(zakatAmount)}</p>
          <p className="mt-2 text-sm text-slate-400">ريال سعودي</p>
          <div className="mt-5 rounded-2xl border border-slate-700/80 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
            {formatAmount(numericAmount)} × {formatAmount(numericRate)}% = <span className="font-black text-amber-300">{formatAmount(zakatAmount)} ر.س</span>
          </div>
        </div>

        <p className="text-center text-[11px] leading-5 text-slate-500">هذه الحاسبة أداة تقديرية. راجع أهل العلم عند الحاجة.</p>
      </div>
    </div>
  );
};

export default ZakatCalculator;
