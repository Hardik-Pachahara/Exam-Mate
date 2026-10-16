// Loads KEY=value lines from a .env file in the project folder, so you don't have to
// set variables in the terminal every time. Variables already set in the terminal win.
import fs from 'fs';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, ''); // drop accidental quotes
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
} catch { /* no .env file: fine */ }
