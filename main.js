document.getElementById("playOnlineBtn").addEventListener("click", UI.toggleOnline);

// Создаём таймер-лейбл
let timerLabel = document.createElement("div");
timerLabel.id = "onlineTimer";
document.getElementById("mainMenu").appendChild(timerLabel);