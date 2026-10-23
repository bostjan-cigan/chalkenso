// Unit tests for the password rule the sign-up form shows as they type and the server checks again
// (src/lib/password-strength.ts): too short, easy to guess (common, a run, a keyboard row, their own email
// name), and too simple (short and one kind of character). No server needed; esbuild compiles the module.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = await build({
  entryPoints: [path.join(root, 'src/lib/password-strength.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
});
const { passwordProblem } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};
const is = (password, expected, options) => {
  const got = passwordProblem(password, options);
  check(`${JSON.stringify(password)}: ${expected ?? 'fine'}`, got === expected, String(got));
};

is('abc', 'short');
is('a1b2c3d', 'short');
is('abcdefghij', 'common', { min: 10 });
is('password123', 'common');
is('Password123', 'common');
is('12345678', 'common');
is('aaaaaaaa', 'common');
is('98765432', 'common');
is('qwertzuiop', 'common');
is('lkjhgfdsa', 'common');
is('ana.novak1', 'common', { email: 'ana.novak@example.com' });
is('ana.novak+news@example.com'.split('@')[0], 'common', { email: 'ana.novak+news@example.com' });
is('sunflower', 'simple');
is('48213907', 'simple');
is('sunflowerfield', null);
is('Sun-flower7', null);
is('chalk board 42 sunny', null);
is('ana.novak-likes-tea', null, { email: 'ana.novak@example.com' });

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
