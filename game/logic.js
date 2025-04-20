// game/logic.js - Classes et logique réutilisables pour le jeu Complot

/**
 * Représente et gère la pioche de cartes du jeu.
 */
class Deck {
    /**
     * @type {string[]} - Tableau des ID des cartes dans la pioche.
     */
    #cards = []; // Propriété privée pour stocker les cartes

    /**
     * Crée une instance de Deck.
     * @param {object} gameConfig - L'objet de configuration chargé depuis cards.json.
     * @param {Array<object>} gameConfig.roles - La liste des rôles avec leurs détails.
     */
    constructor(gameConfig) {
        this.#cards = this.#createFullDeck(gameConfig);
        console.log(`Deck initialisé avec ${this.#cards.length} cartes.`);
    }

    /**
     * Crée une pioche complète basée sur la configuration.
     * @param {object} gameConfig - L'objet de configuration du jeu.
     * @returns {string[]} Un tableau contenant les ID de toutes les cartes.
     * @private // Méthode privée utilisée par le constructeur
     */
    #createFullDeck(gameConfig) {
        const deck = [];
        if (!gameConfig || !gameConfig.roles) {
            console.error("ERREUR: gameConfig invalide pour créer le deck.");
            return [];
        }
        gameConfig.roles.forEach(role => {
            for (let i = 0; i < role.countInDeck; i++) {
                deck.push(role.id); // Ajoute l'ID de la carte
            }
        });
        return deck;
    }

    /**
     * Mélange les cartes dans la pioche (algorithme Fisher-Yates).
     * @returns {void}
     */
    shuffle() {
        const deck = this.#cards;
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]]; // Échange les éléments
        }
        console.log("Deck mélangé !");
    }

    /**
     * Pioche une ou plusieurs cartes du dessus de la pioche.
     * @param {number} [count=1] - Le nombre de cartes à piocher.
     * @returns {string | string[] | null} L'ID de la carte piochée (ou un tableau d'IDs si count > 1), ou null si la pioche est vide.
     */
    draw(count = 1) {
        if (this.#cards.length === 0) {
            console.warn("Attention: Tentative de pioche dans un deck vide !");
            return count === 1 ? null : [];
        }
        if (count === 1) {
            // pop() retire et retourne le dernier élément (le "dessus" de la pioche)
            return this.#cards.pop() || null;
        } else {
            const drawnCards = [];
            for (let i = 0; i < count; i++) {
                if (this.#cards.length > 0) {
                    drawnCards.push(this.#cards.pop());
                } else {
                    break; // Arrête si la pioche est vide
                }
            }
            return drawnCards;
        }
    }

    /**
     * Ajoute une carte (par son ID) sous la pioche (ou dans la pioche avant de remélanger).
     * Utile pour l'échange de l'Ambassadeur/Espion ou une contestation réussie.
     * @param {string} cardId - L'ID de la carte à remettre.
     * @returns {void}
     */
    addCard(cardId) {
        // Pour l'instant, on ajoute simplement à la fin (comme si on mettait sous la pioche)
        // Une autre approche serait de l'ajouter n'importe où et de remélanger.
        this.#cards.push(cardId);
        // Alternative: this.#cards.splice(Math.floor(Math.random() * this.#cards.length), 0, cardId); // Insère aléatoirement
    }

    /**
     * Retourne le nombre de cartes restantes dans la pioche.
     * @returns {number} Le nombre de cartes restantes.
     */
    cardsRemaining() {
        return this.#cards.length;
    }

    /**
     * Vérifie si la pioche est vide.
     * @returns {boolean} True si la pioche est vide, false sinon.
     */
    isEmpty() {
        return this.#cards.length === 0;
    }
}


// Exporte la classe Deck pour pouvoir l'utiliser dans server.js
module.exports = { Deck };

// On pourrait ajouter d'autres classes ici plus tard (Player, GameState, etc.)
