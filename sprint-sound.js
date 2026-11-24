(() => {
  let audio;
  window.playSprintSound = correct => {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime;
      const notes = correct ? [660, 880] : [440, 554, 659];
      notes.forEach((hz, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = now + index * 0.09;
        oscillator.type = 'sine';
        oscillator.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.21);
      });
    } catch (_) { /* звук браузера може бути недоступний */ }
  };
})();
