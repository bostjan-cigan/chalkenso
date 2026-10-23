// Checks the translations: every language has exactly the English messages, with the same
// placeholders (`{name}`, `{count, plural, …}`) and rich-text tags (`<strong>…</strong>`).
//
//   node scripts/check-messages.mjs        (yarn i18n:check)
//
// Message files: src/i18n/messages/<locale>/<namespace>.json.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src/i18n/messages'];
const SOURCE = 'en';

/** Every message by its dotted key. */
function flatten(value, prefix = '', into = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child, name, into);
    else into.set(name, String(child));
  }
  return into;
}

/**
 * The arguments a message uses (`{name}`, `{count, plural, …}`), from inside plural and select
 * branches too, without taking a branch's text (`one {section}`) for an argument.
 */
function argumentsOf(message, into = new Set()) {
  let index = 0;
  const skipSpace = () => {
    while (/\s/.test(message[index] ?? '')) index += 1;
  };
  const readUntil = (stops) => {
    const start = index;
    while (index < message.length && !stops.includes(message[index])) index += 1;
    return message.slice(start, index).trim();
  };
  /** The text of a branch, from after its `{` to its closing `}`, with its own arguments. */
  const branch = () => {
    let depth = 1;
    const start = index;
    while (index < message.length && depth > 0) {
      if (message[index] === '{') depth += 1;
      else if (message[index] === '}') depth -= 1;
      index += 1;
    }
    argumentsOf(message.slice(start, index - 1), into);
  };
  while (index < message.length) {
    if (message[index] === "'" && message[index + 1] === '{') {
      // A quoted brace is text.
      index = message.indexOf("'", index + 1) + 1 || message.length;
      continue;
    }
    if (message[index] !== '{') {
      index += 1;
      continue;
    }
    index += 1;
    const name = readUntil([',', '}']);
    into.add(`{${name}}`);
    if (message[index] === '}') {
      index += 1;
      continue;
    }
    index += 1;
    const type = readUntil([',', '}']);
    if (message[index] === ',' && ['plural', 'select', 'selectordinal'].includes(type)) {
      index += 1;
      // Options: `offset:1`, then selectors (`one`, `=0`, `other`), each followed by its branch.
      while (index < message.length) {
        skipSpace();
        if (message[index] === '}') break;
        readUntil(['{', '}']);
        if (message[index] !== '{') break;
        index += 1;
        branch();
      }
    } else {
      // A format (`{amount, number, ::currency/USD}`): skip to its end.
      readUntil(['}']);
    }
    index += 1;
  }
  return into;
}

/** The arguments and tags a message uses, sorted: what a translation must keep. */
function shape(message) {
  const names = argumentsOf(message);
  for (const match of message.matchAll(/<\/?([A-Za-z][\w-]*)>/g)) names.add(`<${match[1]}>`);
  return [...names].sort().join(' ');
}

let problems = 0;
const report = (text) => {
  problems += 1;
  console.error(`  ${text}`);
};

for (const root of ROOTS) {
  const locales = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const files = readdirSync(path.join(root, SOURCE)).filter((file) => file.endsWith('.json'));
  for (const locale of locales.filter((entry) => entry !== SOURCE)) {
    for (const file of files) {
      const read = (lang) => {
        const full = path.join(root, lang, file);
        if (!existsSync(full)) return null;
        try {
          return flatten(JSON.parse(readFileSync(full, 'utf8')));
        } catch (error) {
          report(`${full}: not valid JSON (${error.message})`);
          return null;
        }
      };
      const source = read(SOURCE);
      const target = read(locale);
      if (!source) continue;
      if (!target) {
        report(`${path.join(root, locale, file)}: missing`);
        continue;
      }
      for (const [key, message] of source) {
        if (!target.has(key)) report(`${locale}/${file}: missing ${key}`);
        else if (shape(message) !== shape(target.get(key))) {
          report(`${locale}/${file}: ${key} uses ${shape(target.get(key)) || 'nothing'}, English uses ${shape(message) || 'nothing'}`);
        }
      }
      for (const key of target.keys()) if (!source.has(key)) report(`${locale}/${file}: ${key} is not in English`);
    }
  }
}

if (problems) {
  console.error(`\n${problems} problem${problems === 1 ? '' : 's'} in the translations.`);
  process.exit(1);
}
console.log('Translations match English.');
