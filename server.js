// server.js - v7 avec gestion du blocage pour Aide Étrangère

// --- Importations ---
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const fs = require("fs");
const { Deck, Card } = require("./game/logic.js"); // Importe Deck ET Card

// --- Chargement Configuration ---
let gameConfig;
try {
	const rawData = fs.readFileSync(path.join(__dirname, "public/cards.json"));
	gameConfig = JSON.parse(rawData);
	console.log("✅ Configuration du jeu (cards.json) chargée.");
	if (
		!gameConfig ||
		!Array.isArray(gameConfig.roles) ||
		!Array.isArray(gameConfig.generalActions)
	) {
		throw new Error("Structure de cards.json invalide.");
	}
} catch (error) {
	console.error("❌ ERREUR FATALE: Impossible de charger cards.json !", error);
	process.exit(1);
}

// --- Initialisation Serveur ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- Constantes & Stockage ---
const PORT = process.env.PORT || 3000;
const MIN_PLAYERS_PER_LOBBY = 2;
const MAX_PLAYERS_PER_LOBBY = 6;
const STARTING_COINS = 2;
const CARDS_PER_PLAYER = 2;
const REACTION_TIMEOUT_MS = 15000; // Temps en ms pour réagir (contester/bloquer) - 15 secondes

const lobbies = {}; // { lobbyName: { players: [...], gameState: {..., reactionTimer: null} } }

// --- Fonctions Utilitaires ---

/**
 * Distribue les cartes initiales.
 * @param {Array<object>} players
 * @param {Deck} deckManager
 */
function dealInitialCards(players, deckManager) {
	console.log(
		`Distribution de ${CARDS_PER_PLAYER} cartes à ${players.length} joueurs...`
	);
	players.forEach((player) => {
		player.influence = deckManager.draw(CARDS_PER_PLAYER);
		player.lostInfluence = [];
		player.coins = STARTING_COINS;
		console.log(
			` -> Joueur ${player.name} a reçu ses cartes (IDs: ${player.influence.join(
				", "
			)}) et ${player.coins} pièces.`
		);
	});
	console.log(`Distribution terminée. Cartes restantes: ${deckManager.cardsRemaining()}`);
}

/**
 * Détermine le joueur de départ.
 * @param {Array<object>} players
 * @returns {string} ID du joueur.
 */
function determineStartingPlayer(players) {
	const randomIndex = Math.floor(Math.random() * players.length);
	return players[randomIndex].id;
}
/**
 * Récupère les infos d'une carte depuis gameConfig.
 * @param {string} cardId
 * @returns {object | null}
 */
function getCardInfo(cardId) {
	return gameConfig.roles.find((role) => role.id === cardId) || null;
}

/**
 * Vérifie si un joueur possède au moins une carte d'une faction donnée.
 * @param {object} player - L'objet joueur (avec player.influence contenant les IDs).
 * @param {string} factionId - L'ID de la faction à vérifier.
 * @returns {boolean} True si le joueur a une carte de cette faction, false sinon.
 */
function playerHasFaction(player, factionId) {
	if (!player || !player.influence || !factionId) return false;
	// Itère sur les cartes (IDs) du joueur
	for (const cardId of player.influence) {
		const cardInfo = getCardInfo(cardId);
		// Vérifie si la carte existe et appartient à la bonne faction
		if (cardInfo && cardInfo.faction === factionId) {
			return true; // Trouvé !
		}
	}
	return false; // Aucune carte de cette faction trouvée
}

/**
 * Construit l'état initial pour UN joueur (infos privées incluses).
 * @param {object} lobby
 * @param {string} playerId
 * @returns {object | null}
 */
function getInitialGameStateForPlayer(lobby, playerId) {
	const player = lobby.players.find((p) => p.id === playerId);
	if (!player || !lobby.gameState || !lobby.gameState.deckManager) return null;
	return {
		myId: playerId,
		myInfluenceIds: player.influence,
		myCoins: player.coins,
		players: lobby.players.map((p) => ({
			id: p.id,
			name: p.name,
			coins: p.coins,
			influenceCount: p.influence.length,
			lostInfluenceIds: p.lostInfluence,
		})),
		currentPlayerId: lobby.gameState.currentPlayerId,
		deckCardCount: lobby.gameState.deckManager.cardsRemaining(),
		discardPileIds: lobby.gameState.discardPile,
	};
}
/**
 * Construit l'état public du jeu (visible par tous).
 * @param {object} lobby
 * @returns {object}
 */
function getPublicGameState(lobby) {
	if (!lobby || !lobby.gameState || !lobby.gameState.deckManager) return {};
	return {
		players: lobby.players.map((p) => ({
			id: p.id,
			name: p.name,
			coins: p.coins,
			influenceCount: p.influence.length,
			lostInfluenceIds: p.lostInfluence,
		})),
		currentPlayerId: lobby.gameState.currentPlayerId,
		currentTurnState: lobby.gameState.currentTurnState,
		deckCardCount: lobby.gameState.deckManager.cardsRemaining(),
		discardPileIds: lobby.gameState.discardPile,
		declaredAction: lobby.gameState.declaredAction,
	};
}

/**
 * Tente de résoudre l'action déclarée (appelée après timeout ou si phase C/B terminée sans blocage).
 * @param {string} lobbyName - Le nom du lobby.
 */
function resolveDeclaredAction(lobbyName) {
	const lobby = lobbies[lobbyName];
	// Vérifie si l'action est toujours en attente de résolution
	if (
		!lobby ||
		lobby.gameState.status !== "playing" ||
		lobby.gameState.currentTurnState !== "AWAITING_CHALLENGE_OR_BLOCK"
	) {
		// Peut arriver si un blocage/challenge a déjà résolu l'action entre temps
		console.log(
			`[${lobbyName}] Tentative de résolution d'action annulée (état: ${lobby?.gameState?.currentTurnState})`
		);
		return;
	}

	const action = lobby.gameState.declaredAction;
	if (!action) {
		console.error(`[${lobbyName}] Erreur: Tentative de résolution sans action déclarée.`);
		// Peut-être passer au tour suivant par sécurité?
		nextTurn(lobbyName);
		return;
	}

	const actor = lobby.players.find((p) => p.id === action.actorId);
	if (!actor) {
		console.error(
			`[${lobbyName}] Erreur: Acteur de l'action ${action.type} introuvable.`
		);
		nextTurn(lobbyName);
		return;
	}

	console.log(
		`[${lobbyName}] Résolution de l'action ${action.type} pour ${actor.name} (pas de blocage/contestation).`
	);

	// Appliquer l'effet de l'action
	let actionSuccessful = false;
	switch (action.type) {
		case "foreign_aid":
			actor.coins += 2;
			console.log(` -> ${actor.name} reçoit Aide Étrangère (+2). Total: ${actor.coins}`);
			io.to(lobbyName).emit("game_message", `${actor.name} reçoit l'Aide Étrangère.`);
			actionSuccessful = true;
			break;
		// --- Ajouter ici la résolution des autres actions ---
		// case 'tax':
		//     actor.coins += 3;
		//     console.log(` -> ${actor.name} reçoit Taxe (+3). Total: ${actor.coins}`);
		//     io.to(lobbyName).emit('game_message', `${actor.name} collecte la Taxe.`);
		//     actionSuccessful = true;
		//     break;
		// case 'steal': ... etc ...

		default:
			console.error(
				`[${lobbyName}] Erreur: Type d'action inconnu lors de la résolution: ${action.type}`
			);
			// Ne rien faire et passer au tour suivant?
			break;
	}

	// Nettoyer l'action déclarée et passer au tour suivant
	lobby.gameState.declaredAction = null;
	// On met à jour l'état AVANT de passer au tour suivant
	io.to(lobbyName).emit("game_update", getPublicGameState(lobby));
	nextTurn(lobbyName);
}

/**
 * Passe au joueur suivant actif.
 * @param {string} lobbyName - Le nom du lobby.
 */
function nextTurn(lobbyName) {
	const lobby = lobbies[lobbyName];
	// Vérifications initiales (lobby existe, jeu en cours)
	if (
		!lobby ||
		!lobby.gameState ||
		!["playing", "finished"].includes(lobby.gameState.status)
	)
		return;

	// Nettoie le timer de réaction précédent s'il existe
	if (lobby.gameState.reactionTimer) {
		clearTimeout(lobby.gameState.reactionTimer);
		lobby.gameState.reactionTimer = null;
	}

	// Si la partie est déjà finie, ne rien faire de plus
	if (lobby.gameState.status === "finished") return;

	const activePlayers = lobby.players.filter((p) => p.influence.length > 0);
	if (activePlayers.length <= 1) {
		lobby.gameState.status = "finished";
		const winner = activePlayers[0];
		console.log(
			`🏁 Fin de partie [${lobbyName}]. Gagnant: ${winner ? winner.name : "Personne?"}`
		);
		io.to(lobbyName).emit("game_over", {
			winner: winner ? { id: winner.id, name: winner.name } : null,
		});
		// Supprimer le lobby après un délai?
		// setTimeout(() => { delete lobbies[lobbyName]; }, 60000); // Ex: 1 minute
		return;
	}

	const currentPlayerIndex = activePlayers.findIndex(
		(p) => p.id === lobby.gameState.currentPlayerId
	);
	const nextPlayerIndex =
		currentPlayerIndex === -1 ? 0 : (currentPlayerIndex + 1) % activePlayers.length;
	lobby.gameState.currentPlayerId = activePlayers[nextPlayerIndex].id;
	lobby.gameState.currentTurnState = "AWAITING_ACTION"; // Prêt pour la nouvelle action
	lobby.gameState.declaredAction = null;
	lobby.gameState.declaredBlock = null;
	lobby.gameState.challengeInfo = null;

	const nextPlayerName = activePlayers[nextPlayerIndex].name;
	console.log(`[${lobbyName}] Tour suivant -> ${nextPlayerName}`);

	io.to(lobbyName).emit("game_update", getPublicGameState(lobby));
	io.to(lobby.gameState.currentPlayerId).emit("request_action", {
		message: "C'est votre tour !",
	});
}

// --- Configuration Express ---
// Servir les fichiers statiques du dossier 'public'
app.use(express.static(path.join(__dirname, "public")));
// Route pour la page d'accueil
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
// Route pour les règles
app.get("/rules", (req, res) =>
	res.sendFile(path.join(__dirname, "public", "rules.html"))
);
app.get('/cards', (req, res) => {
    // Assure-toi que 'gallery.html' (le fichier créé précédemment) existe dans 'public'
    res.sendFile(path.join(__dirname, 'public', 'cards.html'));
});

// --- Logique Socket.IO ---
io.on("connection", (socket) => {
	console.log(`🟢 Joueur connecté : ${socket.id}`);
	socket.emit("game_config", gameConfig);

	// --- Rejoindre un Lobby ---
	socket.on("join_lobby", ({ playerName, lobbyName }) => {
		if (!playerName || !lobbyName || playerName.length > 20 || lobbyName.length > 20) {
			socket.emit("lobby_error", "Pseudo/Lobby invalide.");
			return;
		}
		if (!lobbies[lobbyName]) {
			lobbies[lobbyName] = { players: [], gameState: { status: "waiting" } };
			console.log(`✨ Lobby "${lobbyName}" créé.`);
		}
		const lobby = lobbies[lobbyName];
		if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) {
			socket.emit("lobby_error", "Lobby plein !");
			return;
		}
		if (lobby.players.some((p) => p.name === playerName)) {
			socket.emit("lobby_error", "Pseudo déjà pris.");
			return;
		}
		if (lobby.gameState.status !== "waiting") {
			socket.emit("lobby_error", "Partie commencée.");
			return;
		}
		const newPlayer = {
			id: socket.id,
			name: playerName,
			coins: STARTING_COINS,
			influence: [],
			lostInfluence: [],
		};
		lobby.players.push(newPlayer);
		socket.join(lobbyName);
		socket.lobbyName = lobbyName;
		socket.playerName = playerName;
		const lobbyData = {
			lobbyName: lobbyName,
			players: lobby.players.map((p) => ({ id: p.id, name: p.name })),
			maxPlayers: MAX_PLAYERS_PER_LOBBY,
			isHost: lobby.players.length === 1,
		};
		socket.emit("lobby_joined", lobbyData);
		socket.to(lobbyName).emit("update_lobby", {
			players: lobby.players.map((p) => ({ id: p.id, name: p.name })),
		});
		console.log(`👍 [${socket.id}] ("${playerName}") a rejoint [${lobbyName}].`);
	});

	// --- Démarrage de la Partie ---
	socket.on("request_start_game", () => {
		const lobbyName = socket.lobbyName;
		const playerName = socket.playerName;
		// Vérifier si le lobby existe
		if (!lobbyName || !lobbies[lobbyName]) {
			console.error(
				`❗️ Tentative de démarrage pour un lobby inexistant: "${lobbyName}"`
			);
			socket.emit("lobby_error", "Erreur interne : Lobby introuvable.");
			return;
		}
		const lobby = lobbies[lobbyName];
		// Validations (état, hôte, nb joueurs)
		if (lobby.gameState.status !== "waiting") {
			console.log(
				`❗️ [${playerName}] Tentative de démarrage alors que la partie est déjà ${lobby.gameState.status}.`
			);
			socket.emit("lobby_error", "La partie a déjà commencé ou est terminée.");
			return;
		}

		// Vérifier si le demandeur est bien l'hôte (le premier joueur à avoir rejoint)
		if (!lobby.players.length || lobby.players[0].id !== socket.id) {
			console.log(
				`❗️ [${playerName}] n'est pas l'hôte et ne peut pas démarrer la partie.`
			);
			socket.emit("lobby_error", "Seul l'hôte peut démarrer la partie.");
			return;
		}
		// Vérifier s'il y a assez de joueurs
		if (lobby.players.length < MIN_PLAYERS_PER_LOBBY) {
			console.log(
				`❗️ Pas assez de joueurs dans "${lobbyName}" pour démarrer (${lobby.players.length}/${MIN_PLAYERS_PER_LOBBY}).`
			);
			socket.emit(
				"lobby_error",
				`Il faut au moins ${MIN_PLAYERS_PER_LOBBY} joueurs pour commencer.`
			);
			return;
		}

		// --- Lancement ---
		console.log(`✅ Démarrage partie [${lobbyName}] par ${playerName}...`);
		lobby.gameState.status = "playing";
		try {
			lobby.gameState.deckManager = new Deck(gameConfig);
		} catch (error) {
			console.error(
				`❌ Erreur critique lors de la création du Deck pour [${lobbyName}]: ${error.message}`
			);
			io.to(lobbyName).emit(
				"lobby_error",
				`Erreur configuration jeu: ${error.message}. Impossible de démarrer.`
			);
			lobby.gameState.status = "error"; // Met le lobby en état d'erreur
			return;
		}
		lobby.gameState.deckManager.shuffle();
		lobby.gameState.discardPile = [];
		dealInitialCards(lobby.players, lobby.gameState.deckManager);
		lobby.gameState.currentPlayerId = determineStartingPlayer(lobby.players);
		lobby.gameState.currentTurnState = "AWAITING_ACTION";
		lobby.gameState.declaredAction = null;
		lobby.gameState.declaredBlock = null;
		lobby.gameState.challengeInfo = null;
		lobby.gameState.reactionTimer = null; // Initialise le timer
		console.log(`📢 Envoi état initial [${lobbyName}]...`);
		lobby.players.forEach((player) => {
			const initialState = getInitialGameStateForPlayer(lobby, player.id);
			io.to(player.id).emit("game_start", initialState);
		});
		const startingPlayer = lobby.players.find(
			(p) => p.id === lobby.gameState.currentPlayerId
		);
		io.to(lobbyName).emit(
			"game_message",
			`🚀 La partie commence ! C'est au tour de ${startingPlayer.name}.`
		);
		io.to(lobby.gameState.currentPlayerId).emit("request_action", {
			message: "C'est votre tour !",
		});
	});

	// --- Gestion des Actions du Joueur ---
	socket.on("player_action", (actionData) => {
		const lobbyName = socket.lobbyName;
		const playerId = socket.id;
		if (!lobbyName || !lobbies[lobbyName]) return;
		const lobby = lobbies[lobbyName];
		if (lobby.gameState.status !== "playing") return;
		if (lobby.gameState.currentPlayerId !== playerId) {
			socket.emit("game_error", "Pas votre tour.");
			return;
		}
		if (lobby.gameState.currentTurnState !== "AWAITING_ACTION") {
			socket.emit("game_error", "Action impossible maintenant.");
			return;
		}
		if (!actionData || !actionData.actionType) {
			socket.emit("game_error", "Action invalide.");
			return;
		}

		console.log(
			`[${lobbyName}] Joueur ${socket.playerName} tente: ${actionData.actionType}`
		);
		const player = lobby.players.find((p) => p.id === playerId);
		if (!player) return;

		let actionProcessed = false; // Action traitée (mais peut-être en attente de C/B)
		let requiresChallengeBlockPhase = false;
		let actionCost = 0;
		const actionType = actionData.actionType;
		const generalActionInfo = gameConfig.generalActions.find((a) => a.id === actionType);
		const roleActionInfo = gameConfig.roles.find((r) => r.actionType === actionType);

		// --- Validation spécifique à l'action (coût, cible, etc.) ---
		if (actionType === "coup") {
			actionCost = generalActionInfo.cost;
			const targetId = actionData.targetId;
			const targetPlayer = lobby.players.find((p) => p.id === targetId);
			if (player.coins < actionCost) {
				socket.emit("game_error", `Pas assez d'or (coût: ${actionCost})`);
				return;
			}
			if (!targetId || !targetPlayer || targetPlayer.influence.length === 0) {
				socket.emit("game_error", "Cible invalide.");
				return;
			}
			if (targetId === playerId) {
				socket.emit("game_error", "Auto-coup interdit.");
				return;
			}
		}
		// Ajouter ici validations pour Assassin, etc.

		// --- Traitement ---
		if (generalActionInfo) {
			switch (actionType) {
				case "income":
					player.coins += 1;
					console.log(
						` -> ${socket.playerName} +1 pièce (Revenu). Total: ${player.coins}`
					);
					actionProcessed = true;
					break;
				case "foreign_aid":
					console.log(` -> ${socket.playerName} déclare Aide Étrangère.`);
					lobby.gameState.declaredAction = { type: "foreign_aid", actorId: playerId };
					lobby.gameState.currentTurnState = "AWAITING_CHALLENGE_OR_BLOCK";
					// Notifier opportunité + factions blocantes
					io.to(lobbyName).emit("action_opportunity", {
						actorName: player.name,
						actionType: "foreign_aid",
						actionDescription: generalActionInfo.description,
						// Qui peut bloquer? Utiliser blockedByFaction de generalActionInfo
						canBeBlockedByFaction: generalActionInfo.blockedByFaction || [],
					});
					requiresChallengeBlockPhase = true;
					actionProcessed = true;
					break;
				case "coup":
					actionCost = generalActionInfo.cost;
					const targetId = actionData.targetId;
					const targetPlayer = lobby.players.find((p) => p.id === targetId);
					// Validations spécifiques au Coup
					if (player.coins < actionCost) {
						socket.emit("game_error", `Pas assez d'or (coût: ${actionCost})`);
						return;
					}
					if (!targetId || !targetPlayer || targetPlayer.influence.length === 0) {
						socket.emit("game_error", "Cible invalide.");
						return;
					}
					if (targetId === playerId) {
						socket.emit("game_error", "Auto-coup interdit.");
						return;
					}

					console.log(
						` -> ${socket.playerName} lance Coup d'État sur ${actionData.targetId}.`
					);
					player.coins -= actionCost;
					// Logique de perte d'influence (simplifiée)
					if (targetPlayer.influence.length > 0) {
						const lostCardId = targetPlayer.influence.pop();
						targetPlayer.lostInfluence.push(lostCardId);
						lobby.gameState.discardPile.push(lostCardId);
						io.to(lobbyName).emit(
							"game_message",
							`${targetPlayer.name} perd une influence (Coup d'État) !`
						);
						if (targetPlayer.influence.length === 0) {
							io.to(lobbyName).emit("player_eliminated", {
								playerId: targetPlayer.id,
								playerName: targetPlayer.name,
							});
						}
					}
					actionProcessed = true; // Coup est imparable, traité immédiatement
					break;
				default:
					socket.emit("game_error", `Action générale inconnue: ${actionType}`);
					return;
			}
		} else if (roleActionInfo) {
			// --- Traitement Actions de Rôle ---
			console.log(
				` -> ${socket.playerName} déclare utiliser ${roleActionInfo.name} pour ${actionType}`
			);
			// Vérifier coût si applicable (ex: Assassin)
			// ...
			lobby.gameState.declaredAction = {
				type: actionType,
				actorId: playerId,
				claimedCardId: roleActionInfo.id,
				targetId: actionData.targetId,
			};
			lobby.gameState.currentTurnState = "AWAITING_CHALLENGE_OR_BLOCK";
			// Notifier opportunité + factions blocantes + contestable
			io.to(lobbyName).emit("action_opportunity", {
				actorName: player.name,
				actionType: actionType,
				actionDescription: roleActionInfo.actionDescription,
				claimedCardName: roleActionInfo.name,
				targetName: actionData.targetId
					? lobby.players.find((p) => p.id === actionData.targetId)?.name
					: null,
				canBeChallenged: true, // Les actions de rôle peuvent être contestées
				canBeBlockedByFaction: roleActionInfo.counteredByFaction || [],
			});
			requiresChallengeBlockPhase = true;
			actionProcessed = true;
		} else {
			socket.emit("game_error", `Type d'action totalement inconnu: ${actionType}`);
			return;
		}

		// --- Suite : Fin du Tour ou Attente de Réaction ---
		if (actionProcessed && !requiresChallengeBlockPhase) {
			// Action terminée immédiatement (Income, Coup)
			io.to(lobbyName).emit("game_update", getPublicGameState(lobby));
			nextTurn(lobbyName);
		} else if (requiresChallengeBlockPhase) {
			// Action en attente de contestation/blocage
			io.to(lobbyName).emit("game_update", getPublicGameState(lobby));
			console.log(
				`[${lobbyName}] Action ${actionType} déclarée. Attente de réactions (${REACTION_TIMEOUT_MS}ms)...`
			);
			// Démarre le timer pour résoudre l'action si personne ne réagit
			lobby.gameState.reactionTimer = setTimeout(() => {
				console.log(`[${lobbyName}] Timeout pour ${actionType}. Résolution...`);
				resolveDeclaredAction(lobbyName);
			}, REACTION_TIMEOUT_MS);
		}
	});

	// --- Gestion du Blocage ---
	socket.on("player_block", (blockData) => {
		const lobbyName = socket.lobbyName;
		const blockerId = socket.id;
		if (!lobbyName || !lobbies[lobbyName]) return;
		const lobby = lobbies[lobbyName];
		const blockerPlayer = lobby.players.find((p) => p.id === blockerId);

		// Validations
		if (lobby.gameState.status !== "playing") return;
		if (lobby.gameState.currentTurnState !== "AWAITING_CHALLENGE_OR_BLOCK") {
			socket.emit("game_error", "Pas le moment de bloquer.");
			return;
		}
		if (!lobby.gameState.declaredAction) {
			socket.emit("game_error", "Aucune action à bloquer.");
			return;
		}
		if (lobby.gameState.declaredAction.actorId === blockerId) {
			socket.emit("game_error", "Vous ne pouvez pas bloquer votre propre action.");
			return;
		}
		if (!blockerPlayer) return;

		const actionType = lobby.gameState.declaredAction.type;
		let requiredFaction = null;

		// Détermine quelle faction est nécessaire pour bloquer CETTE action
		if (actionType === "foreign_aid") {
			const faInfo = gameConfig.generalActions.find((a) => a.id === "foreign_aid");
			// Note: blockedByFaction est un tableau, on prend le premier pour l'instant (simplification)
			// Il faudrait gérer le cas où plusieurs factions peuvent bloquer
			requiredFaction = faInfo.blockedByFaction ? faInfo.blockedByFaction[0] : null; // Ex: 'perceptrices'
			if (!requiredFaction) {
				socket.emit("game_error", "Cette action ne peut pas être bloquée.");
				return;
			}
		}
		// Ajouter ici la logique pour déterminer la faction requise pour bloquer les actions de rôle
		// else {
		//     const roleInfo = gameConfig.roles.find(r => r.actionType === actionType);
		//     requiredFaction = roleInfo.counteredByFaction ? roleInfo.counteredByFaction[0] : null;
		// }

		if (!requiredFaction) {
			console.warn(
				`[${lobbyName}] Pas de faction requise trouvée pour bloquer ${actionType}`
			);
			return; // Ne devrait pas arriver si la config est bonne
		}

		console.log(
			`[${lobbyName}] ${blockerPlayer.name} tente de bloquer ${actionType} (nécessite ${requiredFaction}).`
		);

		// Vérifier si le joueur a la faction requise
		if (playerHasFaction(blockerPlayer, requiredFaction)) {
			console.log(` -> Blocage VALIDE par ${blockerPlayer.name} !`);
			// Annuler le timer de résolution automatique
			if (lobby.gameState.reactionTimer) {
				clearTimeout(lobby.gameState.reactionTimer);
				lobby.gameState.reactionTimer = null;
				console.log(` -> Timer annulé.`);
			}

			// Annoncer le blocage
			// TODO: Permettre de contester le blocage ! Pour l'instant, on considère réussi.
			io.to(lobbyName).emit(
				"game_message",
				`${blockerPlayer.name} bloque l'action ${actionType} !`
			);
			lobby.gameState.declaredAction = null; // L'action est annulée

			// Mettre à jour et passer au tour suivant
			io.to(lobbyName).emit("game_update", getPublicGameState(lobby));
			nextTurn(lobbyName);
		} else {
			console.log(
				` -> Blocage INVALIDE par ${blockerPlayer.name} (n'a pas la faction ${requiredFaction}).`
			);
			socket.emit(
				"game_error",
				`Vous n'avez pas de carte de la faction ${requiredFaction} pour bloquer.`
			);
			// On ignore simplement la tentative de blocage invalide, le timer continue.
		}
	});

	// --- Autres gestionnaires (challenge, etc. à ajouter) ---

	// --- Déconnexion ---
	socket.on("disconnect", () => {
		console.log(`🔴 Joueur déconnecté : ${socket.id} (${socket.playerName || "?"})`);
		const lobbyName = socket.lobbyName;
		if (lobbyName && lobbies[lobbyName]) {
			const lobby = lobbies[lobbyName];
			const playerIndex = lobby.players.findIndex((p) => p.id === socket.id);
			if (playerIndex !== -1) {
				const leavingPlayerName = lobby.players[playerIndex].name;
				lobby.players.splice(playerIndex, 1);
				console.log(
					`👋 Joueur "${leavingPlayerName}" retiré de [${lobbyName}]. Restants: ${lobby.players.length}`
				);
				if (lobby.players.length === 0 && lobby.gameState.status !== "playing") {
					delete lobbies[lobbyName];
					console.log(`🗑️ Lobby [${lobbyName}] vide supprimé.`);
				} else {
					io.to(lobbyName).emit("update_lobby", {
						players: lobby.players.map((p) => ({ id: p.id, name: p.name })),
					});
					if (lobby.gameState.status === "playing") {
						io.to(lobbyName).emit(
							"game_message",
							`⚠️ ${leavingPlayerName} a quitté la partie.`
						);
						if (lobby.gameState.currentPlayerId === socket.id) {
							nextTurn(lobbyName);
						}
						const activePlayers = lobby.players.filter((p) => p.influence.length > 0);
						if (
							activePlayers.length < MIN_PLAYERS_PER_LOBBY &&
							activePlayers.length > 0
						) {
							// Fin si moins de 2 mais plus de 0
							console.log(
								` -> Moins de ${MIN_PLAYERS_PER_LOBBY} joueurs restants, fin de partie.`
							);
							nextTurn(lobbyName);
						}
					}
				}
			}
		}
	});
});

// --- Démarrage du Serveur ---
server.listen(PORT, () => {
	console.log(
		`🚀 Serveur Complot (v7 - Blocage FA) démarré sur http://localhost:${PORT}`
	);
});
