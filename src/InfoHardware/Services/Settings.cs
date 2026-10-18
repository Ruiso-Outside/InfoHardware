using System.Text.Json;
using InfoHardware.Core;

namespace InfoHardware.Services;

public sealed class Settings : ObservableObject
{
    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "InfoHardware");
    static string FilePath => Path.Combine(Folder, "settings.json");

    int _interval = 1000;
    bool _overlayEnabled;
    string _overlayPosition = "TopLeft";
    double _overlayOpacity = 0.85, _overlayScale = 1.0;
    bool _ovFps = true, _ovFrameTime = true, _ovCpu = true, _ovGpu = true, _ovRam = true, _ovVram = true, _ovPower = true, _ovClocks, _ovClock;

    public int UpdateIntervalMs { get => _interval; set => Set(ref _interval, Math.Clamp(value, 250, 5000)); }
    public bool OverlayEnabled { get => _overlayEnabled; set => Set(ref _overlayEnabled, value); }
    public string OverlayPosition { get => _overlayPosition; set => Set(ref _overlayPosition, value); }
    public double OverlayOpacity { get => _overlayOpacity; set => Set(ref _overlayOpacity, Math.Clamp(value, 0.2, 1)); }
    public double OverlayScale { get => _overlayScale; set => Set(ref _overlayScale, Math.Clamp(value, 0.6, 2)); }
    public bool OvShowFps { get => _ovFps; set => Set(ref _ovFps, value); }
    public bool OvShowFrameTime { get => _ovFrameTime; set => Set(ref _ovFrameTime, value); }
    public bool OvShowCpu { get => _ovCpu; set => Set(ref _ovCpu, value); }
    public bool OvShowGpu { get => _ovGpu; set => Set(ref _ovGpu, value); }
    public bool OvShowRam { get => _ovRam; set => Set(ref _ovRam, value); }
    public bool OvShowVram { get => _ovVram; set => Set(ref _ovVram, value); }
    public bool OvShowPower { get => _ovPower; set => Set(ref _ovPower, value); }
    public bool OvShowClocks { get => _ovClocks; set => Set(ref _ovClocks, value); }
    public bool OvShowClock { get => _ovClock; set => Set(ref _ovClock, value); }

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings();
        }
        catch { }
        return new Settings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}
