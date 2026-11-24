const $ = id => document.getElementById(id);
const VOWEL_CLUSTERS = /(ου|ού|ευ|εύ|αυ|αύ|υι|υί|ει|εί|οι|οί|αι|αί|[ιίϊΐηήυύϋΰοόωώεέ])/giu;
let activeGap = null;

function normalizeGreek(value) {
  return value.trim().toLocaleLowerCase('el').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function soundFor(cluster) {
  const normalized = normalizeGreek(cluster);
  if (['ι', 'η', 'υ', 'ει', 'οι', 'υι'].includes(normalized)) return 'і';
  if (['ο', 'ω'].includes(normalized)) return 'о';
  if (['ε', 'αι'].includes(normalized)) return 'е';
  return null;
}

function showToast(message) {
  const toast = $('generator-toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function updateScore() {
  const gaps = [...document.querySelectorAll('.generator-gap')];
  const correct = gaps.filter(input => input.classList.contains('correct')).length;
  $('generator-score').textContent = `${correct} / ${gaps.length}`;
}

function markInput(input) {
  input.classList.remove('correct', 'incorrect');
  const value = normalizeGreek(input.value);
  if (!value) return false;
  if (value === normalizeGreek(input.dataset.answer)) {
    input.value = input.dataset.answer;
    input.classList.add('correct');
    return true;
  }
  if (value.length >= normalizeGreek(input.dataset.answer).length) input.classList.add('incorrect');
  return false;
}

function createGap(answer, sound) {
  const input = document.createElement('input');
  input.type = 'text';
  input.lang = 'el';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.maxLength = 3;
  input.size = 3;
  input.className = 'generator-gap';
  input.dataset.answer = answer;
  input.placeholder = `[${sound}]`;
  input.setAttribute('aria-label', `Введи грецьке написання звука [${sound}]`);
  input.addEventListener('input', () => {
    markInput(input);
    $('generator-feedback').textContent = '';
    updateScore();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') $('check-exercise').click();
    if (event.key === 'ArrowRight') input.nextElementSibling?.focus();
    if (event.key === 'ArrowLeft') input.previousElementSibling?.focus();
  });
  return input;
}

function generateExercise() {
  const text = $('generator-text').value.trim();
  if (!text) {
    showToast('Встав грецький текст, щоб створити вправу.');
    $('generator-text').focus();
    return;
  }
  const masks = {
    і: $('mask-i').checked,
    о: $('mask-o').checked,
    е: $('mask-e').checked
  };
  if (!Object.values(masks).some(Boolean)) {
    showToast('Обери хоча б один звук для тренування.');
    return;
  }

  const output = $('generator-output');
  output.replaceChildren();
  let gaps = 0;
  const parts = text.split(/(\s+|[.,!?;:…«»"'()—–-]+)/u).filter(Boolean);
  for (const wordPart of parts) {
    if (!/[\p{Script=Greek}]/u.test(wordPart)) {
      output.append(document.createTextNode(wordPart));
      continue;
    }
    const clusters = wordPart.split(VOWEL_CLUSTERS).filter(Boolean);
    clusters.forEach((cluster, index) => {
      const sound = soundFor(cluster);
      let mask = false;
      if (sound && masks[sound]) {
        const density = $('mask-density').value;
        const lastCluster = clusters[clusters.length - 1];
        const atEnding = index === clusters.length - 1 || (index === clusters.length - 2 && /^[ςν]$/iu.test(lastCluster));
        mask = density === 'endings' ? atEnding : Math.random() < Number(density);
      }
      if (mask) {
        gaps++;
        output.append(createGap(cluster, sound));
      } else {
        output.append(document.createTextNode(cluster));
      }
    });
  }
  $('generator-result-toolbar').classList.toggle('hidden', gaps === 0);
  $('generator-feedback').textContent = gaps ? '' : 'У тексті не знайшлося вибраних звуків для пропусків.';
  updateScore();
  if (gaps) showToast(`Готово — ${gaps} пропусків. Полюй на правильні літери!`);
}

$('generate-exercise').addEventListener('click', generateExercise);
$('check-exercise').addEventListener('click', () => {
  const inputs = [...document.querySelectorAll('.generator-gap')];
  inputs.forEach(input => {
    if (!input.value.trim()) input.classList.add('incorrect');
    else markInput(input);
  });
  updateScore();
  const correct = inputs.filter(input => input.classList.contains('correct')).length;
  $('generator-feedback').textContent = `Правильно: ${correct} із ${inputs.length}. Червоні поля ще можна виправити.`;
});
$('reveal-exercise').addEventListener('click', () => {
  document.querySelectorAll('.generator-gap').forEach(input => {
    input.value = input.dataset.answer;
    input.classList.remove('incorrect');
    input.classList.add('correct');
  });
  updateScore();
  $('generator-feedback').textContent = 'Відповіді показано.';
});
document.addEventListener('focusin', event => {
  if (event.target instanceof HTMLInputElement && event.target.classList.contains('generator-gap')) activeGap = event.target;
});
document.querySelectorAll('.generator-keyboard button[data-char]').forEach(button => {
  button.addEventListener('click', () => {
    if (!activeGap) {
      showToast('Спочатку вибери поле для відповіді.');
      return;
    }
    activeGap.value = button.dataset.char;
    activeGap.dispatchEvent(new Event('input', { bubbles: true }));
    activeGap.focus();
  });
});

if (new URLSearchParams(location.search).get('from') === 'story') {
  try {
    const source = JSON.parse(sessionStorage.getItem('greek-sprint:writing-source') || 'null');
    if (source?.text) {
      $('generator-back').href = '#reading';
      $('generator-back').textContent = '← До тексту';
      $('generator-back').addEventListener('click', event => {
        event.preventDefault();
        history.back();
      });
      $('generator-text').value = source.text;
      $('writing-generator-source').textContent = `Текст із читання: ${source.title || 'твій текст'}`;
      $('writing-generator-source').classList.remove('hidden');
      sessionStorage.removeItem('greek-sprint:writing-source');
      generateExercise();
    }
  } catch {}
}
