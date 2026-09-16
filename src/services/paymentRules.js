export const PAYMENT_TOLERANCE = 0.009;

export const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const getPaidAmount = (installment) => {
  const actualPaid = Number(installment?.actual_paid || 0);
  const status = String(installment?.status || '').trim().toLowerCase();
  const discountAmount = Number(installment?.discount_amount || 0);
  if (status === 'paid' && actualPaid <= 0 && discountAmount <= 0) {
    return Number(installment?.amount || 0);
  }
  return actualPaid;
};

export const getRemainingAmount = (installment) => {
  return Math.max(0, roundCurrency(Number(installment?.amount || 0) - getPaidAmount(installment)));
};

export const sumPaid = (installments = []) => {
  return roundCurrency(installments.reduce((sum, item) => sum + getPaidAmount(item), 0));
};

export const isContractComplete = ({ totalAmount, installments = [], discountAmount = 0 }) => {
  const total = roundCurrency(totalAmount);
  const discount = Math.max(0, Number(discountAmount) || 0);
  return sumPaid(installments) + discount + PAYMENT_TOLERANCE >= total;
};

export const calculateEarlySettlement = (installments = [], contractAmount, requestedDiscount = 0) => {
  const total = roundCurrency(contractAmount);
  const totalPaid = sumPaid(installments);

  if (totalPaid > total + PAYMENT_TOLERANCE) {
    throw new Error('لا يمكن تنفيذ السداد المبكر لأن المدفوع الحالي يتجاوز إجمالي العقد');
  }

  const outstandingBeforeDiscount = roundCurrency(Math.max(0, total - totalPaid));
  const safeDiscount = roundCurrency(Math.min(Math.max(0, Number(requestedDiscount) || 0), outstandingBeforeDiscount));
  let remainingPayment = roundCurrency(
    Math.min(outstandingBeforeDiscount - safeDiscount, Math.max(0, total - totalPaid))
  );
  let remainingDiscount = safeDiscount;
  const updates = [];

  // A postponed row is the source of a replacement row, so only pending rows receive settlement money.
  for (const installment of installments) {
    if ((remainingPayment <= 0 && remainingDiscount <= 0) || installment.status !== 'pending') continue;

    const amount = roundCurrency(installment.amount);
    const paidBefore = roundCurrency(getPaidAmount(installment));
    const remainingInstallment = getRemainingAmount(installment);
    if (remainingInstallment <= 0) continue;

    const cashApplied = roundCurrency(Math.min(remainingPayment, remainingInstallment));
    const discountApplied = roundCurrency(
      Math.min(remainingDiscount, Math.max(0, remainingInstallment - cashApplied))
    );
    const applied = roundCurrency(cashApplied + discountApplied);
    const paidAfter = roundCurrency(paidBefore + cashApplied);
    const isPaid = paidAfter + discountApplied + PAYMENT_TOLERANCE >= amount;

    updates.push({
      id: installment.id,
      status: isPaid ? 'paid' : 'pending',
      actual_paid: paidAfter,
      discount_amount: discountApplied,
      applied: cashApplied,
      discountApplied
    });
    remainingPayment = roundCurrency(remainingPayment - cashApplied);
    remainingDiscount = roundCurrency(remainingDiscount - discountApplied);
  }

  if (remainingPayment > PAYMENT_TOLERANCE || remainingDiscount > PAYMENT_TOLERANCE) {
    throw new Error('تعذر إكمال السداد المبكر بسبب عدم تطابق جدول الأقساط مع قيمة العقد');
  }

  return {
    totalPaid,
    safeDiscount,
    paymentAmount: roundCurrency(updates.reduce((sum, update) => sum + update.applied, 0)),
    updates
  };
};
