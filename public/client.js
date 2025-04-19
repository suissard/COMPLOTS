// public/client.js - v2 avec gestion des événements du lobby

// --- Initialisation ---
const socket = io();

// Récupération des éléments du DOM
const lobbyContainer = document.getElementById('lobby-container');
const playerNameInput = document.getElementById('playerName');
const lobbyNameInput = document.getElementById('lobbyName');
const joinButton = document.getElementById('joinButton');
const messageArea = document.getElementById('message-area');

const gameArea = document.getElementById('game-area');
const lobbyTitle = document.getElementById('lobby-title'); // Pour afficher le nom du lobby
const playerListUL = document.getElementById('player-list'); // La liste <ul> des joueurs
const hostControlsDiv = document.getElementById('host-controls'); // La div pour les boutons de l'hôte
const startButton = document.getElementById('startButton'); // Le bouton pour démarrer
const gameContentDiv = document.getElementById('game-content'); // Là où le jeu se passera

// --- Gestion de la Connexion au Lobby ---
joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const lobbyName = lobbyNameInput.value.trim();

    if (!playerName || !lobbyName) {
        messageArea.textContent = '⚠️ Veuillez entrer un pseudo et un nom de lobby !';
        return;
    }
    messageArea.textContent = 'Connexion en cours... ⏳';
    joinButton.disabled = true;
    joinButton.textContent = 'Connexion...';
    socket.emit('join_lobby', { playerName, lobbyName });
});

// --- Écouteurs d'Événements Socket.IO ---

socket.on('connect', () => {
    console.log('✅ Connecté au serveur ! ID:', socket.id);
    // Si on était en train de tenter de rejoindre, on peut laisser le bouton désactivé
    // car la logique 'lobby_joined' ou 'lobby_error' prendra le relais.
});

socket.on('connect_error', (err) => {
    console.error('Erreur de connexion:', err);
    messageArea.textContent = '❌ Impossible de se connecter au serveur. Réessayez plus tard.';
    joinButton.disabled = false;
    joinButton.textContent = 'Rejoindre le Lobby';
});

socket.on('disconnect', (reason) => {
    console.log('🔌 Déconnecté du serveur:', reason);
    // Affiche un message et potentiellement remet l'écran de lobby
    lobbyContainer.style.display = 'block'; // Ou 'flex' si c'était le cas
    gameArea.style.display = 'none';
    messageArea.textContent = '🔴 Déconnecté du serveur. Veuillez rafraîchir et rejoindre à nouveau.';
    // Assure que le bouton est réactivé si on revient à l'écran de lobby
    joinButton.disabled = false;
    joinButton.textContent = 'Rejoindre le Lobby';
});

// --- Événements Spécifiques au Lobby ---

/**
 * Gère la réception de l'événement 'lobby_joined' du serveur.
 * Met à jour l'interface pour afficher la zone de jeu/lobby.
 * @param {object} lobbyData - Données du lobby envoyées par le serveur.
 * @param {string} lobbyData.lobbyName - Nom du lobby.
 * @param {Array<object>} lobbyData.players - Liste des joueurs ({id, name}).
 * @param {number} lobbyData.maxPlayers - Nombre maximum de joueurs.
 * @param {boolean} lobbyData.isHost - Indique si le joueur actuel est l'hôte.
 */
socket.on('lobby_joined', (lobbyData) => {
    console.log('🎉 Lobby rejoint avec succès ! Données:', lobbyData);
    messageArea.textContent = ''; // Efface les messages d'attente/erreur
    lobbyContainer.style.display = 'none'; // Cache le formulaire de lobby
    gameArea.style.display = 'block'; // Affiche la zone d'attente/jeu

    // Met à jour le titre avec le nom du lobby
    lobbyTitle.textContent = `Lobby: ${lobbyData.lobbyName}`;

    // Met à jour la liste des joueurs
    updatePlayerList(lobbyData.players);

    // Affiche le bouton "Démarrer" si le joueur est l'hôte ET qu'il y a assez de joueurs (optionnel, on peut laisser l'hôte démarrer même seul pour tester)
    // Note: Le serveur devrait idéalement valider le nombre de joueurs avant de démarrer.
    if (lobbyData.isHost) {
        hostControlsDiv.style.display = 'block'; // Affiche la div des contrôles
        startButton.disabled = false; // Active le bouton
    } else {
        hostControlsDiv.style.display = 'none'; // Cache les contrôles pour les non-hôtes
    }

    // On pourrait afficher un message indiquant le nombre de joueurs attendus
    gameContentDiv.innerHTML = `<p>En attente d'autres joueurs (${lobbyData.players.length}/${lobbyData.maxPlayers})...</p>`;
    if (lobbyData.isHost) {
        gameContentDiv.innerHTML += `<p>Vous êtes l'hôte. Cliquez sur "Démarrer la Partie" quand vous êtes prêts !</p>`;
    }
});

/**
 * Gère la réception de l'événement 'update_lobby' (un joueur a rejoint ou quitté).
 * @param {object} lobbyUpdateData - Données mises à jour du lobby.
 * @param {Array<object>} lobbyUpdateData.players - Nouvelle liste des joueurs ({id, name}).
 */
socket.on('update_lobby', (lobbyUpdateData) => {
    console.log('🔄 Mise à jour du lobby reçue:', lobbyUpdateData);
    // Met simplement à jour la liste des joueurs affichée
    updatePlayerList(lobbyUpdateData.players);

    // Met à jour le compteur de joueurs (si on est toujours dans la phase d'attente)
    // On vérifie si gameContentDiv existe toujours pour éviter des erreurs si le jeu a commencé
    if (gameContentDiv && gameArea.style.display === 'block' && !document.getElementById('game-board')) { // Vérifie si on est encore en attente
        const maxPlayersText = document.getElementById('lobby-title').textContent.includes('/') ? document.getElementById('lobby-title').textContent.split('/')[1].split(')')[0] : 'N/A'; // Essaye de récupérer maxPlayers si dispo
        const currentPlayers = lobbyUpdateData.players.length;
        let waitingMessage = `<p>En attente d'autres joueurs (${currentPlayers}/${maxPlayersText})...</p>`;
         // Vérifie si l'hôte est toujours là et si c'est nous (basé sur l'ID)
         const amIHost = hostControlsDiv.style.display === 'block'; // Simple check si les contrôles sont visibles
         if(amIHost) {
             waitingMessage += `<p>Vous êtes l'hôte. Cliquez sur "Démarrer la Partie" quand vous êtes prêts !</p>`;
         }
        gameContentDiv.innerHTML = waitingMessage;
    }
});

/**
 * Gère la réception d'une erreur du lobby depuis le serveur.
 * @param {string} errorMessage - Le message d'erreur.
 */
socket.on('lobby_error', (errorMessage) => {
    console.error('Erreur de lobby:', errorMessage);
    messageArea.textContent = `❌ Erreur : ${errorMessage}`;
    // Réactive le bouton pour que l'utilisateur puisse corriger et réessayer
    joinButton.disabled = false;
    joinButton.textContent = 'Rejoindre le Lobby';
});

// --- Gestion du Démarrage du Jeu (par l'hôte) ---
startButton.addEventListener('click', () => {
    console.log('▶️ Demande de démarrage de la partie...');
    startButton.disabled = true; // Désactive le bouton pour éviter double clic
    startButton.textContent = 'Démarrage...';
    // Événement à envoyer au serveur pour demander le démarrage
    socket.emit('request_start_game');
    // Le serveur répondra (ou non) avec un événement 'game_start'
});


// --- Événements Spécifiques au Jeu (À AJOUTER PLUS TARD) ---

/**
 * Gère le début de la partie, envoyé par le serveur.
 * @param {object} initialGameState - L'état initial du jeu (joueurs avec cartes/pièces, tour actuel, etc.)
 */
socket.on('game_start', (initialGameState) => {
    console.log('🚀 La partie commence ! État initial:', initialGameState);
    hostControlsDiv.style.display = 'none'; // Cache les contrôles de l'hôte
    gameContentDiv.innerHTML = ''; // Vide la zone d'attente
    // Ici, on appellerait la fonction pour construire l'interface de jeu réelle
    // buildGameInterface(initialGameState); // Fonction à créer
    gameContentDiv.innerHTML = "<h2>La partie a commencé !</h2> <p>(Interface de jeu à construire ici...)</p>"; // Placeholder
});

/**
 * Gère les mises à jour de l'état du jeu pendant la partie.
 * @param {object} gameState - Le nouvel état du jeu.
 */
socket.on('game_update', (gameState) => {
   console.log('🔄 Mise à jour de l\'état du jeu reçue');
   // Ici, on mettrait à jour l'interface de jeu
   // updateGameInterface(gameState); // Fonction à créer
});


// --- Fonctions d'Interface Utilisateur ---

/**
 * Met à jour la liste des joueurs affichée dans l'élément <ul> #player-list.
 * @param {Array<object>} players - Liste des joueurs ({id, name}).
 */
function updatePlayerList(players) {
    // Vide la liste actuelle
    playerListUL.innerHTML = '';
    // Ajoute chaque joueur comme un élément <li>
    players.forEach(player => {
        const li = document.createElement('li');
        // Ajoute une petite icône ou distinction si c'est notre propre joueur
        if (player.id === socket.id) {
            li.innerHTML = `👤 <strong>${player.name} (Vous)</strong>`;
            li.style.fontWeight = 'bold'; // Met en gras notre nom
        } else {
            li.textContent = `👤 ${player.name}`;
        }
        playerListUL.appendChild(li);
    });
}

// --- Autres fonctions potentielles ---
// function buildGameInterface(state) { ... }
// function updateGameInterface(state) { ... }

