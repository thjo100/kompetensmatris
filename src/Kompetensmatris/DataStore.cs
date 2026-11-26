using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kompetensmatris;

/// <summary>
/// Håller all data i minnet och sparar den till en JSON-fil vid varje ändring.
/// Datamängden är liten (några hundra noder), så det räcker gott och ger en fil som är lätt att säkerhetskopiera.
/// </summary>
public class DataStore
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Skriv å, ä och ö som de är så att filen går att läsa.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly string _path;
    private readonly Lock _lock = new();
    private AppData _data;
    private string _json;

    public DataStore(string path, ILogger<DataStore>? logger = null)
    {
        _path = Path.GetFullPath(path);
        if (File.Exists(_path))
        {
            _data = JsonSerializer.Deserialize<AppData>(File.ReadAllText(_path), JsonOptions) ?? new AppData();
            _data.Validate();
            _json = JsonSerializer.Serialize(_data, JsonOptions);
            logger?.LogInformation("Läste data från {Path}", _path);
        }
        else
        {
            _data = SeedData.Create();
            _json = Save();
            logger?.LogInformation("Skapade exempeldata i {Path}", _path);
        }
    }

    /// <summary>All data som JSON, klar att skicka till webbläsaren.</summary>
    public string Json
    {
        get { lock (_lock) return _json; }
    }

    /// <summary>
    /// Gör en ändring och sparar. Ändringen görs på en kopia, så kastar den ett fel
    /// lämnas datan helt orörd (allt eller inget).
    /// </summary>
    public T Update<T>(Func<AppData, T> change)
    {
        lock (_lock)
        {
            var copy = JsonSerializer.Deserialize<AppData>(_json, JsonOptions)!;
            var result = change(copy);
            _data = copy;
            _json = Save();
            return result;
        }
    }

    public void Replace(AppData data)
    {
        data.Validate();
        lock (_lock)
        {
            _data = data;
            _json = Save();
        }
    }

    private string Save()
    {
        var json = JsonSerializer.Serialize(_data, JsonOptions);
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        // Skriv till en temporär fil och byt sedan namn, så att filen aldrig blir halvskriven.
        // Den förra versionen sparas som .bak.
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, json);
        if (File.Exists(_path)) File.Copy(_path, _path + ".bak", overwrite: true);
        File.Move(tmp, _path, overwrite: true);
        return json;
    }
}
