// server.js - v3 avec démarrage de partie

// Importation des modules nécessaires
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

// Initialisation Express et HTTP Server
const app = express();
const server = http.createServer(app);
// Initialisation Socket.IO avec CORS
const io = new Server(server, {
    cors: {
      origin: "*", // Attention : à restreindre en production !
      methods: ["GET", "POST"]
    }
  });

// --- Constantes et Configuration du Jeu ---
const PORT = process.env.PORT || 3000;
const MIN_PLAYERS_PER_LOBBY = 2; // Minimum 2 joueurs pour commencer
const MAX_PLAYERS_PER_LOBBY = 6; // Maximum 6 joueurs
const STARTING_COINS = 2; // Pièces au début
const CARDS_PER_PLAYER = 2; // Cartes Influence par joueur
// Définition des rôles possibles dans le jeu
const ROLES = ['Duc', 'Assassin', 'Ambassadeur', 'Capitaine', 'Contessa'];
const CARDS_PER_ROLE = 3; // 3 exemplaires de chaque rôle

// --- Stockage des Lobbies ---
// Structure : { lobbyName: { players: [{id, name, coins, influence: [card1, card2], lostInfluence: []}, ...], gameState: { status: 'waiting'/'playing'/'finished', deck: [], discardPile: [], currentPlayerId: null, /* autres infos */ } }, ... }
const lobbies = {};

// --- Fonctions Utilitaires pour le Jeu ---

/**
 * Crée une pioche de cartes Complot complète.
 * @returns {string[]} Un tableau contenant toutes les cartes (ex: ['Duc', 'Duc', 'Assassin', ...]).
 */
function createDeck() {
    const deck = [];
    for (const role of ROLES) {
        for (let i = 0; i < CARDS_PER_ROLE; i++) {
            deck.push(role);
        }
    }
    console.log(`Pioche créée avec ${deck.length} cartes.`);
    return deck;
}

/**
 * Mélange un tableau de cartes en utilisant l'algorithme Fisher-Yates.
 * @param {string[]} deck - Le tableau de cartes à mélanger.
 * @returns {string[]} Le tableau de cartes mélangé.
 */
function shuffleDeck(deck) {
    // Copie le deck pour ne pas modifier l'original directement si besoin
    const shuffledDeck = [...deck];
    // Parcours le tableau à partir de la fin
    for (let i = shuffledDeck.length - 1; i > 0; i--) {
        // Choisit un index aléatoire parmi les éléments restants (de 0 à i inclus)
        const j = Math.floor(Math.random() * (i + 1));
        // Échange l'élément courant avec l'élément à l'index aléatoire
        [shuffledDeck[i], shuffledDeck[j]] = [shuffledDeck[j], shuffledDeck[i]];
    }
    console.log("Pioche mélangée !");
    return shuffledDeck;
}

/**
 * Distribue les cartes initiales aux joueurs depuis la pioche.
 * Modifie directement les objets 'player' et 'deck'.
 * @param {Array<object>} players - La liste des joueurs du lobby.
 * @param {string[]} deck - La pioche mélangée.
 */
function dealInitialCards(players, deck) {
    console.log(`Distribution de ${CARDS_PER_PLAYER} cartes à ${players.length} joueurs...`);
    players.forEach(player => {
        player.influence = []; // Réinitialise les cartes (au cas où)
        player.lostInfluence = []; // Cartes perdues (révélées)
        for (let i = 0; i < CARDS_PER_PLAYER; i++) {
            // Prend la carte du dessus de la pioche et l'ajoute à la main du joueur
            // 'pop()' retire et retourne le dernier élément du tableau (la carte du dessus)
            const card = deck.pop();
            if (card) {
                player.influence.push(card);
            } else {
                console.error("ERREUR: Plus de cartes dans la pioche pendant la distribution initiale !");
                // Gérer ce cas improbable (normalement impossible avec 15 cartes et max 6 joueurs)
            }
        }
        player.coins = STARTING_COINS; // Attribue les pièces de départ
        console.log(` -> Joueur ${player.name} a reçu ses cartes et ${player.coins} pièces.`);
    });
    console.log(`Distribution terminée. Cartes restantes dans la pioche: ${deck.length}`);
}

/**
 * Détermine aléatoirement qui commence la partie.
 * @param {Array<object>} players - La liste des joueurs.
 * @returns {string} L'ID du joueur qui commence.
 */
function determineStartingPlayer(players) {
    const randomIndex = Math.floor(Math.random() * players.length);
    const startingPlayerId = players[randomIndex].id;
    console.log(`Joueur qui commence (aléatoire): ${players[randomIndex].name} (ID: ${startingPlayerId})`);
    return startingPlayerId;
}

/**
 * Construit l'objet d'état initial du jeu spécifique à un joueur.
 * Ne révèle que les informations publiques des autres et les cartes du joueur concerné.
 * @param {object} lobby - L'objet lobby complet.
 * @param {string} playerId - L'ID du joueur pour qui construire l'état.
 * @returns {object} L'état initial du jeu pour ce joueur.
 */
function getInitialGameStateForPlayer(lobby, playerId) {
    const player = lobby.players.find(p => p.id === playerId);
    if (!player) return null; // Sécurité

    return {
        myId: playerId,
        myInfluence: player.influence, // Les cartes spécifiques de CE joueur
        myCoins: player.coins,
        players: lobby.players.map(p => ({ // Infos publiques sur tous les joueurs
            id: p.id,
            name: p.name,
            coins: p.coins,
            influenceCount: p.influence.length, // Juste le NOMBRE de cartes
            lostInfluence: p.lostInfluence // Cartes révélées (publiques)
        })),
        currentPlayerId: lobby.gameState.currentPlayerId,
        deckCardCount: lobby.gameState.deck.length,
        discardPile: lobby.gameState.discardPile,
        // On pourrait ajouter d'autres infos générales ici si besoin
    };
}


// --- Configuration d'Express ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/rules', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rules.html')));

// --- Logique Socket.IO ---
io.on('connection', (socket) => {
  console.log(`🟢 Joueur connecté : ${socket.id}`);

  // (Code pour 'join_lobby' et 'disconnect' - inchangé par rapport à la v2)
  socket.on('join_lobby', ({ playerName, lobbyName }) => {
    // ... (même code que la version précédente pour rejoindre) ...
    // Validation, création lobby si besoin, vérif plein/pseudo/commencé
    if (!lobbies[lobbyName]) {
        lobbies[lobbyName] = { players: [], gameState: { status: 'waiting' } };
        console.log(`✨ Lobby "${lobbyName}" créé.`);
    }
    const lobby = lobbies[lobbyName];
    // ... (Validations: plein, pseudo, état) ...
    if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) { /* ... */ return; }
    if (lobby.players.some(p => p.name === playerName)) { /* ... */ return; }
    if (lobby.gameState.status !== 'waiting') { /* ... */ return; }

    // Ajout du joueur
    const newPlayer = { id: socket.id, name: playerName, coins: STARTING_COINS, influence: [], lostInfluence: [] };
    lobby.players.push(newPlayer);
    socket.join(lobbyName);
    socket.lobbyName = lobbyName;
    socket.playerName = playerName;

    // Confirmation + update aux autres
    const lobbyData = { /* ... */ isHost: lobby.players.length === 1 };
    socket.emit('lobby_joined', lobbyData);
    socket.to(lobbyName).emit('update_lobby', { players: lobby.players.map(p => ({ id: p.id, name: p.name })) });
    console.log(`👍 [${socket.id}] ("${playerName}") a rejoint le lobby "${lobbyName}".`);

  });

  // --- Démarrage de la Partie ---
  socket.on('request_start_game', () => {
    const lobbyName = socket.lobbyName;
    const playerName = socket.playerName; // Récupère le nom pour les logs

    console.log(`[${playerName} - ${socket.id}] demande à démarrer la partie dans le lobby "${lobbyName}"`);

    // Vérifier si le lobby existe
    if (!lobbyName || !lobbies[lobbyName]) {
        console.error(`❗️ Tentative de démarrage pour un lobby inexistant: "${lobbyName}"`);
        socket.emit('lobby_error', 'Erreur interne : Lobby introuvable.');
        return;
    }

    const lobby = lobbies[lobbyName];

    // Vérifier si la partie est déjà en cours ou terminée
    if (lobby.gameState.status !== 'waiting') {
        console.log(`❗️ [${playerName}] Tentative de démarrage alors que la partie est déjà ${lobby.gameState.status}.`);
        socket.emit('lobby_error', 'La partie a déjà commencé ou est terminée.');
        return;
    }

    // Vérifier si le demandeur est bien l'hôte (le premier joueur à avoir rejoint)
    if (!lobby.players.length || lobby.players[0].id !== socket.id) {
        console.log(`❗️ [${playerName}] n'est pas l'hôte et ne peut pas démarrer la partie.`);
        socket.emit('lobby_error', 'Seul l\'hôte peut démarrer la partie.');
        return;
    }

    // Vérifier s'il y a assez de joueurs
    if (lobby.players.length < MIN_PLAYERS_PER_LOBBY) {
        console.log(`❗️ Pas assez de joueurs dans "${lobbyName}" pour démarrer (${lobby.players.length}/${MIN_PLAYERS_PER_LOBBY}).`);
        socket.emit('lobby_error', `Il faut au moins ${MIN_PLAYERS_PER_LOBBY} joueurs pour commencer.`);
        return;
    }

    // --- Tout est OK : On lance la partie ! ---
    console.log(`✅ Démarrage de la partie dans le lobby "${lobbyName}" par ${playerName}...`);
    lobby.gameState.status = 'playing';

    // 1. Créer et mélanger la pioche
    const deck = shuffleDeck(createDeck());
    lobby.gameState.deck = deck; // Stocke la pioche dans l'état du lobby
    lobby.gameState.discardPile = []; // Initialise la défausse

    // 2. Distribuer les cartes et pièces (pièces déjà faites à l'arrivée)
    dealInitialCards(lobby.players, lobby.gameState.deck);

    // 3. Déterminer le premier joueur
    lobby.gameState.currentPlayerId = determineStartingPlayer(lobby.players);

    // 4. Envoyer l'état initial à chaque joueur (personnalisé)
    console.log(`📢 Envoi de l'état initial aux joueurs de "${lobbyName}"...`);
    lobby.players.forEach(player => {
        const initialStateForPlayer = getInitialGameStateForPlayer(lobby, player.id);
        // On utilise io.to(player.id) pour envoyer un message privé à ce joueur spécifique
        io.to(player.id).emit('game_start', initialStateForPlayer);
        console.log(` -> État envoyé à ${player.name} (ID: ${player.id})`);
    });

    // Optionnel: On pourrait aussi envoyer un message global disant "La partie commence, c'est au tour de X"
    const startingPlayer = lobby.players.find(p => p.id === lobby.gameState.currentPlayerId);
    io.to(lobbyName).emit('game_message', `🚀 La partie commence ! C'est au tour de ${startingPlayer.name}.`);

  });


  // --- Gestion des Actions du Jeu (À AJOUTER) ---
  // socket.on('player_action', (actionData) => { /* Gérer Revenu, Aide Étrangère, Taxe, Vol, Assassinat, Échange, Coup */ });
  // socket.on('player_challenge', (challengeData) => { /* Gérer une contestation */ });
  // socket.on('player_block', (blockData) => { /* Gérer un blocage (ex: Duc bloque Aide, Contessa bloque Assassin) */ });
  // socket.on('challenge_response', (responseData) => { /* Gérer la réponse à une contestation (révéler ou perdre influence) */ });

  // --- Déconnexion ---
  socket.on('disconnect', () => {
    // ... (même code que la version précédente pour quitter) ...
    const lobbyName = socket.lobbyName;
    if (lobbyName && lobbies[lobbyName]) {
        // ... (retirer joueur, supprimer lobby si vide, informer les autres) ...

        // !! Important : Gérer le cas où un joueur part en pleine partie !!
        const lobby = lobbies[lobbyName];
        if (lobby && lobby.gameState.status === 'playing') {
             console.log(`⚠️ Joueur ${socket.playerName} a quitté pendant la partie dans "${lobbyName}" !`);
             // Logique à définir :
             // - Mettre fin à la partie ?
             // - Le déclarer perdant et continuer ? (Si > 2 joueurs)
             // - Gérer le cas où c'était son tour ?
             // Pour l'instant, on informe juste les autres :
             io.to(lobbyName).emit('game_message', `⚠️ ${socket.playerName} a quitté la partie.`);
             // handlePlayerLeaveMidGame(lobbyName, socket.id); // Fonction à créer
        }
    }
  });
});

// --- Démarrage du Serveur ---
server.listen(PORT, () => {
  console.log(`🚀 Serveur Complot (v3) démarré sur http://localhost:${PORT}`);
});
