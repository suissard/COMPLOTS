// server.js - v6 (Corrigé et Complet)

// --- Importations ---
const express = require("express"); // Framework web
const http = require("http"); // Module HTTP natif de Node
const path = require("path"); // Gestion des chemins de fichiers
const { Server } = require("socket.io"); // Classe Server de Socket.IO
const fs = require("fs"); // Module File System pour lire JSON

// Importe les classes depuis notre fichier de logique
const { Deck, Card } = require("./game/logic.js"); // Importe Deck ET Card

// --- Chargement Configuration ---
let gameConfig;
try {
	const rawData = fs.readFileSync(path.join(__dirname, "cards.json"));
	gameConfig = JSON.parse(rawData);
	console.log("✅ Configuration du jeu (cards.json) chargée.");
	// Valider la config ici si besoin (ex: vérifier que gameConfig.roles existe)
	if (
		!gameConfig ||
		!Array.isArray(gameConfig.roles) ||
		!Array.isArray(gameConfig.generalActions)
	) {
		throw new Error("Structure de cards.json invalide (manque roles ou generalActions).");
	}
} catch (error) {
	console.error("❌ ERREUR FATALE: Impossible de charger ou parser cards.json !", error);
	process.exit(1); // Arrête si la config est inutilisable
}

// --- Initialisation Serveur ---
const app = express(); // Crée l'application Express (MANQUANT PRÉCÉDEMMENT)
const server = http.createServer(app); // Crée le serveur HTTP à partir d'Express
const io = new Server(server, {
	// Initialise Socket.IO
	cors: {
		origin: "*", // À restreindre en production
		methods: ["GET", "POST"],
	},
});

// --- Constantes & Stockage ---
const PORT = process.env.PORT || 3000;
const MIN_PLAYERS_PER_LOBBY = 2;
const MAX_PLAYERS_PER_LOBBY = 6; // Ajuster si besoin selon les règles finales
const STARTING_COINS = 2;
const CARDS_PER_PLAYER = 2;

// Stockage des Lobbies en mémoire
const lobbies = {}; // { lobbyName: { players: [...], gameState: {...} } }

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
	// On pourrait utiliser "new Card(gameConfig.roles.find...)" si on voulait un objet Card
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
		myInfluenceIds: player.influence, // Ses cartes !
		myCoins: player.coins,
		players: lobby.players.map((p) => ({
			// Infos publiques des autres
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
		declaredAction: lobby.gameState.declaredAction, // Action en cours de résolution
	};
}

/**
 * Passe au joueur suivant actif.
 * @param {string} lobbyName
 */
function nextTurn(lobbyName) {
	const lobby = lobbies[lobbyName];
	if (!lobby || !lobby.gameState || lobby.gameState.status !== "playing") return;

	const activePlayers = lobby.players.filter((p) => p.influence.length > 0);
	if (activePlayers.length <= 1) {
		lobby.gameState.status = "finished";
		const winner = activePlayers[0];
		console.log(
			`🏁 Fin de partie dans ${lobbyName}. Gagnant: ${winner ? winner.name : "Personne?"}`
		);
		io.to(lobbyName).emit("game_over", {
			winner: winner ? { id: winner.id, name: winner.name } : null,
		});
		return;
	}

	const currentPlayerIndex = activePlayers.findIndex(
		(p) => p.id === lobby.gameState.currentPlayerId
	);
	// Gère le cas où le joueur courant n'est plus actif (devrait pas arriver si appelé au bon moment)
	const nextPlayerIndex =
		currentPlayerIndex === -1
			? 0 // Si joueur courant inactif, on repart du premier actif
			: (currentPlayerIndex + 1) % activePlayers.length;

	lobby.gameState.currentPlayerId = activePlayers[nextPlayerIndex].id;
	lobby.gameState.currentTurnState = "AWAITING_ACTION";
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
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Route pour les règles
app.get("/rules", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "rules.html"));
});

// --- Logique Socket.IO ---
io.on("connection", (socket) => {
	console.log(`🟢 Joueur connecté : ${socket.id}`);
	socket.emit("game_config", gameConfig); // Envoie la config au client

	// --- Rejoindre un Lobby ---
	socket.on("join_lobby", ({ playerName, lobbyName }) => {
		// Validation entrées
		if (!playerName || !lobbyName || playerName.length > 20 || lobbyName.length > 20) {
			socket.emit("lobby_error", "Pseudo ou nom de lobby invalide.");
			return;
		}
		// Création lobby si besoin
		if (!lobbies[lobbyName]) {
			lobbies[lobbyName] = { players: [], gameState: { status: "waiting" } };
			console.log(`✨ Lobby "${lobbyName}" créé.`);
		}
		const lobby = lobbies[lobbyName];
		// Validations (plein, pseudo, état)
		if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) {
			socket.emit("lobby_error", "Ce lobby est plein !");
			return;
		}
		if (lobby.players.some((p) => p.name === playerName)) {
			socket.emit("lobby_error", "Ce pseudo est déjà pris.");
			return;
		}
		if (lobby.gameState.status !== "waiting") {
			socket.emit("lobby_error", "Partie déjà commencée.");
			return;
		}

		// Ajout joueur
		const newPlayer = {
			id: socket.id,
			name: playerName,
			coins: STARTING_COINS,
			influence: [],
			lostInfluence: [],
		};
		lobby.players.push(newPlayer);
		socket.join(lobbyName);
		socket.lobbyName = lobbyName; // Stocke pour retrouver à la déconnexion
		socket.playerName = playerName;

		// Confirmation + update
		const lobbyData = {
			lobbyName: lobbyName,
			players: lobby.players.map((p) => ({ id: p.id, name: p.name })),
			maxPlayers: MAX_PLAYERS_PER_LOBBY,
			isHost: lobby.players.length === 1,
		};
		socket.emit("lobby_joined", lobbyData);
		socket
			.to(lobbyName)
			.emit("update_lobby", {
				players: lobby.players.map((p) => ({ id: p.id, name: p.name })),
			});
		console.log(`👍 [${socket.id}] ("${playerName}") a rejoint le lobby "${lobbyName}".`);
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
			// Utilise la classe Deck qui valide les cartes à l'intérieur
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

		// Envoi état initial
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
		// Validations (partie en cours, tour du joueur, état AWAITING_ACTION)
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

		let actionProcessed = false;
		let requiresChallengeBlockPhase = false; // Mettre à true pour les actions contestables/blocables
		let actionCost = 0;
		const actionType = actionData.actionType;

		// Vérifier si c'est une action générale
		const generalActionInfo = gameConfig.generalActions.find((a) => a.id === actionType);

		if (generalActionInfo) {
			// --- Traitement Actions Générales ---
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
					// !! Logique future: Phase de contestation/blocage !!
					// Stocker l'action déclarée
					lobby.gameState.declaredAction = { type: "foreign_aid", actorId: playerId };
					// Changer l'état pour attendre les réactions
					lobby.gameState.currentTurnState = "AWAITING_CHALLENGE_OR_BLOCK";
					// Notifier les autres joueurs de l'opportunité
					io.to(lobbyName).emit("action_opportunity", {
						actorName: player.name,
						actionType: "foreign_aid",
						actionDescription: generalActionInfo.description,
						// Qui peut bloquer? Utiliser blockedByFaction de generalActionInfo
						canBeBlockedByFaction: generalActionInfo.blockedByFaction || [],
					});
					requiresChallengeBlockPhase = true; // Ne pas terminer le tour tout de suite
					actionProcessed = true; // L'action est "en cours", pas terminée
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
						` -> ${socket.playerName} lance Coup d'État sur ${targetPlayer.name}.`
					);
					player.coins -= actionCost;
					// !! Logique future: Demander à la cible quelle carte révéler !!
					// Logique actuelle (simplifiée):
					if (targetPlayer.influence.length > 0) {
						const lostCardId = targetPlayer.influence.pop();
						targetPlayer.lostInfluence.push(lostCardId);
						lobby.gameState.discardPile.push(lostCardId);
						console.log(
							` -> ${targetPlayer.name} perd ${lostCardId}. Restant: ${targetPlayer.influence.length}`
						);
						io.to(lobbyName).emit(
							"game_message",
							`${targetPlayer.name} perd une influence (Coup d'État) !`
						);
						if (targetPlayer.influence.length === 0) {
							console.log(` -> ${targetPlayer.name} est éliminé !`);
							io.to(lobbyName).emit("player_eliminated", {
								playerId: targetId,
								playerName: targetPlayer.name,
							});
							// Déclencher Croque-Mort ici ?
						}
					}
					actionProcessed = true;
					break;
				default:
					socket.emit("game_error", `Action générale inconnue: ${actionType}`);
					return;
			}
		} else {
			// --- Traitement Actions de Rôle (à ajouter) ---
			const roleActionInfo = gameConfig.roles.find((r) => r.actionType === actionType);
			if (roleActionInfo) {
				console.log(
					` -> ${socket.playerName} déclare utiliser ${roleActionInfo.name} pour ${actionType}`
				);
				// !! Logique future: Phase de contestation/blocage !!
				// Vérifier coût si applicable (ex: Assassin)
				// Stocker l'action déclarée (avec carte prétendue = roleActionInfo.id)
				lobby.gameState.declaredAction = {
					type: actionType,
					actorId: playerId,
					claimedCardId: roleActionInfo.id, // Carte que le joueur prétend avoir
					targetId: actionData.targetId, // Si l'action a une cible
				};
				lobby.gameState.currentTurnState = "AWAITING_CHALLENGE_OR_BLOCK";
				// Notifier les autres
				io.to(lobbyName).emit("action_opportunity", {
					actorName: player.name,
					actionType: actionType,
					actionDescription: roleActionInfo.actionDescription,
					claimedCardName: roleActionInfo.name,
					targetName: actionData.targetId
						? lobby.players.find((p) => p.id === actionData.targetId)?.name
						: null,
					canBeChallenged: true, // Les actions de rôle peuvent être contestées
					canBeBlockedByFaction: roleActionInfo.counteredByFaction || [], // Factions qui contrent cette action
				});
				requiresChallengeBlockPhase = true;
				actionProcessed = true; // Action "en cours"
			} else {
				socket.emit("game_error", `Type d'action totalement inconnu: ${actionType}`);
				return;
			}
		}

		// --- Fin du Tour ou Attente ---
		if (actionProcessed && !requiresChallengeBlockPhase) {
			io.to(lobbyName).emit("game_update", getPublicGameState(lobby));
			nextTurn(lobbyName);
		} else if (requiresChallengeBlockPhase) {
			io.to(lobbyName).emit("game_update", getPublicGameState(lobby)); // Met à jour l'état (ex: AWAITING_CHALLENGE_OR_BLOCK)
			console.log(
				`[${lobbyName}] Action ${actionType} déclarée. Attente de réactions...`
			);
			// Mettre en place un timer ici ?
		}
	});

	// --- Autres gestionnaires (challenge, block, etc. à ajouter) ---

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
					// Ne supprime que si vide ET pas en jeu? Ou toujours?
					delete lobbies[lobbyName];
					console.log(`🗑️ Lobby [${lobbyName}] vide supprimé.`);
				} else {
					// Informer les autres joueurs du départ
					io.to(lobbyName).emit("update_lobby", {
						players: lobby.players.map((p) => ({ id: p.id, name: p.name })),
					});
					// Si la partie était en cours...
					if (lobby.gameState.status === "playing") {
						io.to(lobbyName).emit(
							"game_message",
							`⚠️ ${leavingPlayerName} a quitté la partie.`
						);
						// Si c'était son tour, passer au suivant
						if (lobby.gameState.currentPlayerId === socket.id) {
							console.log(` -> C'était son tour, passage au suivant.`);
							nextTurn(lobbyName); // nextTurn gère aussi la fin de partie si besoin
						}
						// Vérifier si la partie doit se terminer s'il reste moins de 2 joueurs
						const activePlayers = lobby.players.filter((p) => p.influence.length > 0);
						if (activePlayers.length < MIN_PLAYERS_PER_LOBBY) {
							// Peut-être attendre un peu avant de déclarer la fin? Ou finir direct?
							console.log(
								` -> Moins de ${MIN_PLAYERS_PER_LOBBY} joueurs restants, fin de partie.`
							);
							nextTurn(lobbyName); // nextTurn gère la fin si <= 1 joueur actif
						}
					}
				}
			}
		}
	});
});

// --- Démarrage du Serveur ---
server.listen(PORT, () => {
	console.log(`🚀 Serveur Complot (v6 - Complet) démarré sur http://localhost:${PORT}`);
});
