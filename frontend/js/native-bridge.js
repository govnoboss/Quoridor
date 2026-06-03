(function () {
    if (typeof window.Capacitor === 'undefined') return;

    const App = window.Capacitor.Plugins.App;

    App.addListener('backButton', function () {
        const authModal = document.getElementById('authModal');
        if (authModal && !authModal.classList.contains('hidden')) {
            UI.closeAuthModal();
            return;
        }

        const profileModal = document.getElementById('profileModal');
        if (profileModal && !profileModal.classList.contains('hidden')) {
            UI.closeProfileModal();
            return;
        }

        const disconnectModal = document.getElementById('disconnectModal');
        if (disconnectModal && !disconnectModal.classList.contains('hidden')) {
            UI.hideDisconnectOverlay();
            return;
        }

        const confirmModal = document.getElementById('confirmModal');
        if (confirmModal && confirmModal.style.display !== 'none') {
            confirmModal.style.display = 'none';
            return;
        }

        const resultModal = document.getElementById('resultModal');
        if (resultModal && !resultModal.classList.contains('hidden')) {
            resultModal.classList.add('hidden');
            return;
        }

        const gameScreen = document.getElementById('gameScreen');
        if (gameScreen && gameScreen.classList.contains('active')) {
            if (Game.isReplayMode) {
                Game.exitReplay();
                return;
            }
            if (Net.isOnline) {
                UI.handleSurrender();
                return;
            }
            Game.goToMainMenu();
            return;
        }

        const profileScreen = document.getElementById('profileScreen');
        if (profileScreen && profileScreen.classList.contains('active')) {
            UI.backToMenuFromProfile();
            return;
        }

        App.exitApp();
    });
})();
