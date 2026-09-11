const example = process.env.EXAMPLE || 'trivia';
if (example === 'directory') await import('./directory-server.js');
else if (example === 'euchre') await (await import('./euchre-server.js')).startEuchre();
else if (example === 'trivia') await (await import('./server.js')).startTrivia();
else throw new Error(`Unknown example: ${example}. Use EXAMPLE=trivia or EXAMPLE=directory or EXAMPLE=euchre.`);