// public/client.js - Logique côté client pour Complot

// --- Initialisation ---
// Se connecte au serveur Socket.IO qui tourne sur le même hôte/port
// La variable 'io' est disponible grâce au script /socket.io/socket.io.js inclus dans l'HTML
const socket = io();

// Récupération des éléments du DOM (les objets HTML)
const lobbyContainer = document.getElementById('lobby-container');
const playerNameInput = document.getElementById('playerName');
const lobbyNameInput = document.getElementById('lobbyName');
const joinButton = document.getElementById('joinButton');
const messageArea = document.getElementById('message-area');
const gameArea = document.getElementById('game-area'); // La future zone de jeu

// --- Gestion de la Connexion au Lobby ---

// Ajoute un écouteur d'événement sur le clic du bouton "Rejoindre"
joinButton.addEventListener('click', () => {
    // Récupère les valeurs entrées par l'utilisateur
    const playerName = playerNameInput.value.trim(); // .trim() enlève les espaces avant/après
    const lobbyName = lobbyNameInput.value.trim();

    // Validation simple : vérifie que les champs ne sont pas vides
    if (!playerName || !lobbyName) {
        messageArea.textContent = '⚠️ Veuillez entrer un pseudo et un nom de lobby !';
        return; // Arrête l'exécution si la validation échoue
    }

    // Si tout est bon, on efface les anciens messages
    messageArea.textContent = 'Connexion en cours... ⏳';
    // On désactive le bouton pour éviter les clics multiples
    joinButton.disabled = true;
    joinButton.textContent = 'Connexion...';


    // Émission de l'événement 'join_lobby' vers le serveur Node.js
    // On envoie un objet contenant le nom du joueur et le nom du lobby
    socket.emit('join_lobby', { playerName, lobbyName });

    // Note : La suite (cacher le formulaire, afficher le jeu)
    // devrait idéalement être déclenchée par une réponse du serveur
    // confirmant que le lobby a été rejoint avec succès.
    // On ajoutera ça avec socket.on('lobby_joined', ...)
});

// --- Écouteurs d'Événements Socket.IO (À COMPLÉTER) ---

// Se déclenche quand la connexion au serveur est établie
socket.on('connect', () => {
    console.log('✅ Connecté au serveur ! ID:', socket.id);
    // On pourrait réactiver le bouton si la connexion réussit après une déconnexion
    // Mais pour l'instant, on attend l'action de l'utilisateur
});

// Se déclenche en cas d'erreur de connexion
socket.on('connect_error', (err) => {
    console.error('Erreur de connexion:', err);
    messageArea.textContent = '❌ Impossible de se connecter au serveur. Réessayez plus tard.';
    joinButton.disabled = false; // Réactive le bouton
    joinButton.textContent = 'Rejoindre le Lobby';
});

// Se déclenche lors de la déconnexion du serveur
socket.on('disconnect', (reason) => {
    console.log('🔌 Déconnecté du serveur:', reason);
    messageArea.textContent = '🔴 Déconnecté du serveur. Veuillez rafraîchir la page.';
    // On pourrait vouloir cacher la zone de jeu et réafficher le lobby ici
    lobbyContainer.style.display = 'block'; // Ou 'flex' selon le style
    gameArea.style.display = 'none';
    joinButton.disabled = false;
    joinButton.textContent = 'Rejoindre le Lobby';
});

// --- Événements Spécifiques au Jeu (À AJOUTER PLUS TARD) ---

// Exemple : Le serveur confirme qu'on a rejoint le lobby
socket.on('lobby_joined', (lobbyData) => {
    console.log('🎉 Lobby rejoint avec succès !', lobbyData);
    messageArea.textContent = ''; // Efface les messages d'attente
    lobbyContainer.style.display = 'none'; // Cache le formulaire de lobby
    gameArea.style.display = 'block'; // Affiche la zone de jeu
    // Ici, on initialiserait l'affichage du jeu avec les données reçues (lobbyData)
    // setupGameUI(lobbyData); // Fonction à créer
});

// Exemple : Le serveur signale une erreur (lobby plein, nom déjà pris...)
socket.on('lobby_error', (errorMessage) => {
    console.error('Erreur de lobby:', errorMessage);
    messageArea.textContent = `❌ Erreur : ${errorMessage}`;
    joinButton.disabled = false; // Réactive le bouton
    joinButton.textContent = 'Rejoindre le Lobby';
});

// Exemple : Recevoir la mise à jour de l'état du jeu
// socket.on('game_update', (gameState) => {
//    console.log('🔄 Mise à jour du jeu reçue');
//    updateGameUI(gameState); // Fonction à créer pour mettre à jour l'interface
// });

// --- Fonctions d'Interface Utilisateur (Exemples à créer) ---
// function setupGameUI(data) {
//   // Crée les éléments visuels du jeu (infos joueurs, cartes, boutons...)
// }
// function updateGameUI(state) {
//   // Met à jour l'affichage avec les nouvelles données du jeu
// }

