const UI = {
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },
  showModeSelect() { this.showScreen('modeScreen'); },
  backToMenu() { this.showScreen('mainMenu'); },
  showSettings() { this.showScreen('settingsScreen'); },
  showRules() { this.showScreen('rulesScreen'); },
  showAbout() { this.showScreen('aboutScreen'); },
  saveSettings() {
    const theme = document.getElementById('themeSelect').value;
    document.body.className = theme;
    localStorage.setItem('quoridor-theme', theme);
    alert('Настройки сохранены!');
    this.backToMenu();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('quoridor-theme') || 'dark';
  document.body.className = saved;
  document.getElementById('themeSelect').value = saved;
});