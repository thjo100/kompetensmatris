"""Bygger demoversionen för claude.ai till en enda HTML-fil: demo/dist/kompetensmatris.html.

Demon är samma gränssnitt som appen (src/Kompetensmatris/wwwroot), men demo/adapter.js byter ut
anropen till ASP.NET-servern mot den delade databasen som en claude.ai-artefakt har.
Den används inte av Docker-bygget.

Kör från repots rot:  python3 demo/build.py
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
src = root / "src" / "Kompetensmatris" / "wwwroot"
here = root / "demo"

css = (src / "style.css").read_text(encoding="utf-8")
dark = re.search(r'@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{(.*?)\}\s*\}', css, re.S).group(1)
css = css.replace("/* ---------- Grund ---------- */", ':root[data-theme="dark"] {' + dark + "}\n\n/* ---------- Grund ---------- */", 1)
css += """
/* ---------- Demo i claude.ai ---------- */
.topbar, .course-bar, .admin-hint, .demo-note {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
.tree {
  padding-left: max(24px, env(safe-area-inset-left, 0px));
  padding-right: max(24px, env(safe-area-inset-right, 0px));
}
@media (max-width: 640px) {
  .tree {
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
  }
}
.toast { bottom: calc(24px + env(safe-area-inset-bottom, 0px)); }
.demo-note {
  padding-block: 6px;
  font-size: 13px;
  color: var(--muted);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.demo-note strong { color: var(--text); }
"""

html = (src / "index.html").read_text(encoding="utf-8")
body = html.split("<body>", 1)[1].split('<script src="app.js"></script>', 1)[0]
note = ('\n  <div class="demo-note">Demoversion: ändringar sparas och syns för alla du delar sidan med. '
        "Lösenord till adminläget: <strong>demo</strong></div>\n")
body = body.replace("</header>\n", "</header>\n" + note, 1)

js = (src / "app.js").read_text(encoding="utf-8").rstrip()
assert js.endswith("init();")
js = js[: -len("init();")]
adapter = (here / "adapter.js").read_text(encoding="utf-8")

out = ('<title>Kompetensmatris</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
       "<style>\n" + css + "</style>\n" + body.strip() + "\n<script>\n" + js + adapter + "</script>\n")
(here / "dist").mkdir(exist_ok=True)
(here / "dist" / "kompetensmatris.html").write_text(out, encoding="utf-8")
print("Skrev", here / "dist" / "kompetensmatris.html")
