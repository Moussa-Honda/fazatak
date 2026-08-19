export const DATA_CHANGED_EVENT = 'fazatak:data-changed';

export const notifyDataChanged = (detail = {}) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
    detail: {
      ...detail,
      changedAt: Date.now()
    }
  }));
};
