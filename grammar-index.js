const $ = id => document.getElementById(id);

async function loadGrammarLibrary() {
  const files = await fetch('/data/grammar/index.json').then(checkResponse).then(response => response.json());
  const topics = await Promise.all(files.map(file => fetch(`/data/grammar/${encodeURIComponent(file)}`).then(checkResponse).then(response => response.json())));
  const list = $('grammar-topic-list');
  list.replaceChildren();
  if (!topics.length) {
    const empty = document.createElement('p'); empty.className = 'grammar-empty'; empty.textContent = 'Теми з’являться тут після розбору нових матеріалів.'; list.append(empty); return;
  }
  topics.forEach((topic, index) => {
    const link = document.createElement('a');
    link.className = 'grammar-topic-card';
    link.href = `grammar-topic.html?id=${encodeURIComponent(topic.id)}`;
    const top = document.createElement('div'); top.className = 'grammar-topic-card-top';
    const tag = document.createElement('span'); tag.className = 'grammar-topic-number'; tag.textContent = `ТЕМА ${String(index + 1).padStart(2, '0')}`;
    const count = document.createElement('span');
    count.className = 'grammar-topic-exercises';
    const exampleCount = topic.practiceSets
      ? topic.practiceSets.reduce((sum, set) => sum + set.questions.length, 0)
      : (topic.practice || []).length;
    count.textContent = `${exampleCount} прикладів`;
    top.append(tag, count);
    const title = document.createElement('h2'); title.textContent = topic.title;
    const summary = document.createElement('p'); summary.textContent = topic.summary;
    const source = document.createElement('span'); source.className = 'grammar-topic-origin'; source.textContent = topic.source;
    const open = document.createElement('span'); open.className = 'grammar-topic-open'; open.textContent = 'Відкрити тему →';
    link.append(top, title, summary, source, open); list.append(link);
  });
}

async function checkResponse(response) {
  if (!response.ok) throw new Error(`Не вдалося завантажити теми (${response.status}).`);
  return response;
}

loadGrammarLibrary().catch(error => {
  const message = document.createElement('p'); message.className = 'grammar-error'; message.textContent = error.message;
  $('grammar-topic-list').replaceChildren(message);
});
