const questions = [
  { text: 'Which planet is called the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter'], correct: 1 },
  { text: 'How many bits are in a byte?', choices: ['4', '16', '8'], correct: 2 },
  { text: 'Which ocean is largest?', choices: ['Pacific', 'Atlantic', 'Indian'], correct: 0 }
];
export class Game {
  constructor(host, code) { this.host = host; this.code = code; this.players = new Map(); this.round = -1; this.answers = new Set(); this.finished = false; }
  join(username) {
    if (this.round >= 0) throw new Error('Game already started');
    if (this.players.size >= 4 && !this.players.has(username)) throw new Error('Room full');
    this.players.set(username, 0);
  }
  next(username) {
    if (username !== this.host) throw new Error('Only the host can advance questions');
    if (this.finished) throw new Error('Game finished');
    this.round++; this.answers.clear(); this.finished = this.round >= questions.length;
  }
  answer(username, choice) {
    if (!this.players.has(username) || this.round < 0 || this.finished) throw new Error('No active question');
    if (!Number.isInteger(choice) || choice < 0 || choice >= questions[this.round].choices.length) throw new Error('Invalid answer');
    if (this.answers.has(username)) throw new Error('Already answered');
    this.answers.add(username);
    if (choice === questions[this.round].correct) this.players.set(username, this.players.get(username) + 1);
  }
  snapshot() {
    const q = questions[this.round];
    return { totalQuestions: questions.length, host: this.host, code: this.code, round: this.round, finished: this.finished, question: q ? { text: q.text, choices: q.choices } : null, scores: [...this.players].map(([name, score]) => ({ name, score })), answered: this.answers.size };
  }
}
