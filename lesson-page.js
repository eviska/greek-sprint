const $ = id => document.getElementById(id);
const lessonId = decodeURIComponent(location.pathname.replace(/^\/lessons\//, '').replace(/\/$/, ''));
const normalize = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('el').replace(/[.,!?;:«»“”„'’]/g, '').replace(/\s+/g, ' ').trim();
let lesson;
let state;
let saveQueue = Promise.resolve();
let saveTimer;
let lessonSprintWords = [];
let lessonSprintRecent = new Set();
let lessonSprintQueue = [];
let lessonSprintIndex = 0;
let lessonSprintScore = 0;
let lessonSprintCurrent = null;
let lessonSprintLocked = false;
let lessonSprintAdvanceTimer;
const LESSON_SPRINT_SIZE = 10;

async function api(path, options) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error((await response.text()) || ('HTTP ' + response.status));
  return response.status === 204 ? null : response.json();
}

function saveProgress(immediate = false) {
  clearTimeout(saveTimer);
  const write = () => {
    const payload = JSON.stringify({ lessonId: lesson.id, state });
    saveQueue = saveQueue.catch(() => {}).then(() => api('/api/lesson-progress', { method: 'POST', body: payload }))
      .then(() => { $('lesson-save-status').textContent = 'Прогрес збережено'; })
      .catch(error => { $('lesson-save-status').textContent = 'Не вдалося зберегти: ' + error.message; });
  };
  if (immediate) write();
  else saveTimer = setTimeout(write, 350);
}

function markCompleted(id) {
  if (!state.completed.includes(id)) state.completed.push(id);
}
function renderProgress() {
  const total = lesson.exercises.length;
  const done = state.completed.length;
  $('progress-fill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  $('progress-label').textContent = done + ' з ' + total + ' вправ позначено виконаними';
}

function renderVocabulary() {
  const query = $('vocab-search').value.trim().toLocaleLowerCase('uk');
  const container = $('unit-vocabulary');
  container.replaceChildren();
  const groups = new Map();
  lesson.vocabulary.forEach(term => {
    if (query && !(term.greek + ' ' + term.ukrainian).toLocaleLowerCase('uk').includes(query)) return;
    if (!groups.has(term.group)) groups.set(term.group, []);
    groups.get(term.group).push(term);
  });
  if (!groups.size) {
    const empty = document.createElement('p'); empty.className = 'empty-terms'; empty.textContent = 'Слова не знайдено.';
    container.append(empty); return;
  }
  groups.forEach((terms, groupName) => {
    const group = document.createElement('section'); group.className = 'vocab-group';
    const heading = document.createElement('h3'); heading.textContent = groupName;
    const grid = document.createElement('div'); grid.className = 'vocab-grid';
    terms.forEach(term => {
      const row = document.createElement('article'); row.className = 'vocab-term';
      const greek = document.createElement('span'); greek.lang = 'el'; greek.textContent = term.greek;
      const translation = document.createElement('span'); translation.textContent = term.ukrainian;
      row.append(greek, translation); grid.append(row);
    });
    group.append(heading, grid); container.append(group);
  });
}

function buildLessonSprintWords(deck) {
  const unique = new Map();
  for (const term of lesson.vocabulary) {
    const key = `${term.greek.trim().normalize('NFC').toLocaleLowerCase('el')}|${term.ukrainian.trim().toLocaleLowerCase('uk')}`;
    if (unique.has(key)) continue;
    const matches = deck.filter(card => card.greek.trim().normalize('NFC').toLocaleLowerCase('el') === term.greek.trim().normalize('NFC').toLocaleLowerCase('el'));
    matches.sort((a, b) => Number(b.source === lesson.source) - Number(a.source === lesson.source));
    unique.set(key, { ...term, key, cardId: matches[0]?.id || null });
  }
  lessonSprintWords = [...unique.values()];
  $('lesson-sprint-count').textContent = `${lessonSprintWords.length} слів у матеріалі`;
  $('lesson-sprint-start-button').disabled = !lessonSprintWords.length;
  if (!lessonSprintWords.length) $('lesson-sprint-count').textContent = 'У цьому матеріалі поки немає слів для спринту.';
}

function shuffleLessonSprint(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function makeLessonSprintRound() {
  const size = Math.min(LESSON_SPRINT_SIZE, lessonSprintWords.length);
  let available = lessonSprintWords.filter(term => !lessonSprintRecent.has(term.key));
  if (available.length < size) { lessonSprintRecent.clear(); available = lessonSprintWords; }
  const selected = shuffleLessonSprint(available).slice(0, size);
  selected.forEach(term => lessonSprintRecent.add(term.key));
  const questions = selected.map((target, index) => {
    const decoys = lessonSprintWords.filter(term => term.key !== target.key && term.ukrainian.trim().toLocaleLowerCase('uk') !== target.ukrainian.trim().toLocaleLowerCase('uk'));
    const isTrue = !decoys.length || Math.random() < 0.65;
    const decoy = decoys.length ? decoys[Math.floor(Math.random() * decoys.length)] : target;
    return { target, shown: isTrue ? target.ukrainian : decoy.ukrainian, isTrue };
  });
  if (questions.length > 1 && lessonSprintWords.length > 1 && questions.every(question => question.isTrue)) {
    const question = questions.at(-1);
    const decoy = lessonSprintWords.find(term => term.key !== question.target.key && term.ukrainian.trim().toLocaleLowerCase('uk') !== question.target.ukrainian.trim().toLocaleLowerCase('uk'));
    if (decoy) { question.shown = decoy.ukrainian; question.isTrue = false; }
  }
  lessonSprintQueue = questions;
  lessonSprintIndex = 0;
  lessonSprintScore = 0;
  $('lesson-sprint-start').classList.add('hidden');
  $('lesson-sprint-result').classList.add('hidden');
  $('lesson-sprint-game').classList.remove('hidden');
  showLessonSprintQuestion();
}

function showLessonSprintQuestion() {
  lessonSprintCurrent = lessonSprintQueue[lessonSprintIndex];
  if (!lessonSprintCurrent) return;
  lessonSprintLocked = false;
  $('lesson-sprint-question-number').textContent = `Слово ${lessonSprintIndex + 1} з ${lessonSprintQueue.length}`;
  $('lesson-sprint-score').textContent = `Правильно: ${lessonSprintScore}`;
  $('lesson-sprint-greek').textContent = lessonSprintCurrent.target.greek;
  $('lesson-sprint-translation').textContent = lessonSprintCurrent.shown;
  $('lesson-sprint-feedback').textContent = '';
  $('lesson-sprint-feedback').className = 'lesson-sprint-feedback';
  $('lesson-sprint-true').disabled = $('lesson-sprint-false').disabled = false;
  $('lesson-sprint-next').classList.add('hidden');
}

function recordLessonSprintAnswer(cardId, correct) {
  if (!cardId) return;
  saveQueue = saveQueue.catch(() => {}).then(() => api('/api/answer', {
    method: 'POST', body: JSON.stringify({ cardId, correct, answeredAt: new Date().toISOString() })
  })).catch(error => { $('lesson-save-status').textContent = 'Не вдалося зберегти відповідь спринту: ' + error.message; });
}

function answerLessonSprint(choice) {
  if (lessonSprintLocked || !lessonSprintCurrent) return;
  lessonSprintLocked = true;
  const correct = choice === lessonSprintCurrent.isTrue;
  if (correct) lessonSprintScore++;
  recordLessonSprintAnswer(lessonSprintCurrent.target.cardId, correct);
  $('lesson-sprint-true').disabled = $('lesson-sprint-false').disabled = true;
  const feedback = $('lesson-sprint-feedback');
  feedback.classList.add(correct ? 'correct' : 'incorrect');
  if (correct) feedback.textContent = `Правильно! ${lessonSprintCurrent.target.greek} — ${lessonSprintCurrent.target.ukrainian}.`;
  else if (!lessonSprintCurrent.isTrue) feedback.textContent = `Це неправда. Правильно: ${lessonSprintCurrent.target.greek} — ${lessonSprintCurrent.target.ukrainian}.`;
  else feedback.textContent = `Це правда: ${lessonSprintCurrent.target.greek} — ${lessonSprintCurrent.target.ukrainian}.`;
  $('lesson-sprint-score').textContent = `Правильно: ${lessonSprintScore}`;
  $('lesson-sprint-next').textContent = lessonSprintIndex + 1 >= lessonSprintQueue.length ? 'Підсумок раунду →' : 'Наступне слово →';
  $('lesson-sprint-next').classList.remove('hidden');
  lessonSprintAdvanceTimer = setTimeout(nextLessonSprintQuestion, 850);
}

function nextLessonSprintQuestion() {
  clearTimeout(lessonSprintAdvanceTimer);
  if (lessonSprintIndex + 1 < lessonSprintQueue.length) {
    lessonSprintIndex++;
    showLessonSprintQuestion();
    return;
  }
  $('lesson-sprint-game').classList.add('hidden');
  $('lesson-sprint-result').classList.remove('hidden');
  $('lesson-sprint-final-score').textContent = `${lessonSprintScore} із ${lessonSprintQueue.length} правильно`;
  saveQueue = saveQueue.catch(() => {}).then(() => api('/api/finish', {
    method: 'POST', body: JSON.stringify({ score: lessonSprintScore, answers: lessonSprintQueue.length })
  })).catch(error => { $('lesson-save-status').textContent = 'Не вдалося зберегти раунд: ' + error.message; });
}

function renderGrammar() {
  const root = $('grammar-cards'); root.replaceChildren();
  lesson.grammar.forEach((entry, index) => {
    const card = document.createElement('article'); card.className = 'grammar-card';
    const title = document.createElement('h3'); title.textContent = (index + 1) + '. ' + entry.title;
    const text = document.createElement('p'); text.textContent = entry.text;
    const examples = document.createElement('ul');
    entry.examples.forEach(example => { const li = document.createElement('li'); li.lang = 'el'; li.textContent = example; examples.append(li); });
    card.append(title, text, examples); root.append(card);
  });
}

function renderReading() {
  $('reading-title').textContent = lesson.reading.title;
  const root = $('reading-passage'); root.replaceChildren();
  lesson.reading.paragraphs.forEach(line => { const p = document.createElement('p'); p.textContent = line; root.append(p); });
  if (lesson.reading.glossary?.length) {
    const gloss = document.createElement('details'); gloss.className = 'reading-glossary';
    const summary = document.createElement('summary'); summary.textContent = 'Слова до тексту';
    const list = document.createElement('div'); list.className = 'reading-glossary-list';
    lesson.reading.glossary.forEach(greek => {
      const term = lesson.vocabulary.find(item => item.greek === greek);
      if (!term) return;
      const chip = document.createElement('span'); chip.innerHTML = '';
      const gr = document.createElement('strong'); gr.lang = 'el'; gr.textContent = term.greek;
      const uk = document.createElement('span'); uk.textContent = term.ukrainian;
      chip.append(gr, uk); list.append(chip);
    });
    gloss.append(summary, list); root.after(gloss);
  }
}

function exerciseSupport(exercise) {
  if (!exercise.support?.length) return null;
  const details = document.createElement('details'); details.className = 'exercise-support';
  const summary = document.createElement('summary'); summary.textContent = 'Підглянути слова';
  const terms = document.createElement('div'); terms.className = 'support-terms';
  exercise.support.forEach(value => {
    const term = lesson.vocabulary.find(item => item.greek === value);
    if (!term) return;
    const chip = document.createElement('span'); chip.innerHTML = '';
    const gr = document.createElement('strong'); gr.lang = 'el'; gr.textContent = term.greek;
    const uk = document.createElement('span'); uk.textContent = term.ukrainian;
    chip.append(gr, uk); terms.append(chip);
  });
  details.append(summary, terms); return details;
}

function makeField(item, index, exercise) {
  let field;
  if (['odd-one', 'matching', 'choice'].includes(exercise.type) || (exercise.type === 'mixed' && item.kind !== 'text')) {
    field = document.createElement('select');
    field.add(new Option(exercise.type === 'matching' ? 'Обери відповідь…' : 'Обери варіант…', ''));
    const options = exercise.type === 'matching' ? exercise.options : exercise.type === 'odd-one' ? item.options :
      item.kind === 'truefalse' ? [{ label: 'Σωστό — Правда', value: 'Σ' }, { label: 'Λάθος — Неправда', value: 'Λ' }] : item.options;
    options.forEach(option => {
      const label = typeof option === 'string' ? option : option.label;
      const value = typeof option === 'string' ? option : option.value;
      field.add(new Option(label, value));
    });
  } else {
    field = document.createElement('input'); field.type = 'text'; field.autocomplete = 'off'; field.lang = 'el';
    field.placeholder = item.answers?.length > 1 && item.answers[0].includes(';') ? 'Розділи відповіді крапкою з комою' : 'Введи відповідь грецькою';
  }
  field.id = 'answer-' + exercise.id + '-' + index;
  return field;
}

function checkItem(item, value) {
  if (item.contains) {
    const answer = normalize(value);
    return item.contains.every(word => answer.includes(normalize(word)));
  }
  return (item.answers || [item.answer]).some(answer => normalize(value) === normalize(answer));
}
function expectedHint(item, exercise) {
  if (exercise.type === 'matching') return exercise.options.find(option => option.value === item.answer)?.label || item.answer;
  return item.sample || item.answers?.[0] || item.answer || '';
}
function evaluateRows(rows, exercise) {
  const results = rows.map(({ item, field }) => checkItem(item, field.value));
  if (exercise.type === 'matching') {
    const counts = new Map();
    rows.forEach(({ field }) => { if (field.value) counts.set(field.value, (counts.get(field.value) || 0) + 1); });
    rows.forEach(({ field }, index) => { if (counts.get(field.value) > 1) results[index] = false; });
  }
  return results;
}

function renderExercise(exercise, index) {
  if (exercise.type === 'writing') return;
  const card = document.createElement('article'); card.className = 'practice-card'; card.id = 'exercise-' + exercise.id;
  const head = document.createElement('div'); head.className = 'practice-title';
  const number = document.createElement('span'); number.className = 'practice-number'; number.textContent = String(index + 1).padStart(2, '0');
  const title = document.createElement('h3'); title.textContent = exercise.title;
  head.append(number, title);
  const instruction = document.createElement('p'); instruction.className = 'practice-instruction'; instruction.textContent = exercise.instruction;
  card.append(head, instruction);
  const support = exerciseSupport(exercise); if (support) card.append(support);
  if (exercise.wordbank) {
    const bank = document.createElement('div'); bank.className = 'word-bank';
    const label = document.createElement('strong'); label.textContent = 'Банк слів: ';
    const words = document.createElement('span'); words.lang = 'el'; words.textContent = exercise.wordbank.join(' · ');
    bank.append(label, words); card.append(bank);
  }
  const rows = [];
  exercise.items.forEach((item, itemIndex) => {
    const row = document.createElement('div'); row.className = 'question-row';
    const prompt = document.createElement('label'); prompt.htmlFor = 'answer-' + exercise.id + '-' + itemIndex;
    const text = document.createElement('span'); text.className = 'question-prompt'; text.lang = /[\u0370-\u03ff]/.test(item.prompt) ? 'el' : 'uk'; text.textContent = (itemIndex + 1) + '. ' + item.prompt;
    const field = makeField(item, itemIndex, exercise);
    const result = document.createElement('span'); result.className = 'answer-feedback';
    prompt.append(text); row.append(prompt, field, result); card.append(row);
    const key = exercise.id + ':' + itemIndex;
    field.value = state.answers[key] || '';
    rows.push({ item, field, result, key });
  });
  const check = document.createElement('button'); check.className = 'check-button'; check.type = 'button'; check.textContent = 'Перевірити цю вправу';
  const summary = document.createElement('p'); summary.className = 'exercise-result'; summary.setAttribute('role', 'status');
  const restoreCheckedState = () => {
    if (!state.attempts[exercise.id]) return;
    const results = evaluateRows(rows, exercise);
    let correct = 0;
    rows.forEach(({ item, field, result }, index) => {
      const ok = results[index];
      if (ok) correct++;
      result.className = 'answer-feedback ' + (ok ? 'correct' : 'incorrect');
      result.textContent = ok ? 'Правильно ✓' : (expectedHint(item, exercise) ? 'Варіант: ' + expectedHint(item, exercise) : 'Ще раз — перевір підказку.');
    });
    const all = correct === rows.length;
    summary.className = 'exercise-result ' + (all ? 'correct' : 'incorrect');
    summary.textContent = all ? 'Усі відповіді правильні.' : 'Правильно ' + correct + ' із ' + rows.length + '. Виправ помилки й перевір ще раз.';
  };
  check.addEventListener('click', () => {
    const results = evaluateRows(rows, exercise);
    let correct = 0;
    rows.forEach(({ item, field, result, key }, index) => {
      const ok = results[index];
      if (ok) correct++;
      result.className = 'answer-feedback ' + (ok ? 'correct' : 'incorrect');
      result.textContent = ok ? 'Правильно ✓' : (expectedHint(item, exercise) ? 'Варіант: ' + expectedHint(item, exercise) : 'Перевір підказку й спробуй ще.');
      state.answers[key] = field.value;
    });
    state.attempts[exercise.id] = (state.attempts[exercise.id] || 0) + 1;
    const all = correct === rows.length;
    if (all) markCompleted(exercise.id);
    summary.className = 'exercise-result ' + (all ? 'correct' : 'incorrect');
    summary.textContent = all ? 'Усі відповіді правильні.' : 'Правильно ' + correct + ' із ' + rows.length + '. Виправ помилки й перевір ще раз.';
    saveProgress(true); renderProgress();
  });
  card.append(check, summary); $('exercise-list').append(card); restoreCheckedState();
}

function renderExercises() {
  $('exercise-list').replaceChildren();
  lesson.exercises.forEach((exercise, index) => renderExercise(exercise, index));
  const writing = lesson.exercises.find(exercise => exercise.type === 'writing');
  if (writing) {
    $('writing-instruction').textContent = writing.instruction;
    $('writing-draft').value = state.draft || '';
    renderWritingCount();
  }
}
function renderWritingCount() {
  const count = $('writing-draft').value.trim().split(/\s+/).filter(Boolean).length;
  const writing = lesson.exercises.find(exercise => exercise.type === 'writing');
  const guidance = writing?.wordRange
    ? ` · орієнтир: ${writing.wordRange[0]}–${writing.wordRange[1]} слів`
    : ' · рекомендовано 5–6 речень';
  $('writing-count').textContent = count + (count === 1 ? ' слово' : ' слів') + guidance;
}
function renderWritingReview() {
  const container = $('writing-review-content');
  container.replaceChildren();
  if (!state.feedback) {
    container.textContent = 'Після перевірки тут з’являться виправлення й коментарі.';
    return;
  }
  state.feedback.split('\n').forEach((line, index) => {
    if (index) container.append(document.createElement('br'));
    container.append(document.createTextNode(line));
  });
}

async function initialize() {
  try {
    const files = await api('/data/lessons/index.json');
    const names = files;
    const list = await Promise.all(names.map(name => api('/data/lessons/' + encodeURIComponent(name))));
    lesson = list.find(item => item.id === lessonId);
    if (!lesson) throw new Error('Урок не знайдено');
    const [progress, deck] = await Promise.all([api('/api/progress'), api('/api/cards')]);
    state = progress.lessons?.[lesson.id] || { completed: [], attempts: {}, answers: {}, draft: '' };
    state.completed ||= []; state.attempts ||= {}; state.answers ||= {}; state.draft ||= '';
    state.feedback ||= '';
    document.title = lesson.title + ' · Грецький спринт';
    $('lesson-level').textContent = lesson.level;
    $('lesson-title').textContent = lesson.title;
    $('lesson-description').textContent = lesson.description;
    $('lesson-pdf').href = '/data/lessons/' + encodeURIComponent(lesson.pdf);
    renderVocabulary(); buildLessonSprintWords(deck); renderGrammar(); renderReading(); renderExercises(); renderWritingReview(); renderProgress();
    $('vocab-search').addEventListener('input', renderVocabulary);
    $('lesson-sprint-start-button').addEventListener('click', makeLessonSprintRound);
    $('lesson-sprint-again').addEventListener('click', makeLessonSprintRound);
    $('lesson-sprint-true').addEventListener('click', () => answerLessonSprint(true));
    $('lesson-sprint-false').addEventListener('click', () => answerLessonSprint(false));
    $('lesson-sprint-next').addEventListener('click', nextLessonSprintQuestion);
    $('writing-draft').addEventListener('input', () => { state.draft = $('writing-draft').value; renderWritingCount(); saveProgress(); });
    $('writing-complete').addEventListener('click', () => {
      if (!$('writing-draft').value.trim()) { $('writing-feedback').textContent = 'Спершу напиши кілька речень грецькою.'; return; }
      markCompleted('writing'); $('writing-feedback').textContent = 'Чернетку збережено. Перевір артиклі, назви магазинів і ціни.';
      saveProgress(true); renderProgress();
    });
  } catch (error) {
    $('lesson-main').innerHTML = '<section class="lesson-hero"><h1>Не вдалося завантажити урок</h1><p>' + error.message + '</p><a href="/">Повернутися до Грецького спринту</a></section>';
  }
}
initialize();
