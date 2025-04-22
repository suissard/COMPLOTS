// public/client.js - v3 Gère l'interface de jeu dynamique

// --- Initialisation ---
const socket = io();

// --- Variables Globales ---
/** @type {object | null} Données de configuration du jeu (cards.json) */
let gameConfig = null;
/** @type {object | null} État actuel du jeu reçu du serveur */
let currentGameState = null;
/** @type {string | null} Notre propre ID de joueur */
let myPlayerId = null;

// --- Récupération des Éléments du DOM ---

// Écran Lobby
const lobbyContainer = document.getElementById('lobby-container');
const playerNameInput = document.getElementById('playerName');
const lobbyNameInput = document.getElementById('lobbyName');
const joinButton = document.getElementById('joinButton');
const messageArea = document.getElementById('message-area');

// Écran Jeu
const gameArea = document.getElementById('game-area');
// -> Zone Adversaires
const opponentsArea = document.getElementById('opponents-area');
// -> Zone Table
const tableArea = document.getElementById('table-area');
const deckCountSpan = document.getElementById('deck-count');
const discardPileSpan = document.getElementById('discard-top-card'); // Pour afficher du texte ou une image
const gamePromptMessage = document.getElementById('game-prompt-message');
const reactionButtonsDiv = document.getElementById('reaction-buttons');
const challengeButton = document.getElementById('challenge-button');
const blockButton = document.getElementById('block-button');
// -> Zone Joueur
const playerArea = document.getElementById('player-area');
const myPlayerNameSpan = document.getElementById('my-player-name');
const myCoinsSpan = document.getElementById('my-coins').querySelector('.coin-count');
const myCardsDiv = document.getElementById('my-cards');
// -> Zone Actions
const actionButtonsDiv = document.getElementById('action-buttons');
// -> Zone Log
const gameLogList = document.getElementById('log-list');


// --- Fonctions d'Affichage / Rendu ---

/**
 * Ajoute un message au journal de jeu.
 * @param {string} message - Le message à afficher.
 * @param {string} [type='info'] - Type de message ('info', 'action', 'error', 'system'). Non utilisé pour l'instant.
 */
function logMessage(message, type = 'info') {
    const li = document.createElement('li');
    li.textContent = message;
    // On pourrait ajouter des classes CSS selon le type
    // li.classList.add(`log-${type}`);
    gameLogList.appendChild(li);
    // Scroll automatique vers le bas
    gameLogList.parentElement.scrollTop = gameLogList.parentElement.scrollHeight;
}

/**
 * Met à jour l'affichage des informations du joueur actuel (cartes, pièces).
 * @param {object} gameState - L'état actuel du jeu.
 */
function renderPlayerArea(gameState) {
    const me = gameState.players.find(p => p.id === myPlayerId);
    if (!me) return;

    myPlayerNameSpan.textContent = me.name + " (Vous)";
    myCoinsSpan.textContent = me.coins;

    // Efface les anciennes cartes
    myCardsDiv.innerHTML = '';

    // Affiche les cartes influence (cachées ou révélées)
    // On utilise les IDs reçus dans `myInfluenceIds` (état privé) ou `lostInfluenceIds` (état public)
    const myPrivateState = currentGameState; // Supposons que currentGameState contient l'état privé reçu via game_start/game_update spécifique
    const influenceCards = myPrivateState?.myInfluenceIds || me.lostInfluenceIds.slice(0, me.influenceCount); // Fallback si état privé non reçu
    const lostCards = me.lostInfluenceIds || [];

    // Crée les éléments pour les cartes actives (face cachée)
    for (let i = 0; i < me.influenceCount; i++) {
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card', 'my-card', 'hidden');
        // Si on a l'info privée, on peut stocker l'ID réel pour plus tard
        if (myPrivateState?.myInfluenceIds && myPrivateState.myInfluenceIds[i]) {
             cardDiv.dataset.cardId = myPrivateState.myInfluenceIds[i]; // Stocke l'ID
             // On pourrait afficher l'image si on voulait tricher ;)
        }
        cardDiv.innerHTML = `<div class="card-back">?</div>`;
        myCardsDiv.appendChild(cardDiv);
    }

    // Crée les éléments pour les cartes perdues (face visible)
    lostCards.forEach(cardId => {
        const cardInfo = gameConfig?.roles.find(r => r.id === cardId);
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card', 'my-card', 'revealed');
        cardDiv.style.borderColor = cardInfo?.color || '#7f8c8d'; // Couleur de faction sur la bordure?
        cardDiv.innerHTML = `
            <img src="${cardInfo?.imageUrl || '/images/cards/default.png'}" alt="${cardInfo?.name || cardId}">
            <div class="card-name">${cardInfo?.name || cardId}</div>
        `;
        myCardsDiv.appendChild(cardDiv);
    });
}

/**
 * Met à jour l'affichage des informations des adversaires.
 * @param {object} gameState - L'état public actuel du jeu.
 */
function renderOpponentsArea(gameState) {
    opponentsArea.innerHTML = ''; // Efface les anciens
    gameState.players.forEach(player => {
        if (player.id === myPlayerId) return; // Ne pas s'afficher soi-même ici

        const opponentDiv = document.createElement('div');
        opponentDiv.classList.add('opponent');
        opponentDiv.id = `opponent-${player.id}`;
        if (player.id === gameState.currentPlayerId) {
            opponentDiv.classList.add('current-turn');
        }

        // Cartes Influence (Cachées + Révélées)
        let cardsHTML = '';
        // Cartes cachées (dos)
        for (let i = 0; i < player.influenceCount; i++) {
            cardsHTML += `<div class="card-back">?</div>`;
        }
        // Cartes révélées
        (player.lostInfluenceIds || []).forEach(cardId => {
            const cardInfo = gameConfig?.roles.find(r => r.id === cardId);
            cardsHTML += `
                <div class="revealed-card" style="background-color: ${cardInfo?.color || '#7f8c8d'};">
                    <span class="card-name-opponent">${cardInfo?.name || cardId}</span>
                </div>`;
        });

        opponentDiv.innerHTML = `
            <div class="opponent-name">${player.name} <span class="current-turn-indicator">(Son tour)</span></div>
            <div class="opponent-coins"><i class="fas fa-coins"></i> <span class="coin-count">${player.coins}</span></div>
            <div class="opponent-cards-container">
                ${cardsHTML}
            </div>
        `;
        // Ajouter un écouteur pour la sélection de cible (si nécessaire)
        opponentDiv.addEventListener('click', () => handleTargetSelection(player.id));
        opponentsArea.appendChild(opponentDiv);
    });
}

/**
 * Met à jour la zone centrale (pioche, défausse, message prompt).
 * @param {object} gameState - L'état public actuel du jeu.
 */
function renderTableArea(gameState) {
    deckCountSpan.textContent = gameState.deckCardCount ?? '?';

    // Afficher la dernière carte défaussée (si info disponible)
    if (gameState.discardPileIds && gameState.discardPileIds.length > 0) {
        const topDiscardId = gameState.discardPileIds[gameState.discardPileIds.length - 1];
        const cardInfo = gameConfig?.roles.find(r => r.id === topDiscardId);
        discardPileSpan.innerHTML = `(${cardInfo?.name || topDiscardId}) <img src="${cardInfo?.imageUrl}" alt="${cardInfo?.name}">`;
    } else {
        discardPileSpan.textContent = 'Aucune';
    }

    // Gérer le message principal et les boutons de réaction
    updatePrompt(gameState);
}

/**
 * Met à jour le message central et affiche/cache les boutons Contester/Bloquer.
 * @param {object} gameState - L'état public actuel du jeu.
 */
function updatePrompt(gameState) {
    let message = "";
    let showReactions = false;

    // Est-ce notre tour?
    const isMyTurn = gameState.currentPlayerId === myPlayerId;

    switch (gameState.currentTurnState) {
        case 'AWAITING_ACTION':
            if (isMyTurn) {
                message = "C'est votre tour ! Choisissez une action.";
            } else {
                const currentPlayer = gameState.players.find(p => p.id === gameState.currentPlayerId);
                message = `C'est au tour de ${currentPlayer?.name}...`;
            }
            break;
        case 'AWAITING_CHALLENGE_OR_BLOCK':
            const action = gameState.declaredAction;
            const actor = gameState.players.find(p => p.id === action?.actorId);
            if (action && actor) {
                const actionInfo = gameConfig?.generalActions.find(a => a.id === action.type) || gameConfig?.roles.find(r => r.actionType === action.type);
                const claimedCardInfo = action.claimedCardId ? gameConfig?.roles.find(r => r.id === action.claimedCardId) : null;
                message = `${actor.name} déclare : ${actionInfo?.description || action.type}`;
                if (claimedCardInfo) {
                    message += ` (en utilisant ${claimedCardInfo.name})`;
                }
                // Afficher les boutons si ce n'est PAS notre action
                if (!isMyTurn) {
                    showReactions = true;
                    // TODO: Affiner quels boutons montrer (Contester toujours? Bloquer seulement si possible?)
                } else {
                     message += " (Attente des réactions...)";
                }
            } else {
                message = "Attente des réactions...";
            }
            break;
        // Ajouter d'autres états ici (AWAITING_CHALLENGE_ON_BLOCK, RESOLVING_ACTION, etc.)
        default:
            message = "Chargement...";
    }

    gamePromptMessage.textContent = message;
    reactionButtonsDiv.style.display = showReactions ? 'block' : 'none';
}

/**
 * Active ou désactive les boutons d'action en fonction de l'état du jeu.
 * @param {object} gameState - L'état public actuel du jeu.
 */
function updateActionButtons(gameState) {
    const isMyTurn = gameState.currentPlayerId === myPlayerId;
    const canAct = isMyTurn && gameState.currentTurnState === 'AWAITING_ACTION';
    const myCoins = gameState.players.find(p => p.id === myPlayerId)?.coins ?? 0;

    actionButtonsDiv.querySelectorAll('.action-btn').forEach(button => {
        const actionType = button.dataset.action;
        let disabled = !canAct; // Désactivé par défaut si ce n'est pas notre tour d'agir

        if (canAct) {
            // Vérifier les conditions spécifiques à chaque action
            switch (actionType) {
                case 'coup':
                    const coupCost = gameConfig?.generalActions.find(a => a.id === 'coup')?.cost || 7;
                    if (myCoins < coupCost) disabled = true;
                    break;
                case 'assassinate':
                     const assassinateCost = 3; // À récupérer de gameConfig si on l'ajoute
                     if (myCoins < assassinateCost) disabled = true;
                    break;
                // Ajouter vérifications pour autres actions (EXECUTE, BLACKMAIL...)
            }
            // Vérifier si l'action est obligatoire (ex: Coup si >= 10 pièces)
            const mustCoupThreshold = gameConfig?.generalActions.find(a => a.id === 'coup')?.mustActionCoinThreshold;
            if (mustCoupThreshold && myCoins >= mustCoupThreshold && actionType !== 'coup') {
                 disabled = true; // Doit faire Coup, désactive les autres actions
            }
             if (mustCoupThreshold && myCoins >= mustCoupThreshold && actionType === 'coup') {
                 disabled = false; // Assure que Coup est activé
            }
        }

        button.disabled = disabled;
    });
}

/**
 * Fonction principale pour mettre à jour toute l'interface utilisateur.
 * @param {object} gameState - L'état public du jeu.
 */
function updateUI(gameState) {
    if (!gameConfig) { // Attendre d'avoir la config
        console.warn("Config jeu non reçue, UI non mise à jour.");
        return;
    }
    currentGameState = gameState; // Met à jour l'état global côté client

    renderPlayerArea(gameState);
    renderOpponentsArea(gameState);
    renderTableArea(gameState);
    updateActionButtons(gameState);
    // Le log est mis à jour via `logMessage` sur l'événement `game_message`
}

// --- Gestion des Événements Socket.IO ---

socket.on('connect', () => { console.log('✅ Connecté au serveur ! ID:', socket.id); myPlayerId = socket.id; });
socket.on('connect_error', (err) => { console.error('Erreur connexion:', err); messageArea.textContent = '❌ Connexion serveur échouée.'; });
socket.on('disconnect', (reason) => { console.log('🔌 Déconnecté:', reason); lobbyContainer.style.display = 'block'; gameArea.style.display = 'none'; messageArea.textContent = '🔴 Déconnecté.'; });

// Réception de la configuration du jeu
socket.on('game_config', (config) => {
    console.log("⚙️ Configuration jeu reçue.");
    gameConfig = config;
    // On pourrait pré-charger les images ici si on voulait
});

// Confirmation de join lobby
socket.on('lobby_joined', (lobbyData) => {
    console.log('🎉 Lobby rejoint:', lobbyData);
    messageArea.textContent = '';
    lobbyContainer.style.display = 'none';
    gameArea.style.display = 'grid'; // Utilise grid maintenant
    // Affichage initial simple avant le démarrage du jeu
    logMessage(`Vous avez rejoint le lobby "${lobbyData.lobbyName}".`);
    // updateUI sera appelé par game_start ou game_update
});

// Mise à jour du lobby (joueur rejoint/part) AVANT démarrage
socket.on('update_lobby', (lobbyUpdateData) => {
    console.log('🔄 Lobby mis à jour (pré-jeu):', lobbyUpdateData);
    // On pourrait mettre à jour une liste de joueurs en attente si nécessaire
});

// Erreur du lobby
socket.on('lobby_error', (errorMessage) => {
    console.error('Erreur lobby:', errorMessage);
    messageArea.textContent = `❌ Erreur : ${errorMessage}`;
    joinButton.disabled = false; joinButton.textContent = 'Rejoindre le Lobby';
});

// Démarrage de la partie
socket.on('game_start', (initialGameState) => {
    console.log('🚀 Partie démarrée ! État initial:', initialGameState);
    logMessage("🚀 La partie commence !");
    // Stocke l'état privé initial
    currentGameState = initialGameState;
    // Met à jour l'UI avec cet état initial
    updateUI(initialGameState);
});

// Mise à jour de l'état du jeu
socket.on('game_update', (gameState) => {
    console.log('🔄 État jeu mis à jour.');
    // Met à jour l'UI avec le nouvel état public
    // Note: On ne reçoit plus nos cartes privées ici, il faut les garder de game_start
    // ou demander au serveur de les renvoyer si nécessaire (moins sécurisé).
    // Pour l'instant, on met à jour avec l'état public reçu.
    updateUI(gameState);
});

// Réception d'un message de jeu
socket.on('game_message', (message) => {
    console.log('💬 Message jeu:', message);
    logMessage(message);
});

// Demande d'action au joueur courant
socket.on('request_action', (data) => {
    console.log("👉 C'est notre tour !");
    logMessage(data.message || "C'est à vous de jouer !");
    // updateUI appelé par game_update devrait déjà avoir activé les boutons
});

// Notification d'une action déclarée (pour contester/bloquer)
socket.on('action_opportunity', (data) => {
    console.log(`❗️ Opportunité de réaction: ${data.actorName} fait ${data.actionType}`);
    // updateUI appelé par game_update devrait afficher le prompt et les boutons
    // On pourrait affiner ici quels boutons sont actifs (ex: Bloquer seulement si on a la bonne faction)
});

// Un joueur est éliminé
socket.on('player_eliminated', (data) => {
    console.log(`💀 Joueur éliminé: ${data.playerName}`);
    logMessage(`💀 ${data.playerName} est éliminé !`);
    // Mettre à jour l'UI pour griser/masquer le joueur
    const opponentDiv = document.getElementById(`opponent-${data.playerId}`);
    if (opponentDiv) {
        opponentDiv.style.opacity = '0.5';
        opponentDiv.style.pointerEvents = 'none'; // Empêche interaction
    }
    // Si c'est nous... afficher un message de défaite?
    if (data.playerId === myPlayerId) {
         gamePromptMessage.textContent = "Vous avez été éliminé ! 😵";
         actionButtonsDiv.querySelectorAll('button').forEach(b => b.disabled = true); // Désactive tout
    }
});

// Fin de partie
socket.on('game_over', (data) => {
    console.log('🏆 Fin de partie ! Gagnant:', data.winner);
    logMessage(`🏆 Fin de partie ! Gagnant: ${data.winner?.name || 'Personne'}`);
    gamePromptMessage.textContent = `Partie terminée ! Gagnant: ${data.winner?.name || 'Personne'}`;
    actionButtonsDiv.querySelectorAll('button').forEach(b => b.disabled = true);
    reactionButtonsDiv.style.display = 'none';
});

// Erreur de jeu
socket.on('game_error', (errorMessage) => {
    console.error('Erreur jeu:', errorMessage);
    // Afficher l'erreur d'une manière non bloquante?
    logMessage(`Erreur: ${errorMessage}`, 'error');
    // Peut-être afficher dans la zone de prompt temporairement?
    const oldPrompt = gamePromptMessage.textContent;
    gamePromptMessage.style.color = '#e74c3c';
    gamePromptMessage.textContent = `Erreur: ${errorMessage}`;
    setTimeout(() => {
       // Remettre le message précédent si l'état est toujours le même?
       if (currentGameState) updatePrompt(currentGameState);
       gamePromptMessage.style.color = ''; // Remet la couleur par défaut
    }, 4000); // Affiche l'erreur pendant 4 secondes
});


// --- Gestion des Actions Utilisateur ---

// Clic sur le bouton "Rejoindre" (Lobby)
joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const lobbyName = lobbyNameInput.value.trim();
    if (!playerName || !lobbyName) { messageArea.textContent = '⚠️ Pseudo et nom de lobby requis !'; return; }
    messageArea.textContent = 'Connexion... ⏳';
    joinButton.disabled = true; joinButton.textContent = 'Connexion...';
    socket.emit('join_lobby', { playerName, lobbyName });
});

// Clic sur les boutons d'action du jeu
actionButtonsDiv.addEventListener('click', (event) => {
    if (event.target.classList.contains('action-btn') && !event.target.disabled) {
        const actionType = event.target.dataset.action;
        if (!actionType) return;

        console.log(`Clic sur action: ${actionType}`);

        // --- Gérer la sélection de cible ---
        // Simplifié: pour l'instant, on ne gère pas la sélection interactive
        // On suppose que targetId est fourni si nécessaire (ex: pour Coup)
        let targetId = null;
        const needsTarget = ['coup', 'assassinate', 'steal', 'execute', 'blackmail', 'redistribute']; // Actions nécessitant une cible
        if (needsTarget.includes(actionType)) {
            // TODO: Implémenter la sélection de cible
            // Pour l'instant, on demande avec un prompt (pas idéal !)
            const targetName = prompt(`Action ${actionType}: Entrez le nom exact de la cible :`);
            if (!targetName) return; // Annulé par l'utilisateur
            // Trouver l'ID du joueur basé sur le nom (fragile !)
            const target = currentGameState?.players.find(p => p.name === targetName && p.id !== myPlayerId && p.influenceCount > 0);
            if (!target) { alert("Cible invalide ou nom incorrect."); return; }
            targetId = target.id;
            console.log(`Cible sélectionnée: ${targetName} (ID: ${targetId})`);
        }

        // Envoyer l'action au serveur
        socket.emit('player_action', { actionType, targetId });

        // Optionnel: Désactiver les boutons en attendant la résolution
        actionButtonsDiv.querySelectorAll('.action-btn').forEach(button => button.disabled = true);
        gamePromptMessage.textContent = "Action envoyée...";

    }
});

// Clic sur Contester
challengeButton.addEventListener('click', () => {
    console.log("Clic sur Contester !");
    // TODO: Envoyer l'événement 'player_challenge' au serveur
    // socket.emit('player_challenge', { /* infos sur qui est contesté */ });
    reactionButtonsDiv.style.display = 'none'; // Cache les boutons après réaction
});

// Clic sur Bloquer
blockButton.addEventListener('click', () => {
    console.log("Clic sur Bloquer !");
    // TODO: Gérer le choix de la carte/faction avec laquelle bloquer si nécessaire
    // Pour l'instant, on envoie un blocage générique (le serveur vérifiera si c'est possible)
    socket.emit('player_block', { /* actionTypeToBlock: currentGameState.declaredAction.type */ });
    reactionButtonsDiv.style.display = 'none'; // Cache les boutons après réaction
});

// --- Gestion de la sélection de cible (Exemple basique) ---
let selectingTargetForAction = null;

function handleTargetSelection(playerId) {
    // TODO: Améliorer cette logique pour qu'elle soit activée seulement
    // quand une action nécessitant une cible est choisie.
    console.log(`Clic sur adversaire: ${playerId}`);
    // Si on est en train de choisir une cible...
    // if (selectingTargetForAction) {
    //     socket.emit('player_action', { actionType: selectingTargetForAction, targetId: playerId });
    //     selectingTargetForAction = null;
    //     // Retirer le style 'targeted' et 'selectable' des adversaires
    // }
}


// --- Initialisation au chargement ---
// Cache la zone de jeu au début
gameArea.style.display = 'none';
lobbyContainer.style.display = 'block'; // Assure que le lobby est visible

