// Gera dist/piphin-module-infohardware-<versão>.zip sem o .NET (serve para gerar no Linux).
// Uso: node scripts/make-module.js
// Se o motor do Windows já foi compilado (out/module/engine, pelo build-module.ps1), ele entra e o pacote
// serve para os dois sistemas. Sem ele, o pacote sai marcado só para Linux ("platforms": ["linux"]),
// para nunca chegar quebrado num Windows.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const version = (/<Version>([^<]+)<\/Version>/.exec(fs.readFileSync(path.join(root, "src", "InfoHardware", "InfoHardware.csproj"), "utf8")) || [])[1];
if (!version) throw new Error("versão não encontrada no InfoHardware.csproj");
const stage = path.join(root, "out", "module-js");
const out = path.join(root, "dist", `piphin-module-infohardware-${version}.zip`);
const winEngine = path.join(root, "out", "module", "engine");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "icons"), { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, "module", "module.json"), "utf8"));
manifest.version = version;
const both = fs.existsSync(path.join(winEngine, "start.ps1"));
if (!both) manifest.platforms = ["linux"];
fs.writeFileSync(path.join(stage, "module.json"), JSON.stringify(manifest, null, 2));
for (const f of fs.readdirSync(path.join(root, "module"))) if (/\.(js|ps1)$/.test(f)) fs.copyFileSync(path.join(root, "module", f), path.join(stage, f));
fs.cpSync(path.join(root, "module", "web"), path.join(stage, "web"), { recursive: true });
if (both) fs.cpSync(winEngine, path.join(stage, "engine"), { recursive: true });
fs.mkdirSync(path.join(stage, "i18n"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "i18n"))) if (f.endsWith(".json") && f !== "config.json") fs.copyFileSync(path.join(root, "i18n", f), path.join(stage, "i18n", f));
fs.copyFileSync(path.join(root, "module", "icon.png"), path.join(stage, "icons", "infohardware.png"));

fs.rmSync(out, { force: true });
if (process.platform === "win32") execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", out, "-C", stage, "."], { stdio: "inherit" });
else execFileSync("python3", ["-c", "import os,sys,zipfile\nr,o=sys.argv[1],sys.argv[2]\nwith zipfile.ZipFile(o,'w',zipfile.ZIP_DEFLATED) as z:\n for d,_,fs in os.walk(r):\n  for f in fs:\n   p=os.path.join(d,f);z.write(p,os.path.relpath(p,r))", stage, out], { stdio: "inherit" });
fs.rmSync(stage, { recursive: true, force: true });
console.log("módulo:", out, both ? "(Windows e Linux)" : "(só Linux: rode o build-module.ps1 no Windows para o pacote dos dois)");
