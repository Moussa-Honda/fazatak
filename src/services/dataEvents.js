export const DATA_CHANGED_EVENT = 'fazatak:data-changed';
export const PAGE_NAVIGATED_EVENT = 'fazatak:page-navigated';

export const notifyDataChanged = (detail = {}) => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem('fazatak_has_pending_cloud_sync', 'true');
    localStorage.setItem('fazatak_last_local_mutation', Date.now().toString());
  } catch (e) {
    // Ignore storage quota errors
  }

  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, {
    detail: {
      ...detail,
      changedAt: Date.now()
    }
  }));
};

export const notifyPageNavigated = (detail = {}) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(PAGE_NAVIGATED_EVENT, {
    detail: {
      ...detail,
      navigatedAt: Date.now()
    }
  }));
};
