import test from 'node:test';
import assert from 'node:assert/strict';
import { Euchre, effectiveSuit, strength, suits } from '../euchre.js';
const card = (rank, suit) => ({rank, suit, id: rank + suit});
function game(count = 4) { const g = new Euchre('alice', 123456); for (const name of ['alice', 'bob', 'carol', 'dave'].slice(0, count)) g.join(name); return g; }
test('bowers, non-trump ranking, and following the left bower suit', () => {
  assert.equal(effectiveSuit(card('J', '♦'), '♥'), '♥');
  assert.ok(strength(card('J', '♥'), '♥', '♠') > strength(card('J', '♦'), '♥', '♠'));
  assert.ok(strength(card('J', '♦'), '♥', '♠') > strength(card('A', '♥'), '♥', '♠'));
  assert.ok(strength(card('Q', '♠'), '♥', '♠') > strength(card('J', '♠'), '♥', '♠'));
  const g = game(); g.next('alice'); g.phase = 'play'; g.trump = '♥'; g.turn = 1;
  g.trick = [{seat: 0, card: card('J', '♦')}]; g.hands[1] = [card('9', '♥'), card('A', '♦')];
  assert.deepEqual(g.legalCards(1).map(c => c.id), ['9♥']);
  assert.throws(() => g.act('bob', {type: 'play', card: 'A♦'}), /follow suit/);
  assert.throws(() => g.act('alice', {type: 'play', card: '9♥'}), /turn/);
});
test('deal validation, private snapshots, two rounds, pickup and discard', () => {
  const g = game();
  assert.throws(() => g.next('bob'), /host/); g.next('alice');
  assert.equal(new Set(g.hands.flat().map(c => c.id)).size, 20);
  assert.equal(g.snapshot('alice').hand.length, 5); assert.equal(g.snapshot('outsider').hand.length, 0);
  assert.equal('hands' in g.snapshot('alice'), false);
  assert.throws(() => g.join('eve'), /started/);
  for (let i = 0; i < 4; i++) g.act(g.seats[g.turn], {type: 'pass'});
  assert.equal(g.bidRound, 2);
  assert.throws(() => g.act(g.seats[g.turn], {type: 'bid', suit: g.upcard.suit}), /trump/);
  for (let i = 0; i < 3; i++) g.act(g.seats[g.turn], {type: 'pass'});
  assert.throws(() => g.act(g.seats[g.turn], {type: 'pass'}), /dealer/);
  g.act(g.seats[g.turn], {type: 'bid', suit: suits.find(s => s !== g.upcard.suit), alone: true});
  assert.equal(g.sittingOut, (g.maker + 2) % 4); assert.equal(g.phase, 'play');
  const h = game(); h.next('alice'); h.act(h.seats[h.turn], {type: 'bid', suit: h.upcard.suit});
  assert.equal(h.hands[h.dealer].length, 6); assert.equal(h.phase, 'discard');
  h.act(h.seats[h.turn], {type: 'discard', card: h.hands[h.dealer][0].id});
  assert.equal(h.hands[h.dealer].length, 5); assert.equal(h.phase, 'play');
});
test('scoring includes euchres, marches, lone marches and winning threshold', () => {
  for (const [tricks, alone, team, points] of [[2,false,1,2],[3,false,0,1],[4,true,0,1],[5,false,0,2],[5,true,0,4]]) {
    const g = game(); g.maker = 0; g.tricks = [tricks, 5 - tricks]; g.alone = alone; g.finishHand();
    assert.equal(g.scores[team], points);
    g.scores = [9,9]; g.finishHand(); assert.equal(g.finished, true);
  }
});
for (const humans of [1, 2, 3, 4]) test(`${humans} humans finish full games with bots and legal turns`, () => {
  for (let repeat = 0; repeat < 10; repeat++) {
    const g = game(humans); let actions = 0;
    while (!g.finished) {
      if (++actions > 2000) assert.fail('Game stalled');
      if (['lobby', 'handEnd'].includes(g.phase)) { g.next('alice'); continue; }
      const name = g.seats[g.turn]; assert.ok(g.players.has(name));
      if (g.phase === 'bid') g.act(name, {type: 'bid', suit: g.bidRound === 1 ? g.upcard.suit : suits.find(s => s !== g.upcard.suit), alone: repeat % 2 === 0});
      else g.act(name, {type: g.phase === 'discard' ? 'discard' : 'play', card: (g.phase === 'discard' ? g.hands[g.turn] : g.legalCards(g.turn))[0].id});
    }
    assert.equal(Math.max(...g.scores) >= 10, true);
  }
});
test('a departing guest becomes a bot without stalling the hand', () => {
  const g = game(); g.next('alice'); const departed = g.seats[g.turn];
  g.players.delete(departed); g.runBots(); assert.notEqual(g.seats[g.turn], departed);
});
