const example = process.env.EXAMPLE || 'trivia';
if (example === 'directory') await import('./directory-server.js');
else if (example === 'trivia') await import('./server.js');
else throw new Error(`Unknown example: ${example}. Use EXAMPLE=trivia or EXAMPLE=directory.`);