const $ = id => document.getElementById(id);
const intro = $('intro');
const game = $('game');
const result = $('result');
const reading = $('reading');
const vocabulary = $('vocabulary');
const lessonsPanel = $('lessons');
const writing = $('writing');
const TYPE_LABELS = { phrase: 'Коротка фраза', word: 'Слово', question: 'Запитання' };
const ROUND_SECONDS = 60;
let cards = [];
let stories = [];
let currentStory = null;
let progress = { version: 1, cards: {}, totals: { sessions: 0, answers: 0, correct: 0, incorrect: 0 } };
let seconds = ROUND_SECONDS;
let score = 0;
let streak = 0;
let timer = null;
let current = null;
let history = [];
let recentIds = [];
let locked = false;
let writeQueue = Promise.resolve();
let vocabularyPage = 0;
let readingReturn = 'intro';
let lessons = [];
let writingQueue = [];
let writingIndex = 0;
let writingCorrect = 0;
let writingRevealed = false;
let writingPhase = 'preview';
let writingTiles = [];
let writingSlots = [];
let draggedTile = null;
const VOCABULARY_PAGE_SIZE = 20;

function api(path, options = {}) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }).then(async response => {
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  });
}

function queueWrite(path, body) {
  writeQueue = writeQueue.then(() => api(path, { method: 'POST', body: JSON.stringify(body) }))
    .catch(error => {
      $('storage-note').textContent = `Не вдалося зберегти прогрес: ${error.message}`;
      $('storage-note').classList.add('load-error');
    });
}

function getCardProgress(card) {
  return progress.cards?.[card.id] || { seen: 0, correct: 0, incorrect: 0, streak: 0, intervalDays: 0, lastSeen: null, nextDue: null };
}

function lessonContainsCard(lesson, card) {
  return lesson.vocabulary?.some(term => (typeof term === 'string' ? term : term.greek) === card.greek);
}

function cardSourceNames(card) {
  const matchingLessons = lessons.filter(lesson => lessonContainsCard(lesson, card));
  const names = [];
  const sourceLesson = lessons.find(lesson => lesson.source === card.source);
  const fallbackName = card.source === 'kiosk-vocabulary' ? 'Словник кіоску'
    : card.source?.endsWith('-previous-source') ? `Попередній матеріал · ${lessons.find(lesson => lesson.id === 'periptero-fournos-kafeteria-a1-a2')?.title || 'Періптеро'}`
      : card.source?.replace(/-vocabulary$/,'').replace(/-/g,' ');
  if (card.source) names.push(stories.find(item => item.id === card.source)?.title || sourceLesson?.title || fallbackName);
  matchingLessons.forEach(lesson => names.push(lesson.title));
  return [...new Set(names)];
}

function buildWritingItems() {
  const unique = new Map();
  cards.filter(card => card.type === 'word' && !getCardProgress(card).suspended).forEach(card => {
    const key = `${card.greek.trim().toLocaleLowerCase('el')}|${card.ukrainian.trim().toLocaleLowerCase('uk')}`;
    const item = unique.get(key) || { ...card, sources: [] };
    item.sources = [...new Set([...item.sources, ...cardSourceNames(card)])];
    unique.set(key, item);
  });
  return [...unique.values()];
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function writingGraphemes(text) {
  if (Intl.Segmenter) return [...new Intl.Segmenter('el', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  return Array.from(text.normalize('NFC'));
}

function renderWriting() {
  const select = $('writing-source');
  const selected = select.value || 'all';
  const items = buildWritingItems();
  const names = [...new Set(items.flatMap(item => item.sources))].sort((a, b) => a.localeCompare(b, 'uk'));
  const existing = new Set([...select.options].map(option => option.value));
  names.forEach(name => { if (!existing.has(name)) select.add(new Option(name, name)); });
  const filtered = selected === 'all' ? items : items.filter(item => item.sources.includes(selected));
  $('writing-count').textContent = `${filtered.length} активних слів · одна коротка вправа — 5 слів`;
  writingQueue = shuffle(filtered).slice(0, 5);
  writingIndex = 0; writingCorrect = 0; writingRevealed = false; writingPhase = 'preview';
  showWritingCard();
}

function showWritingCard() {
  const item = writingQueue[writingIndex];
  $('writing-feedback').textContent = '';
  $('writing-feedback').className = 'writing-feedback';
  $('writing-answer').value = '';
  $('writing-builder').classList.add('hidden');
  $('writing-begin').classList.remove('hidden');
  $('writing-prompt').classList.remove('hidden');
  $('writing-meaning').classList.remove('hidden');
  $('writing-begin').disabled = !item;
  $('writing-next').classList.add('hidden');
  $('writing-known').textContent = `${writingCorrect} складено`;
  $('writing-step').textContent = writingQueue.length ? `Слово ${writingIndex + 1} з ${writingQueue.length}` : 'Немає слів';
  if (!item) {
    $('writing-prompt').textContent = 'У цій добірці поки немає слів';
    $('writing-meaning').textContent = '';
    $('writing-prompt-label').textContent = 'Вибери інший матеріал або додай слова до колоди';
    $('writing-card-source').textContent = '';
    $('writing-begin').classList.add('hidden');
    return;
  }
  $('writing-prompt').textContent = item.greek;
  $('writing-prompt-label').textContent = writingPhase === 'preview' ? 'Подивись на слово і його значення' : 'Склади слово з літер';
  $('writing-meaning').textContent = item.ukrainian;
  $('writing-card-source').textContent = item.sources.length ? `З матеріалу: ${item.sources.join(' · ')}` : 'Джерело не вказане';
  if (writingPhase === 'build') {
    $('writing-prompt').classList.add('hidden');
    $('writing-builder').classList.remove('hidden');
    $('writing-begin').classList.add('hidden');
    initializeLetterBuilder();
    $('writing-answer').focus();
  }
}

function initializeLetterBuilder() {
  const item = writingQueue[writingIndex];
  if (!item) return;
  const graphemes = writingGraphemes(item.greek);
  writingTiles = shuffle(graphemes.map((letter, id) => ({ id, letter })).filter(tile => tile.letter !== ' '));
  writingSlots = graphemes.map(letter => letter === ' ' ? { letter: ' ', fixed: true } : null);
  renderLetterBuilder();
}

function renderLetterBuilder() {
  const bank = $('letter-bank');
  const slots = $('letter-slots');
  slots.replaceChildren(); bank.replaceChildren();
  writingSlots.forEach((tile, index) => {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = tile?.fixed ? 'letter-slot letter-space' : 'letter-slot';
    target.dataset.slot = index;
    target.setAttribute('aria-label', tile?.fixed ? 'пробіл' : tile ? `позиція ${index + 1}: ${tile.letter}` : `позиція ${index + 1}`);
    if (tile?.fixed) target.textContent = '·';
    else if (tile) { target.textContent = tile.letter; target.classList.add('filled'); target.title = 'Натисни, щоб повернути літеру'; }
    target.addEventListener('click', () => { if (writingSlots[index] && !writingSlots[index].fixed) { writingTiles.push(writingSlots[index]); writingSlots[index] = null; renderLetterBuilder(); } });
    target.addEventListener('dragover', event => event.preventDefault());
    target.addEventListener('drop', event => { event.preventDefault(); placeWritingTile(draggedTile, index); });
    slots.append(target);
  });
  writingTiles.forEach(tile => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'letter-tile'; button.textContent = tile.letter; button.lang = 'el';
    button.setAttribute('aria-label', `Додати літеру ${tile.letter}`);
    button.addEventListener('click', () => placeWritingTile(tile.id));
    button.draggable = true;
    button.addEventListener('dragstart', () => { draggedTile = tile.id; });
    bank.append(button);
  });
  bank.ondragover = event => event.preventDefault();
  bank.ondrop = event => { event.preventDefault(); returnWritingTile(draggedTile); };
}

function placeWritingTile(tileId, slotIndex = null) {
  const tileIndex = writingTiles.findIndex(tile => tile.id === tileId);
  if (tileIndex < 0) return;
  const tile = writingTiles.splice(tileIndex, 1)[0];
  const destination = slotIndex ?? writingSlots.findIndex(slot => !slot);
  if (destination < 0) { writingTiles.push(tile); return; }
  if (writingSlots[destination] && !writingSlots[destination].fixed) writingTiles.push(writingSlots[destination]);
  if (writingSlots[destination]?.fixed) { writingTiles.push(tile); return; }
  writingSlots[destination] = tile;
  renderLetterBuilder();
}

function returnWritingTile(tileId) {
  const slotIndex = writingSlots.findIndex(tile => tile?.id === tileId);
  if (slotIndex < 0) return;
  writingTiles.push(writingSlots[slotIndex]); writingSlots[slotIndex] = null; renderLetterBuilder();
}

function typeWritingLetters(value) {
  for (const letter of writingGraphemes(value.normalize('NFC'))) {
    if (letter === ' ' && writingSlots.some(slot => slot?.fixed)) continue;
    const tile = writingTiles.find(item => item.letter.toLocaleLowerCase('el') === letter.toLocaleLowerCase('el'));
    if (tile) placeWritingTile(tile.id);
    else { $('writing-feedback').textContent = `Літери «${letter}» у цьому слові немає.`; $('writing-feedback').className = 'writing-feedback miss'; }
  }
  $('writing-answer').value = '';
}

function checkWritingAnswer() {
  const item = writingQueue[writingIndex];
  if (!item || writingPhase !== 'build') return;
  const answer = writingSlots.map(slot => slot?.letter || '').join('').normalize('NFC').toLocaleLowerCase('el');
  const expected = item.greek.normalize('NFC').toLocaleLowerCase('el');
  const feedback = $('writing-feedback');
  if (answer === expected) {
    writingCorrect++;
    writingPhase = 'checked';
    feedback.textContent = 'Так, слово складено правильно!'; feedback.className = 'writing-feedback ok';
    $('writing-prompt').textContent = item.greek; $('writing-prompt').classList.remove('hidden');
    $('writing-prompt-label').textContent = 'Готово';
    $('writing-builder').classList.add('hidden');
    $('writing-next').classList.remove('hidden');
    $('writing-next').textContent = writingIndex + 1 >= writingQueue.length ? 'Завершити вправу ✓' : 'Наступне слово →';
    $('writing-known').textContent = `${writingCorrect} складено`;
  } else {
    feedback.textContent = 'Ще не зовсім: поверни або перемісти плитки й спробуй ще раз.';
    feedback.className = 'writing-feedback miss';
  }
}

function refreshDashboard() {
  const now = Date.now();
  const activeCards = cards.filter(card => !getCardProgress(card).suspended);
  const newCards = activeCards.filter(card => getCardProgress(card).seen === 0).length;
  const dueCards = activeCards.filter(card => {
    const state = getCardProgress(card);
    return state.seen > 0 && (!state.nextDue || Date.parse(state.nextDue) <= now);
  }).length;
  $('deck-count').textContent = cards.length;
  $('new-count').textContent = newCards;
  $('due-count').textContent = dueCards;
  $('best').textContent = progress.totals.best || 0;
  $('played').textContent = progress.totals.sessions || 0;
  $('total-correct').textContent = progress.totals.correct || 0;
  $('start').disabled = activeCards.length === 0;
  if (!activeCards.length) $('start').textContent = 'Усі картки призупинені';
  else if ($('start').textContent === 'Усі картки призупинені') $('start').textContent = 'Почати спринт →';
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let point = Math.random() * total;
  for (const item of items) {
    point -= item.weight;
    if (point <= 0) return item.card;
  }
  return items.at(-1).card;
}

function pickCard() {
  const activeCards = cards.filter(card => !getCardProgress(card).suspended);
  let candidates = activeCards.filter(card => !recentIds.includes(card.id));
  if (!candidates.length) candidates = activeCards.filter(card => card.id !== current?.id);
  if (!candidates.length) candidates = activeCards;
  if (!candidates.length) return;
  const now = Date.now();
  const weighted = candidates.map(card => {
    const state = getCardProgress(card);
    let weight;
    if (!state.seen) weight = 8; // нові картки мають найбільший пріоритет
    else if (!state.nextDue || Date.parse(state.nextDue) <= now) weight = 6;
    else if (state.streak === 0) weight = 2.5; // нещодавно помилкові
    else weight = 0.3; // відомі теж повертаються, але рідко
    return { card, weight };
  });
  const answerCard = weightedPick(weighted);
  const normalizeTranslation = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
  const answerGreek = answerCard.greek.trim().replace(/\s+/g, ' ').toLocaleLowerCase('el');
  const answerTranslation = normalizeTranslation(answerCard.ukrainian);
  const decoys = cards.filter(card =>
    card.type === answerCard.type &&
    !getCardProgress(card).suspended &&
    card.id !== answerCard.id &&
    card.greek.trim().replace(/\s+/g, ' ').toLocaleLowerCase('el') !== answerGreek &&
    normalizeTranslation(card.ukrainian) !== answerTranslation
  );
  // Duplicate cards from different story perspectives must never make a correct translation look false.
  const canShowFalse = decoys.length > 0;
  const isTrue = !canShowFalse || Math.random() < 0.66;
  const decoy = canShowFalse ? decoys[Math.floor(Math.random() * decoys.length)] : null;
  current = { ...answerCard, shown: isTrue ? answerCard.ukrainian : decoy.ukrainian, isTrue };
  recentIds.push(answerCard.id);
  if (recentIds.length > 3) recentIds.shift();

  $('card-label').textContent = TYPE_LABELS[answerCard.type] || 'Фраза';
  $('greek').textContent = answerCard.greek;
  $('meaning').textContent = current.shown;
  $('feedback').textContent = '';
  $('true').disabled = $('false').disabled = false;
  locked = false;
}

function playSound(correct) {
  window.playSprintSound?.(correct);
}

function answer(choice) {
  if (locked || seconds <= 0 || !current) return;
  locked = true;
  const correct = choice === current.isTrue;
  history.push({
    cardId: current.id,
    greek: current.greek,
    shown: current.shown,
    translation: current.ukrainian,
    isTrue: current.isTrue,
    choice,
    correct
  });
  const state = getCardProgress(current);
  const now = new Date().toISOString();
  const updated = { ...state, seen: state.seen + 1, lastSeen: now };
  if (correct) {
    updated.correct++;
    updated.streak++;
    updated.intervalDays = [1, 3, 7, 14, 30][Math.min(updated.streak - 1, 4)];
  } else {
    updated.incorrect++;
    updated.streak = 0;
    updated.intervalDays = 0.25;
  }
  updated.nextDue = new Date(Date.now() + updated.intervalDays * 86400000).toISOString();
  progress.cards[current.id] = updated;
  queueWrite('/api/answer', { cardId: current.id, correct, answeredAt: now });

  playSound(correct);
  if (correct) {
    score++;
    streak++;
    $('feedback').textContent = 'Так, правильно!';
    $('feedback').style.color = 'var(--green)';
  } else {
    streak = 0;
    $('feedback').textContent = 'Не цього разу — продовжуй!';
    $('feedback').style.color = 'var(--red)';
  }
  $('score').textContent = score;
  $('streak').textContent = streak;
  $('true').disabled = $('false').disabled = true;
  refreshDashboard();
  setTimeout(() => { if (seconds > 0) pickCard(); }, 300);
}

function tick() {
  seconds--;
  $('time').textContent = `00:${String(seconds).padStart(2, '0')}`;
  $('fill').style.width = `${seconds / ROUND_SECONDS * 100}%`;
  if (seconds <= 15) $('fill').style.background = 'var(--red)';
  if (seconds <= 0) finishRound();
}

function appendReviewItem(item, index) {
  const row = document.createElement('article');
  row.className = 'review-item';
  const greek = document.createElement('div');
  greek.className = 'gr';
  greek.textContent = `${index + 1}. ${item.greek}`;
  const shown = document.createElement('div');
  shown.textContent = `Переклад на картці: ${item.shown}`;
  const resultLine = document.createElement('div');
  resultLine.className = item.correct ? 'ok' : 'miss';
  resultLine.textContent = item.correct
    ? (item.isTrue ? 'Правда — правильно' : 'Неправда — правильно')
    : `Твоя відповідь: ${item.choice ? 'Правда' : 'Неправда'} · правильна: ${item.isTrue ? 'Правда' : 'Неправда'}`;
  row.append(greek, shown, resultLine);
  if (!item.isTrue || !item.correct) {
    const translation = document.createElement('div');
    translation.textContent = `Правильний переклад: ${item.translation}`;
    row.append(translation);
  }
  $('review-list').append(row);
}

function renderStories() {
  const list = $('story-list');
  list.replaceChildren();
  for (const story of stories) {
    const button = document.createElement('button');
    button.className = 'story-choice';
    const title = document.createElement('strong');
    title.textContent = story.title;
    const perspective = document.createElement('span');
    perspective.textContent = `${story.perspective} · ${story.paragraphs.length} речень`;
    button.append(title, perspective);
    button.addEventListener('click', () => openStory(story));
    list.append(button);
  }
}

function renderLessons() {
  const list = $('lesson-list'); list.replaceChildren();
  const typeFilter = $('lesson-type-filter');
  const topicFilter = $('lesson-topic-filter');
  const addOptions = (select, allLabel, values) => {
    const selected = select.value || 'all';
    select.replaceChildren(new Option(allLabel, 'all'));
    [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'uk')).forEach(value => select.add(new Option(value,value)));
    select.value = [...select.options].some(option => option.value === selected) ? selected : 'all';
  };
  addOptions(typeFilter, 'Усі типи', lessons.map(lesson => lesson.materialType || 'PDF-матеріал'));
  addOptions(topicFilter, 'Усі теми', lessons.flatMap(lesson => lesson.topics || []));
  const query = $('lesson-search').value.trim().toLocaleLowerCase('uk');
  const visibleLessons = lessons.filter(lesson => {
    const type = lesson.materialType || 'PDF-матеріал';
    if (typeFilter.value !== 'all' && type !== typeFilter.value) return false;
    if (topicFilter.value !== 'all' && !(lesson.topics || []).includes(topicFilter.value)) return false;
    const searchable = [lesson.title, lesson.level, lesson.description, type, ...(lesson.topics || [])].join(' ').toLocaleLowerCase('uk');
    return !query || searchable.includes(query);
  });
  $('lesson-empty').classList.toggle('hidden', visibleLessons.length > 0);
  visibleLessons.forEach(lesson => {
    const state = progress.lessons?.[lesson.id] || { completed: [] };
    const link = document.createElement('a');
    link.className = 'story-choice lesson-choice';
    link.href = `/lessons/${encodeURIComponent(lesson.id)}`;
    const title = document.createElement('strong'); title.textContent = lesson.title;
    const detail = document.createElement('span');
    detail.textContent = `${lesson.level} · ${state.completed?.length || 0} з ${lesson.exercises.length} вправ позначено виконаними`;
    const tags = document.createElement('span'); tags.className = 'material-tags';
    [lesson.materialType || 'PDF-матеріал', ...(lesson.topics || [])].forEach((value, index) => {
      const tag = document.createElement('span'); tag.className = 'material-tag'; tag.textContent = value;
      if (index === 0) tag.classList.add('material-type-tag');
      tags.append(tag);
    });
    const action = document.createElement('span'); action.className = 'lesson-open-label'; action.textContent = 'Відкрити повний урок →';
    link.append(title, detail, tags, action); list.append(link);
  });
}
function openLessons() {
  [intro, game, result, reading, vocabulary, writing].forEach(panel => panel.classList.add('hidden'));
  lessonsPanel.classList.remove('hidden'); renderLessons();
}

function renderVocabulary() {
  const query = $('vocabulary-search').value.trim().toLocaleLowerCase('uk');
  const filter = $('vocabulary-filter').value;
  const sort = $('vocabulary-sort').value;
  const source = $('vocabulary-source').value;
  const filtered = cards.filter(card => {
    const state = getCardProgress(card);
    if (filter === 'active' && state.suspended) return false;
    if (filter === 'paused' && !state.suspended) return false;
    if (source !== 'all') {
      if (source.startsWith('lesson:')) {
        const lesson = lessons.find(item => item.id === source.slice(7));
        if (!lesson || !lessonContainsCard(lesson, card)) return false;
      } else if (card.source !== source) return false;
    }
    return !query || `${card.greek} ${card.ukrainian}`.toLocaleLowerCase('uk').includes(query);
  }).sort((a, b) => {
    const greekOrder = a.greek.localeCompare(b.greek, 'el');
    if (sort === 'mastery-asc') return (getCardProgress(a).correct || 0) - (getCardProgress(b).correct || 0) || greekOrder;
    if (sort === 'mastery-desc') return (getCardProgress(b).correct || 0) - (getCardProgress(a).correct || 0) || greekOrder;
    return greekOrder;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / VOCABULARY_PAGE_SIZE));
  vocabularyPage = Math.min(vocabularyPage, pageCount - 1);
  const pageCards = filtered.slice(vocabularyPage * VOCABULARY_PAGE_SIZE, (vocabularyPage + 1) * VOCABULARY_PAGE_SIZE);
  const paused = cards.filter(card => getCardProgress(card).suspended).length;
  const mastered = cards.filter(card => (getCardProgress(card).correct || 0) >= 5).length;
  $('vocabulary-summary').textContent = `${cards.length} карток · ${cards.length - paused} для тренування · ${paused} призупинено · ${mastered} мають 5+ правильних відповідей`;
  const list = $('vocabulary-list');
  list.replaceChildren();
  if (!pageCards.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-vocabulary';
    empty.textContent = query ? 'Нічого не знайдено.' : 'У цій категорії поки немає карток.';
    list.append(empty);
  }
  for (const card of pageCards) {
    const state = getCardProgress(card);
    const row = document.createElement('article');
    const mastery = Math.min(5, state.correct || 0);
    row.className = `vocabulary-card mastery-${mastery}${state.suspended ? ' paused' : ''}`;
    const head = document.createElement('div');
    head.className = 'vocabulary-card-head';
    const masteryBadge = document.createElement('span');
    masteryBadge.className = `mastery-badge mastery-badge-${mastery}`;
    masteryBadge.setAttribute('aria-label', `${mastery} з 5 правильних відповідей для рівня знайомства`);
    const masteryDot = document.createElement('span');
    masteryDot.className = 'mastery-dot';
    masteryDot.setAttribute('aria-hidden', 'true');
    const masteryText = document.createElement('span');
    masteryText.textContent = `${mastery}/5 правильно`;
    masteryBadge.append(masteryDot, masteryText);
    const info = document.createElement('div');
    const greek = document.createElement('div');
    greek.className = 'vocabulary-greek';
    greek.lang = 'el';
    greek.textContent = card.greek;
    const translation = document.createElement('div');
    translation.className = 'vocabulary-translation';
    translation.textContent = card.ukrainian;
    const meta = document.createElement('div');
    meta.className = 'vocabulary-meta';
    const accuracy = state.seen ? Math.round(state.correct / state.seen * 100) : null;
    const next = state.suspended ? 'призупинено' : state.seen ? `наступне повторення: ${state.nextDue ? new Date(state.nextDue).toLocaleDateString('uk') : 'коли буде доречно'}` : 'ще не тренувалася';
    const sourceName = lessons.find(item => lessonContainsCard(item, card))?.title || stories.find(item => item.id === card.source)?.title || card.source;
    meta.textContent = `${sourceName} · ${TYPE_LABELS[card.type] || 'Картка'} · ${state.seen} відповідей · ${accuracy === null ? 'без статистики' : `${accuracy}% правильно`} · ${next}`;
    info.append(greek, translation, meta);
    head.append(info, masteryBadge);
    row.append(head);
    const actions = document.createElement('div');
    actions.className = 'vocabulary-card-actions';
    const action = document.createElement('button');
    action.className = state.suspended ? 'yes' : 'secondary';
    action.textContent = state.suspended ? 'Повернути до тренування' : 'Знаю · призупинити';
    action.addEventListener('click', () => changeCardStatus(card, state.suspended ? 'active' : 'paused'));
    actions.append(action);
    if (!state.suspended && (state.seen || state.streak)) {
      const learning = document.createElement('button');
      learning.className = 'secondary';
      learning.textContent = 'Ще вчу';
      learning.title = 'Скинути інтервал повторення, зберігши історію відповідей';
      learning.addEventListener('click', () => changeCardStatus(card, 'learning'));
      actions.append(learning);
    }
    row.append(actions);
    list.append(row);
  }
  $('vocabulary-page').textContent = `${vocabularyPage + 1} / ${pageCount}`;
  $('vocabulary-prev').disabled = vocabularyPage === 0;
  $('vocabulary-next').disabled = vocabularyPage >= pageCount - 1;
}

async function changeCardStatus(card, status) {
  const previous = { ...getCardProgress(card) };
  const state = { ...previous, suspended: status === 'paused' };
  if (status === 'learning') {
    state.streak = 0;
    state.intervalDays = 0;
    state.nextDue = new Date().toISOString();
  } else if (status === 'active' && !state.seen) {
    state.nextDue = null;
  }
  progress.cards[card.id] = state;
  $('vocabulary-notice').textContent = status === 'paused' ? 'Картку призупинено.' : status === 'active' ? 'Картку повернуто до тренування.' : 'Інтервал повторення скинуто.';
  renderVocabulary();
  $('vocabulary-list').querySelectorAll('.vocabulary-card-actions button').forEach(button => { button.disabled = true; });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      await api('/api/card-status', { method: 'POST', body: JSON.stringify({ cardId: card.id, status }), signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    refreshDashboard();
    renderVocabulary();
  } catch (error) {
    progress.cards[card.id] = previous;
    refreshDashboard();
    renderVocabulary();
    const staleServer = error.message.includes('Unknown API endpoint');
    const timedOut = error.name === 'AbortError';
    $('vocabulary-notice').textContent = staleServer
      ? 'Не збережено: сервер запущений зі старою версією. Зупини його клавішами Ctrl+C і запусти командою python3 server.py.'
      : timedOut
        ? 'Не вдалося зберегти: сервер не відповів за 10 секунд. Перевір, чи він запущений.'
        : `Не вдалося зберегти зміну: ${error.message}`;
  }
}

function isGreekWordCharacter(character) {
  return Boolean(character) && /[\p{L}\p{N}]/u.test(character);
}

function appendStoryLine(container, story, line) {
  const matchingCards = cards
    .filter(card => card.source === story.id && (card.type === 'phrase' || card.type === 'word'))
    .sort((a, b) => b.greek.length - a.greek.length);
  const normalizedLine = line.toLocaleLowerCase('el');
  let position = 0;
  let plainStart = 0;

  while (position < line.length) {
    const match = matchingCards.find(card => {
      const phrase = card.greek.toLocaleLowerCase('el');
      const end = position + phrase.length;
      const leftBoundary = position === 0 || !isGreekWordCharacter(normalizedLine[position - 1]);
      const rightBoundary = end === line.length || !isGreekWordCharacter(normalizedLine[end]);
      return leftBoundary && rightBoundary && normalizedLine.startsWith(phrase, position);
    });

    if (!match) {
      position++;
      continue;
    }

    if (position > plainStart) container.append(document.createTextNode(line.slice(plainStart, position)));
    const end = position + match.greek.length;
    const phraseButton = document.createElement('button');
    phraseButton.type = 'button';
    phraseButton.className = 'interactive-phrase';
    phraseButton.setAttribute('aria-label', `${line.slice(position, end)} — переклад: ${match.ukrainian}`);
    phraseButton.setAttribute('aria-expanded', 'false');
    phraseButton.append(document.createTextNode(line.slice(position, end)));
    const tooltip = document.createElement('span');
    tooltip.className = 'phrase-tooltip';
    tooltip.textContent = match.ukrainian;
    tooltip.setAttribute('aria-hidden', 'true');
    phraseButton.append(tooltip);
    phraseButton.addEventListener('click', event => {
      event.stopPropagation();
      const wasSelected = phraseButton.classList.contains('selected');
      container.querySelectorAll('.interactive-phrase.selected').forEach(selected => {
        selected.classList.remove('selected');
        selected.setAttribute('aria-expanded', 'false');
      });
      if (!wasSelected) {
        phraseButton.classList.add('selected');
        phraseButton.setAttribute('aria-expanded', 'true');
      }
    });
    container.append(phraseButton);
    position = end;
    plainStart = end;
  }

  if (plainStart < line.length) container.append(document.createTextNode(line.slice(plainStart)));
}

function normalizedPhraseChars(value) {
  return Array.from(value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('el'));
}

function phraseAlignment(expected, actual) {
  const target = normalizedPhraseChars(expected);
  const typed = normalizedPhraseChars(actual);
  const dp = Array.from({ length: target.length + 1 }, () => Array(typed.length + 1).fill(0));
  for (let i = target.length - 1; i >= 0; i--) {
    for (let j = typed.length - 1; j >= 0; j--) {
      dp[i][j] = target[i] === typed[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const targetMatched = new Set();
  const typedMatched = new Set();
  let i = 0, j = 0;
  while (i < target.length && j < typed.length) {
    if (target[i] === typed[j]) { targetMatched.add(i++); typedMatched.add(j++); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { targetMatched, typedMatched, exact: target.length === typed.length && targetMatched.size === target.length };
}

function appendMarkedText(container, value, matched, className) {
  Array.from(value).forEach((character, index) => {
    const span = document.createElement('span');
    span.textContent = character;
    if (!matched.has(index)) span.className = className;
    container.append(span);
  });
}

function renderSentenceWriting(story) {
  const cardTranslations = new Map(cards.map(card => [card.greek.trim(), card.ukrainian]));
  const practiceParagraphs = [];
  for (const paragraph of story.paragraphs) {
    if (/^(?:Και τώρα κάποιες ερωτήσεις|Και τώρα ερωτήσεις|Ερωτήσεις)(?:[.!?;\s]|$)/i.test(paragraph.trim())) break;
    practiceParagraphs.push(paragraph);
  }
  const sentences = story.writingPractice?.sentences?.length
    ? story.writingPractice.sentences
    : practiceParagraphs.flatMap((paragraph, paragraphIndex) => {
      const parts = paragraph.split(/(?<=[.!?;])\s+/u).map(part => part.replace(/^\d+\.\s*/, '').trim()).filter(part => part && !/^\d+\.$/.test(part) && /[.!?;]$/.test(part));
      const translatedParts = (story.translation?.[paragraphIndex] || '').split(/(?<=[.!?;])\s+/u).map(part => part.trim()).filter(Boolean);
      return parts.map(part => ({
        greek: part,
        ukrainian: parts.length === translatedParts.length && translatedParts.length
          ? translatedParts[parts.indexOf(part)]
          : cardTranslations.get(part)
      }));
    });
  const section = $('sentence-writing');
  const list = $('sentence-writing-list');
  section.classList.toggle('hidden', sentences.length === 0);
  list.replaceChildren();
  sentences.forEach((sentence, index) => {
    const row = document.createElement('article');
    row.className = 'sentence-writing-row';
    const number = document.createElement('span');
    number.className = 'sentence-writing-number';
    number.textContent = `${index + 1}.`;
    const content = document.createElement('div');
    content.className = 'sentence-writing-content';
    const prompt = document.createElement('p');
    prompt.className = 'sentence-writing-prompt';
    prompt.lang = 'el';
    prompt.textContent = sentence.greek;
    const input = document.createElement('input');
    input.className = 'sentence-writing-input';
    input.type = 'text'; input.lang = 'el'; input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
    input.placeholder = 'Передрукуй речення…';
    const feedback = document.createElement('p');
    feedback.className = 'sentence-writing-feedback';
    feedback.setAttribute('aria-live', 'polite');
    const controls = document.createElement('div');
    controls.className = 'sentence-writing-controls';
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'secondary small-button'; toggle.textContent = 'Писати з української';
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'yes small-button'; check.textContent = 'Показати помилки';
    let source = 'greek';
    if (!sentence.ukrainian) toggle.classList.add('hidden');
    toggle.addEventListener('click', () => {
      source = source === 'greek' ? 'ukrainian' : 'greek';
      prompt.textContent = source === 'greek' ? sentence.greek : sentence.ukrainian;
      prompt.lang = source === 'greek' ? 'el' : 'uk';
      toggle.textContent = source === 'greek' ? 'Писати з української' : 'Показати грецьку';
      feedback.replaceChildren();
    });
    check.addEventListener('click', () => {
      feedback.replaceChildren();
      feedback.className = 'sentence-writing-feedback';
      const { targetMatched, typedMatched, exact } = phraseAlignment(sentence.greek, input.value);
      const status = document.createElement('strong');
      status.textContent = exact ? 'Збігається точно ✓' : 'Червоним позначено місця для виправлення';
      feedback.append(status);
      if (!exact) {
        const attemptLine = document.createElement('span');
        attemptLine.className = 'phrase-writing-diff-line';
        const attemptLabel = document.createElement('small'); attemptLabel.textContent = 'Твоя спроба: ';
        attemptLine.append(attemptLabel);
        appendMarkedText(attemptLine, input.value.trim() || 'порожньо', typedMatched, 'phrase-writing-error');
        feedback.append(attemptLine);
      }
      const answerLine = document.createElement('span');
      answerLine.className = 'phrase-writing-diff-line';
      const answerLabel = document.createElement('small'); answerLabel.textContent = 'Грецький оригінал: ';
      answerLine.append(answerLabel);
      appendMarkedText(answerLine, sentence.greek, targetMatched, 'phrase-writing-error');
      feedback.append(answerLine);
    });
    controls.append(toggle, check);
    content.append(prompt, input, controls, feedback);
    row.append(number, content);
    list.append(row);
  });
}

function openStory(story) {
  currentStory = story;
  $('story-title').textContent = story.title;
  $('story-perspective').textContent = story.perspective;
  const text = $('story-text');
  text.replaceChildren();
  for (const line of story.paragraphs) {
    const paragraph = document.createElement('p');
    appendStoryLine(paragraph, story, line);
    text.append(paragraph);
  }
  renderSentenceWriting(story);
  $('story-list-view').classList.add('hidden');
  $('story-reader').classList.remove('hidden');
}

function openReading(returnTo) {
  readingReturn = returnTo;
  if (returnTo === 'game') clearInterval(timer);
  intro.classList.add('hidden');
  game.classList.add('hidden');
  result.classList.add('hidden');
  vocabulary.classList.add('hidden');
  writing.classList.add('hidden');
  lessonsPanel.classList.add('hidden');
  reading.classList.remove('hidden');
  $('story-list-view').classList.remove('hidden');
  $('story-reader').classList.add('hidden');
}

function returnFromReading() {
  reading.classList.add('hidden');
  $(readingReturn).classList.remove('hidden');
  if (readingReturn === 'game') timer = setInterval(tick, 1000);
}

reading.addEventListener('click', event => {
  if (event.target.closest('.interactive-phrase')) return;
  reading.querySelectorAll('.interactive-phrase.selected').forEach(selected => {
    selected.classList.remove('selected');
    selected.setAttribute('aria-expanded', 'false');
  });
});

function finishRound() {
  if (game.classList.contains('hidden')) return;
  clearInterval(timer);
  const rightTrue = history.filter(item => item.correct && item.isTrue).length;
  const rightFalse = history.filter(item => item.correct && !item.isTrue).length;
  const errors = history.length - score;
  $('final-score').textContent = score;
  $('true-count').textContent = rightTrue;
  $('false-count').textContent = rightFalse;
  $('error-count').textContent = errors;
  $('review-list').replaceChildren();
  history.forEach(appendReviewItem);
  game.classList.add('hidden');
  result.classList.remove('hidden');
  queueWrite('/api/finish', { score, answers: history.length });
  progress.totals.sessions = (progress.totals.sessions || 0) + 1;
  progress.totals.answers = (progress.totals.answers || 0) + history.length;
  progress.totals.correct = (progress.totals.correct || 0) + score;
  progress.totals.incorrect = (progress.totals.incorrect || 0) + errors;
  progress.totals.best = Math.max(progress.totals.best || 0, score);
  refreshDashboard();
}

function beginRound() {
  clearInterval(timer);
  seconds = ROUND_SECONDS;
  score = 0;
  streak = 0;
  history = [];
  recentIds = [];
  current = null;
  $('score').textContent = '0';
  $('streak').textContent = '0';
  $('time').textContent = '01:00';
  $('fill').style.width = '100%';
  $('fill').style.background = 'var(--green)';
  intro.classList.add('hidden');
  result.classList.add('hidden');
  game.classList.remove('hidden');
  pickCard();
  timer = setInterval(tick, 1000);
}

async function initialize() {
  try {
    const [deck, savedProgress, storyFiles, lessonFiles] = await Promise.all([api('/api/cards'), api('/api/progress'), api('/data/stories/index.json'), api('/data/lessons/index.json')]);
    const savedStories = await Promise.all(storyFiles.map(file => api(`/data/stories/${encodeURIComponent(file)}`)));
    lessons = await Promise.all(lessonFiles.map(file => api(`/data/lessons/${encodeURIComponent(file)}`)));
    cards = deck;
    progress = savedProgress;
    stories = savedStories;
    renderStories();
    renderLessons();
    const sourceSelect = $('vocabulary-source');
    const sources = [...new Set(cards.map(card => card.source))];
    lessons.forEach(lesson => sourceSelect.add(new Option(lesson.title, 'lesson:' + lesson.id)));
    sources.filter(source => !lessons.some(item => item.source === source)).forEach(source => {
      const option = new Option(stories.find(item => item.id === source)?.title || source, source);
      sourceSelect.add(option);
    });
    refreshDashboard();
    $('start').textContent = 'Почати спринт →';
    $('open-reading').disabled = false;
    $('open-lessons').disabled = false;
    $('open-vocabulary').disabled = false;
    $('open-writing').disabled = false;
    renderVocabulary();
  } catch (error) {
    $('start').classList.add('hidden');
    $('load-error').classList.remove('hidden');
    $('load-error').textContent = `Не вдалося завантажити матеріали. Запусти сервер командою python3 server.py у теці проєкту. (${error.message})`;
  }
}

$('start').addEventListener('click', beginRound);
$('again').addEventListener('click', beginRound);
$('open-reading').addEventListener('click', () => openReading('intro'));
$('open-lessons').addEventListener('click', openLessons);
$('lesson-search').addEventListener('input', renderLessons);
$('lesson-type-filter').addEventListener('change', renderLessons);
$('lesson-topic-filter').addEventListener('change', renderLessons);
$('lessons-home').addEventListener('click', () => { lessonsPanel.classList.add('hidden'); intro.classList.remove('hidden'); });
$('game-reading').addEventListener('click', () => openReading('game'));
$('result-reading').addEventListener('click', () => openReading('result'));
$('open-vocabulary').addEventListener('click', () => {
  intro.classList.add('hidden');
  lessonsPanel.classList.add('hidden');
  vocabulary.classList.remove('hidden');
  vocabularyPage = 0;
  renderVocabulary();
});
$('vocabulary-home').addEventListener('click', () => {
  vocabulary.classList.add('hidden');
  intro.classList.remove('hidden');
});
$('vocabulary-search').addEventListener('input', () => { vocabularyPage = 0; renderVocabulary(); });
$('vocabulary-filter').addEventListener('change', () => { vocabularyPage = 0; renderVocabulary(); });
$('vocabulary-source').addEventListener('change', () => { vocabularyPage = 0; renderVocabulary(); });
$('vocabulary-sort').addEventListener('change', () => { vocabularyPage = 0; renderVocabulary(); });
$('vocabulary-prev').addEventListener('click', () => { vocabularyPage--; renderVocabulary(); });
$('vocabulary-next').addEventListener('click', () => { vocabularyPage++; renderVocabulary(); });
$('open-writing').addEventListener('click', () => {
  [intro, game, result, reading, vocabulary, lessonsPanel].forEach(panel => panel.classList.add('hidden'));
  writing.classList.remove('hidden');
  writingQueue = []; renderWriting();
});
$('writing-home').addEventListener('click', () => { writing.classList.add('hidden'); intro.classList.remove('hidden'); });
$('writing-source').addEventListener('change', () => { writingQueue = []; renderWriting(); });
$('writing-begin').addEventListener('click', () => { writingPhase = 'build'; showWritingCard(); });
$('writing-check').addEventListener('click', checkWritingAnswer);
$('writing-answer').addEventListener('input', event => typeWritingLetters(event.target.value));
$('writing-answer').addEventListener('keydown', event => { if (event.key === 'Enter') checkWritingAnswer(); });
$('writing-undo').addEventListener('click', () => {
  const index = writingSlots.findLastIndex ? writingSlots.findLastIndex(slot => slot && !slot.fixed) : writingSlots.map(slot => slot && !slot.fixed).lastIndexOf(true);
  if (index >= 0) { writingTiles.push(writingSlots[index]); writingSlots[index] = null; renderLetterBuilder(); }
});
$('writing-clear').addEventListener('click', () => renderLetterBuilder());
$('writing-next').addEventListener('click', () => {
  if (writingIndex + 1 >= writingQueue.length) { writingQueue = []; renderWriting(); return; }
  writingIndex++; writingRevealed = false; writingPhase = 'preview'; showWritingCard();
});
$('reading-home').addEventListener('click', () => {
  returnFromReading();
});
$('back-to-stories').addEventListener('click', () => {
  $('story-reader').classList.add('hidden');
  $('story-list-view').classList.remove('hidden');
});
$('story-spelling-link').addEventListener('click', () => {
  if (!currentStory) return;
  try {
    sessionStorage.setItem('greek-sprint:writing-source', JSON.stringify({
      title: currentStory.title,
      text: currentStory.paragraphs.join('\n')
    }));
  } catch {}
});
$('true').addEventListener('click', () => answer(true));
$('false').addEventListener('click', () => answer(false));
document.addEventListener('keydown', event => {
  if (game.classList.contains('hidden')) return;
  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') answer(true);
  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') answer(false);
});

initialize();
