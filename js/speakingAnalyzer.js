import { CONJUGATION_TENSE_LABELS, stripSpanishDiacritics } from './constants.js';
import { loadVerbsPack, loadVocabularyPack } from './packs.js';
import { appState } from './storage.js';

const STOP_WORDS_ES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'e', 'o', 'u',
  'que', 'se', 'es', 'son', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'lo', 'le', 'les', 'me', 'te', 'nos',
  'con', 'por', 'para', 'sobre', 'entre', 'mas', 'pero', 'como', 'si', 'no', 'ya', 'muy', 'este', 'esta',
  'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'hay', 'ser', 'estar'
]);

const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'is', 'are', 'was', 'were',
  'be', 'your', 'our', 'their', 'this', 'that', 'how', 'what', 'why', 'which', 'during', 'from', 'both',
  'between', 'does', 'do', 'you', 'hispanic', 'spanish', 'speaking', 'region', 'community'
]);

const BASE_SPANISH_GLOSS = {
  // Pronouns & determiners
  yo: 'I',
  tu: 'you',
  el: 'the / he',
  ella: 'she',
  usted: 'you (formal)',
  nosotros: 'we',
  nosotras: 'we',
  vosotros: 'you all',
  vosotras: 'you all',
  ellos: 'they',
  ellas: 'they',
  ustedes: 'you all',
  mi: 'my',
  mis: 'my',
  nuestro: 'our',
  nuestra: 'our',
  nuestros: 'our',
  nuestras: 'our',
  su: 'their / its',
  sus: 'their / its',
  un: 'a',
  una: 'a',
  unos: 'some',
  unas: 'some',
  la: 'the',
  los: 'the',
  las: 'the',
  lo: 'it / what',
  este: 'this',
  esta: 'this',
  estos: 'these',
  estas: 'these',
  ese: 'that',
  esa: 'that',
  // Prepositions & conjunctions
  de: 'of / from',
  del: 'of the',
  al: 'to the',
  a: 'to',
  en: 'in / on',
  con: 'with',
  sin: 'without',
  para: 'for / in order to',
  por: 'for / because of',
  sobre: 'about / on',
  entre: 'between / among',
  hacia: 'toward',
  desde: 'from / since',
  hasta: 'until',
  y: 'and',
  e: 'and',
  o: 'or',
  pero: 'but',
  sino: 'but rather',
  porque: 'because',
  aunque: 'although',
  mientras: 'while',
  cuando: 'when',
  donde: 'where',
  como: 'like / as / how',
  si: 'if',
  que: 'that / which',
  quien: 'who',
  no: 'not / no',
  ni: 'neither / nor',
  muy: 'very',
  mucho: 'a lot / much',
  muchos: 'many',
  muchas: 'many',
  poco: 'little',
  pocos: 'few',
  todo: 'all / everything',
  todos: 'everyone / all',
  todas: 'all',
  cada: 'each',
  otro: 'another / other',
  otra: 'another / other',
  otros: 'other',
  otras: 'other',
  mismo: 'same',
  misma: 'same',
  ambos: 'both',
  ambas: 'both',
  // High-frequency connectors
  'en mi comunidad': 'in my community',
  'en mi pais': 'in my country',
  'en mi ciudad': 'in my city',
  'en mi escuela': 'in my school',
  'en comparacion': 'in comparison',
  'en comparacion con': 'in comparison with',
  'a diferencia de': 'unlike / in contrast to',
  'por un lado': 'on one hand',
  'por otro lado': 'on the other hand',
  'sin embargo': 'however',
  'no obstante': 'nevertheless',
  'por lo tanto': 'therefore',
  'por eso': 'that is why',
  'ademas': 'furthermore / besides',
  'tambien': 'also',
  'en cambio': 'on the other hand',
  'de hecho': 'in fact',
  'en primer lugar': 'firstly',
  'en segundo lugar': 'secondly',
  'en conclusion': 'in conclusion',
  'en resumen': 'in summary',
  'en mi opinion': 'in my opinion',
  'creo que': 'I think that',
  'pienso que': 'I think that',
  'es importante': 'it is important',
  'es necesario': 'it is necessary',
  'hay que': 'one must',
  'hoy en dia': 'nowadays',
  'cada vez mas': 'more and more',
  'america latina': 'Latin America',
  'mundo hispanohablante': 'Spanish-speaking world',
  'estados unidos': 'United States'
};

const PERSON_SUBJECT_EN = ['I', 'you', 'he/she/it', 'we', 'you all', 'they'];

let cachedConjugatedLookup = null;
let cachedConjugatedPackRef = null;

function cleanEnglishVerbInfinitive(rawEn) {
  let first = String(rawEn || '').split(/[\/;(]/)[0].trim();
  first = first.replace(/^to\s+/i, '').trim();
  return first || 'do';
}

function formatConjugatedVerbEnglish(verb, tenseKey, personIdx) {
  const base = cleanEnglishVerbInfinitive(verb.english);
  const subj = PERSON_SUBJECT_EN[personIdx] || 'one';
  if (tenseKey === 'present') return `${subj} ${base}`;
  if (tenseKey === 'preterite') return `${subj} ${base} (past)`;
  if (tenseKey === 'imperfect') return `${subj} used to ${base}`;
  if (tenseKey === 'future') return `${subj} will ${base}`;
  if (tenseKey === 'conditional') return `${subj} would ${base}`;
  if (tenseKey === 'present_subjunctive') return `${subj} (may) ${base}`;
  if (tenseKey === 'imperfect_subjunctive') return `${subj} were to ${base}`;
  if (tenseKey === 'present_perfect') return `${subj} have ${base} (perf.)`;
  return `${subj} ${base}`;
}

function getConjugatedVerbGlossIndex() {
  const verbsPack = appState.verbsPack;
  if (!verbsPack || !Array.isArray(verbsPack.verbs)) return new Map();
  if (cachedConjugatedPackRef === verbsPack && cachedConjugatedLookup) {
    return cachedConjugatedLookup;
  }

  const map = new Map();
  for (const v of verbsPack.verbs) {
    const infNorm = stripSpanishDiacritics(String(v.infinitive || '').toLowerCase());
    if (infNorm && !map.has(infNorm)) {
      map.set(infNorm, {
        infinitive: v.infinitive,
        tenseKey: 'infinitive',
        tenseLabel: 'Infinitive',
        en: v.english
      });
    }
    for (const [tenseKey, forms] of Object.entries(v.tenses || {})) {
      if (!Array.isArray(forms)) continue;
      forms.forEach((form, personIdx) => {
        const bareForm = stripSpanishDiacritics(String(form || '').toLowerCase().trim());
        if (!bareForm) return;
        if (!map.has(bareForm)) {
          map.set(bareForm, {
            infinitive: v.infinitive,
            tenseKey,
            tenseLabel: CONJUGATION_TENSE_LABELS[tenseKey] || tenseKey,
            personIdx,
            en: formatConjugatedVerbEnglish(v, tenseKey, personIdx)
          });
        }
        // Also store second token of 2-word reflexive forms if unambiguous
        const parts = bareForm.split(/\s+/);
        if (parts.length === 2 && ['me', 'te', 'se', 'nos', 'os'].includes(parts[0])) {
          if (!map.has(parts[1])) {
            map.set(parts[1], {
              infinitive: v.infinitive,
              tenseKey,
              tenseLabel: CONJUGATION_TENSE_LABELS[tenseKey] || tenseKey,
              personIdx,
              en: formatConjugatedVerbEnglish(v, tenseKey, personIdx)
            });
          }
        }
      });
    }
  }

  cachedConjugatedPackRef = verbsPack;
  cachedConjugatedLookup = map;
  return map;
}

function cleanVocabGloss(rawEn) {
  return String(rawEn || '')
    .replace(/\([^)]*\)/g, '')
    .split(/[;/]/)[0]
    .trim();
}

function translateClauseLocally(clauseText) {
  const vocabPack = appState.vocabPack;
  const verbIndex = getConjugatedVerbGlossIndex();
  const tokens = String(clauseText || '').match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/g) || [];
  if (tokens.length === 0) {
    return { es: clauseText, en: '', matchedPhrases: [], verbsFound: [], matchedTokens: 0, totalTokens: 0 };
  }

  const outPieces = [];
  const matchedPhrases = [];
  const verbsFound = [];
  let matchedCount = 0;

  let i = 0;
  while (i < tokens.length) {
    let matchedMulti = false;
    // Try longest multi-word phrase match (up to 5 tokens)
    const maxWindow = Math.min(5, tokens.length - i);
    for (let len = maxWindow; len >= 2; len--) {
      const sliceOrig = tokens.slice(i, i + len).join(' ');
      const sliceBare = stripSpanishDiacritics(sliceOrig.toLowerCase());
      const basePhraseEn = BASE_SPANISH_GLOSS[sliceBare];
      const packPhrase =
        vocabPack?.phraseMap?.get(sliceOrig.toLowerCase()) ||
        vocabPack?.phraseNormMap?.get(sliceBare);

      if (basePhraseEn || packPhrase) {
        const en = basePhraseEn || cleanVocabGloss(packPhrase.en);
        outPieces.push(en);
        matchedPhrases.push({ es: sliceOrig, en });
        matchedCount += len;
        i += len;
        matchedMulti = true;
        break;
      }

      const conjPhrase = verbIndex.get(sliceBare);
      if (conjPhrase) {
        outPieces.push(conjPhrase.en);
        verbsFound.push(conjPhrase);
        matchedCount += len;
        i += len;
        matchedMulti = true;
        break;
      }
    }
    if (matchedMulti) continue;

    const tok = tokens[i];
    const lower = tok.toLowerCase();
    const bare = stripSpanishDiacritics(lower);

    if (/^\d+$/.test(tok)) {
      outPieces.push(tok);
      matchedCount += 1;
      i += 1;
      continue;
    }

    // Prefer conjugated verb meaning when it is a specific conjugated verb (non-stopword)
    const conjMatch = verbIndex.get(bare);
    const wordEntry = vocabPack?.wordMap?.get(lower) || vocabPack?.wordNormMap?.get(bare);
    const baseWordEn = BASE_SPANISH_GLOSS[bare];

    if (conjMatch && !BASE_SPANISH_GLOSS[bare]) {
      outPieces.push(conjMatch.en);
      verbsFound.push(conjMatch);
      matchedCount += 1;
    } else if (baseWordEn) {
      outPieces.push(baseWordEn.split('/')[0].trim());
      matchedCount += 1;
    } else if (wordEntry) {
      outPieces.push(cleanVocabGloss(wordEntry.en));
      matchedCount += 1;
    } else {
      outPieces.push(tok);
    }
    i += 1;
  }

  let assembled = outPieces.join(' ').replace(/\s+/g, ' ').trim();
  if (assembled) {
    assembled = assembled[0].toUpperCase() + assembled.slice(1);
  }

  return {
    es: clauseText.trim(),
    en: assembled,
    matchedPhrases,
    verbsFound,
    matchedTokens: matchedCount,
    totalTokens: tokens.length
  };
}

async function tryChromeBuiltInTranslator(clauses) {
  if (typeof self === 'undefined') return null;
  try {
    let translator = null;
    if ('Translator' in self && typeof self.Translator?.create === 'function') {
      if (typeof self.Translator.availability === 'function') {
        const status = await self.Translator.availability({ sourceLanguage: 'es', targetLanguage: 'en' });
        if (status === 'unavailable') return null;
      }
      translator = await self.Translator.create({ sourceLanguage: 'es', targetLanguage: 'en' });
    } else if (self.ai?.translator && typeof self.ai.translator.create === 'function') {
      translator = await self.ai.translator.create({ sourceLanguage: 'es', targetLanguage: 'en' });
    }
    if (!translator || typeof translator.translate !== 'function') return null;

    const translatedClauses = [];
    for (const c of clauses) {
      const en = await translator.translate(c);
      translatedClauses.push(String(en || '').trim());
    }
    if (typeof translator.destroy === 'function') {
      try {
        translator.destroy();
      } catch {
        // Ignore
      }
    }
    return translatedClauses;
  } catch {
    return null;
  }
}

async function tryChromeGeminiNanoFeedback({ prompt, requiredChunks, transcriptEs, naturalEnglish }) {
  if (typeof self === 'undefined') return null;
  try {
    let lm = null;
    if ('LanguageModel' in self && typeof self.LanguageModel?.create === 'function') {
      if (typeof self.LanguageModel.availability === 'function') {
        const avail = await self.LanguageModel.availability();
        if (avail === 'unavailable') return null;
      }
      lm = await self.LanguageModel.create();
    } else if (self.ai?.languageModel && typeof self.ai.languageModel.create === 'function') {
      lm = await self.ai.languageModel.create();
    }
    if (!lm || typeof lm.prompt !== 'function') return null;

    const askPrompt = [
      'You are an AP Spanish Language and Culture Task 4 (Cultural Comparison) grader.',
      `AP Prompt: ${prompt?.es || ''}`,
      `Required Chunks: ${(requiredChunks || []).map((c) => c.target).join(', ')}`,
      `Student Spanish Speech: ${transcriptEs}`,
      `English Translation: ${naturalEnglish}`,
      'In 3-4 concise bullet points, evaluate: 1) Did the speech clearly compare two communities? 2) Any grammar/tense corrections? 3) Estimated AP score 1-5.'
    ].join('\n');

    const reply = await lm.prompt(askPrompt);
    if (typeof lm.destroy === 'function') {
      try {
        lm.destroy();
      } catch {
        // Ignore
      }
    }
    return String(reply || '').trim() || null;
  } catch {
    return null;
  }
}

export async function translateSpanishSpeech(transcriptEs) {
  await Promise.all([loadVocabularyPack().catch(() => null), loadVerbsPack().catch(() => null)]);

  const cleanTranscript = String(transcriptEs || '').trim();
  if (!cleanTranscript) {
    return {
      engineUsed: 'None',
      naturalEnglish: '',
      glossEnglish: '',
      clauses: [],
      coveragePct: 0,
      verbsFound: []
    };
  }

  const rawClauses = cleanTranscript
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Split very long run-on speech transcripts (from continuous STT without punctuation) into readable ~18-word segments
  const clauses = [];
  for (const rc of rawClauses) {
    const words = rc.split(/\s+/);
    if (words.length <= 24) {
      clauses.push(rc);
    } else {
      for (let idx = 0; idx < words.length; idx += 18) {
        clauses.push(words.slice(idx, idx + 18).join(' '));
      }
    }
  }

  const localClauses = clauses.map((c) => translateClauseLocally(c));
  const chromeTranslations = await tryChromeBuiltInTranslator(clauses);

  let totalMatched = 0;
  let totalTokens = 0;
  const allVerbs = [];

  const mergedClauses = localClauses.map((lc, idx) => {
    totalMatched += lc.matchedTokens;
    totalTokens += lc.totalTokens;
    allVerbs.push(...lc.verbsFound);
    const chromeEn = chromeTranslations && chromeTranslations[idx] ? chromeTranslations[idx] : '';
    return {
      es: lc.es,
      glossEn: lc.en,
      en: chromeEn || lc.en,
      matchedPhrases: lc.matchedPhrases
    };
  });

  const glossEnglish = mergedClauses.map((c) => c.glossEn).filter(Boolean).join('. ');
  const naturalEnglish = mergedClauses.map((c) => c.en).filter(Boolean).join(' ');
  const coveragePct = totalTokens > 0 ? Math.round((totalMatched / totalTokens) * 100) : 0;

  return {
    engineUsed: chromeTranslations
      ? 'Chrome On-Device Translator + Local AP Dictionary'
      : 'Local AP Phrase & Conjugation Translator',
    naturalEnglish,
    glossEnglish,
    clauses: mergedClauses,
    coveragePct,
    verbsFound: allVerbs
  };
}

function checkChunkInTranscript(chunkTarget, transcriptEs, verbIndex) {
  const bareTranscript = stripSpanishDiacritics(String(transcriptEs || '').toLowerCase());
  const cleanChunk = stripSpanishDiacritics(
    String(chunkTarget || '')
      .toLowerCase()
      .replace(/[¿¡.,;:!?"'()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  if (!cleanChunk) return false;

  if (bareTranscript.includes(cleanChunk)) return true;

  // Check multi-part chunks separated by "..."
  if (cleanChunk.includes('...')) {
    const parts = cleanChunk
      .split('...')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0 && parts.every((p) => bareTranscript.includes(p))) return true;
  }

  // Fuzzy token overlap (allowing conjugated verb stems from the same infinitive!)
  const chunkTokens = cleanChunk
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS_ES.has(t));
  if (chunkTokens.length === 0) return false;

  const transcriptWords = bareTranscript.match(/[a-z0-9]+/g) || [];
  const transcriptWordSet = new Set(transcriptWords);
  const transcriptInfinitives = new Set();
  for (const w of transcriptWords) {
    const vInfo = verbIndex.get(w);
    if (vInfo?.infinitive) {
      transcriptInfinitives.add(stripSpanishDiacritics(vInfo.infinitive.toLowerCase()));
    }
  }

  let hits = 0;
  for (const ct of chunkTokens) {
    if (transcriptWordSet.has(ct)) {
      hits++;
      continue;
    }
    const ctVerb = verbIndex.get(ct);
    if (ctVerb && transcriptInfinitives.has(stripSpanishDiacritics(ctVerb.infinitive.toLowerCase()))) {
      hits++;
      continue;
    }
    // Check shared >=5 char root stem
    if (ct.length >= 5 && transcriptWords.some((tw) => tw.startsWith(ct.slice(0, 5)))) {
      hits++;
    }
  }
  return hits >= Math.ceil(chunkTokens.length * 0.7);
}

export function detectMatchedChunks(requiredChunks = [], transcriptEs = '') {
  const verbIndex = getConjugatedVerbGlossIndex();
  const matched = [];
  requiredChunks.forEach((chunk, idx) => {
    if (checkChunkInTranscript(chunk?.target || '', transcriptEs, verbIndex)) {
      matched.push(idx);
    }
  });
  return matched;
}

export async function gradeSpeakingChallenge({
  transcriptEs,
  translationResult,
  prompt,
  requiredChunks = [],
  durationSeconds = 120,
  elapsedSeconds = null
}) {
  await Promise.all([loadVocabularyPack().catch(() => null), loadVerbsPack().catch(() => null)]);

  const textEs = String(transcriptEs || '').trim();
  const bareEs = stripSpanishDiacritics(textEs.toLowerCase());
  const wordsEs = textEs.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+/g) || [];
  const wordCount = wordsEs.length;

  const naturalEn = String(translationResult?.naturalEnglish || translationResult?.glossEnglish || '').trim();
  const bareEn = naturalEn.toLowerCase();

  // 1. Required Chunks (0 - 30 pts)
  const matchedChunkIndices = detectMatchedChunks(requiredChunks, textEs);
  const totalReq = Math.max(1, requiredChunks.length);
  const chunksScore = requiredChunks.length
    ? Math.round((matchedChunkIndices.length / totalReq) * 30)
    : 30;

  // 2. Cultural Comparison & Prompt Relevance (0 - 30 pts)
  const hasCommunityRef =
    /\b(mi comunidad|mi ciudad|mi escuela|mi pais|nuestra comunidad|nuestro pais|estados unidos|aqui|donde vivo|en mi familia)\b/.test(
      bareEs
    ) || /\b(my community|my city|my school|my country|united states|where i live)\b/.test(bareEn);

  const hasHispanicRegionRef =
    /\b(argentina|bolivia|mexico|espana|colombia|peru|chile|ecuador|venezuela|cuba|puerto rico|guatemala|uruguay|paraguay|hispanohablante|latinoamerica|america latina|el mundo hispano|otra cultura|ese pais)\b/.test(
      bareEs
    ) ||
    /\b(argentina|bolivia|mexico|spain|colombia|peru|chile|latin america|spanish-speaking)\b/.test(bareEn);

  const comparisonMarkers = [
    'en comparacion',
    'a diferencia de',
    'por otro lado',
    'por un lado',
    'sin embargo',
    'mientras que',
    'en cambio',
    'ambos',
    'ambas',
    'igual que',
    'similarmente',
    'parecido',
    'semejante',
    'comparar',
    'diferencia',
    'similitud'
  ];
  const usedComparisonMarkers = comparisonMarkers.filter((m) => bareEs.includes(m));

  // Topic alignment using prompt Spanish + English keywords
  const promptEsKeywords = stripSpanishDiacritics(String(prompt?.es || '').toLowerCase())
    .match(/[a-z]{4,}/g) || [];
  const filteredPromptEs = [...new Set(promptEsKeywords.filter((w) => !STOP_WORDS_ES.has(w)))];
  const promptEnKeywords = String(prompt?.en || '')
    .toLowerCase()
    .match(/[a-z]{4,}/g) || [];
  const filteredPromptEn = [...new Set(promptEnKeywords.filter((w) => !STOP_WORDS_EN.has(w)))];

  const esTopicHits = filteredPromptEs.filter((kw) => bareEs.includes(kw.slice(0, 5))).length;
  const enTopicHits = filteredPromptEn.filter((kw) => bareEn.includes(kw.slice(0, 5))).length;
  const topicAlignmentRatio = Math.min(
    1,
    (esTopicHits + enTopicHits) / Math.max(3, Math.min(6, filteredPromptEs.length))
  );

  let comparisonScore = 0;
  if (hasCommunityRef) comparisonScore += 8;
  if (hasHispanicRegionRef) comparisonScore += 8;
  comparisonScore += Math.min(8, usedComparisonMarkers.length * 3);
  comparisonScore += Math.round(topicAlignmentRatio * 6);
  comparisonScore = Math.min(30, comparisonScore);

  // 3. Grammar, Conjugations & Vocabulary Variety (0 - 25 pts)
  const detectedVerbs = translationResult?.verbsFound || [];
  const uniqueInfinitives = new Set(detectedVerbs.map((v) => v.infinitive));
  const uniqueTenses = new Set(
    detectedVerbs.map((v) => v.tenseKey).filter((t) => t && t !== 'infinitive')
  );
  const hasAdvancedTense =
    uniqueTenses.has('present_subjunctive') ||
    uniqueTenses.has('imperfect_subjunctive') ||
    uniqueTenses.has('conditional') ||
    uniqueTenses.has('present_perfect') ||
    uniqueTenses.has('future');

  const contentWordsEs = wordsEs
    .map((w) => stripSpanishDiacritics(w.toLowerCase()))
    .filter((w) => w.length >= 4 && !STOP_WORDS_ES.has(w));
  const uniqueContentCount = new Set(contentWordsEs).size;

  const connectorsUsed = [
    'ademas',
    'sin embargo',
    'por lo tanto',
    'porque',
    'aunque',
    'en primer lugar',
    'en conclusion',
    'es importante',
    'creo que',
    'pienso que'
  ].filter((c) => bareEs.includes(c));

  let grammarVocabScore = 0;
  grammarVocabScore += Math.min(8, uniqueInfinitives.size); // up to 8 distinct verbs
  grammarVocabScore += Math.min(7, uniqueTenses.size * 2 + (hasAdvancedTense ? 2 : 0));
  grammarVocabScore += Math.min(6, Math.round(uniqueContentCount / 6));
  grammarVocabScore += Math.min(4, connectorsUsed.length);
  grammarVocabScore = Math.min(25, grammarVocabScore);

  // 4. Fluency, Pacing & Duration Scaling (0 - 15 pts)
  const targetMin = Math.max(1, (Number(durationSeconds) || 120) / 60);
  const actualSec = elapsedSeconds && elapsedSeconds > 5 ? elapsedSeconds : durationSeconds || 120;
  const actualMin = Math.max(0.25, actualSec / 60);
  const wpm = Math.round(wordCount / actualMin);
  const targetWordGoal = Math.round(targetMin * 85); // ~170 words for 2 min, ~340 words for 4 min

  const fillerMatches = bareEs.match(/\b(eh|ehm|este|um|uh|mm)\b/g) || [];
  const fillerCount = fillerMatches.length;

  let fluencyScore = 0;
  fluencyScore += Math.min(9, Math.round((wordCount / Math.max(40, targetWordGoal)) * 9));
  if (wpm >= 75) fluencyScore += 4;
  else if (wpm >= 45) fluencyScore += 2;
  else if (wordCount >= 15) fluencyScore += 1;
  if (fillerCount <= 3 && wordCount >= 20) fluencyScore += 2;
  else if (fillerCount <= 7 && wordCount >= 20) fluencyScore += 1;
  fluencyScore = Math.min(15, fluencyScore);

  const totalScore = Math.min(100, chunksScore + comparisonScore + grammarVocabScore + fluencyScore);
  const apBand =
    wordCount < 12
      ? 1
      : totalScore >= 86
        ? 5
        : totalScore >= 72
          ? 4
          : totalScore >= 55
            ? 3
            : totalScore >= 38
              ? 2
              : 1;

  const apBandLabels = {
    5: '5 — Strong (AP Exam Ready)',
    4: '4 — Good (Solid Cultural Comparison)',
    3: '3 — Fair (Adequate, Needs Deeper Comparison/Detail)',
    2: '2 — Limited (Short or Missing Key Task Elements)',
    1: '1 — Beginning (Too Brief / Off-Task)'
  };

  const strengths = [];
  const improvements = [];

  if (matchedChunkIndices.length === requiredChunks.length && requiredChunks.length > 0) {
    strengths.push(`Wove in all ${requiredChunks.length} required target chunks.`);
  } else if (requiredChunks.length > 0) {
    const missingNames = requiredChunks
      .filter((_, idx) => !matchedChunkIndices.includes(idx))
      .map((c) => `"${c.target}"`);
    improvements.push(`Include missing target chunk(s): ${missingNames.join(', ')}.`);
  }

  if (hasCommunityRef && hasHispanicRegionRef) {
    strengths.push('Referenced both your own community and a Spanish-speaking region/culture.');
  } else {
    if (!hasCommunityRef) {
      improvements.push('Explicitly reference your own community (e.g., "en mi comunidad...").');
    }
    if (!hasHispanicRegionRef) {
      improvements.push('Name a specific Spanish-speaking country or region (e.g., Argentina, Bolivia, México, España).');
    }
  }

  if (usedComparisonMarkers.length >= 2) {
    strengths.push(`Used comparison transitions (${usedComparisonMarkers.slice(0, 3).join(', ')}).`);
  } else {
    improvements.push('Add explicit comparison connectors ("en comparación con", "a diferencia de", "sin embargo", "por otro lado").');
  }

  if (uniqueTenses.size >= 2) {
    const tenseNames = [...uniqueTenses]
      .slice(0, 4)
      .map((t) => CONJUGATION_TENSE_LABELS[t] || t);
    strengths.push(`Varied verb tenses (${tenseNames.join(', ')}).`);
  } else {
    improvements.push('Mix verb tenses (add preterite, imperfect, future/conditional, or subjunctive like "espero que...").');
  }

  if (wordCount < Math.round(targetWordGoal * 0.65)) {
    improvements.push(
      `Expand your response length (~${wordCount} words spoken; aim for ~${targetWordGoal}+ words across ${targetMin} min).`
    );
  } else {
    strengths.push(`Strong speaking output (${wordCount} words at ~${wpm} WPM).`);
  }

  const nanoFeedback =
    wordCount >= 10
      ? await tryChromeGeminiNanoFeedback({
          prompt,
          requiredChunks,
          transcriptEs: textEs,
          naturalEnglish: naturalEn
        })
      : null;

  return {
    totalScore,
    apBand,
    apBandLabel: apBandLabels[apBand],
    matchedChunkIndices,
    subscores: {
      chunksScore,
      comparisonScore,
      grammarVocabScore,
      fluencyScore
    },
    metrics: {
      wordCount,
      targetWordGoal,
      wpm,
      fillerCount,
      uniqueVerbsCount: uniqueInfinitives.size,
      tensesDetected: [...uniqueTenses].map((t) => CONJUGATION_TENSE_LABELS[t] || t)
    },
    strengths,
    improvements,
    nanoFeedback
  };
}

export function buildGeminiExternalPrompt({
  prompt,
  requiredChunks = [],
  transcriptEs,
  translationResult,
  gradeResult,
  durationSeconds = 120
}) {
  const mins = Math.round(((Number(durationSeconds) || 120) / 60) * 10) / 10;
  return [
    `Please act as an official AP Spanish Language & Culture Task 4 (Cultural Comparison) grader for a ${mins}-minute spoken response.`,
    '',
    `AP Prompt (Spanish): ${prompt?.es || ''}`,
    `AP Prompt (English): ${prompt?.en || ''}`,
    `Required Chunks to Weave In: ${requiredChunks.map((c) => `"${c.target}" (${c.hint})`).join('; ')}`,
    '',
    '1. First provide a clean, natural English translation of what my Spanish speech actually communicated.',
    '2. Score my response on the College Board 1-5 AP Cultural Comparison rubric (Task Completion, Cultural Comparison, Vocabulary/Register, Grammar/Tense Accuracy).',
    '3. List specific grammar corrections ("I said -> Better AP Spanish") and 2 concrete ways to push this to a 5.',
    '',
    `Student Spanish Transcript (${gradeResult?.metrics?.wordCount || 0} words):`,
    transcriptEs || '(empty)',
    '',
    `Browser Gloss / Initial English Translation:`,
    translationResult?.naturalEnglish || translationResult?.glossEnglish || '(none)'
  ].join('\n');
}
