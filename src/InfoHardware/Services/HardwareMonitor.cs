using LibreHardwareMonitor.Hardware;

namespace InfoHardware.Services;

public readonly record struct SensorReading(float? Value, float? Min, float? Max);

public sealed class SensorInfo(string id, string name, SensorType type, int index)
{
    public string Id { get; } = id;
    public string Name { get; } = name;
    public SensorType Type { get; } = type;
    public int Index { get; } = index;
}

public sealed class HardwareGroup(string name, HardwareType type, IReadOnlyList<SensorInfo> sensors)
{
    public string Name { get; } = name;
    public HardwareType Type { get; } = type;
    public IReadOnlyList<SensorInfo> Sensors { get; } = sensors;
}

/// <summary>Valores principais lidos em um ciclo de atualização (imutável, seguro para outra thread).</summary>
public sealed class HardwareSnapshot
{
    public string? CpuName, GpuName;
    public double? CpuLoad, CpuTemp, CpuClock, CpuPower;
    public double[] CoreLoads = [];
    public double? GpuLoad, GpuTemp, GpuHotspot, GpuClock, GpuMemClock, GpuPower, GpuFan;
    public double? VramUsedMb, VramTotalMb;
    public double? RamUsedGb, RamAvailableGb, RamLoad;
    public double? DiskRead, DiskWrite, DiskTemp, DiskActivity;
    public double? NetUp, NetDown;
    public Dictionary<string, SensorReading> Sensors = [];
}

/// <summary>Lê todos os sensores via LibreHardwareMonitor em uma thread dedicada.</summary>
public sealed class HardwareMonitor : IDisposable
{
    readonly Computer _computer = new()
    {
        IsCpuEnabled = true,
        IsGpuEnabled = true,
        IsMemoryEnabled = true,
        IsMotherboardEnabled = true,
        IsControllerEnabled = true,
        IsNetworkEnabled = true,
        IsStorageEnabled = true,
        IsBatteryEnabled = true,
        IsPsuEnabled = true,
    };

    readonly object _lock = new();
    readonly ManualResetEventSlim _wake = new(false);
    readonly CpuPerfCounter _cpuPerf = new();
    Thread? _thread;
    volatile bool _running;
    volatile bool _structureDirty = true;
    volatile bool _resetRequested;
    IReadOnlyList<HardwareGroup> _groups = [];

    public int IntervalMs { get; set; } = 1000;
    public bool IsReady { get; private set; }
    public string? Error { get; private set; }

    /// <summary>Disparado na thread de leitura a cada ciclo.</summary>
    public event Action<HardwareSnapshot>? Updated;
    /// <summary>Disparado quando a lista de hardware/sensores muda.</summary>
    public event Action<IReadOnlyList<HardwareGroup>>? StructureChanged;

    public IReadOnlyList<HardwareGroup> Groups { get { lock (_lock) return _groups; } }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _thread = new Thread(Loop) { IsBackground = true, Name = "HardwareMonitor", Priority = ThreadPriority.AboveNormal };
        _thread.Start();
    }

    public void ResetMinMax() => _resetRequested = true;

    /// <summary>Fecha e abre de novo o LibreHardwareMonitor (ex.: o driver PawnIO acabou de ser instalado).</summary>
    public void Reopen()
    {
        lock (_lock)
        {
            try { _computer.Close(); } catch { }
            try { _computer.Open(); Error = null; } catch (Exception ex) { Error = ex.Message; }
            _structureDirty = true;
        }
        _wake.Set();
    }

    /// <summary>Força uma leitura imediata (ex.: após mudar o intervalo).</summary>
    public void Poke() => _wake.Set();

    void Loop()
    {
        try
        {
            _computer.HardwareAdded += _ => _structureDirty = true;
            _computer.HardwareRemoved += _ => _structureDirty = true;
            _computer.Open();
            IsReady = true;
        }
        catch (Exception ex)
        {
            Error = ex.Message;
        }

        while (_running)
        {
            var started = Environment.TickCount64;
            try
            {
                lock (_lock)
                {
                    foreach (var hw in _computer.Hardware) UpdateRecursive(hw);

                    if (_resetRequested)
                    {
                        _resetRequested = false;
                        foreach (var s in AllSensors()) { s.ResetMin(); s.ResetMax(); }
                    }

                    if (_structureDirty)
                    {
                        _structureDirty = false;
                        _groups = BuildGroups();
                        StructureChanged?.Invoke(_groups);
                    }
                }
                Updated?.Invoke(BuildSnapshot());
            }
            catch (Exception ex)
            {
                Error = ex.Message;
            }

            var wait = IntervalMs - (int)(Environment.TickCount64 - started);
            if (wait > 0) _wake.Wait(wait);
            _wake.Reset();
        }
    }

    static void UpdateRecursive(IHardware hw)
    {
        try { hw.Update(); } catch { /* um dispositivo com falha não deve parar os demais */ }
        foreach (var sub in hw.SubHardware) UpdateRecursive(sub);
    }

    IEnumerable<IHardware> AllHardware()
    {
        foreach (var hw in _computer.Hardware)
        {
            yield return hw;
            foreach (var sub in hw.SubHardware)
            {
                yield return sub;
                foreach (var sub2 in sub.SubHardware) yield return sub2;
            }
        }
    }

    IEnumerable<ISensor> AllSensors() => AllHardware().SelectMany(h => h.Sensors);

    List<HardwareGroup> BuildGroups()
    {
        var list = new List<HardwareGroup>();
        foreach (var hw in AllHardware())
        {
            if (hw.HardwareType == HardwareType.Network && IsFilterAdapter(hw.Name)) continue;
            var sensors = hw.Sensors
                .OrderBy(s => s.SensorType).ThenBy(s => s.Index)
                .Select(s => new SensorInfo(s.Identifier.ToString(), s.Name, s.SensorType, s.Index))
                .ToList();
            if (sensors.Count == 0) continue;
            var name = hw.Parent is { } p ? $"{p.Name} › {hw.Name}" : hw.Name;
            list.Add(new HardwareGroup(name, hw.HardwareType, sensors));
        }
        return list;
    }

    HardwareSnapshot BuildSnapshot()
    {
        var snap = new HardwareSnapshot();
        List<IHardware> hardware;
        lock (_lock)
        {
            hardware = AllHardware().ToList();
            foreach (var s in hardware.SelectMany(h => h.Sensors))
                snap.Sensors[s.Identifier.ToString()] = new SensorReading(s.Value, s.Min, s.Max);
        }

        // ---------- CPU ----------
        var cpu = hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        if (cpu != null)
        {
            snap.CpuName = cpu.Name;
            snap.CpuLoad = Find(cpu, SensorType.Load, "CPU Total");
            snap.CpuTemp = Find(cpu, SensorType.Temperature, "Core (Tctl/Tdie)", "CPU Package", "Package", "Tctl", "Core Max", "Core Average")
                           ?? MaxOf(cpu, SensorType.Temperature);
            var clocks = cpu.Sensors.Where(s => s.SensorType == SensorType.Clock && s.Name.StartsWith("Core #") && !s.Name.Contains("Effective") && s.Value > 0)
                                    .Select(s => (double)s.Value!.Value).ToList();
            snap.CpuClock = clocks.Count > 0 ? clocks.Average() : Find(cpu, SensorType.Clock, "Cores (Average)");
            // Sem driver de baixo nível: estima pelo contador "% Processor Performance" do Windows.
            snap.CpuClock ??= _cpuPerf.ReadMhz();
            snap.CpuPower = Find(cpu, SensorType.Power, "CPU Package", "Package") ?? FirstOf(cpu, SensorType.Power);
            snap.CoreLoads = cpu.Sensors
                .Where(s => s.SensorType == SensorType.Load && s.Name.StartsWith("CPU Core #"))
                .OrderBy(s => s.Index)
                .Select(s => (double)(s.Value ?? 0)).ToArray();
        }
        if (snap.CpuTemp == null)
        {
            // Algumas placas expõem a temperatura da CPU apenas pelo chip SuperIO.
            var sio = hardware.Where(h => h.HardwareType == HardwareType.SuperIO);
            foreach (var h in sio) snap.CpuTemp ??= Find(h, SensorType.Temperature, "CPU", "CPU Core", "CPU Socket");
        }

        // ---------- GPU (dedicada primeiro: a de maior VRAM dedicada) ----------
        var gpu = PickMainGpu(hardware);
        if (gpu != null)
        {
            snap.GpuName = gpu.Name;
            snap.GpuLoad = Find(gpu, SensorType.Load, "GPU Core", "D3D 3D") ?? MaxOf(gpu, SensorType.Load, n => n.Contains("3D") || n.Contains("Core"));
            snap.GpuTemp = Find(gpu, SensorType.Temperature, "GPU Core", "GPU Temperature") ?? FirstOf(gpu, SensorType.Temperature);
            snap.GpuHotspot = Find(gpu, SensorType.Temperature, "GPU Hot Spot", "GPU Hotspot");
            snap.GpuClock = Find(gpu, SensorType.Clock, "GPU Core");
            snap.GpuMemClock = Find(gpu, SensorType.Clock, "GPU Memory");
            snap.GpuPower = Find(gpu, SensorType.Power, "GPU Package", "GPU Power", "GPU Core") ?? FirstOf(gpu, SensorType.Power);
            snap.GpuFan = FirstOf(gpu, SensorType.Fan);
            snap.VramUsedMb = Find(gpu, SensorType.SmallData, "GPU Memory Used", "D3D Dedicated Memory Used");
            snap.VramTotalMb = Find(gpu, SensorType.SmallData, "GPU Memory Total", "D3D Dedicated Memory Total");
            if (snap.VramTotalMb == null && snap.VramUsedMb != null && Find(gpu, SensorType.SmallData, "GPU Memory Free") is double free)
                snap.VramTotalMb = snap.VramUsedMb + free;
        }

        // ---------- Memória ----------
        var mem = hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Memory &&
                                              h.Sensors.Any(s => s.SensorType == SensorType.Data && s.Name == "Memory Used"));
        if (mem != null)
        {
            snap.RamUsedGb = Find(mem, SensorType.Data, "Memory Used");
            snap.RamAvailableGb = Find(mem, SensorType.Data, "Memory Available");
            snap.RamLoad = Find(mem, SensorType.Load, "Memory");
        }

        // ---------- Armazenamento ----------
        var disks = hardware.Where(h => h.HardwareType == HardwareType.Storage).ToList();
        if (disks.Count > 0)
        {
            snap.DiskRead = SumOf(disks, SensorType.Throughput, "Read Rate");
            snap.DiskWrite = SumOf(disks, SensorType.Throughput, "Write Rate");
            snap.DiskTemp = disks.Select(d => FirstOf(d, SensorType.Temperature)).Where(v => v != null).Max();
            snap.DiskActivity = disks.Select(d => Find(d, SensorType.Load, "Total Activity")).Where(v => v != null).Max();
        }

        // ---------- Rede (só adaptadores físicos conectados; filtros/virtuais duplicariam o tráfego) ----------
        var active = ActiveInterfaceNames();
        var nets = hardware.Where(h => h.HardwareType == HardwareType.Network && active.Contains(h.Name) && !IsVirtualAdapter(h.Name)).ToList();
        if (nets.Count > 0)
        {
            snap.NetUp = SumOf(nets, SensorType.Throughput, "Upload Speed");
            snap.NetDown = SumOf(nets, SensorType.Throughput, "Download Speed");
        }

        return snap;
    }

    string? _mainGpuId;

    IHardware? PickMainGpu(List<IHardware> hardware)
    {
        var gpus = hardware.Where(h => h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel).ToList();
        if (_mainGpuId != null && gpus.FirstOrDefault(g => g.Identifier.ToString() == _mainGpuId) is { } cached) return cached;
        var best = gpus
            .OrderByDescending(g => Find(g, SensorType.SmallData, "GPU Memory Total", "D3D Dedicated Memory Total") ?? 0)
            .ThenByDescending(g => g.HardwareType == HardwareType.GpuNvidia)
            .FirstOrDefault();
        _mainGpuId = best?.Identifier.ToString();
        return best;
    }

    HashSet<string> _activeNics = new(StringComparer.OrdinalIgnoreCase);
    long _activeNicsAt;

    HashSet<string> ActiveInterfaceNames()
    {
        if (Environment.TickCount64 - _activeNicsAt < 10_000) return _activeNics;
        _activeNicsAt = Environment.TickCount64;
        try
        {
            _activeNics = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up &&
                            n.NetworkInterfaceType is not (System.Net.NetworkInformation.NetworkInterfaceType.Loopback or System.Net.NetworkInformation.NetworkInterfaceType.Tunnel))
                .Select(n => n.Name)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch { }
        return _activeNics;
    }

    /// <summary>Adaptadores-filtro do Windows (QoS, WFP…) aparecem como placas extras no LHM.</summary>
    static bool IsFilterAdapter(string name) =>
        name.Contains("-0000") || name.Contains("Filter", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Scheduler", StringComparison.OrdinalIgnoreCase) || name.Contains("Depurador de Kernel", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Kernel Debug", StringComparison.OrdinalIgnoreCase);

    static bool IsVirtualAdapter(string name) =>
        name.Contains("vEthernet", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Loopback", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Virtual", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Pseudo", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("VPN", StringComparison.OrdinalIgnoreCase);

    /// <summary>Sem o driver, alguns sensores ficam fixos em 0 — temperatura/consumo/clock 0 não são leituras reais.</summary>
    static bool Valid(ISensor s) =>
        s.Value is float v && !float.IsNaN(v) &&
        !(v <= 0 && s.SensorType is SensorType.Temperature or SensorType.Power or SensorType.Clock);

    static double? Find(IHardware hw, SensorType type, params string[] names)
    {
        foreach (var n in names)
        {
            var s = hw.Sensors.FirstOrDefault(x => x.SensorType == type && x.Name.Equals(n, StringComparison.OrdinalIgnoreCase) && Valid(x));
            if (s != null) return s.Value;
        }
        return null;
    }

    static double? FirstOf(IHardware hw, SensorType type) =>
        hw.Sensors.FirstOrDefault(s => s.SensorType == type && Valid(s))?.Value;

    static double? MaxOf(IHardware hw, SensorType type, Func<string, bool>? filter = null)
    {
        var values = hw.Sensors.Where(s => s.SensorType == type && Valid(s) && (filter?.Invoke(s.Name) ?? true))
                               .Select(s => (double)s.Value!.Value).ToList();
        return values.Count > 0 ? values.Max() : null;
    }

    static double? SumOf(IEnumerable<IHardware> hws, SensorType type, string name)
    {
        double sum = 0; bool any = false;
        foreach (var hw in hws)
            if (Find(hw, type, name) is double v) { sum += v; any = true; }
        return any ? sum : null;
    }

    public string GetReport()
    {
        lock (_lock) return _computer.GetReport();
    }

    public void Dispose()
    {
        _running = false;
        _wake.Set();
        _thread?.Join(2000);
        lock (_lock)
        {
            try { _computer.Close(); } catch { }
        }
    }
}
