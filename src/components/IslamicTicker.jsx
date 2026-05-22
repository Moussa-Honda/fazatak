import { useState, useEffect } from 'react';

// ── Quran verses & Adhkar ────────────────────────────────────────────────────
const PHRASES = [
  // القرآن الكريم
  { text: '﴿ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ﴾', type: 'quran' },
  { text: '﴿ وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ ﴾', type: 'quran' },
  { text: '﴿ إِنَّ مَعَ الْعُسْرِ يُسْرًا ﴾', type: 'quran' },
  { text: '﴿ وَقُل رَّبِّ زِدْنِي عِلْمًا ﴾', type: 'quran' },
  { text: '﴿ فَإِنَّ مَعَ الْعُسْرِ يُسْرًا ﴾', type: 'quran' },
  { text: '﴿ وَاللَّهُ يَرْزُقُ مَن يَشَاءُ بِغَيْرِ حِسَابٍ ﴾', type: 'quran' },
  { text: '﴿ وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ ﴾', type: 'quran' },
  { text: '﴿ حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ ﴾', type: 'quran' },
  { text: '﴿ وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ ﴾', type: 'quran' },
  { text: '﴿ وَفِي ذَٰلِكَ فَلْيَتَنَافَسِ الْمُتَنَافِسُونَ ﴾', type: 'quran' },
  // الأذكار والأدعية
  { text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ سُبْحَانَ اللَّهِ الْعَظِيمِ', type: 'dhikr' },
  { text: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ', type: 'dhikr' },
  { text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ ﷺ', type: 'salah' },
  { text: 'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ', type: 'dhikr' },
  { text: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ الْعَلِيِّ الْعَظِيمِ', type: 'dhikr' },
  { text: 'اللَّهُمَّ بَارِكْ لَنَا فِيمَا رَزَقْتَنَا', type: 'dhikr' },
  { text: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الآخِرَةِ حَسَنَةً', type: 'dua' },
  { text: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ', type: 'dua' },
  { text: 'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ', type: 'dua' },
  { text: 'اللَّهُمَّ يَسِّرْ وَلَا تُعَسِّرْ', type: 'dua' },
  { text: 'اللَّهُمَّ اكْفِنِي بِحَلَالِكَ عَنْ حَرَامِكَ', type: 'dua' },
  { text: 'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي', type: 'quran' },
  { text: 'تَوَكَّلْتُ عَلَى اللَّهِ وَكَفَى بِاللَّهِ وَكِيلًا', type: 'dhikr' },
  { text: 'اللَّهُمَّ اجْعَلْ عَمَلَنَا صَالِحًا وَلَكَ خَالِصًا', type: 'dua' },
  { text: 'سُبْحَانَ اللَّهِ وَالْحَمْدُ لِلَّهِ وَلَا إِلَهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ', type: 'dhikr' },
];

// Color per type
const TYPE_COLOR = {
  quran:  'text-emerald-300',
  dhikr:  'text-amber-300',
  salah:  'text-sky-300',
  dua:    'text-violet-300',
};

const IslamicTicker = () => {
  const [index,   setIndex]   = useState(0);
  const [visible, setVisible] = useState(true);

  // Change phrase every 6 seconds with a fade transition
  useEffect(() => {
    const SHOW = 5500;   // ms visible
    const FADE = 500;    // ms fade out

    const cycle = setInterval(() => {
      // Fade out
      setVisible(false);
      setTimeout(() => {
        setIndex(i => (i + 1) % PHRASES.length);
        setVisible(true);
      }, FADE);
    }, SHOW + FADE);

    return () => clearInterval(cycle);
  }, []);

  const phrase = PHRASES[index];
  const color  = TYPE_COLOR[phrase.type] ?? 'text-amber-300';

  // Icon per type
  const icon = phrase.type === 'quran' ? '📖'
             : phrase.type === 'salah' ? '🌙'
             : phrase.type === 'dua'   ? '🤲'
             :                          '✨';

  return (
    <div className="bg-slate-800/95 border-b border-slate-600/60 h-11 flex items-center px-3 gap-2 overflow-hidden shrink-0">
      <span className="text-base shrink-0">{icon}</span>
      <div
        className={`flex-1 text-center text-sm font-medium leading-tight transition-all duration-500 ${color} ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
        }`}
        style={{ direction: 'rtl', fontFamily: "'Amiri', 'Arial Unicode MS', serif" }}
      >
        {phrase.text}
      </div>
      <span className="text-base shrink-0">{icon}</span>
    </div>
  );
};

export default IslamicTicker;
