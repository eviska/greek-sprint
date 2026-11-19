const $ = id => document.getElementById(id);
let topics = [];
let topic = null;
let questionIndex = 0;
let practiceSetIndex = 0;
let correctCount = 0;
let answered = false;

function practiceSetsFor(item) {
  return item.practiceSets || [{
    title: 'Підбери правильну форму',
    prompt: item.practicePrompt || 'Обери правильну відповідь.',
    options: item.options,
    questions: item.practice || []
  }];
}

async function loadTopics() {
  const files = await fetch('/data/grammar/index.json').then(checkResponse).then(response => response.json());
  topics = await Promise.all(files.map(file => fetch(`/data/grammar/${encodeURIComponent(file)}`).then(checkResponse).then(response => response.json())));
  if (!topics.length) throw new Error('У розділі поки немає граматичних тем.');
  const topicId = new URLSearchParams(location.search).get('id');
  const selectedTopic = topics.find(item => item.id === topicId);
  if (!selectedTopic) throw new Error('Не знайшла цю граматичну тему. Повернися до списку тем і вибери її звідти.');
  openTopic(selectedTopic);
}

async function checkResponse(response) {
  if (!response.ok) throw new Error(`Не вдалося завантажити матеріали (${response.status}).`);
  return response;
}

function openTopic(item) {
  topic = item;
  questionIndex = 0;
  practiceSetIndex = 0;
  correctCount = 0;
  document.title = `${item.title} · Грецький спринт`;
  $('grammar-source').textContent = item.source;
  $('grammar-title').textContent = item.title;
  $('grammar-explanation').textContent = item.explanation;
  const patterns = $('grammar-patterns');
  patterns.replaceChildren();
  item.patterns.forEach(pattern => {
    const card = document.createElement('div'); card.className = 'grammar-pattern';
    const greek = document.createElement('strong'); greek.lang = 'el'; greek.textContent = pattern.greek;
    const meaning = document.createElement('span'); meaning.textContent = pattern.ukrainian;
    card.append(greek, meaning); patterns.append(card);
  });
  const examples = $('grammar-examples');
  examples.replaceChildren();
  item.examples.forEach(example => {
    const card = document.createElement('div'); card.className = 'grammar-example';
    const greek = document.createElement('strong'); greek.lang = 'el'; greek.textContent = example.greek;
    const meaning = document.createElement('span'); meaning.textContent = example.ukrainian;
    card.append(greek, meaning); examples.append(card);
  });
  showQuestion();
}

function showQuestion() {
  answered = false;
  const sets = practiceSetsFor(topic);
  const exercise = sets[practiceSetIndex];
  const question = exercise.questions[questionIndex];
  $('practice-title').textContent = exercise.title;
  $('practice-noun').textContent = question.noun;
  $('practice-meaning').textContent = `· ${question.meaning}`;
  $('practice-prompt').textContent = question.prompt || exercise.prompt;
  $('practice-progress').textContent = `Вправа ${practiceSetIndex + 1}/${sets.length} · ${questionIndex + 1}/${exercise.questions.length} · ${correctCount} правильно`;
  $('practice-feedback').textContent = '';
  $('practice-feedback').className = 'practice-feedback';
  $('practice-next').classList.add('hidden');
  const options = $('practice-options');
  options.replaceChildren();
  const choices = question.options || exercise.options || topic.options || topic.patterns.map(pattern => pattern.greek);
  choices.forEach(choice => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'practice-option'; button.lang = 'el'; button.textContent = choice;
    button.addEventListener('click', () => answerQuestion(button, choice, question));
    options.append(button);
  });
}

function answerQuestion(button, selected, question) {
  if (answered) return;
  answered = true;
  const correct = selected.trim().toLocaleLowerCase('el') === question.answer.trim().toLocaleLowerCase('el');
  if (correct) correctCount++;
  [...$('practice-options').children].forEach(option => {
    option.disabled = true;
    if (option.textContent.trim().toLocaleLowerCase('el') === question.answer.trim().toLocaleLowerCase('el')) option.classList.add('correct');
    else if (option === button) option.classList.add('incorrect');
  });
  const feedback = $('practice-feedback');
  feedback.classList.add(correct ? 'ok' : 'miss');
  feedback.textContent = `${correct ? 'Так!' : `Правильна пара — ${question.answer}.`} ${question.why}`;
  const sets = practiceSetsFor(topic);
  const exercise = sets[practiceSetIndex];
  $('practice-progress').textContent = `Вправа ${practiceSetIndex + 1}/${sets.length} · ${questionIndex + 1}/${exercise.questions.length} · ${correctCount} правильно`;
  const lastQuestion = questionIndex + 1 === exercise.questions.length;
  $('practice-next').textContent = lastQuestion
    ? (practiceSetIndex + 1 < sets.length ? 'Наступна вправа →' : 'Потренувати тему ще раз ↻')
    : 'Наступний приклад →';
  $('practice-next').classList.remove('hidden');
}

$('practice-next').addEventListener('click', () => {
  const sets = practiceSetsFor(topic);
  const exercise = sets[practiceSetIndex];
  if (questionIndex + 1 < exercise.questions.length) questionIndex++;
  else if (practiceSetIndex + 1 < sets.length) { practiceSetIndex++; questionIndex = 0; }
  else { practiceSetIndex = 0; questionIndex = 0; correctCount = 0; }
  showQuestion();
});

loadTopics().catch(error => {
  const article = $('grammar-topic');
  article.replaceChildren();
  const message = document.createElement('p'); message.className = 'grammar-error'; message.textContent = error.message;
  article.append(message);
});
