export const DEFAULT_GOOGLE_CLIENT_ID =
  typeof window !== 'undefined' &&
  window.APP_CONFIG &&
  typeof window.APP_CONFIG.googleClientId === 'string'
    ? window.APP_CONFIG.googleClientId.trim()
    : '';

export const STORAGE_KEY = 'ap_spanish_srs_deck_v1';
export const DELETED_IDS_KEY = 'ap_spanish_deleted_ids_v1';
export const LOADED_PACKS_KEY = 'ap_spanish_loaded_packs_v1';
export const AUDIO_PREFS_KEY = 'ap_spanish_audio_prefs_v1';
export const DAILY_PACE_KEY = 'ap_spanish_daily_pace_v1';
export const USER_PREFS_KEY = 'ap_spanish_user_prefs_v1';
export const VOCAB_STATS_KEY = 'ap_spanish_vocab_stats_v1';
export const VERB_STATS_KEY = 'ap_spanish_verb_stats_v1';
export const GOOGLE_AUTH_PREFS_KEY = 'ap_spanish_google_auth_v1';
export const AUTO_FOCUS_TYPE_KEY = 'ap_spanish_auto_focus_type_v1';

export const VOCAB_PACK_URL = './packs/vocabulary.json';
export const VERBS_PACK_URL = './packs/verbs.json';
export const DRIVE_FILE_NAME = 'ap-spanish-progress-v2.json';
export const DRIVE_BACKUP_FILE_NAME = 'ap-spanish-progress-v2.backup.json';

export const THEME_MODE_LABELS = {
  light: 'Light',
  dark: 'Dark',
  midnight: 'Midnight',
  sepia: 'Sepia',
  'high-contrast': 'Contrast',
  colorblind: 'Colorblind'
};

export const LEVEL_BADGES = {
  1: { text: 'Level 1: 9th Foundations', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  2: { text: 'Level 2: 10th Intermediate', cls: 'bg-sky-50 border-sky-200 text-sky-800' },
  3: { text: 'Level 3: 11th Pre-AP', cls: 'bg-indigo-50 border-indigo-200 text-indigo-800' },
  4: { text: 'Level 4: 12th AP Mastery', cls: 'bg-purple-50 border-purple-200 text-purple-800' }
};

export const CONJUGATION_PRONOUNS = [
  { key: 'yo', label: 'yo', note: '1st sg.' },
  { key: 'tu', label: 'tú', note: '2nd sg.' },
  { key: 'el', label: 'él / ella / Ud.', note: '3rd sg.' },
  { key: 'nosotros', label: 'nosotros / as', note: '1st pl.' },
  { key: 'vosotros', label: 'vosotros / as', note: '2nd pl.' },
  { key: 'ellos', label: 'ellos / ellas / Uds.', note: '3rd pl.' }
];

export const CONJUGATION_TENSE_LABELS = {
  present: 'Presente (Present)',
  preterite: 'Pretérito (Preterite)',
  imperfect: 'Imperfecto (Imperfect)',
  future: 'Futuro (Future)',
  conditional: 'Condicional (Conditional)',
  present_subjunctive: 'Presente de Subjuntivo',
  imperfect_subjunctive: 'Imperfecto de Subjuntivo (-ra)',
  present_perfect: 'Pretérito Perfecto (Present Perfect)'
};

export const SPANISH_ACCENT_CHARS = ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ', '¿', '¡'];

export const OFFICIAL_PACK_CATALOG = [
  { url: './packs/grade9-foundations.json', label: '9th Grade Foundations (7,300)', regex: /^g9-\d+$/ },
  { url: './packs/grade10-foundations.json', label: '10th Grade Intermediate (7,300)', regex: /^g10-\d+$/ },
  { url: './packs/grade11-foundations.json', label: '11th Grade Pre-AP (7,300)', regex: /^g11-\d+$/ },
  { url: './packs/grade12-foundations.json', label: '12th Grade AP Mastery (7,300)', regex: /^g12-\d+$/ }
];
export const OFFICIAL_PACK_URLS = OFFICIAL_PACK_CATALOG.map((p) => p.url);

export const IDB_NAME = 'ap_spanish_trainer_db';
export const IDB_VERSION = 1;
export const IDB_STORE = 'app_state';
export const IDB_DECK_KEY = 'deck';
export const IDB_VOCAB_KEY = 'vocab_pack_v1';
export const IDB_VERBS_KEY = 'verbs_pack_v1';
export const DAY_MS = 24 * 60 * 60 * 1000;

export const VALID_AP_THEMES = [
  'Argument & Connectors',
  'Global Challenges',
  'Science & Technology',
  'Contemporary Life',
  'Personal & Public Identities',
  'Families & Communities',
  'Beauty & Aesthetics'
];

export const BOOTSTRAP_SAMPLE_DECK = [
  {
    id: 'g9-boot-1',
    level: 1,
    sentence: 'Juan come manzanas frescas todas las mañanas antes de ir a la escuela.',
    target: 'come manzanas',
    hint: 'eats apples',
    theme: 'Contemporary Life',
    notes: 'Classic starter! Notice how Spanish drops "unos/unas" before plural food items.',
    interval: 0,
    ease: 2.5,
    reps: 0,
    dueDate: Date.now()
  },
  {
    id: 'g9-boot-2',
    level: 1,
    sentence: 'En mi opinión, aprender otro idioma abre muchas puertas en el futuro.',
    target: 'En mi opinión',
    hint: 'In my opinion',
    theme: 'Argument & Connectors',
    notes: 'Clear, confident way to state a viewpoint in 9th grade.',
    interval: 0,
    ease: 2.5,
    reps: 0,
    dueDate: Date.now()
  },
  {
    id: 'g9-boot-3',
    level: 1,
    sentence: 'Mi familia y yo solemos cenar juntos alrededor de las ocho de la noche.',
    target: 'solemos cenar juntos',
    hint: 'usually have dinner together',
    theme: 'Families & Communities',
    notes: '"Soler + infinitive" means "to usually do something" — very natural!',
    interval: 0,
    ease: 2.5,
    reps: 0,
    dueDate: Date.now()
  },
  {
    id: 'g9-boot-4',
    level: 1,
    sentence: 'Por ejemplo, en Argentina es muy común tomar mate con amigos en el parque.',
    target: 'Por ejemplo',
    hint: 'For example',
    theme: 'Argument & Connectors',
    notes: 'Essential for backing up any statement with a concrete cultural detail.',
    interval: 0,
    ease: 2.5,
    reps: 0,
    dueDate: Date.now()
  },
  {
    id: 'g9-boot-5',
    level: 1,
    sentence: 'Sin embargo, a veces paso demasiado tiempo mirando videos en Internet.',
    target: 'Sin embargo',
    hint: 'However',
    theme: 'Argument & Connectors',
    notes: 'Your #1 contrast connector from 9th grade through the AP exam.',
    interval: 0,
    ease: 2.5,
    reps: 0,
    dueDate: Date.now()
  }
];

export const SPEAKING_PROMPTS = [
  {
    theme: 'Families & Communities',
    es: '¿Qué papel desempeñan las celebraciones familiares en la preservación de la identidad cultural en tu comunidad y en una región del mundo hispanohablante?',
    en: 'What role do family celebrations play in preserving cultural identity in your community and in a Spanish-speaking region?'
  },
  {
    theme: 'Science & Technology',
    es: '¿Cómo ha afectado el acceso a Internet y a las redes sociales la vida cotidiana de los jóvenes en tu comunidad en comparación con un país hispanohablante?',
    en: 'How has access to the Internet and social media affected the daily lives of young people in your community compared to a Spanish-speaking country?'
  },
  {
    theme: 'Global Challenges',
    es: '¿Qué iniciativas existen en tu comunidad para proteger el medio ambiente y cómo se comparan con los esfuerzos en una región del mundo hispanohablante?',
    en: 'What initiatives exist in your community to protect the environment and how do they compare with efforts in a Spanish-speaking region?'
  },
  {
    theme: 'Contemporary Life',
    es: '¿Cómo influye el transporte público o la infraestructura urbana en la calidad de vida de los habitantes de tu comunidad y en una ciudad hispanohablante?',
    en: 'How does public transportation or urban infrastructure influence residents’ quality of life in your community and in a Spanish-speaking city?'
  },
  {
    theme: 'Personal & Public Identities',
    es: '¿De qué manera el idioma o las expresiones regionales reflejan la identidad de las personas en tu comunidad y en una región hispanohablante?',
    en: 'In what ways do language or regional expressions reflect people’s identity in your community and in a Spanish-speaking region?'
  },
  {
    theme: 'Beauty & Aesthetics',
    es: '¿Cómo contribuye el arte público (como los murales o la música callejera) a la identidad de un barrio en tu comunidad y en el mundo hispanohablante?',
    en: 'How does public art (such as murals or street music) contribute to a neighborhood’s identity in your community and in the Spanish-speaking world?'
  },
  {
    theme: 'Families & Communities',
    es: '¿Cómo ha cambiado la estructura familiar y el rol de los abuelos en la crianza de los hijos en tu comunidad frente a una región hispanohablante?',
    en: 'How has family structure and the role of grandparents in raising children changed in your community versus a Spanish-speaking region?'
  },
  {
    theme: 'Contemporary Life',
    es: '¿Qué importancia tienen los deportes o las actividades extracurriculares en la formación de los jóvenes en tu comunidad y en un país hispanohablante?',
    en: 'What importance do sports or extracurricular activities have in shaping young people in your community and in a Spanish-speaking country?'
  },
  {
    theme: 'Global Challenges',
    es: '¿Qué desafíos enfrentan los jóvenes al buscar su primer empleo en tu comunidad en comparación con una región del mundo hispanohablante?',
    en: 'What challenges do young people face when looking for their first job in your community compared to a Spanish-speaking region?'
  },
  {
    theme: 'Personal & Public Identities',
    es: '¿Cómo se manifiesta el orgullo nacional o regional durante los eventos culturales en tu comunidad y en una región hispanohablante?',
    en: 'How is national or regional pride expressed during cultural events in your community and in a Spanish-speaking region?'
  },
  {
    theme: 'Science & Technology',
    es: '¿Qué beneficios y riesgos presenta el uso de la inteligencia artificial en la educación en tu comunidad y en el mundo hispanohablante?',
    en: 'What benefits and risks does the use of artificial intelligence present in education in your community and in the Spanish-speaking world?'
  },
  {
    theme: 'Beauty & Aesthetics',
    es: '¿De qué manera la gastronomía tradicional refleja la historia y la diversidad cultural de tu comunidad y de una región hispanohablante?',
    en: 'In what ways does traditional gastronomy reflect the history and cultural diversity of your community and a Spanish-speaking region?'
  }
];

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeRegExp(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSpanishAnswer(str) {
  return String(str ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function stripSpanishDiacritics(str) {
  return String(str ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);
}
