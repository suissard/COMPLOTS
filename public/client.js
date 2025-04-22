// public/client.js - v4 Affichage des cartes joueur et adversaires

// --- Initialisation ---
const socket = io();

// --- Variables Globales ---
/** @type {object | null} Données de configuration du jeu (cards.json) */
let gameConfig = null;
/** @type {object | null} Dernier état privé reçu (contient myInfluenceIds) */
let myPrivateGameState = null;
/** @type {object | null} Dernier état public reçu */
let currentPublicGameState = null;
/** @type {string | null} Notre propre ID de joueur */
let myPlayerId = null;

// --- Récupération des Éléments du DOM ---
// (Identique à la v3)
// Écran Lobby
const lobbyContainer = document.getElementById("lobby-container");
const playerNameInput = document.getElementById("playerName");
const lobbyNameInput = document.getElementById("lobbyName");
const joinButton = document.getElementById("joinButton");
const messageArea = document.getElementById("message-area");
// Écran Jeu
const gameArea = document.getElementById("game-area");
const opponentsArea = document.getElementById("opponents-area");
const tableArea = document.getElementById("table-area");
const deckCountSpan = document.getElementById("deck-count");
const discardPileSpan = document.getElementById("discard-top-card");
const gamePromptMessage = document.getElementById("game-prompt-message");
const reactionButtonsDiv = document.getElementById("reaction-buttons");
const challengeButton = document.getElementById("challenge-button");
const blockButton = document.getElementById("block-button");
const playerArea = document.getElementById("player-area");
const myPlayerNameSpan = document.getElementById("my-player-name");
const myCoinsSpan = document.getElementById("my-coins").querySelector(".coin-count");
const myCardsDiv = document.getElementById("my-cards");
const actionButtonsDiv = document.getElementById("action-buttons");
const gameLogList = document.getElementById("log-list");

// --- Fonctions d'Affichage / Rendu ---

/**
 * Ajoute un message au journal de jeu.
 * @param {string} message - Le message à afficher.
 * @param {string} [type='info'] - Type de message.
 */
function logMessage(message, type = "info") {
	const li = document.createElement("li");
	li.textContent = message;
	gameLogList.appendChild(li);
	gameLogList.parentElement.scrollTop = gameLogList.parentElement.scrollHeight;
}

/**
 * Met à jour l'affichage des informations du joueur actuel (cartes, pièces).
 * Utilise myPrivateGameState si disponible pour les IDs des cartes cachées.
 */
function renderPlayerArea() {
	// Trouve nos données dans le dernier état public reçu
	const me = currentPublicGameState?.players.find((p) => p.id === myPlayerId);
	if (!me) return;

	myPlayerNameSpan.textContent = me.name + " (Vous)";
	myCoinsSpan.textContent = me.coins;

	myCardsDiv.innerHTML = ""; // Efface les anciennes cartes

	const influenceCount = me.influenceCount; // Nombre de cartes actives
	const lostCards = me.lostInfluenceIds || []; // Cartes révélées

	// Crée les éléments pour les cartes actives (face cachée)
	for (let i = 0; i < influenceCount; i++) {
		const cardDiv = document.createElement("div");
		cardDiv.classList.add("card", "my-card", "hidden");
		// Essaye de récupérer l'ID réel depuis l'état privé (reçu au game_start)
		const actualCardId = myPrivateGameState?.myInfluenceIds?.[i];
		if (actualCardId) {
			cardDiv.dataset.cardId = actualCardId; // Stocke l'ID réel
			// Pourrait être utilisé pour afficher un tooltip ou pour la logique de révélation
		}
		cardDiv.innerHTML = `<div class="card-back">?</div>`;
		myCardsDiv.appendChild(cardDiv);
	}

	// Crée les éléments pour les cartes perdues (face visible)
	lostCards.forEach((cardId) => {
		const cardInfo = gameConfig?.roles.find((r) => r.id === cardId);
		const cardDiv = document.createElement("div");
		cardDiv.classList.add("card", "my-card", "revealed");
		// Applique la couleur de la carte (ex: bordure) - nécessite CSS adapté
		// cardDiv.style.borderColor = cardInfo?.color || '#7f8c8d';
		cardDiv.innerHTML = `
            <img src="${cardInfo?.imageUrl || "/images/cards/default.png"}" alt="${
			cardInfo?.name || cardId
		}">
            <div class="card-name" style="background-color: ${
							cardInfo?.color || "rgba(44, 62, 80, 0.7)"
						};">${cardInfo?.name || cardId}</div>
        `;
		myCardsDiv.appendChild(cardDiv);
	});
}

/**
 * Met à jour l'affichage des informations des adversaires.
 * @param {object} gameState - L'état public actuel du jeu.
 */
function renderOpponentsArea(gameState) {
	opponentsArea.innerHTML = ""; // Efface les anciens
	gameState.players.forEach((player) => {
		if (player.id === myPlayerId) return; // Ne pas s'afficher soi-même

		const opponentDiv = document.createElement("div");
		opponentDiv.classList.add("opponent");
		opponentDiv.id = `opponent-${player.id}`;
		if (player.id === gameState.currentPlayerId) {
			opponentDiv.classList.add("current-turn");
		}
		if (player.influenceCount === 0) opponentDiv.style.opacity = "0.5"; // Grise les joueurs éliminés

		// Cartes Influence (Cachées + Révélées)
		let cardsHTML = "";
		// Cartes cachées (dos)
		for (let i = 0; i < player.influenceCount; i++) {
			// Utilise la classe card-back stylée en CSS
			cardsHTML += `<div class="card-back">?</div>`;
		}
		// Cartes révélées
		(player.lostInfluenceIds || []).forEach((cardId) => {
			const cardInfo = gameConfig?.roles.find((r) => r.id === cardId);
			// Utilise la classe revealed-card stylée en CSS
			cardsHTML += `
                <div class="revealed-card" style="background-color: ${
									cardInfo?.color || "#7f8c8d"
								};">
                     <span class="card-name-opponent">${cardInfo?.name || cardId}</span>
                </div>`;
		});

		opponentDiv.innerHTML = `
            <div class="opponent-name">${
							player.name
						} <span class="current-turn-indicator">(Son tour)</span></div>
            <div class="opponent-coins"><i class="fas fa-coins"></i> <span class="coin-count">${
							player.coins
						}</span></div>
            <div class="opponent-cards-container">
                ${
									cardsHTML ||
									'<span style="font-size:0.8em; opacity:0.7;">Éliminé</span>'
								}
            </div>
        `;
		// Ajouter un écouteur pour la sélection de cible
		opponentDiv.addEventListener("click", () => handleTargetSelection(player.id));
		opponentsArea.appendChild(opponentDiv);
	});
}

/**
 * Met à jour la zone centrale (pioche, défausse, message prompt).
 * @param {object} gameState - L'état public actuel du jeu.
 */
function renderTableArea(gameState) {
	deckCountSpan.textContent = gameState.deckCardCount ?? "?";

	// Afficher la dernière carte défaussée
	if (gameState.discardPileIds && gameState.discardPileIds.length > 0) {
		const topDiscardId = gameState.discardPileIds[gameState.discardPileIds.length - 1];
		const cardInfo = gameConfig?.roles.find((r) => r.id === topDiscardId);
		// Affichage amélioré avec image si possible
		discardPileSpan.innerHTML = `(${cardInfo?.name || topDiscardId}) ${
			cardInfo?.imageUrl ? `<img src="${cardInfo.imageUrl}" alt="${cardInfo.name}">` : ""
		}`;
	} else {
		discardPileSpan.textContent = "Aucune";
	}

	updatePrompt(gameState);
}

/**
 * Met à jour le message central et affiche/cache les boutons Contester/Bloquer.
 * @param {object} gameState - L'état public actuel du jeu.
 */
function updatePrompt(gameState) {
	// (Inchangé pour l'instant, mais pourrait être amélioré)
	let message = "";
	let showReactions = false;
	const isMyTurn = gameState.currentPlayerId === myPlayerId;

	switch (gameState.currentTurnState) {
		case "AWAITING_ACTION":
			if (isMyTurn) {
				message = "C'est votre tour ! Choisissez une action.";
			} else {
				const currentPlayer = gameState.players.find(
					(p) => p.id === gameState.currentPlayerId
				);
				message = `C'est au tour de ${currentPlayer?.name}...`;
			}
			break;
		case "AWAITING_CHALLENGE_OR_BLOCK":
			const action = gameState.declaredAction;
			const actor = gameState.players.find((p) => p.id === action?.actorId);
			if (action && actor) {
				const actionInfo =
					gameConfig?.generalActions.find((a) => a.id === action.type) ||
					gameConfig?.roles.find((r) => r.actionType === action.type);
				const claimedCardInfo = action.claimedCardId
					? gameConfig?.roles.find((r) => r.id === action.claimedCardId)
					: null;
				message = `${actor.name} déclare : ${actionInfo?.description || action.type}`;
				if (claimedCardInfo) {
					message += ` (avec ${claimedCardInfo.name})`;
				}
				if (!isMyTurn) {
					showReactions = true;
					// TODO: Vérifier si on PEUT réellement contester/bloquer
					// challengeButton.disabled = false; // Toujours possible?
					// blockButton.disabled = !canIBlock(action); // Logique à ajouter
				} else {
					message += " (Attente des réactions...)";
				}
			} else {
				message = "Attente des réactions...";
			}
			break;
		default:
			message = "Chargement...";
	}
	gamePromptMessage.textContent = message;
	reactionButtonsDiv.style.display = showReactions ? "block" : "none";
}

/**
 * Active ou désactive les boutons d'action.
 * @param {object} gameState - L'état public actuel du jeu.
 */
function updateActionButtons(gameState) {
	// (Inchangé pour l'instant, mais pourrait être amélioré)
	const isMyTurn = gameState.currentPlayerId === myPlayerId;
	const canAct = isMyTurn && gameState.currentTurnState === "AWAITING_ACTION";
	const me = gameState.players.find((p) => p.id === myPlayerId);
	const myCoins = me?.coins ?? 0;
	const myInfluenceCount = me?.influenceCount ?? 0;

	// Désactive tout si le joueur est éliminé
	if (myInfluenceCount === 0) {
		actionButtonsDiv
			.querySelectorAll(".action-btn")
			.forEach((button) => (button.disabled = true));
		return;
	}

	actionButtonsDiv.querySelectorAll(".action-btn").forEach((button) => {
		const actionType = button.dataset.action;
		let disabled = !canAct;

		if (canAct) {
			const generalAction = gameConfig?.generalActions.find((a) => a.id === actionType);
			const roleAction = gameConfig?.roles.find((r) => r.actionType === actionType);

			// Vérif coût
			let cost = 0;
			if (generalAction) cost = generalAction.cost || 0;
			else if (roleAction) {
				// Coûts spécifiques aux actions de rôle (à définir dans cards.json si besoin)
				if (
					actionType === "ASSASSINATE" ||
					actionType === "EXECUTE" ||
					actionType === "BLACKMAIL"
				)
					cost = 3;
			}
			if (myCoins < cost) disabled = true;

			// Vérif Coup obligatoire
			const coupInfo = gameConfig?.generalActions.find((a) => a.id === "coup");
			const mustCoupThreshold = coupInfo?.mustActionCoinThreshold;
			if (mustCoupThreshold && myCoins >= mustCoupThreshold) {
				disabled = actionType !== "coup"; // Seul Coup est possible
			}
		}
		button.disabled = disabled;
	});
}

/**
 * Fonction principale pour mettre à jour toute l'interface utilisateur.
 * @param {object} gameState - L'état public ou privé du jeu.
 */
function updateUI(gameState) {
	if (!gameConfig) {
		console.warn("Config jeu non reçue...");
		return;
	}

	// Stocke l'état public pour référence
	currentPublicGameState = gameState;
	// Si l'état reçu contient nos infos privées (game_start), on le stocke aussi
	if (gameState.myInfluenceIds) {
		myPrivateGameState = gameState;
	}

	console.log("Mise à jour UI avec état:", currentPublicGameState);

	renderPlayerArea(); // Utilise myPrivateGameState si dispo pour les IDs cachés
	renderOpponentsArea(currentPublicGameState);
	renderTableArea(currentPublicGameState);
	updateActionButtons(currentPublicGameState);
}

// --- Gestion des Événements Socket.IO ---
// (Gestionnaires 'connect', 'connect_error', 'disconnect', 'game_config',
// 'lobby_joined', 'update_lobby', 'lobby_error' inchangés)
socket.on("connect", () => {
	console.log("✅ Connecté ! ID:", socket.id);
	myPlayerId = socket.id;
});
socket.on("connect_error", (err) => {
	console.error("Erreur connexion:", err);
	messageArea.textContent = "❌ Connexion serveur échouée.";
});
socket.on("disconnect", (reason) => {
	console.log("🔌 Déconnecté:", reason);
	lobbyContainer.style.display = "block";
	gameArea.style.display = "none";
	messageArea.textContent = "🔴 Déconnecté.";
});
socket.on("game_config", (config) => {
	console.log("⚙️ Config jeu reçue.");
	gameConfig = config;
});
socket.on("lobby_joined", (lobbyData) => {
	console.log("🎉 Lobby rejoint:", lobbyData);
	messageArea.textContent = "";
	lobbyContainer.style.display = "none";
	gameArea.style.display = "grid";
	logMessage(`Lobby "${lobbyData.lobbyName}" rejoint.`);
});
socket.on("update_lobby", (lobbyUpdateData) => {
	console.log("🔄 Lobby MàJ (pré-jeu):", lobbyUpdateData);
});
socket.on("lobby_error", (errorMessage) => {
	console.error("Erreur lobby:", errorMessage);
	messageArea.textContent = `❌ Erreur : ${errorMessage}`;
	joinButton.disabled = false;
	joinButton.textContent = "Rejoindre";
});

// Démarrage de la partie
socket.on("game_start", (initialGameState) => {
	console.log("🚀 Partie démarrée !");
	logMessage("🚀 La partie commence !");
	updateUI(initialGameState); // Met à jour avec l'état privé initial
});

// Mise à jour de l'état du jeu (reçoit état public)
socket.on("game_update", (publicGameState) => {
	console.log("🔄 État jeu MàJ.");
	updateUI(publicGameState); // Met à jour avec l'état public
});

// Réception d'un message de jeu
socket.on("game_message", (message) => {
	console.log("💬 Msg:", message);
	logMessage(message);
});
// Demande d'action
socket.on("request_action", (data) => {
	console.log("👉 Votre tour !");
	logMessage(data.message || "C'est à vous de jouer !");
});
// Opportunité de réaction
socket.on("action_opportunity", (data) => {
	console.log(
		`❗️ Réaction possible: ${data.actorName} fait ${data.actionType}`
	); /* UI mise à jour par game_update */
});
// Joueur éliminé
socket.on("player_eliminated", (data) => {
	console.log(`💀 Éliminé: ${data.playerName}`);
	logMessage(`💀 ${data.playerName} est éliminé !`);
	updateUI(currentPublicGameState); /* Met à jour l'affichage */
});
// Fin de partie
socket.on("game_over", (data) => {
	console.log("🏆 Fin ! Gagnant:", data.winner);
	logMessage(`🏆 Fin de partie ! Gagnant: ${data.winner?.name || "Personne"}`);
	updateUI(currentPublicGameState);
	/* Met à jour une dernière fois */ gamePromptMessage.textContent = `Partie terminée ! Gagnant: ${
		data.winner?.name || "Personne"
	}`;
	actionButtonsDiv.querySelectorAll("button").forEach((b) => (b.disabled = true));
	reactionButtonsDiv.style.display = "none";
});
// Erreur de jeu
socket.on("game_error", (errorMessage) => {
	console.error("Erreur jeu:", errorMessage);
	logMessage(`Erreur: ${errorMessage}`, "error"); 
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
// (Inchangé pour l'instant, la sélection de cible reste basique)
joinButton.addEventListener("click", () => {
	const playerName = playerNameInput.value.trim();
	const lobbyName = lobbyNameInput.value.trim();
	if (!playerName || !lobbyName) {
		messageArea.textContent = "⚠️ Pseudo et nom de lobby requis !";
		return;
	}
	messageArea.textContent = "Connexion... ⏳";
	joinButton.disabled = true;
	joinButton.textContent = "Connexion...";
	socket.emit("join_lobby", { playerName, lobbyName });
});
actionButtonsDiv.addEventListener("click", (event) => {
	if (event.target.classList.contains("action-btn") && !event.target.disabled) {
		const actionType = event.target.dataset.action;
		if (!actionType) return;
		console.log(`Clic action: ${actionType}`);
		let targetId = null;
		const needsTarget = [
			"coup",
			"assassinate",
			"steal",
			"execute",
			"blackmail",
			"redistribute",
			"collect_tax",
		]; // Ajout collect_tax qui donne à une cible
		if (needsTarget.includes(actionType)) {
			const targetName = prompt(
				`Action ${actionType}: Nom exact de la cible${
					actionType === "collect_tax" ? " (à qui donner 1 pièce)" : ""
				} :`
			);
			if (!targetName && actionType !== "collect_tax") return; // Annulé (sauf pour collect_tax où on peut se cibler?)
			const target = currentPublicGameState?.players.find(
				(p) =>
					p.name === targetName &&
					(actionType === "collect_tax" || (p.id !== myPlayerId && p.influenceCount > 0))
			); // Logique cible
			if (!target) {
				alert("Cible invalide ou nom incorrect.");
				return;
			}
			targetId = target.id;
			console.log(`Cible: ${targetName} (ID: ${targetId})`);
		}
		socket.emit("player_action", { actionType, targetId });
		actionButtonsDiv
			.querySelectorAll(".action-btn")
			.forEach((button) => (button.disabled = true));
		gamePromptMessage.textContent = "Action envoyée...";
	}
});
challengeButton.addEventListener("click", () => {
	console.log("Clic Contester !");
	/* TODO */ reactionButtonsDiv.style.display = "none";
});
blockButton.addEventListener("click", () => {
	console.log("Clic Bloquer !");
	socket.emit("player_block", {});
	reactionButtonsDiv.style.display = "none";
});
function handleTargetSelection(playerId) {
	console.log(`Clic adversaire: ${playerId}`); /* TODO: Logique sélection cible */
}

// --- Initialisation ---
gameArea.style.display = "none";
lobbyContainer.style.display = "block";
