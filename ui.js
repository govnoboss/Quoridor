const UI = {
  // Добавленные переменные для таймера
  searchTimerInterval: null,
  searchTime: 0,

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
  },
  
  // Отключает все кнопки, кроме тех, что в контейнере поиска
  disableAll(excludeSearch = false) {
      document.querySelectorAll('.menu-buttons button').forEach(b => {
        // Исключаем кнопки, которые должны работать во время поиска
        if (b.id === 'cancelSearchBtn') {
            return;
        }
        b.disabled = true;
      });
    },
  // Включает все кнопки
  enableAll() {
    document.querySelectorAll('button').forEach(b => b.disabled = false);
  },

  updateSearchTimer() {
    this.searchTime++;
    const minutes = Math.floor(this.searchTime / 60);
    const seconds = this.searchTime % 60;
    const timeString = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    document.getElementById('searchTimer').textContent = timeString;
  },

  showSearch() {
      // 1. Изменение UI
      this.disableAll(); 
      document.getElementById('playOnlineBtn').classList.add('hidden');
      document.getElementById('cancelSearchBtn').classList.remove('hidden');
      document.getElementById('searchTimer').classList.remove('hidden');
      document.getElementById('cancelSearchBtn').disabled = false;

      // 2. Запуск таймера
      this.searchTime = 0;
      this.updateSearchTimer();
      this.searchTimerInterval = setInterval(() => this.updateSearchTimer(), 1000);
      
      // 3. Сетевой запрос на поиск игры
      if (typeof Net !== 'undefined') {
          Net.findGame();
      }
    },

  handleSurrender() {
      const confirmSurrender = confirm("Вы уверены, что хотите сдаться?");
      if (confirmSurrender) {
          if (Net.isOnline) {
              Net.surrender();
          } else {
              Game.handleGameOver(1 - Game.state.currentPlayer, 'Surrender');
          }
      }
  },

  hideSearch() {
    // 1. Остановка таймера
    if (this.searchTimerInterval) {
      clearInterval(this.searchTimerInterval);
      this.searchTimerInterval = null;
    }

    // 2. Изменение UI
    this.enableAll(); 
    document.getElementById('playOnlineBtn').classList.remove('hidden');
    document.getElementById('cancelSearchBtn').classList.add('hidden');
    document.getElementById('searchTimer').classList.add('hidden');


  }

};

UI.selectBotDifficulty = function(diff) {
  Game.pendingBotDifficulty = diff;
  UI.showScreen('colorSelectScreen');
};

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('quoridor-theme') || 'dark';
  document.body.className = saved;
  document.getElementById('themeSelect').value = saved;
});

