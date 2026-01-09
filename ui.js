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

  setRulesLang(lang) {
    const ruContent = document.getElementById('rulesContentRu');
    const enContent = document.getElementById('rulesContentEn');
    const ruBtn = document.getElementById('langRu');
    const enBtn = document.getElementById('langEn');

    if (lang === 'en') {
      ruContent.classList.add('hidden');
      enContent.classList.remove('hidden');
      ruBtn.classList.remove('active');
      enBtn.classList.add('active');
    } else {
      enContent.classList.add('hidden');
      ruContent.classList.remove('hidden');
      enBtn.classList.remove('active');
      ruBtn.classList.add('active');
    }
  },
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
    UI.showConfirm(
      'Подтверждение сдачи',
      'Вы уверены, что хотите сдаться?',
      () => {
        // Пользователь подтвердил сдачу
        if (Net.isOnline) {
          Net.surrender();
        } else {
          Game.handleGameOver(1 - Game.state.currentPlayer, 'Surrender');
        }
      }
    );
  },

  /**
   * Показывает модальное окно подтверждения
   * @param {string} title - Заголовок окна
   * @param {string} message - Текст сообщения
   * @param {function} onConfirm - Callback при нажатии "Да"
   * @param {function} [onCancel] - Callback при нажатии "Отмена" (опционально)
   */
  showConfirm(title, message, onConfirm, onCancel = null) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const yesBtn = document.getElementById('confirmYes');
    const noBtn = document.getElementById('confirmNo');

    titleEl.textContent = title;
    messageEl.textContent = message;

    // Удаляем старые слушатели (если есть)
    const newYesBtn = yesBtn.cloneNode(true);
    const newNoBtn = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
    noBtn.parentNode.replaceChild(newNoBtn, noBtn);

    // Добавляем новые слушатели
    newYesBtn.onclick = () => {
      modal.style.display = 'none';
      if (onConfirm) onConfirm();
    };

    newNoBtn.onclick = () => {
      modal.style.display = 'none';
      if (onCancel) onCancel();
    };

    modal.style.display = 'flex';
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
  },

  // --- NOTIFICATIONS (Toasts) ---
  showToast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('notificationContainer');
    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    toast.textContent = msg;

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('fading');
        toast.addEventListener('animationend', () => toast.remove());
      }, duration);
    }
    return toast; // Return element in case we want to remove it manually
  },

  // --- DISCONNECT OVERLAY ---
  showDisconnectOverlay() {
    const el = document.getElementById('disconnectModal');
    el.classList.remove('hidden');
  },

  hideDisconnectOverlay() {
    const el = document.getElementById('disconnectModal');
    el.classList.add('hidden');
  }

};

UI.selectBotDifficulty = function (diff) {
  Game.pendingBotDifficulty = diff;
  UI.showScreen('colorSelectScreen');
};

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('quoridor-theme') || 'dark';
  document.body.className = saved;
  document.getElementById('themeSelect').value = saved;
});

