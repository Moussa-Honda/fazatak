import { useEffect, useRef } from 'react';
import { DATA_CHANGED_EVENT, PAGE_NAVIGATED_EVENT } from '../services/dataEvents';

export const useLiveRefresh = (refresh, enabled = true) => {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    let timerId = null;
    let refreshInFlight = false;
    let pendingRefresh = false;
    let disposed = false;

    const runRefresh = async () => {
      timerId = null;

      if (refreshInFlight) {
        pendingRefresh = true;
        return;
      }

      refreshInFlight = true;
      try {
        await refreshRef.current?.();
      } catch (error) {
        console.error('Live refresh error:', error);
      } finally {
        refreshInFlight = false;
        if (!disposed && pendingRefresh) {
          pendingRefresh = false;
          scheduleRefresh();
        }
      }
    };

    const scheduleRefresh = () => {
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(runRefresh, 50);
    };

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    window.addEventListener(DATA_CHANGED_EVENT, scheduleRefresh);
    window.addEventListener(PAGE_NAVIGATED_EVENT, scheduleRefresh);
    window.addEventListener('focus', scheduleRefresh);
    window.addEventListener('pageshow', scheduleRefresh);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      document.addEventListener('resume', scheduleRefresh);
    }

    return () => {
      disposed = true;
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener(DATA_CHANGED_EVENT, scheduleRefresh);
      window.removeEventListener(PAGE_NAVIGATED_EVENT, scheduleRefresh);
      window.removeEventListener('focus', scheduleRefresh);
      window.removeEventListener('pageshow', scheduleRefresh);

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.removeEventListener('resume', scheduleRefresh);
      }
    };
  }, [enabled]);
};
