namespace Kompetensmatris;

/// <summary>Exempeldata som skapas första gången applikationen startar (när datafilen saknas).</summary>
public static class SeedData
{
    private const string Example = """
        LST Systemutvecklare
          Generell utvecklarkunskap
            Dokumentstandarder
            git
            Mjukvaruarkitekturer
            Arkitekturmönster
            Felsökningsmetodik
            Paketering
            Scriptspråk
            Säker utveckling
          Grunder i C#
            Datatyper
            [1] Async/await
            [1] Arrayer / Collections
            [1] Access modifiers
            [1] Generics
            [1] Reference & value types
            [1] Interfaces
            [1] Statements & expressions
            [3] Delegates/events/action/func
            [1] Exception (try/catch/finally)
            [1] Usings
            [1] Virtual
          Frontend/klient
            [1] HTML
            [1] CSS
            JavaScript
            Ramverk
            [1] Bibliotek
            Tillgänglighet
            UX
            Observabilitet
          Backend/server
            [1] Webbgrunder
            [1] API:er
            [1] Bibliotek
            Kommunikation
            Server
            Autentisering & auktorisering
            Databas
            [1] Mappning
            Bakgrundstjänster
            Loggning
          Test
            [1] Enhetstester
            [2] End-to-End-tester
            Områdesansvarig
          GIS
            [1] GeoJSON
            [1] Koncept
            Områdesansvarig
          Stödtjänster
            Containerisering
            DevOps
            AI
        """;

    public static AppData Create()
    {
        var data = new AppData();
        data.AddOutline(new OutlineInput(null, Example));

        // En exempelkurs så att man ser hur det ser ut. Ta bort den i adminläget.
        var asyncNode = data.Nodes.First(n => n.Title == "Async/await");
        data.AddCourse(new CourseInput(
            NodeId: asyncNode.Id,
            Title: "Exempelkurs: Async/await i praktiken",
            Start: NextWeekAt(13),
            End: NextWeekAt(15),
            Url: "https://teams.microsoft.com/",
            Teacher: "Ange kursledare",
            Description: "Det här är en exempelkurs som skapas vid första start. Ändra eller ta bort den i adminläget."));
        return data;
    }

    private static DateTimeOffset NextWeekAt(int hour)
    {
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Stockholm"); }
        catch (TimeZoneNotFoundException) { zone = TimeZoneInfo.Utc; }

        var date = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).Date.AddDays(7);
        var local = date.AddHours(hour);
        return new DateTimeOffset(local, zone.GetUtcOffset(local));
    }
}
