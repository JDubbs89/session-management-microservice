import { randomInt } from 'node:crypto';
export const suits = ['♣', '♠', '♥', '♦'];
const ranks = ['9', '10', 'J', 'Q', 'K', 'A'];
const color = s => suits.indexOf(s) < 2 ? 'black' : 'red';
export const effectiveSuit = (card, trump) => card.rank === 'J' && color(card.suit) === color(trump) ? trump : card.suit;
export function strength(card, trump, lead) {
  const suit = effectiveSuit(card, trump);
  if (suit === trump) return card.rank === 'J' ? (card.suit === trump ? 100 : 99) : 80 + ranks.indexOf(card.rank);
  return (suit === lead ? 40 : 0) + ranks.indexOf(card.rank);
}
export class Euchre {
  constructor(host, code) {
    this.host = host; this.code = code; this.players = new Map(); this.answers = new Set();
    this.round = -1; this.finished = false; this.phase = 'lobby'; this.scores = [0, 0]; this.dealer = 3;
  }
  join(name) {
    if (this.phase !== 'lobby') throw new Error('Hand already started');
    if (!this.players.has(name) && this.players.size >= 4) throw new Error('Table full');
    this.players.set(name, 0);
  }
  next(name) {
    if (name !== this.host) throw new Error('Only the host can deal');
    if (!['lobby', 'handEnd'].includes(this.phase) || this.finished) throw new Error('Finish this hand first');
    if (!this.players.has(this.host)) throw new Error('The host must be seated before dealing');
    if (this.phase === 'lobby') {
      this.seats = [...this.players.keys()];
      while (this.seats.length < 4) this.seats.push(`Bot ${this.seats.length + 1}`);
    }
    this.round++; this.dealer = (this.dealer + 1) % 4;
    const deck = suits.flatMap(suit => ranks.map(rank => ({suit, rank, id: rank + suit})));
    for (let i = deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    this.hands = Array.from({length: 4}, () => deck.splice(0, 5)); this.upcard = deck[0];
    this.trump = null; this.maker = null; this.alone = false; this.sittingOut = null;
    this.tricks = [0, 0]; this.trick = []; this.lastTrick = []; this.bidRound = 1; this.passes = 0;
    this.turn = (this.dealer + 1) % 4; this.phase = 'bid'; this.notice = 'Order up the turned card, or pass.';
    this.runBots();
  }
  activeNext(seat) { let next = (seat + 1) % 4; if (next === this.sittingOut) next = (next + 1) % 4; return next; }
  legalCards(seat) {
    const hand = this.hands[seat];
    if (!this.trick.length) return hand;
    const lead = effectiveSuit(this.trick[0].card, this.trump);
    const following = hand.filter(c => effectiveSuit(c, this.trump) === lead);
    return following.length ? following : hand;
  }
  act(name, action) {
    if (!this.seats || this.seats[this.turn] !== name || !this.players.has(name)) throw new Error('Wait for your turn');
    this.apply(action); this.runBots();
  }
  apply(action) {
    const seat = this.turn;
    if (this.phase === 'bid') {
      if (action.type === 'pass') {
        if (this.bidRound === 2 && seat === this.dealer) throw new Error('Stick the dealer: choose trump');
        this.passes++; this.turn = (seat + 1) % 4;
        if (this.passes === 4) { this.bidRound = 2; this.passes = 0; this.notice = 'Choose a different trump suit, or pass. Dealer must choose.'; }
        return;
      }
      if (action.type !== 'bid' || !suits.includes(action.suit) ||
          (this.bidRound === 1 ? action.suit !== this.upcard.suit : action.suit === this.upcard.suit)) throw new Error('Invalid trump');
      this.trump = action.suit; this.maker = seat; this.alone = action.alone === true;
      this.sittingOut = this.alone ? (seat + 2) % 4 : null;
      if (this.bidRound === 1) { this.hands[this.dealer].push(this.upcard); this.phase = 'discard'; this.turn = this.dealer; }
      else this.beginPlay();
    } else if (this.phase === 'discard' || this.phase === 'play') {
      if (action.type !== (this.phase === 'discard' ? 'discard' : 'play')) throw new Error('Invalid action');
      const legal = this.phase === 'discard' ? this.hands[seat] : this.legalCards(seat);
      const card = legal.find(c => c.id === action.card);
      if (!card) throw new Error('Choose a legal card; you must follow suit');
      this.hands[seat].splice(this.hands[seat].indexOf(card), 1);
      if (this.phase === 'discard') { this.beginPlay(); return; }
      this.trick.push({seat, card}); this.turn = this.activeNext(seat);
      if (this.trick.length === (this.alone ? 3 : 4)) {
        const lead = effectiveSuit(this.trick[0].card, this.trump);
        const winner = this.trick.reduce((best, entry) => strength(entry.card, this.trump, lead) > strength(best.card, this.trump, lead) ? entry : best).seat;
        this.tricks[winner % 2]++; this.lastTrick = this.trick; this.trick = []; this.turn = winner;
        this.notice = `${this.seats[winner]} won the trick.`;
        if (this.tricks[0] + this.tricks[1] === 5) this.finishHand();
      }
    } else throw new Error('No active turn');
  }
  beginPlay() { this.phase = 'play'; this.turn = this.activeNext(this.dealer); this.notice = `${this.seats[this.maker]} called ${this.trump}${this.alone ? ' alone' : ''}.`; }
  finishHand() {
    const team = this.maker % 2, made = this.tricks[team];
    const winner = made >= 3 ? team : 1 - team;
    const points = made < 3 ? 2 : made === 5 ? (this.alone ? 4 : 2) : 1;
    this.scores[winner] += points; this.finished = this.scores[winner] >= 10;
    this.phase = this.finished ? 'finished' : 'handEnd';
    this.notice = `Team ${winner + 1} scores ${points}${made < 3 ? ' — euchred!' : '!'}${this.finished ? ' Game won!' : ''}`;
  }
  runBots() {
    let guard = 0;
    while (['bid', 'discard', 'play'].includes(this.phase) && !this.players.has(this.seats[this.turn])) {
      if (++guard > 100) throw new Error('Bot turn limit');
      if (this.phase === 'bid') {
        const choices = this.bidRound === 1 ? [this.upcard.suit] : suits.filter(s => s !== this.upcard.suit);
        choices.sort((a, b) => this.hands[this.turn].filter(c => effectiveSuit(c, b) === b).length - this.hands[this.turn].filter(c => effectiveSuit(c, a) === a).length);
        const suit = choices[0];
        const count = this.hands[this.turn].filter(c => effectiveSuit(c, suit) === suit).length;
        this.apply(count >= 3 || (this.bidRound === 2 && this.turn === this.dealer) ? {type: 'bid', suit} : {type: 'pass'});
      } else {
        const cards = [...(this.phase === 'discard' ? this.hands[this.turn] : this.legalCards(this.turn))];
        cards.sort((a, b) => strength(a, this.trump, null) - strength(b, this.trump, null));
        this.apply({type: this.phase === 'discard' ? 'discard' : 'play', card: cards[0].id});
      }
    }
  }
  snapshot(name) {
    const seat = this.seats?.indexOf(name) ?? -1;
    return {host: this.host, code: this.code, phase: this.phase, round: this.round, finished: this.finished,
      seats: this.seats || [...this.players.keys()], scores: this.scores, dealer: this.dealer, turn: this.turn,
      trump: this.trump, maker: this.maker, alone: this.alone, sittingOut: this.sittingOut,
      bidRound: this.bidRound, upcard: this.upcard, tricks: this.tricks, trick: this.trick, lastTrick: this.lastTrick,
      notice: this.notice, hand: seat >= 0 ? this.hands[seat] : [],
      legal: seat >= 0 && this.turn === seat && ['play', 'discard'].includes(this.phase)
        ? (this.phase === 'discard' ? this.hands[seat] : this.legalCards(seat)).map(c => c.id) : []};
  }
}
