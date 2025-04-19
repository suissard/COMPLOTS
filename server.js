// server.js - Version améliorée avec gestion des lobbies

// Importation des modules nécessaires
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

// Initialisation Express et HTTP Server
const app = express();
const server = http.createServer(app);
// Initialisation Socket.IO avec CORS pour autoriser les connexions
const io = new Server(server, {
    cors: {
      origin: "*", // Attention : à restreindre en production !
      methods: ["GET", "POST"]
    }
  });

// Constantes et Configuration
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_LOBBY = 6; // Max joueurs pour Complot

// --- Stockage des Lobbies ---
// Un objet pour garder en mémoire les lobbies actifs et leurs joueurs
// Structure : { lobbyName: { players: [{id: socket.id, name: playerName}, ...], gameState: {...} }, ... }
const lobbies = {};

// --- Configuration d'Express ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/rules', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'rules.html'));
});

// --- Logique Socket.IO ---

io.on('connection', (socket) => {
  console.log(`🟢 Joueur connecté : ${socket.id}`);

  // --- Rejoindre un Lobby ---
  socket.on('join_lobby', ({ playerName, lobbyName }) => {
    console.log(`[${socket.id}] essaie de rejoindre le lobby "${lobbyName}" avec le pseudo "${playerName}"`);

    // Validation du pseudo et du nom de lobby (basique)
    if (!playerName || !lobbyName || playerName.length > 20 || lobbyName.length > 20) {
        socket.emit('lobby_error', 'Pseudo ou nom de lobby invalide.');
        console.log(`❗️ [${socket.id}] Pseudo/Lobby invalide.`);
        return;
    }

    // Créer le lobby s'il n'existe pas
    if (!lobbies[lobbyName]) {
        lobbies[lobbyName] = {
            players: [],
            gameState: 'waiting' // Ou un objet plus complexe pour l'état du jeu
            // On pourrait ajouter ici : deck, pioche, etc. plus tard
        };
        console.log(`✨ Lobby "${lobbyName}" créé.`);
    }

    const lobby = lobbies[lobbyName];

    // Vérifier si le lobby est plein
    if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) {
        socket.emit('lobby_error', 'Ce lobby est plein ! 🤷‍♂️');
        console.log(`❗️ [${socket.id}] Lobby "${lobbyName}" plein.`);
        return;
    }

    // Vérifier si le pseudo est déjà pris DANS CE LOBBY
    if (lobby.players.some(player => player.name === playerName)) {
        socket.emit('lobby_error', 'Ce pseudo est déjà pris dans ce lobby. 🤔');
        console.log(`❗️ [${socket.id}] Pseudo "${playerName}" déjà pris dans "${lobbyName}".`);
        return;
    }

    // Vérifier si la partie a déjà commencé (simpliste pour l'instant)
    if (lobby.gameState !== 'waiting') {
         socket.emit('lobby_error', 'La partie dans ce lobby a déjà commencé. ⏳');
         console.log(`❗️ [${socket.id}] Partie déjà commencée dans "${lobbyName}".`);
         return;
    }

    // Tout est bon ! Ajouter le joueur au lobby
    const newPlayer = { id: socket.id, name: playerName, coins: 2, influence: [] /* Sera rempli au début du jeu */ };
    lobby.players.push(newPlayer);
    console.log(`👍 [${socket.id}] ("${playerName}") a rejoint le lobby "${lobbyName}". Joueurs: ${lobby.players.length}/${MAX_PLAYERS_PER_LOBBY}`);

    // Faire rejoindre au joueur la "room" Socket.IO correspondante
    // Permet d'envoyer des messages ciblés à ce lobby
    socket.join(lobbyName);

    // Stocker le nom du lobby dans l'objet socket pour le retrouver facilement (ex: à la déconnexion)
    socket.lobbyName = lobbyName;
    socket.playerName = playerName; // On stocke aussi le nom

    // Confirmer au joueur qu'il a rejoint + envoyer l'état actuel du lobby
    const lobbyData = {
        lobbyName: lobbyName,
        players: lobby.players.map(p => ({ id: p.id, name: p.name })), // N'envoie que les infos non sensibles
        maxPlayers: MAX_PLAYERS_PER_LOBBY,
        isHost: lobby.players.length === 1 // Le premier joueur est l'hôte (pourrait servir)
    };
    socket.emit('lobby_joined', lobbyData);

    // Informer les AUTRES joueurs du lobby qu'un nouveau joueur est arrivé
    // On utilise socket.to(lobbyName) pour envoyer à tous SAUF au nouvel arrivant
    const updatedLobbyDataForOthers = {
        players: lobby.players.map(p => ({ id: p.id, name: p.name }))
    };
    socket.to(lobbyName).emit('update_lobby', updatedLobbyDataForOthers);

    // --- Logique future ---
    // Si le lobby est plein après l'arrivée de ce joueur, on pourrait lancer le jeu
    // if (lobby.players.length === MAX_PLAYERS_PER_LOBBY) {
    //   startGame(lobbyName); // Fonction à créer
    // }
  });

  // --- Gestion des Actions du Jeu (À AJOUTER) ---
  // socket.on('player_action', (actionData) => { ... });
  // socket.on('player_challenge', (challengeData) => { ... });
  // socket.on('player_block', (blockData) => { ... });
  // socket.on('start_game_request', () => { /* Vérifier si le joueur est l'hôte, etc. */ });

  // --- Déconnexion ---
  socket.on('disconnect', () => {
    console.log(`🔴 Joueur déconnecté : ${socket.id} (${socket.playerName || 'Nom inconnu'})`);

    // Récupérer le lobby du joueur (stocké lors du 'join_lobby')
    const lobbyName = socket.lobbyName;

    if (lobbyName && lobbies[lobbyName]) {
        const lobby = lobbies[lobbyName];

        // Retirer le joueur de la liste des joueurs du lobby
        const playerIndex = lobby.players.findIndex(player => player.id === socket.id);
        if (playerIndex !== -1) {
            const leavingPlayerName = lobby.players[playerIndex].name;
            lobby.players.splice(playerIndex, 1); // Retire le joueur
            console.log(`👋 Joueur "${leavingPlayerName}" retiré du lobby "${lobbyName}". Joueurs restants: ${lobby.players.length}`);

            // Si le lobby est vide, on le supprime
            if (lobby.players.length === 0) {
                delete lobbies[lobbyName];
                console.log(`🗑️ Lobby "${lobbyName}" vide supprimé.`);
            } else {
                // Sinon, informer les joueurs restants de la mise à jour
                const updatedLobbyData = {
                    players: lobby.players.map(p => ({ id: p.id, name: p.name }))
                };
                io.to(lobbyName).emit('update_lobby', updatedLobbyData); // io.to envoie à tout le monde dans la room
                console.log(`📢 Joueurs restants dans "${lobbyName}" informés.`);

                // Gérer le cas où la partie était en cours (à ajouter)
                // if (lobby.gameState !== 'waiting') { handlePlayerLeaveMidGame(lobbyName, socket.id); }
            }
        }
    }
    // Note : Le socket quitte automatiquement les rooms auxquelles il appartenait lors de la déconnexion.
  });
});

// --- Démarrage du Serveur ---
server.listen(PORT, () => {
  console.log(`🚀 Serveur Complot (v2) démarré sur http://localhost:${PORT}`);
});

// --- Fonctions de Logique de Jeu (Exemples à développer) ---
// function startGame(lobbyName) {
//   const lobby = lobbies[lobbyName];
//   if (!lobby || lobby.gameState !== 'waiting') return;
//   console.log(`▶️ Démarrage du jeu dans le lobby "${lobbyName}"...`);
//   lobby.gameState = 'playing';
//   // Distribuer les cartes, définir le premier joueur, etc.
//   // dealInitialCards(lobby);
//   // assignStartingPlayer(lobby);
//   // Envoyer l'état initial du jeu à tous les joueurs dans le lobby
//   // io.to(lobbyName).emit('game_start', getInitialGameState(lobby));
// }

// function getInitialGameState(lobby) { /* ... */ }
// function dealInitialCards(lobby) { /* ... */ }
// function assignStartingPlayer(lobby) { /* ... */ }
// function handlePlayerLeaveMidGame(lobbyName, playerId) { /* ... */ }
