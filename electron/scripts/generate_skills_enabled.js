#!/usr/bin/env node
'use strict';
/** Generate skills_enabled.json with all bundled skill dirs enabled. */
const fs = require('fs');
const path = require('path');

const skillsDir = process.argv[2];
if (!skillsDir || !fs.existsSync(skillsDir)) {
  console.error('Usage: generate_skills_enabled.js <agent-skills-dir>');
  process.exit(1);
}

const out = {};
for (const name of fs.readdirSync(skillsDir)) {
  const p = path.join(skillsDir, name);
  if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'SKILL.md'))) {
    out[name] = true;
  }
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
