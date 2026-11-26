# Kompetensmatris

En enkel webbsida där man bygger upp och visar ett kompetensträd, till exempel **LST Systemutvecklare** med områden som *Grunder i C#*, *Backend/server* och *GIS*. Trädet ritas som en organisationskarta (som i MindManager) och vem som helst på intranätet kan titta. Administratörer loggar in med ett gemensamt lösenord och kan skapa, ändra, flytta och ta bort områden.

Om någon håller en **kurs** i ett område syns det direkt: rutan får en etikett med datum (eller **Pågår nu**), kursen visas i en remsa överst och ett klick öppnar en popup med en knapp **Anslut i Teams**.

![Skärmbild av kompetensmatrisen](docs/skarmbild.png)

## Funktioner

- **Träd som i MindManager**: roten överst, kategorierna bredvid varandra och underområdena under dem. Siffran under en ruta visar hur många underområden som är ihopfällda och ett klick fäller ut dem.
- **Prioritet 1/2/3** visas som röd, blå eller grön etikett före namnet.
- **Beskrivning och länkar** per område. Områden med innehåll är understrukna. Klicka på namnet för att läsa.
- **Kurser** med tid, kursledare, beskrivning och länk till Teams-mötet (eller motsvarande):
  - etikett på rutan (`🎓 3 dec. 13:00` eller `● Pågår nu`)
  - etikett med `↓` på ihopfällda rutor om en kurs finns längre ned i grenen
  - remsa överst med kommande och pågående kurser
  - popup med *Anslut i Teams* och *Lägg till i kalender* (.ics)
  - genomförda kurser göms under *Tidigare kurser*
- **Flera träd** (t.ex. en per roll), som man väljer i en meny när det finns fler än ett.
- **Sök**, **zoom** samt **expandera/fäll ihop alla**.
- **Kod-vy** (som i Visual Basic): hela trädet som indenterad text för att snabbt skriva in eller klistra in många rubriker.
- **Adminläge** med ett enda lösenord:
  - `+` lägger till ett underområde direkt i trädet. Skriv namnet och tryck Enter, sedan nästa.
  - Klistra in en **indenterad lista** i fältet för att skapa många områden på en gång (se nedan).
  - `✎` redigerar namn, prioritet, beskrivning, länkar och var området ligger.
  - `↑ ↓` / `← →` ändrar ordningen och `🗑` tar bort (med underområden och kurser).
  - **Exportera** och **Importera** all data som JSON (säkerhetskopia).
- Ljust och mörkt tema (följer datorns inställning) och fungerar i mobilen.

### Kod-vyn

Fliken **Kod** (eller <kbd>F7</kbd>, som *View Code* i Visual Basic; <kbd>Skift</kbd>+<kbd>F7</kbd> tillbaka till **Design**) visar hela trädet som text, en rad per område. Det är det snabbaste sättet att lägga in många rubriker på en gång:

```text
LST Systemutvecklare
  Grunder i C#
    [1] Async/await
    [1] Generics
  GIS
    [1] GeoJSON
    Kartor
      [2] Leaflet
```

- <kbd>Tab</kbd> drar in raden (den hamnar under raden ovanför), <kbd>Skift</kbd>+<kbd>Tab</kbd> flyttar ut den. Markera flera rader för att flytta alla.
- <kbd>Enter</kbd> ger en ny rad med samma indrag. <kbd>Ctrl</kbd>+<kbd>S</kbd> sparar.
- Medan du skriver visar sidan vad som kommer att hända, t.ex. *Osparat: 3 nya · 1 nytt namn · 1 tas bort*, eller vilken rad som är fel.
- Raderna matchas mot befintliga områden: samma namn är samma område, samma namn på en annan plats är en flytt, och en ändrad rad på samma plats är ett namnbyte. Beskrivning, länkar och kurser följer alltså med. Tar du bort rader frågar sidan först och visar vad som försvinner.
- Den som inte är inloggad ser koden skrivskyddad.

### Klistra in en lista

Varje rad blir ett område. Indrag (mellanslag eller tab) gör raden till ett underområde. `[1]`, `[2]` eller `[3]` först på raden blir prioritet. Punktlistetecken (`-`, `*`, `•`) tas bort. Det fungerar bra att kopiera en disposition från MindManager, Word eller Markdown.

```text
Frontend/klient
  [1] HTML
  [1] CSS
    Flexbox
    Grid
  JavaScript
    TypeScript
```

## Teknik

- **ASP.NET Core 10** (minimal API, C#, .NET 10 LTS som har stöd till november 2028). Ingen databas: allt sparas i **en JSON-fil** som skrivs om vid varje ändring. Den förra versionen sparas som `.bak`.
- **Vanlig HTML, CSS och JavaScript** i `wwwroot`. Inga ramverk och inget byggsteg.
- Inloggningen är avsiktligt enkel: lösenordet skickas i headern `X-Admin-Password` och jämförs med miljövariabeln `ADMIN_PASSWORD`. Läsning är öppen för alla. Det räcker på ett intranät men ger inget skydd mot någon som vill fuska.

```text
Dockerfile                     Bygger imagen (se nedan)
docker-compose.yml             Exempel på drift med Docker Compose
src/Kompetensmatris/
  Program.cs                   API-endpoints, inloggningskontroll och PATH_BASE
  Models.cs                    Datamodell (noder, kurser) och all validering
  Outline.cs                   Tolkar inklistrade, indenterade listor
  DataStore.cs                 Läser och sparar JSON-filen
  SeedData.cs                  Exempelträdet som skapas vid första start
  wwwroot/                     index.html, app.js, style.css
tests/Kompetensmatris.Tests/   Integrationstester för API:t (xUnit)
demo/                          Demoversionen för claude.ai (ingår inte i Docker-bygget)
.github/workflows/docker.yml   Testar, bygger och publicerar imagen i GitHub Actions
```

## Bygga och köra hos oss med Docker

Här står allt som behövs för att bygga imagen och köra den i er Docker-miljö, steg för steg.

### 1. Förutsättningar

- **Docker** 20.10 eller nyare: Docker Engine på Linux eller Docker Desktop på Windows/Mac. På Windows ska Docker Desktop köra **Linux-containrar**.
- **git** för att hämta koden.
- **Nätverk:** byggdatorn måste kunna hämta två basimager från Microsofts register `mcr.microsoft.com`:
  - `mcr.microsoft.com/dotnet/sdk:10.0` (bara för bygget, ca 1,3 GB på disk)
  - `mcr.microsoft.com/dotnet/aspnet:10.0` (grunden för den färdiga imagen)

  Själva bygget behöver **inget** annat nätverk: inga NuGet-paket och inga npm-paket. Det är provat med `docker build --network=none`.
- Går Docker genom en proxy hos er gäller det bara när basimagerna hämtas. Ställ då in proxyn för Docker, inte i Dockerfile:
  - Docker Desktop: *Settings → Resources → Proxies*
  - Linux: [Configure the daemon to use a proxy](https://docs.docker.com/engine/daemon/proxy/)
  - Gör proxyn TLS-inspektion måste organisationens rotcertifikat finnas i byggdatorns certifikatlager.
- Får ni inte nå `mcr.microsoft.com` alls finns två vägar, se [Utan åtkomst till mcr.microsoft.com](#utan-åtkomst-till-mcrmicrosoftcom).

### 2. Hämta koden

```bash
git clone https://github.com/thjo100/kompetensmatris.git
```

```bash
cd kompetensmatris
```

### 3. Bygg imagen

```bash
docker build --pull -t kompetensmatris:1.0.0 .
```

`--pull` hämtar senaste patchversionen av .NET 10 (säkerhetsuppdateringar). Imagen blir ca 350 MB.

**Bygger du på en Mac med Apple-processor för en vanlig server (x86-64):**

```bash
docker buildx build --platform linux/amd64 --pull -t kompetensmatris:1.0.0 --load .
```

### 4. Provkör

```bash
docker run -d --name kompetensmatris -p 8080:8080 -e ADMIN_PASSWORD=byt-mig -v kompetensdata:/data --restart unless-stopped kompetensmatris:1.0.0
```

```bash
curl http://localhost:8080/health
```

Svaret ska vara `ok`. Öppna sedan http://localhost:8080 och logga in med lösenordet. Första gången skapas exempelträdet *LST Systemutvecklare* och en exempelkurs, som du kan ändra eller ta bort i adminläget.

Loggar: `docker logs kompetensmatris`.

Med Docker Compose i stället (byt lösenordet i `docker-compose.yml` först):

```bash
docker compose up -d --build
```

### 5. Lägg imagen i ett register

**Docker Hub, manuellt:**

```bash
docker login
```

```bash
docker tag kompetensmatris:1.0.0 <konto>/kompetensmatris:1.0.0
```

```bash
docker push <konto>/kompetensmatris:1.0.0
```

**Eget/internt register** (t.ex. Harbor, Artifactory, Nexus eller Azure Container Registry) fungerar likadant. Byt `<konto>` mot registrets adress och sökväg, till exempel `<register>/team/kompetensmatris:1.0.0`.

**Docker Hub, automatiskt med GitHub Actions** (`.github/workflows/docker.yml`): lägg till följande två hemligheter under *Settings → Secrets and variables → Actions* i GitHub-repot.

- `DOCKERHUB_USERNAME`: användarnamn eller organisation på Docker Hub
- `DOCKERHUB_TOKEN`: en *Personal access token* från Docker Hub (*Account settings → Personal access tokens*, behörighet *Read & Write*)

Flödet kör testerna och bygger imagen i varje pull request, utan att pusha. Det publicerar till Docker Hub i två fall:

- en push till `main` ger `<konto>/kompetensmatris:latest` och en tagg med commit-hashen
- en tagg som `v1.2.0` ger även `<konto>/kompetensmatris:1.2.0`

### 6. Kör i driftmiljön

Det enda som krävs är imagen, ett lösenord och en volym på `/data`:

```bash
docker run -d --name kompetensmatris -p 8080:8080 -e ADMIN_PASSWORD=<lösenord> -v kompetensdata:/data --restart unless-stopped <konto>/kompetensmatris:1.0.0
```

Med Compose: byt `build: .` mot `image: <konto>/kompetensmatris:1.0.0` i `docker-compose.yml`.

**Bakom en omvänd proxy** (IIS, nginx, Traefik, F5 …) som sköter https: containern talar bara http på port 8080. Sätt `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` så att appen förstår att besökaren kom via https. Proxyn ska skicka `X-Forwarded-Proto`, vilket de flesta gör som standard.

**Under en undersökväg**, t.ex. `https://intranat/kompetens/`, finns två sätt:

- Proxyn tar bort `/kompetens` innan anropet når containern: ingen inställning behövs.
- Proxyn skickar vidare med `/kompetens` kvar: sätt `PATH_BASE=/kompetens`.

Exempel för nginx med prefixet kvar:

```nginx
location /kompetens/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Övervakning:** `GET /health` (eller `/kompetens/health` med `PATH_BASE`) svarar `ok`. Imagen har ingen `HEALTHCHECK`, eftersom den saknar curl, så övervaka adressen utifrån.

### 7. Uppgradera och backa

Bygg eller hämta den nya versionen, ta bort den gamla containern och starta den nya med **samma volym**. Datan ligger kvar i volymen.

```bash
docker rm -f kompetensmatris
```

```bash
docker run -d --name kompetensmatris -p 8080:8080 -e ADMIN_PASSWORD=<lösenord> -v kompetensdata:/data --restart unless-stopped <konto>/kompetensmatris:1.1.0
```

Med Compose: ändra taggen i `docker-compose.yml` och kör `docker compose up -d`. För att backa startar du den förra taggen på samma sätt.

### Utan åtkomst till mcr.microsoft.com

**Intern spegel av MCR:** peka bygget på er spegel med `DOTNET_REGISTRY`. Imagen hämtar då `<er-spegel>/dotnet/sdk:10.0` och `<er-spegel>/dotnet/aspnet:10.0`.

```bash
docker build --build-arg DOTNET_REGISTRY=<er-spegel> -t kompetensmatris:1.0.0 .
```

**Helt utan nätverk:** bygg på en dator som har internet och flytta imagen som en fil.

```bash
docker save kompetensmatris:1.0.0 -o kompetensmatris-1.0.0.tar
```

```bash
docker load -i kompetensmatris-1.0.0.tar
```

## Konfiguration

| Miljövariabel    | Standard                        | Beskrivning                                  |
|------------------|---------------------------------|----------------------------------------------|
| `ADMIN_PASSWORD` | `admin`                         | Lösenordet för adminläget. **Byt det.** Loggen varnar om det inte är satt. |
| `DATA_PATH`      | `/data/kompetensmatris.json` i Docker (annars `data/kompetensmatris.json`) | Var datan sparas. |
| `PATH_BASE`      | tomt                            | Undersökväg, t.ex. `/kompetens`, när proxyn inte tar bort prefixet. |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `false`    | Sätt `true` bakom en proxy som sköter https. |
| `TZ`             | `Europe/Stockholm` i Docker     | Tidszon. Kurstider sparas i UTC och visas i besökarens egen tidszon, så detta påverkar bara exempelkursen. |
| `ASPNETCORE_HTTP_PORTS` | `8080` i Docker          | Porten i containern. Ändra hellre porten på värden (`-p 80:8080`). |

Imagen i korthet:

- grund: `mcr.microsoft.com/dotnet/aspnet:10.0` (Ubuntu 24.04)
- port: 8080
- data: volym på `/data`
- användare: körs som `app` (uid 1654), inte root

## Säkerhetskopiering

All data finns i en enda fil, `/data/kompetensmatris.json`. Den kan kopieras ut medan containern kör:

```bash
docker cp kompetensmatris:/data/kompetensmatris.json ./kompetensmatris-backup.json
```

Det går också att använda **Exportera** i adminläget.

För att läsa tillbaka en kopia: logga in, välj **Importera** och välj filen. Filen kontrolleras först, så en trasig fil skriver inte över något. Alternativt kopierar du in filen och startar om containern:

```bash
docker cp ./kompetensmatris-backup.json kompetensmatris:/data/kompetensmatris.json
```

```bash
docker restart kompetensmatris
```

## Felsökning

| Symptom | Orsak och åtgärd |
|---------|------------------|
| `Access to the path '/data/kompetensmatris.json.tmp' is denied` i loggen och containern stannar | Du monterar en katalog från värden (`-v /srv/kompetensmatris:/data`) som containern inte får skriva i. Kör `sudo chown -R 1654:1654 /srv/kompetensmatris`, eller använd en namngiven volym (`-v kompetensdata:/data`) som i exemplen. |
| Bygget fastnar eller misslyckas på `FROM mcr.microsoft.com/...` | Byggdatorn når inte Microsofts register. Kontrollera proxyinställningen för Docker, eller använd en spegel eller `docker save`/`docker load` (se ovan). |
| `ADMIN_PASSWORD är inte satt` i loggen | Lösenordet är `admin`. Sätt `-e ADMIN_PASSWORD=...`. |
| Sidan visas men trädet laddas inte under en undersökväg | Proxyn och `PATH_BASE` stämmer inte överens. Kolla att `.../kompetens/api/data` svarar och läs avsnittet om undersökväg. |
| Länkar och omdirigeringar blir `http://` fast sidan körs på `https://` | Sätt `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` och kontrollera att proxyn skickar `X-Forwarded-Proto`. |
| `port is already allocated` | Port 8080 används redan på värden. Välj en annan: `-p 8081:8080`. |
| `exec format error` | Imagen är byggd för fel processor, t.ex. på en Mac med Apple-processor. Bygg med `--platform linux/amd64`. |

## Utveckla utan Docker

Kräver [.NET 10 SDK](https://dotnet.microsoft.com/download).

```bash
ADMIN_PASSWORD=hemligt dotnet run --project src/Kompetensmatris
```

Öppna adressen som skrivs ut i terminalen. Datan hamnar i `src/Kompetensmatris/data/`. Ändringar i `wwwroot` syns direkt när du laddar om sidan.

```bash
dotnet test
```

## Demoversionen

`demo/` innehåller det som behövs för demon på claude.ai: samma gränssnitt, men med datan i artefaktens delade databas i stället för i servern. `python3 demo/build.py` skriver `demo/dist/kompetensmatris.html`. Den används inte av Docker-bygget.

## API

Alla ändrande anrop kräver headern `X-Admin-Password`.

| Metod  | Adress                    | Beskrivning                                        |
|--------|---------------------------|----------------------------------------------------|
| GET    | `/api/data`               | All data: `{ nodes: [...], courses: [...] }`       |
| POST   | `/api/login`              | `{ password }` → 204 om rätt, annars 401          |
| POST   | `/api/nodes`              | Skapa område `{ parentId, title, priority, description, links }` (`parentId: null` = nytt träd) |
| POST   | `/api/nodes/outline`      | Skapa många från text `{ parentId, text }`         |
| PUT    | `/api/nodes/{id}`         | Ändra område                                       |
| PUT    | `/api/trees/{id}`         | Kod-vyn: ersätt trädets struktur `{ nodes: [{ id, parentId, title, priority }] }` i dokumentordning |
| POST   | `/api/nodes/{id}/move`    | Flytta `{ parentId, index }`                       |
| DELETE | `/api/nodes/{id}`         | Ta bort område med underområden och kurser         |
| POST   | `/api/courses`            | Skapa kurs `{ nodeId, title, start, end, url, teacher, description }` |
| PUT    | `/api/courses/{id}`       | Ändra kurs                                         |
| DELETE | `/api/courses/{id}`       | Ta bort kurs                                       |
| PUT    | `/api/data`               | Importera (ersätter all data)                      |
