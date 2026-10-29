// Prints "on" if a DryCare backup's sync_config row has change capture enabled, else "off". Used by desktop-startup-test.ps1.
const zlib = require("zlib");
const fs = require("fs");
const text = zlib.gunzipSync(fs.readFileSync(process.argv[2])).toString("utf8");
const m = text.match(/--TABLE sync_config [^\n]*\n([^\n]*)/);
process.stdout.write(m && /"capture_enabled":true/.test(m[1]) ? "on" : "off");
