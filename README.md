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
- **Adminläge** med ett enda lösenord:
  - `+` lägger till ett underområde direkt i trädet. Skriv namnet och tryck Enter, sedan nästa.
  - Klistra in en **indenterad lista** i fältet för att skapa många områden på en gång (se nedan).
  - `✎` redigerar namn, prioritet, beskrivning, länkar och var området ligger.
  - `↑ ↓` / `← →` ändrar ordningen och `🗑` tar bort (med underområden och kurser).
  - **Exportera** och **Importera** all data som JSON (säkerhetskopia).
- Ljust och mörkt tema (följer datorns inställning) och fungerar i mobilen.

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

- **ASP.NET Core 10** (minimal API, C#). Ingen databas: allt sparas i **en JSON-fil** som skrivs om vid varje ändring. Den förra versionen sparas som `.bak`.
- **Vanlig HTML, CSS och JavaScript** i `wwwroot`. Inga ramverk och inget byggsteg.
- Inloggningen är avsiktligt enkel: lösenordet skickas i headern `X-Admin-Password` och jämförs med miljövariabeln `ADMIN_PASSWORD`. Läsning är öppen för alla. Det räcker på ett intranät men ger inget skydd mot någon som vill fuska.

```text
src/Kompetensmatris/
  Program.cs       API-endpoints och inloggningskontroll
  Models.cs        Datamodell (noder, kurser) och all validering
  Outline.cs       Tolkar inklistrade, indenterade listor
  DataStore.cs     Läser och sparar JSON-filen
  SeedData.cs      Exempelträdet som skapas vid första start
  wwwroot/         index.html, app.js, style.css
tests/Kompetensmatris.Tests/   Integrationstester för API:t (xUnit)
```

## Konfiguration

| Miljövariabel    | Standard                        | Beskrivning                                  |
|------------------|---------------------------------|----------------------------------------------|
| `ADMIN_PASSWORD` | `admin`                         | Lösenordet för adminläget. **Byt det.**      |
| `DATA_PATH`      | `data/kompetensmatris.json` (i Docker `/data/kompetensmatris.json`) | Var datan sparas. |
| `TZ`             | `Europe/Stockholm` (i Docker)   | Tidszon, används för exempelkursen.          |

Applikationen lyssnar på port **8080** i containern.

Första gången (när datafilen saknas) skapas exempelträdet *LST Systemutvecklare* och en exempelkurs. Ta bort eller ändra dem i adminläget.

## Köra lokalt

Kräver [.NET 10 SDK](https://dotnet.microsoft.com/download).

```bash
ADMIN_PASSWORD=hemligt dotnet run --project src/Kompetensmatris
```

Öppna adressen som skrivs ut i terminalen. Datan hamnar i `src/Kompetensmatris/data/`.

Kör testerna:

```bash
dotnet test
```

## Docker

Bygg och starta med Docker Compose (byt lösenordet i `docker-compose.yml` först):

```bash
docker compose up -d --build
```

Eller med vanliga Docker-kommandon:

```bash
docker build -t kompetensmatris .
```

```bash
docker run -d --name kompetensmatris -p 8080:8080 -e ADMIN_PASSWORD=byt-mig -v kompetensdata:/data --restart unless-stopped kompetensmatris
```

Öppna sedan http://localhost:8080. Datan ligger i volymen `kompetensdata`, så den finns kvar när containern uppdateras eller startas om. Monterar du en katalog från värden i stället (`-v /sökväg:/data`) måste den vara skrivbar för användaren i containern (uid `1654`).

Hälsokontroll: `GET /health` svarar `ok`.

### Publicera på Docker Hub

**Automatiskt med GitHub Actions** (`.github/workflows/docker.yml`): lägg till följande två hemligheter under *Settings → Secrets and variables → Actions* i GitHub-repot.

- `DOCKERHUB_USERNAME`: ditt användarnamn eller din organisation på Docker Hub
- `DOCKERHUB_TOKEN`: en *Personal access token* från Docker Hub (*Account settings → Personal access tokens*, behörighet *Read & Write*)

Därefter körs testerna och imagen byggs vid varje push till `main`:

- en push till `main` publicerar `<konto>/kompetensmatris:latest` och en tagg med commit-hashen
- en tagg som `v1.2.0` publicerar även `:1.2.0`

Saknas hemligheterna byggs imagen ändå, men den pushas inte.

**Manuellt:**

```bash
docker login
```

```bash
docker build -t <konto>/kompetensmatris:latest .
```

```bash
docker push <konto>/kompetensmatris:latest
```

I driftmiljön räcker det sedan att köra imagen med `ADMIN_PASSWORD` och en volym på `/data` (se `docker-compose.yml`, byt `build: .` mot `image: <konto>/kompetensmatris:latest`).

## Säkerhetskopiering

Allt finns i filen `/data/kompetensmatris.json`. Kopiera den, eller använd **Exportera** i adminläget. **Importera** ersätter all data med en exporterad fil. Filen kontrolleras först, så en trasig fil skriver inte över något.

## API

Alla ändrande anrop kräver headern `X-Admin-Password`.

| Metod  | Adress                    | Beskrivning                                        |
|--------|---------------------------|----------------------------------------------------|
| GET    | `/api/data`               | All data: `{ nodes: [...], courses: [...] }`       |
| POST   | `/api/login`              | `{ password }` → 204 om rätt, annars 401          |
| POST   | `/api/nodes`              | Skapa område `{ parentId, title, priority, description, links }` (`parentId: null` = nytt träd) |
| POST   | `/api/nodes/outline`      | Skapa många från text `{ parentId, text }`         |
| PUT    | `/api/nodes/{id}`         | Ändra område                                       |
| POST   | `/api/nodes/{id}/move`    | Flytta `{ parentId, index }`                       |
| DELETE | `/api/nodes/{id}`         | Ta bort område med underområden och kurser         |
| POST   | `/api/courses`            | Skapa kurs `{ nodeId, title, start, end, url, teacher, description }` |
| PUT    | `/api/courses/{id}`       | Ändra kurs                                         |
| DELETE | `/api/courses/{id}`       | Ta bort kurs                                       |
| PUT    | `/api/data`               | Importera (ersätter all data)                      |
