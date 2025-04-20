// server.js - v5 avec Deck Class et gestion actions simples

// Importation des modules nécessaires
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const fs = require('fs');
// Importe la classe Deck depuis notre fichier de logique
const { Deck } = require('./game/logic.js'); // Assure-toi que le chemin est correct

// --- Chargement de la Configuration du Jeu depuis JSON ---
let gameConfig;
try {
    const rawData = fs.readFileSync(path.join(__dirname, 'cards.json'));
    gameConfig = JSON.parse(rawData);
    console.log("✅ Configuration du jeu (cards.json) chargée.");
} catch (error) {
    console.error("❌ ERREUR FATALE: Impossible de charger cards.json !", error);
    process.exit(1);
}

// --- Constantes et Configuration ---
const PORT = process.env.PORT || 3000;
const MIN_PLAYERS_PER_LOBBY = 2;
const MAX_PLAYERS_PER_LOBBY = 6;
const STARTING_COINS = 2;
const CARDS_PER_PLAYER = 2;

// --- Stockage des Lobbies ---
// Structure : { lobbyName: { players: [...], gameState: { status, deckManager, discardPile, currentPlayerId, currentTurnState, declaredAction, ... } }, ... }
const lobbies = {};

// --- Fonctions Utilitaires

/**
 * Distribue les cartes initiales aux joueurs en utilisant le Deck Manager.
 * @param {Array<object>} players - La liste des joueurs.
 * @param {Deck} deckManager - L'instance de la classe Deck.
 */
function dealInitialCards(players, deckManager) {
    console.log(`Distribution de ${CARDS_PER_PLAYER} cartes à ${players.length} joueurs...`);
    players.forEach(player => {
        player.influence = deckManager.draw(CARDS_PER_PLAYER); // Utilise deck.draw()
        player.lostInfluence = [];
        player.coins = STARTING_COINS;
        console.log(` -> Joueur ${player.name} a reçu ses cartes (IDs: ${player.influence.join(', ')}) et ${player.coins} pièces.`);
    });
    console.log(`Distribution terminée. Cartes restantes: ${deckManager.cardsRemaining()}`);
}

/**
 * Détermine aléatoirement qui commence la partie.
 * @param {Array<object>} players - La liste des joueurs.
 * @returns {string} L'ID du joueur qui commence.
 */
function determineStartingPlayer(players) {
    // (Inchangé)
    const randomIndex = Math.floor(Math.random() * players.length);
    return players[randomIndex].id;
}

/**
 * Récupère les détails d'une carte par son ID.
 * @param {string} cardId - L'ID de la carte.
 * @returns {object | null}
 */
function getCardInfo(cardId) {
    // (Inchangé)
    return gameConfig.roles.find(role => role.id === cardId) || null;
}

/**
 * Construit l'objet d'état initial du jeu pour un joueur.
 * @param {object} lobby - L'objet lobby complet.
 * @param {string} playerId - L'ID du joueur.
 * @returns {object | null}
 */
function getInitialGameStateForPlayer(lobby, playerId) {
    // (Utilise maintenant deckManager.cardsRemaining())
    const player = lobby.players.find(p => p.id === playerId);
    if (!player) return null;
    return {
        myId: playerId,
        myInfluenceIds: player.influence,
        myCoins: player.coins,
        players: lobby.players.map(p => ({
            id: p.id,
            name: p.name,
            coins: p.coins,
            influenceCount: p.influence.length,
            lostInfluenceIds: p.lostInfluence
        })),
        currentPlayerId: lobby.gameState.currentPlayerId,
        deckCardCount: lobby.gameState.deckManager.cardsRemaining(), // Utilise la méthode du Deck
        discardPileIds: lobby.gameState.discardPile,
        // gameConfig: gameConfig // Optionnel: envoyer la config au client une seule fois
    };
}

/**
 * Prépare et retourne l'état public du jeu (visible par tous).
 * @param {object} lobby - L'objet lobby.
 * @returns {object} L'état public du jeu.
 */
function getPublicGameState(lobby) {
    if (!lobby || !lobby.gameState) return {};
    return {
         players: lobby.players.map(p => ({ // Ne révèle que les infos publiques
            id: p.id,
            name: p.name,
            coins: p.coins,
            influenceCount: p.influence.length,
            lostInfluenceIds: p.lostInfluence // Cartes révélées
        })),
        currentPlayerId: lobby.gameState.currentPlayerId,
        currentTurnState: lobby.gameState.currentTurnState, // Important pour l'UI client
        deckCardCount: lobby.gameState.deckManager.cardsRemaining(),
        discardPileIds: lobby.gameState.discardPile,
        declaredAction: lobby.gameState.declaredAction, // Peut être utile pour afficher l'action en cours
        // Ne pas inclure myInfluenceIds ici !
    };
}

/**
 * Passe au joueur suivant actif.
 * @param {string} lobbyName - Le nom du lobby.
 */
function nextTurn(lobbyName) {
    const lobby = lobbies[lobbyName];
    if (!lobby || lobby.gameState.status !== 'playing') return;

    const activePlayers = lobby.players.filter(p => p.influence.length > 0);
    if (activePlayers.length <= 1) {
        // Fin de partie (ou gérer le cas 1 joueur)
        lobby.gameState.status = 'finished';
        const winner = activePlayers[0];
        console.log(`🏁 Fin de partie dans ${lobbyName}. Gagnant: ${winner ? winner.name : 'Personne?'}`);
        io.to(lobbyName).emit('game_over', { winner: winner ? {id: winner.id, name: winner.name} : null });
        // On pourrait supprimer le lobby après un délai
        return;
    }

    const currentPlayerIndex = activePlayers.findIndex(p => p.id === lobby.gameState.currentPlayerId);
    const nextPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
    lobby.gameState.currentPlayerId = activePlayers[nextPlayerIndex].id;
    lobby.gameState.currentTurnState = 'AWAITING_ACTION'; // Le nouveau joueur doit agir
    lobby.gameState.declaredAction = null; // Réinitialise l'action déclarée
    lobby.gameState.declaredBlock = null; // Réinitialise le blocage déclaré
    lobby.gameState.challengeInfo = null; // Réinitialise les infos de contestation

    console.log(`[${lobbyName}] Tour suivant -> ${activePlayers[nextPlayerIndex].name}`);

    // Informe tout le monde de la mise à jour
    io.to(lobbyName).emit('game_update', getPublicGameState(lobby));
    // Informe spécifiquement le nouveau joueur qu'il doit jouer
    io.to(lobby.gameState.currentPlayerId).emit('request_action', { message: "C'est votre tour !" });
}


// --- Configuration d'Express ---
// (Inchangé)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/rules', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rules.html')));

// --- Logique Socket.IO ---
io.on('connection', (socket) => {
  console.log(`🟢 Joueur connecté : ${socket.id}`);
  // Envoie la config au client une fois connecté
  socket.emit('game_config', gameConfig);

  // --- Rejoindre un Lobby ---
  socket.on('join_lobby', ({ playerName, lobbyName }) => {
    // (Logique de join_lobby globalement inchangée)
    // ... Crée lobby si besoin ...
     if (!lobbies[lobbyName]) {
        lobbies[lobbyName] = { players: [], gameState: { status: 'waiting' } };
        console.log(`✨ Lobby "${lobbyName}" créé.`);
    }
    const lobby = lobbies[lobbyName];
    // ... Validations ...
    if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) { /* ... */ return; }
    if (lobby.players.some(p => p.name === playerName)) { /* ... */ return; }
    if (lobby.gameState.status !== 'waiting') { /* ... */ return; }
    // Ajout joueur ...
    const newPlayer = { id: socket.id, name: playerName, coins: STARTING_COINS, influence: [], lostInfluence: [] };
    lobby.players.push(newPlayer);
    socket.join(lobbyName);
    socket.lobbyName = lobbyName;
    socket.playerName = playerName;
    // Confirmation + update ...
    const lobbyData = { /* ... */ isHost: lobby.players.length === 1 };
    socket.emit('lobby_joined', lobbyData);
    socket.to(lobbyName).emit('update_lobby', { players: lobby.players.map(p => ({ id: p.id, name: p.name })) });
    console.log(`👍 [${socket.id}] ("${playerName}") a rejoint le lobby "${lobbyName}".`);
  });

  // --- Démarrage de la Partie ---
  socket.on('request_start_game', () => {
    // (Utilise maintenant la classe Deck)
    const lobbyName = socket.lobbyName;
    const playerName = socket.playerName;
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
    // --- Lancement ---
    console.log(`✅ Démarrage de la partie dans le lobby "${lobbyName}" par ${playerName}...`);
    lobby.gameState.status = 'playing';
    // Crée et stocke l'instance du Deck
    lobby.gameState.deckManager = new Deck(gameConfig);
    lobby.gameState.deckManager.shuffle(); // Mélange
    lobby.gameState.discardPile = [];
    // Distribue les cartes en utilisant le deckManager
    dealInitialCards(lobby.players, lobby.gameState.deckManager);
    lobby.gameState.currentPlayerId = determineStartingPlayer(lobby.players);
    lobby.gameState.currentTurnState = 'AWAITING_ACTION'; // Premier état du tour
    lobby.gameState.declaredAction = null;
    lobby.gameState.declaredBlock = null;
    lobby.gameState.challengeInfo = null;

    // Envoi de l'état initial (personnalisé)
    console.log(`📢 Envoi de l'état initial aux joueurs de "${lobbyName}"...`);
    lobby.players.forEach(player => {
        const initialStateForPlayer = getInitialGameStateForPlayer(lobby, player.id);
        io.to(player.id).emit('game_start', initialStateForPlayer);
    });
    const startingPlayer = lobby.players.find(p => p.id === lobby.gameState.currentPlayerId);
    io.to(lobbyName).emit('game_message', `🚀 La partie commence ! C'est au tour de ${startingPlayer.name}.`);
    // Informe le premier joueur qu'il doit jouer
     io.to(lobby.gameState.currentPlayerId).emit('request_action', { message: "C'est votre tour !" });
  });


  // --- Gestion des Actions du Joueur ---
  socket.on('player_action', (actionData) => {
    const lobbyName = socket.lobbyName;
    const playerId = socket.id;

    // Vérifications de base
    if (!lobbyName || !lobbies[lobbyName]) return; // Lobby non trouvé
    const lobby = lobbies[lobbyName];
    if (lobby.gameState.status !== 'playing') return; // Partie non en cours
    if (lobby.gameState.currentPlayerId !== playerId) {
      socket.emit('game_error', "Ce n'est pas votre tour !");
      return;
    }
    if (lobby.gameState.currentTurnState !== 'AWAITING_ACTION') {
      socket.emit('game_error', "Vous ne pouvez pas faire d'action maintenant.");
      return;
    }
    if (!actionData || !actionData.actionType) {
        socket.emit('game_error', "Données d'action invalides.");
        return;
    }

    console.log(`[${lobbyName}] Joueur ${socket.playerName} tente l'action: ${actionData.actionType}`);

    const player = lobby.players.find(p => p.id === playerId);
    if (!player) return; // Joueur non trouvé

    // --- Traitement des Actions Générales Simples ---
    let actionProcessed = false;
    let requiresChallengeBlockPhase = false;
    let actionCost = 0;

    switch (actionData.actionType) {
        case 'income':
            player.coins += 1;
            console.log(` -> ${socket.playerName} prend Revenu (+1). Total: ${player.coins}`);
            actionProcessed = true;
            break;

        case 'foreign_aid':
            // Pour l'instant, on applique directement. PLUS TARD: passer à AWAITING_CHALLENGE_OR_BLOCK
            console.log(` -> ${socket.playerName} tente Aide Étrangère (+2).`);
            // !! Logique future:
            // lobby.gameState.declaredAction = { type: 'foreign_aid', actorId: playerId };
            // lobby.gameState.currentTurnState = 'AWAITING_CHALLENGE_OR_BLOCK';
            // io.to(lobbyName).emit('action_opportunity', { /* détails action + qui peut bloquer */ });
            // requiresChallengeBlockPhase = true; // Ne pas passer au tour suivant tout de suite

            // Logique actuelle (temporaire):
             player.coins += 2;
             console.log(` -> ${socket.playerName} reçoit Aide Étrangère (+2). Total: ${player.coins}`);
             actionProcessed = true; // On considère traité pour l'instant
            break;

        case 'coup':
            const coupActionInfo = gameConfig.generalActions.find(a => a.id === 'coup');
            actionCost = coupActionInfo ? coupActionInfo.cost : 7;
            const targetId = actionData.targetId;
            const targetPlayer = lobby.players.find(p => p.id === targetId);

            if (player.coins < actionCost) {
                socket.emit('game_error', `Pas assez d'or pour le Coup d'État (coût: ${actionCost})`);
                return; // Arrête le traitement
            }
            if (!targetId || !targetPlayer || targetPlayer.influence.length === 0) {
                 socket.emit('game_error', "Cible invalide pour le Coup d'État.");
                 return;
            }
            if (targetId === playerId) {
                 socket.emit('game_error', "Vous ne pouvez pas vous cibler avec un Coup d'État.");
                 return;
            }

            console.log(` -> ${socket.playerName} lance un Coup d'État sur ${targetPlayer.name} (coût: ${actionCost}).`);
            player.coins -= actionCost;

            // Logique de perte d'influence (simplifiée pour l'instant)
            // PLUS TARD: demander à la cible quelle carte révéler
            if (targetPlayer.influence.length > 0) {
                const lostCard = targetPlayer.influence.pop(); // Retire la dernière carte
                targetPlayer.lostInfluence.push(lostCard); // Ajoute aux cartes révélées
                lobby.gameState.discardPile.push(lostCard); // Ajoute à la défausse
                console.log(` -> ${targetPlayer.name} perd une influence (${lostCard}). Restant: ${targetPlayer.influence.length}`);
                io.to(lobbyName).emit('game_message', `${targetPlayer.name} perd une influence à cause d'un Coup d'État !`);

                 // Vérifier si le joueur ciblé est éliminé
                 if (targetPlayer.influence.length === 0) {
                     console.log(` -> ${targetPlayer.name} est éliminé !`);
                     io.to(lobbyName).emit('player_eliminated', { playerId: targetId, playerName: targetPlayer.name });
                     // Gérer l'effet Croque-Mort ici si besoin (trigger)
                 }
            }
            actionProcessed = true;
            break;

        // --- Autres actions (à ajouter) ---
        // case 'tax':
        // case 'assassinate':
        // ... etc ...

        default:
            socket.emit('game_error', `Type d'action inconnu: ${actionData.actionType}`);
            return;
    }


    // --- Fin du Tour (si l'action est terminée et ne nécessite pas de contestation/blocage) ---
    if (actionProcessed && !requiresChallengeBlockPhase) {
        // Met à jour l'état public pour tout le monde
        io.to(lobbyName).emit('game_update', getPublicGameState(lobby));
        // Passe au joueur suivant
        nextTurn(lobbyName);
    } else if (requiresChallengeBlockPhase) {
         // Met à jour l'état public (pour montrer l'action déclarée et le nouvel état)
         io.to(lobbyName).emit('game_update', getPublicGameState(lobby));
         // Le serveur attend maintenant les contestations ou blocages...
         console.log(`[${lobbyName}] Action ${lobby.gameState.declaredAction.type} déclarée. Attente de contestation/blocage...`);
         // Mettre en place un timer pour cette phase?
    }

  });


  // --- Autres gestionnaires (challenge, block, etc. à ajouter) ---
  // socket.on('player_challenge', (challengeData) => { ... });
  // socket.on('player_block', (blockData) => { ... });
  // socket.on('challenge_response', (responseData) => { ... });


  // --- Déconnexion ---
  socket.on('disconnect', () => {
    // (Logique de déconnexion globalement inchangée)
    // ...
    const lobbyName = socket.lobbyName;
    if (lobbyName && lobbies[lobbyName]) {
        // ... (retirer joueur, supprimer lobby si vide, informer les autres) ...
        const lobby = lobbies[lobbyName];
        if (lobby && lobby.gameState.status === 'playing') {
            console.log(`⚠️ Joueur ${socket.playerName} a quitté pendant la partie dans "${lobbyName}" !`);
            io.to(lobbyName).emit('game_message', `⚠️ ${socket.playerName} a quitté la partie.`);
        }
    }
  });
});

// --- Démarrage du Serveur ---
server.listen(PORT, () => {
  console.log(`🚀 Serveur Complot (v5 - Actions Simples) démarré sur http://localhost:${PORT}`);
});
