// 生成 preview.html 并抽出内嵌 <script> 做语法校验
// 运行: node scripts/check_html.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleHTML } from '../src/console.js';

const here = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(here, '../preview.html'), consoleHTML);

const open = (consoleHTML.match(/<script/g) || []).length;
const close = (consoleHTML.match(/<\/script>/g) || []).length;
const inner = consoleHTML.match(/<script>([\s\S]*?)<\/script>/);
if (!inner) { console.error('未找到内嵌脚本'); process.exit(1); }
fs.writeFileSync(path.join(here, 'preview-app.js'), inner[1]);

console.log('HTML 长度:', consoleHTML.length);
console.log('<script> 开标签:', open, ' 闭标签:', close, open === close ? '(配对 OK)' : '(配对异常!)');
console.log('内嵌 JS 已抽出: scripts/preview-app.js');