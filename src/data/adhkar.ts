import type { StartupSection } from '../types';

export interface LibraryItem {
  section: StartupSection;
  type: 'text';
  title: string;
  text: string;
  source: string;
  repeat: number;
}

const hisn = 'Hisn al-Muslim, chapitre « أذكار الصباح والمساء » (https://hisnmuslim.com/i/ar/1)';

const morningItems: LibraryItem[] = [
  {
    section: 'matin',
    type: 'text',
    title: 'آية الكرسي',
    text: 'اللَّهُ لاَ إِلَهَ إِلاَّ هُوَ الْحَيُّ الْقَيُّومُ لاَ تَأْخُذُهُ سِنَةٌ وَلاَ نَوْمٌ لَّهُ مَا فِي السَّمَوَاتِ وَمَا فِي الأَرْضِ مَن ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلاَّ بِإِذْنِهِ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ وَلاَ يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلاَّ بِمَا شَاء وَسِعَ كُرْسِيُّهُ السَّمَوَاتِ وَالأَرْضَ وَلاَ يَؤُودُهُ حِفْظُهُمَا وَهُوَ الْعَلِيُّ الْعَظِيمُ',
    source: `${hisn}, Ayat al-Kursi`,
    repeat: 1,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'سورة الإخلاص',
    text: 'قُلْ هُوَ اللَّهُ أَحَدٌ، اللَّهُ الصَّمَدُ، لَمْ يَلِدْ وَلَمْ يُولَدْ، وَلَمْ يَكُن لَّهُ كُفُواً أَحَدٌ',
    source: `${hisn}, sourate Al-Ikhlas`,
    repeat: 3,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'سورة الفلق',
    text: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ، مِن شَرِّ مَا خَلَقَ، وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ، وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ، وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    source: `${hisn}, sourate Al-Falaq`,
    repeat: 3,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'سورة الناس',
    text: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ، مَلِكِ النَّاسِ، إِلَهِ النَّاسِ، مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ، الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ، مِنَ الْجِنَّةِ وَالنَّاسِ',
    source: `${hisn}, sourate An-Nas`,
    repeat: 3,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'أصبحنا وأصبح الملك لله',
    text: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لاَ إِلَهَ إِلاَّ اللَّهُ وَحْدَهُ لاَ شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ، رَبِّ أَسْأَلُكَ خَيْرَ مَا فِي هَذَا الْيَوْمِ وَخَيْرَ مَا بَعْدَهُ، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِي هَذَا الْيَوْمِ وَشَرِّ مَا بَعْدَهُ، رَبِّ أَعُوذُ بِكَ مِنَ الْكَسَلِ وَسُوءِ الْكِبَرِ، رَبِّ أَعُوذُ بِكَ مِنْ عَذَابٍ فِي النَّارِ وَعَذَابٍ فِي الْقَبْرِ',
    source: `${hisn}, invocation du matin`,
    repeat: 1,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'سيد الاستغفار',
    text: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ',
    source: `${hisn}, Sayyid al-istighfar`,
    repeat: 1,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'بسم الله الذي لا يضر',
    text: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    source: `${hisn}, invocation « بسم الله الذي لا يضر »`,
    repeat: 3,
  },
  {
    section: 'matin',
    type: 'text',
    title: 'سبحان الله وبحمده',
    text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
    source: `${hisn}, invocation « سبحان الله وبحمده »`,
    repeat: 100,
  },
];

export const adhkarLibrary: LibraryItem[] = [
  ...morningItems,
  ...morningItems.map((item) => ({
    ...item,
    section: 'soir' as const,
    title: item.title === 'أصبحنا وأصبح الملك لله' ? 'أمسينا وأمسى الملك لله' : item.title,
    text: item.title === 'أصبحنا وأصبح الملك لله'
      ? item.text.replaceAll('أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ', 'أَمْسَيْنَا وَأَمْسَى الْمُلْكُ')
        .replaceAll('هَذَا الْيَوْمِ', 'هَذِهِ اللَّيْلَةِ')
      : item.text,
    source: `${item.source} (forme du soir indiquée par la source)`,
  })),
  {
    section: 'rizq',
    type: 'text',
    title: 'رزق من القرآن',
    text: 'ٱلَّذِىٓ أَطْعَمَهُم مِّن جُوعٍۢ وَءَامَنَهُم مِّنْ خَوْفٍۭ',
    source: 'Coran Uthmani, sourate Quraysh 106:4 (AlQuran.cloud, édition quran-uthmani)',
    repeat: 1,
  },
];
