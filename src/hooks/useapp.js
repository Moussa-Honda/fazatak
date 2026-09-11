import { useState, useEffect, useCallback } from 'react';
import { dashboardService, initDatabase } from '../services/database';
import { useLiveRefresh } from './useLiveRefresh';

export const useDatabase = () => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let managerCleanupTimer;

    const init = async () => {
      try {
        await initDatabase();
        
        // Auto-cleanup deleted customers after 7 days
        const { customerService, managerService } = await import('../services/database');
        await customerService.autoCleanupDeletedCustomers();
        await managerService.cleanupDeleted();

        managerCleanupTimer = setInterval(() => {
          managerService.cleanupDeleted().catch((cleanupError) => {
            console.warn('Deleted manager cleanup error:', cleanupError);
          });
        }, 60 * 60 * 1000);

        setIsReady(true);
      } catch (err) {
        console.error('Database init error:', err);
        setError(err.message);
      }
    };

    init();

    return () => {
      if (managerCleanupTimer) clearInterval(managerCleanupTimer);
    };
  }, []);

  return { isReady, error };
};

export const useGreeting = () => {
  const [greeting] = useState(() => {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 12) {
      return 'صباح الإنجاز والرزق 🌅';
    }
    if (hour >= 12 && hour < 17) {
      return 'مساء العطاء والتوفيق ☀️';
    }
    if (hour >= 17 && hour < 21) {
      return 'مساء الخير والبركة 🌇';
    }
    return 'تصبح على خير ونجاح 🌙';
  });

  return greeting;
};

export const useStats = () => {
  const [stats, setStats] = useState({
    totalInstallments: 0,
    totalPaid: 0,
    totalRemaining: 0
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dashboardService.getStats();
      setStats({
        totalInstallments: Math.round(data.totalInstallments || 0),
        totalPaid: Math.round(data.totalPaid || 0),
        totalRemaining: Math.round(data.totalRemaining || 0)
      });

    } catch (error) {
      console.error('Stats error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    
    // Keep a light safety refresh; data-change events handle immediate updates.
    const interval = setInterval(() => {
      refresh();
    }, 15000);
    
    return () => clearInterval(interval);
  }, [refresh]);

  useLiveRefresh(refresh);

  return { stats, loading, refresh };
};

export const useManagerStats = () => {
  const [stats, setStats] = useState({
    managerTotalInstallments: 0,
    managerTotalPaid: 0,
    managerTotalRemaining: 0
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dashboardService.getManagerStats();
      setStats({
        managerTotalInstallments: Math.round(data.managerTotalInstallments || 0),
        managerTotalPaid: Math.round(data.managerTotalPaid || 0),
        managerTotalRemaining: Math.round(data.managerTotalRemaining || 0)
      });

    } catch (error) {
      console.error('Manager stats error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    
    // Keep a light safety refresh; data-change events handle immediate updates.
    const interval = setInterval(() => {
      refresh();
    }, 15000);
    
    return () => clearInterval(interval);
  }, [refresh]);

  useLiveRefresh(refresh);

  return { stats, loading, refresh };
};
