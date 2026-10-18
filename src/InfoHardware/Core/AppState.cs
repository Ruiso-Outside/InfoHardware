using System.Collections.ObjectModel;
using System.Security.Principal;
using System.Windows;
using System.Windows.Media;
using InfoHardware.Services;
using LibreHardwareMonitor.Hardware;

namespace InfoHardware.Core;

public sealed class CoreLoad(string label) : ObservableObject
{
    double _value;
    public string Label { get; } = label;
    public double Value { get => _value; set { if (Set(ref _value, value)) OnPropertyChanged(nameof(Text)); } }
    public string Text => $"{_value:0}%";
}

/// <summary>Métricas ao vivo exibidas no painel, gráficos e overlay.</summary>
public sealed class LiveData : ObservableObject
{
    static Color C(string hex) => (Color)ColorConverter.ConvertFromString(hex);
    static readonly Color Purple = C("#A855F7"), Pink = C("#FF3CAC"), Cyan = C("#22D3EE"), Green = C("#39FF88"),
                          Orange = C("#FFB020"), Red = C("#FF4D6D"), Blue = C("#5B8CFF"), Yellow = C("#F7E26B");

    public Metric CpuLoad { get; } = new("Uso da CPU", "%", Purple);
    public Metric CpuTemp { get; } = new("Temperatura da CPU", "°C", Pink);
    public Metric CpuClock { get; } = new("Clock da CPU", "", Cyan, formatter: Format.Mhz, gaugeMax: 6000);
    public Metric CpuPower { get; } = new("Consumo da CPU", "W", Orange, "0.0", 250);
    public Metric GpuLoad { get; } = new("Uso da GPU", "%", Cyan);
    public Metric GpuTemp { get; } = new("Temperatura da GPU", "°C", Orange);
    public Metric GpuHotspot { get; } = new("Hotspot da GPU", "°C", Red);
    public Metric GpuClock { get; } = new("Clock da GPU", "", Purple, formatter: Format.Mhz, gaugeMax: 3000);
    public Metric GpuMemClock { get; } = new("Clock da VRAM", "", Pink, formatter: Format.Mhz);
    public Metric GpuPower { get; } = new("Consumo da GPU", "W", Green, "0.0", 450);
    public Metric GpuFan { get; } = new("Ventoinha da GPU", "RPM", Blue, gaugeMax: 4000);
    public Metric VramUsed { get; } = new("VRAM usada", "GB", Pink, "0.0");
    public Metric VramLoad { get; } = new("Uso da VRAM", "%", Pink);
    public Metric RamUsed { get; } = new("RAM usada", "GB", Green, "0.0");
    public Metric RamLoad { get; } = new("Uso da RAM", "%", Green);
    public Metric DiskRead { get; } = new("Leitura", "", Cyan, formatter: Format.Rate);
    public Metric DiskWrite { get; } = new("Escrita", "", Pink, formatter: Format.Rate);
    public Metric DiskTemp { get; } = new("Temperatura do disco", "°C", Yellow);
    public Metric NetDown { get; } = new("Download", "", Green, formatter: Format.Rate);
    public Metric NetUp { get; } = new("Upload", "", Purple, formatter: Format.Rate);
    public Metric Fps { get; } = new("FPS", "", Cyan, gaugeMax: 240);
    public Metric FrameTime { get; } = new("Frametime", "ms", Pink, "0.0");
    public Metric Fps1Low { get; } = new("1% low", "", Purple);

    public ObservableCollection<CoreLoad> Cores { get; } = [];

    string _cpuName = "Detectando…", _gpuName = "Detectando…", _fpsProcess = "Nenhum jogo detectado", _ramTotal = "", _vramTotal = "";
    bool _fpsForeground;
    public string CpuName { get => _cpuName; set => Set(ref _cpuName, value); }
    public string GpuName { get => _gpuName; set => Set(ref _gpuName, value); }
    public string FpsProcess { get => _fpsProcess; set => Set(ref _fpsProcess, value); }
    public bool FpsIsForeground { get => _fpsForeground; set => Set(ref _fpsForeground, value); }
    public string RamTotalText { get => _ramTotal; set => Set(ref _ramTotal, value); }
    public string VramTotalText { get => _vramTotal; set => Set(ref _vramTotal, value); }
    public string ClockText => DateTime.Now.ToString("HH:mm");

    public Metric[] Recordable => [Fps, FrameTime, Fps1Low, CpuLoad, CpuTemp, CpuClock, CpuPower, GpuLoad, GpuTemp, GpuHotspot,
                                   GpuClock, GpuMemClock, GpuPower, GpuFan, VramUsed, RamUsed, RamLoad, DiskRead, DiskWrite, NetDown, NetUp];

    public void Apply(HardwareSnapshot s, FpsSample f, double ramTotalGb)
    {
        if (s.CpuName != null) CpuName = s.CpuName;
        if (s.GpuName != null) GpuName = s.GpuName;
        CpuLoad.Set(s.CpuLoad); CpuTemp.Set(s.CpuTemp); CpuClock.Set(s.CpuClock); CpuPower.Set(s.CpuPower);
        GpuLoad.Set(s.GpuLoad); GpuTemp.Set(s.GpuTemp); GpuHotspot.Set(s.GpuHotspot); GpuClock.Set(s.GpuClock);
        GpuMemClock.Set(s.GpuMemClock); GpuPower.Set(s.GpuPower); GpuFan.Set(s.GpuFan);

        VramUsed.Set(s.VramUsedMb / 1024);
        if (s.VramTotalMb is double vt && vt > 0)
        {
            VramUsed.GaugeMax = vt / 1024;
            VramTotalText = Format.Num(vt / 1024, "0.#") + " GB";
            VramLoad.Set(s.VramUsedMb / vt * 100);
        }
        else VramLoad.Set(null);

        RamUsed.Set(s.RamUsedGb);
        // Total instalado (WMI) é o valor que o usuário reconhece; usado+disponível só como reserva.
        double total = ramTotalGb > 0 ? ramTotalGb : (s.RamUsedGb + s.RamAvailableGb) ?? 0;
        if (total > 0) { RamUsed.GaugeMax = total; RamTotalText = Format.Num(total, "0.#") + " GB"; }
        RamLoad.Set(s.RamLoad);

        DiskRead.Set(s.DiskRead); DiskWrite.Set(s.DiskWrite); DiskTemp.Set(s.DiskTemp);
        NetDown.Set(s.NetDown); NetUp.Set(s.NetUp);

        Fps.Set(f.Fps); FrameTime.Set(f.FrameTimeMs); Fps1Low.Set(f.Low1Fps);
        FpsProcess = f.ProcessName ?? "Nenhum jogo detectado";
        FpsIsForeground = f.IsForeground;

        // Núcleos: ajusta a coleção apenas quando a quantidade muda.
        if (Cores.Count != s.CoreLoads.Length)
        {
            Cores.Clear();
            for (int i = 0; i < s.CoreLoads.Length; i++) Cores.Add(new CoreLoad($"{i + 1}"));
        }
        for (int i = 0; i < s.CoreLoads.Length; i++) Cores[i].Value = s.CoreLoads[i];
        OnPropertyChanged(nameof(ClockText));
    }
}

// ---------------------------------------------------------------- sensores
public sealed class SensorRow : ObservableObject
{
    static readonly Dictionary<SensorType, (string Name, string Color)> TypeInfo = new()
    {
        [SensorType.Voltage] = ("Tensão", "#F7E26B"), [SensorType.Current] = ("Corrente", "#F7E26B"),
        [SensorType.Power] = ("Potência", "#FFB020"), [SensorType.Clock] = ("Clock", "#22D3EE"),
        [SensorType.Temperature] = ("Temperatura", "#FF3CAC"), [SensorType.Load] = ("Uso", "#A855F7"),
        [SensorType.Frequency] = ("Frequência", "#22D3EE"), [SensorType.Fan] = ("Ventoinha", "#39FF88"),
        [SensorType.Flow] = ("Fluxo", "#5B8CFF"), [SensorType.Control] = ("Controle", "#39FF88"),
        [SensorType.Level] = ("Nível", "#A855F7"), [SensorType.Factor] = ("Fator", "#A495CC"),
        [SensorType.Data] = ("Dados", "#5B8CFF"), [SensorType.SmallData] = ("Dados", "#5B8CFF"),
        [SensorType.Throughput] = ("Taxa", "#22D3EE"), [SensorType.TimeSpan] = ("Tempo", "#A495CC"),
        [SensorType.Timing] = ("Latência", "#A495CC"), [SensorType.Energy] = ("Energia", "#FFB020"),
        [SensorType.Noise] = ("Ruído", "#A495CC"), [SensorType.Conductivity] = ("Condutividade", "#A495CC"),
        [SensorType.Humidity] = ("Umidade", "#5B8CFF"),
    };

    readonly SensorType _type;
    string _value = "--", _min = "--", _max = "--";
    bool _visible = true;

    public SensorRow(SensorInfo info)
    {
        Id = info.Id;
        Name = info.Name;
        _type = info.Type;
        var t = TypeInfo.TryGetValue(info.Type, out var ti) ? ti : (info.Type.ToString(), "#A495CC");
        TypeName = t.Item1;
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(t.Item2)); b.Freeze();
        TypeBrush = b;
    }

    public string Id { get; }
    public string Name { get; }
    public string TypeName { get; }
    public Brush TypeBrush { get; }
    public string Value { get => _value; private set => Set(ref _value, value); }
    public string Min { get => _min; private set => Set(ref _min, value); }
    public string Max { get => _max; private set => Set(ref _max, value); }
    public bool IsVisible { get => _visible; set => Set(ref _visible, value); }

    public void Update(SensorReading r)
    {
        Value = Fmt(r.Value);
        Min = Fmt(r.Min);
        Max = Fmt(r.Max);
    }

    string Fmt(float? v)
    {
        if (v is not float f || float.IsNaN(f)) return "--";
        return _type switch
        {
            SensorType.Voltage => $"{f:0.000} V",
            SensorType.Current => $"{f:0.00} A",
            SensorType.Power => $"{f:0.0} W",
            SensorType.Clock => $"{f:0} MHz",
            SensorType.Temperature => $"{f:0.0} °C",
            SensorType.Load or SensorType.Control or SensorType.Level or SensorType.Humidity => $"{f:0.0} %",
            SensorType.Frequency => $"{f:0} Hz",
            SensorType.Fan => $"{f:0} RPM",
            SensorType.Flow => $"{f:0} L/h",
            SensorType.Factor => $"{f:0.000}",
            SensorType.Data => $"{f:0.00} GB",
            SensorType.SmallData => $"{f:0} MB",
            SensorType.Throughput => Format.Rate(f),
            SensorType.TimeSpan => TimeSpan.FromSeconds(f).ToString(@"d\.hh\:mm\:ss"),
            SensorType.Timing => $"{f:0.000} ns",
            SensorType.Energy => $"{f:0} mWh",
            SensorType.Noise => $"{f:0} dBA",
            _ => $"{f:0.###}"
        };
    }
}

public sealed class SensorGroup(string name, string glyph, IEnumerable<SensorRow> rows) : ObservableObject
{
    bool _visible = true;
    public string Name { get; } = name;
    public string Glyph { get; } = glyph;
    public ObservableCollection<SensorRow> Rows { get; } = new(rows);
    public int Count => Rows.Count;
    public bool IsVisible { get => _visible; set => Set(ref _visible, value); }

    public static string GlyphFor(HardwareType t) => t switch
    {
        HardwareType.Cpu => "",
        HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel => "",
        HardwareType.Memory => "",
        HardwareType.Motherboard or HardwareType.SuperIO or HardwareType.EmbeddedController => "",
        HardwareType.Storage => "",
        HardwareType.Network => "",
        HardwareType.Battery => "",
        HardwareType.Psu or HardwareType.PowerMonitor => "",
        _ => ""
    };
}

// ---------------------------------------------------------------- estado global
public sealed class AppState : ObservableObject
{
    public static AppState Instance { get; } = new();

    readonly Dictionary<string, SensorRow> _rowsById = [];
    string _filter = "";
    bool _infoLoading = true, _sensorsLoading = true;
    string _hwStatus = "Iniciando sensores…";
    SystemSummary _summary = new();
    InfoSection? _selectedSection;

    AppState()
    {
        Settings = Settings.Load();
        Recorder = new SessionRecorder(Live.Recordable, () => Live.FpsProcess);
        IsAdmin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        try { PawnIoInstalled = LibreHardwareMonitor.PawnIo.PawnIo.IsInstalled; } catch { PawnIoInstalled = false; }
    }

    public Settings Settings { get; }
    public LiveData Live { get; } = new();
    public HardwareMonitor Hardware { get; } = new();
    public FpsMonitor FpsMonitor { get; } = new();
    public SessionRecorder Recorder { get; }
    public bool IsAdmin { get; }
    public bool PawnIoInstalled { get; private set; }
    public string Version => typeof(AppState).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";

    public ObservableCollection<InfoSection> Sections { get; } = [];
    public ObservableCollection<SensorGroup> SensorGroups { get; } = [];

    public SystemSummary Summary { get => _summary; private set => Set(ref _summary, value); }
    public InfoSection? SelectedSection { get => _selectedSection; set => Set(ref _selectedSection, value); }
    public bool IsInfoLoading { get => _infoLoading; private set => Set(ref _infoLoading, value); }
    public bool IsSensorsLoading { get => _sensorsLoading; private set => Set(ref _sensorsLoading, value); }
    public string HardwareStatus { get => _hwStatus; private set => Set(ref _hwStatus, value); }
    public string FpsStatus => FpsMonitor.IsRunning ? "Captura de FPS ativa (DirectX via ETW)" : FpsMonitor.Error ?? "Captura de FPS inativa";
    public bool FpsActive => FpsMonitor.IsRunning;
    public int SensorCount => _rowsById.Count;

    public string SensorFilter
    {
        get => _filter;
        set { if (Set(ref _filter, value)) ApplyFilter(); }
    }

    public void Start()
    {
        Hardware.IntervalMs = Settings.UpdateIntervalMs;
        Settings.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Settings.UpdateIntervalMs)) { Hardware.IntervalMs = Settings.UpdateIntervalMs; Hardware.Poke(); }
            Settings.Save();
        };

        var dispatcher = Application.Current.Dispatcher;
        Hardware.StructureChanged += groups => dispatcher.BeginInvoke(() => RebuildSensors(groups));
        Hardware.Updated += snap => dispatcher.BeginInvoke(() => OnTick(snap));
        Hardware.Start();

        FpsMonitor.Start();
        OnPropertyChanged(nameof(FpsStatus));
        OnPropertyChanged(nameof(FpsActive));

        Task.Run(SystemInfoService.Collect).ContinueWith(t =>
        {
            if (t.IsCompletedSuccessfully)
            {
                var (sections, summary) = t.Result;
                foreach (var s in sections) Sections.Add(s);
                Summary = summary;
                SelectedSection = Sections.FirstOrDefault();
            }
            IsInfoLoading = false;
        }, TaskScheduler.FromCurrentSynchronizationContext());
    }

    void OnTick(HardwareSnapshot snap)
    {
        Live.Apply(snap, FpsMonitor.Sample(), Summary.RamTotalGb);
        Recorder.Record();
        foreach (var (id, reading) in snap.Sensors)
            if (_rowsById.TryGetValue(id, out var row)) row.Update(reading);

        CheckExclusiveFullscreen();
        IsSensorsLoading = false;
        HardwareStatus = Hardware.Error is { } err ? "Erro: " + err : $"{SensorCount} sensores · atualização a cada {Settings.UpdateIntervalMs / 1000.0:0.##} s";
    }

    void RebuildSensors(IReadOnlyList<HardwareGroup> groups)
    {
        SensorGroups.Clear();
        _rowsById.Clear();
        foreach (var g in groups)
        {
            var rows = g.Sensors.Select(s => new SensorRow(s)).ToList();
            foreach (var r in rows) _rowsById[r.Id] = r;
            SensorGroups.Add(new SensorGroup(g.Name, SensorGroup.GlyphFor(g.Type), rows));
        }
        ApplyFilter();
        OnPropertyChanged(nameof(SensorCount));
    }

    void ApplyFilter()
    {
        var f = _filter.Trim();
        foreach (var g in SensorGroups)
        {
            bool groupMatch = f.Length == 0 || g.Name.Contains(f, StringComparison.OrdinalIgnoreCase);
            int visible = 0;
            foreach (var r in g.Rows)
            {
                r.IsVisible = groupMatch || r.Name.Contains(f, StringComparison.OrdinalIgnoreCase) || r.TypeName.Contains(f, StringComparison.OrdinalIgnoreCase);
                if (r.IsVisible) visible++;
            }
            g.IsVisible = visible > 0;
        }
    }

    string? _exclusiveWarning;
    /// <summary>Preenchido quando um jogo em tela cheia exclusiva é detectado (o overlay não aparece nesse modo).</summary>
    public string? ExclusiveFullscreenWarning { get => _exclusiveWarning; private set { if (Set(ref _exclusiveWarning, value)) OnPropertyChanged(nameof(HasExclusiveWarning)); } }
    public bool HasExclusiveWarning => _exclusiveWarning != null;

    void CheckExclusiveFullscreen()
    {
        // QUNS_RUNNING_D3D_FULL_SCREEN = 3: um app Direct3D está em tela cheia exclusiva.
        if (SHQueryUserNotificationState(out int state) != 0 || state != 3) return;
        var game = Live.FpsProcess.EndsWith(".exe") ? Live.FpsProcess : "Um jogo";
        ExclusiveFullscreenWarning =
            $"{game} está em TELA CHEIA EXCLUSIVA ({DateTime.Now:HH:mm}). Nesse modo o Windows não deixa nenhuma janela aparecer por cima, " +
            "então o overlay fica escondido. No jogo, mude o modo de exibição para \"Janela em tela cheia\" (ou \"Janela sem bordas\").";
    }

    public void DismissExclusiveWarning() => ExclusiveFullscreenWarning = null;

    [System.Runtime.InteropServices.DllImport("shell32.dll")]
    static extern int SHQueryUserNotificationState(out int state);

    public void RefreshPawnIo()
    {
        try { PawnIoInstalled = LibreHardwareMonitor.PawnIo.PawnIo.IsInstalled; } catch { }
        OnPropertyChanged(nameof(PawnIoInstalled));
    }

    public void Shutdown()
    {
        Recorder.Stop();
        Settings.Save();
        FpsMonitor.Dispose();
        Hardware.Dispose();
    }
}
