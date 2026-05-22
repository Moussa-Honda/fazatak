import { useState, useEffect, useCallback } from 'react';
import { dashboardService, initDatabase } from '../services/database';

export const useDatabase = () => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase();
        
        // Auto-cleanup deleted customers after 7 days
        const { customerService } = await import('../services/database');
        await customerService.autoCleanupDeletedCustomers();
        
        setIsReady(true);
      } catch (err) {
        console.error('Database init error:', err);
        setError(err.message);
      }
    };

    init();
  }, []);

  return { isReady, error };
};

export const useGreeting = () => {
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    const hour = new Date().getHours();
    let text = '';
    
    if (hour >= 5 && hour < 12) {
      text = 'صباح الإنجاز والرزق 🌅';
    } else if (hour >= 12 && hour < 17) {
      text = 'مساء العطاء والتوفيق ☀️';
    } else if (hour >= 17 && hour < 21) {
      text = 'مساء الخير والبركة 🌇';
    } else {
      text = 'تصبح على خير ونجاح 🌙';
    }
    
    setGreeting(text);
  }, []);

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
    
    // Auto-refresh every 2 seconds when component is mounted
    const interval = setInterval(() => {
      refresh();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [refresh]);

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
    
    // Auto-refresh every 2 seconds when component is mounted
    const interval = setInterval(() => {
      refresh();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [refresh]);

  return { stats, loading, refresh };
};
