import { usePrivacyMode, formatPrivateAmount } from '../hooks/usePrivacyMode';

// Helper to format numbers without diamond symbols
const formatAmount = (value, privacyMode = false) => formatPrivateAmount(value, privacyMode);

const StatCard = ({ title, value, color = 'blue', icon }) => {
  const privacyMode = usePrivacyMode();

  const colorClasses = {
    blue: 'from-blue-600/20 to-blue-600/5 border-blue-500/30',
    green: 'from-emerald-600/20 to-emerald-600/5 border-emerald-500/30',
    gold: 'from-amber-500/20 to-amber-500/5 border-amber-500/30',
    red: 'from-rose-600/20 to-rose-600/5 border-rose-500/30'
  };

  const iconColors = {
    blue: 'text-blue-400',
    green: 'text-emerald-400',
    gold: 'text-amber-400',
    red: 'text-rose-400'
  };

  return (
    <div 
      className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-4 card-hover cursor-pointer`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-2xl ${iconColors[color]}`}>{icon}</span>
        {privacyMode && (
          <span className="text-xs text-slate-500">🔒</span>
        )}
      </div>
      
      <p className="text-slate-400 text-xs mb-1">{title}</p>
      
      <p className="text-xl font-bold text-white">
        {formatAmount(value, privacyMode)}
        <span className="text-sm font-normal text-slate-400 mr-1">ريال</span>
      </p>
    </div>
  );
};

export default StatCard;
