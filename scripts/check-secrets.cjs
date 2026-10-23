// Small regression guard, not a substitute for provider/GitHub secret scanning.
// Report locations only; never echo candidate credentials into CI logs.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
const signatures = [
  ['Groq token', /gsk_[A-Za-z0-9]{20,}/],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['AWS access key', /AKIA[A-Z0-9]{16}/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
let failed = false;
for (const file of new Set(candidates.split('\0').filter(Boolean))) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) {
    console.error(`Environment file must not be committed: ${file}`);
    failed = true;
  }
  let contents;
  try { contents = readFileSync(file, 'utf8'); } catch { continue; }
  if (contents.includes('\0')) continue;
  contents.split(/\r?\n/).forEach((line, index) => {
    for (const [name, pattern] of signatures) {
      if (pattern.test(line)) {
        console.error(`${name} candidate at ${file}:${index + 1}`);
        failed = true;
      }
    }
  });
}
if (failed) process.exitCode = 1;
else console.log('No recognized credential signatures or committed environment files found.');
