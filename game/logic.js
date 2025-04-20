// game/logic.js - Classes et logique réutilisables pour le jeu Complot

/**
 * Représente les données et potentiellement les comportements d'une carte Influence.
 */
class Card {
    /** @type {string} */ id;
    /** @type {string} */ name;
    /** @type {string} */ faction;
    /** @type {string | null} */ actionDescription;
    /** @type {string | null} */ actionType;
    /** @type {boolean} */ simultaneousClaimEffect;
    /** @type {string | null} */ triggeredActionDescription;
    /** @type {string | null} */ triggerCondition;
    /** @type {string | null} */ blockDescription;
    /** @type {string[]} */ blockType; // Types d'actions que cette carte bloque
    /** @type {string[]} */ counteredByFaction; // Factions qui peuvent contrer l'action de cette carte
    /** @type {number} */ countInDeck;
    /** @type {string} */ color;
    /** @type {string} */ imageUrl;

    /**
     * Crée une instance de Card.
     * @param {object} cardData - Les données brutes pour une carte, issues de gameConfig.roles.
     */
    constructor(cardData) {
        if (!cardData || typeof cardData !== 'object') {
            throw new Error("Données de carte invalides (non-objet) fournies au constructeur Card.");
        }
        // Assignation avec vérification de type basique ou valeur par défaut
        this.id = typeof cardData.id === 'string' ? cardData.id : null;
        this.name = typeof cardData.name === 'string' ? cardData.name : 'Nom inconnu';
        this.faction = typeof cardData.faction === 'string' ? cardData.faction : 'Faction inconnue';
        this.actionDescription = typeof cardData.actionDescription === 'string' ? cardData.actionDescription : null;
        this.actionType = typeof cardData.actionType === 'string' ? cardData.actionType : null;
        this.simultaneousClaimEffect = typeof cardData.simultaneousClaimEffect === 'boolean' ? cardData.simultaneousClaimEffect : false;
        this.triggeredActionDescription = typeof cardData.triggeredActionDescription === 'string' ? cardData.triggeredActionDescription : null;
        this.triggerCondition = typeof cardData.triggerCondition === 'string' ? cardData.triggerCondition : null;
        this.blockDescription = typeof cardData.blockDescription === 'string' ? cardData.blockDescription : null;
        this.blockType = Array.isArray(cardData.blockType) ? cardData.blockType : [];
        this.counteredByFaction = Array.isArray(cardData.counteredByFaction) ? cardData.counteredByFaction : [];
        this.countInDeck = typeof cardData.countInDeck === 'number' && cardData.countInDeck >= 0 ? cardData.countInDeck : 0;
        this.color = typeof cardData.color === 'string' ? cardData.color : '#ffffff';
        this.imageUrl = typeof cardData.imageUrl === 'string' ? cardData.imageUrl : '';

        // Validation après assignation
        this.validate();
    }

    /**
     * Valide les données essentielles de la carte. Lance une erreur si invalide.
     * @throws {Error} Si une donnée essentielle est manquante ou invalide.
     * @returns {void}
     */
    validate() {
        if (!this.id) throw new Error(`ID manquant pour la carte.`);
        if (!this.name) throw new Error(`Nom manquant pour la carte ID: ${this.id}.`);
        if (!this.faction) throw new Error(`Faction manquante pour la carte ID: ${this.id}.`);
        if (this.countInDeck <= 0) console.warn(`Attention: countInDeck est 0 ou moins pour la carte ID: ${this.id}. Elle ne sera pas dans la pioche.`);
        if (!this.imageUrl) console.warn(`Attention: imageUrl manquant pour la carte ID: ${this.id}.`);
        // On pourrait ajouter d'autres vérifications (ex: format couleur, types d'action/blocage valides, etc.)
    }

    /**
     * (Potentiel futur) Vérifie si cette carte peut bloquer un certain type d'action.
     * @param {string} actionTypeToBlock - Le type d'action à vérifier (ex: 'ASSASSINATE').
     * @returns {boolean} True si la carte peut bloquer ce type d'action.
     */
    canBlockActionType(actionTypeToBlock) {
        const correspondingBlockType = `BLOCK_${actionTypeToBlock}`;
        return this.blockType.includes(correspondingBlockType);
    }

     /**
     * (Potentiel futur) Vérifie si l'action de cette carte peut être contrée par une faction donnée.
     * @param {string} factionId - L'ID de la faction qui tente de contrer.
     * @returns {boolean} True si la faction peut contrer l'action de cette carte.
     */
    isCounteredBy(factionId) {
        return this.counteredByFaction.includes(factionId);
    }
}


/**
 * Représente et gère la pioche de cartes du jeu.
 */
class Deck {
    /**
     * @type {string[]} - Tableau des ID des cartes dans la pioche.
     */
    #cards = [];

    /**
     * Crée une instance de Deck.
     * @param {object} gameConfig - L'objet de configuration chargé depuis cards.json.
     * @throws {Error} Si la configuration du jeu est invalide ou si une carte ne peut pas être validée.
     */
    constructor(gameConfig) {
        if (!gameConfig || !gameConfig.roles || !Array.isArray(gameConfig.roles)) {
            throw new Error("Configuration de jeu (gameConfig.roles) invalide ou manquante.");
        }
        this.#cards = this.#createFullDeck(gameConfig);
        if (this.#cards.length === 0) {
             console.warn("Attention: Le deck a été initialisé mais est vide (peut-être dû à des erreurs de validation des cartes).");
        }
        console.log(`Deck initialisé avec ${this.#cards.length} cartes.`);
    }

    /**
     * Crée une pioche complète basée sur la configuration, en validant chaque carte.
     * @param {object} gameConfig - L'objet de configuration du jeu.
     * @returns {string[]} Un tableau contenant les ID de toutes les cartes valides.
     * @throws {Error} Si une carte essentielle est invalide.
     * @private
     */
    #createFullDeck(gameConfig) {
        const deck = [];
        gameConfig.roles.forEach(roleData => {
            try {
                // Instancie et valide la carte. Lance une erreur si invalide.
                const card = new Card(roleData);
                // Ajoute les cartes au deck seulement si la validation réussit et countInDeck > 0
                if (card.countInDeck > 0) {
                    for (let i = 0; i < card.countInDeck; i++) {
                        deck.push(card.id);
                    }
                }
            } catch (e) {
                // Log l'erreur mais continue pour potentiellement identifier d'autres erreurs.
                // On pourrait choisir de lancer l'erreur ici pour arrêter complètement.
                console.error(`Erreur lors de la validation/création de la carte ${roleData.id || '(ID inconnu)'}: ${e.message}`);
                // throw e; // Décommenter pour arrêter le serveur si une carte est invalide.
            }
        });
        return deck;
    }

    /**
     * Mélange les cartes dans la pioche.
     * @returns {void}
     */
    shuffle() {
        const deck = this.#cards;
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        console.log("Deck mélangé !");
    }

    /**
     * Pioche une ou plusieurs cartes du dessus de la pioche.
     * @param {number} [count=1] - Le nombre de cartes à piocher.
     * @returns {string | string[] | null} L'ID de la carte piochée (ou un tableau d'IDs si count > 1), ou null/[] si vide.
     */
    draw(count = 1) {
         if (this.#cards.length === 0) {
            console.warn("Attention: Tentative de pioche dans un deck vide !");
            return count === 1 ? null : [];
        }
        if (count === 1) {
            return this.#cards.pop() || null;
        } else {
            const drawnCards = [];
            for (let i = 0; i < count; i++) {
                if (this.#cards.length > 0) {
                    drawnCards.push(this.#cards.pop());
                } else {
                    break;
                }
            }
            return drawnCards;
        }
    }

    /**
     * Ajoute une carte (par son ID) sous la pioche.
     * @param {string} cardId - L'ID de la carte à remettre.
     * @returns {void}
     */
    addCard(cardId) {
        this.#cards.push(cardId);
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


// Exporte les classes Deck et Card
module.exports = { Deck, Card };
