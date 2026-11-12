/* Loads the v4 engine (src/engine/*.js, in name order) into Node and returns AA4. */
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "..", "..", "src", "engine");
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".js")).sort()) require(path.join(DIR, f));
module.exports = globalThis.AA4;
