using System.Management;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
#if NET
using System.Runtime.Intrinsics.X86;
#endif
using System.Text;
using InfoHardware.Core;
using Microsoft.Win32;

namespace InfoHardware.Services;

public sealed record InfoItem(string Label, string Value);

public sealed class InfoGroup(string? header)
{
    public string? Header { get; } = header;
    public bool HasHeader => !string.IsNullOrEmpty(Header);
    public List<InfoItem> Items { get; } = [];

    public InfoGroup Add(string label, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value)) Items.Add(new InfoItem(label, value.Trim()));
        return this;
    }
}

public sealed class InfoSection(string title, string glyph, string subtitle = "")
{
    public string Title { get; } = title;
    public string Glyph { get; } = glyph;
    public string Subtitle { get; set; } = subtitle;
    public List<InfoGroup> Groups { get; } = [];

    public InfoGroup Group(string? header = null)
    {
        var g = new InfoGroup(header);
        Groups.Add(g);
        return g;
    }
}

public sealed class SystemSummary
{
    public string Cpu { get; set; } = "--";
    public string Gpu { get; set; } = "--";
    public string Ram { get; set; } = "--";
    public string Os { get; set; } = "--";
    public string Board { get; set; } = "--";
    public string Computer { get; set; } = Environment.MachineName;
    public double RamTotalGb { get; set; }
}

/// <summary>Coleta as informações estáticas do hardware via WMI, registro e APIs do Windows.</summary>
public static class SystemInfoService
{
    public static (List<InfoSection> Sections, SystemSummary Summary) Collect()
    {
        var summary = new SystemSummary();
        var sections = new List<InfoSection>();
        Try(() => sections.Add(SystemSection(summary)));
        Try(() => sections.Add(CpuSection(summary)));
        Try(() => sections.Add(BoardSection(summary)));
        Try(() => sections.Add(MemorySection(summary)));
        Try(() => sections.Add(GpuSection(summary)));
        Try(() => sections.Add(DisplaySection()));
        Try(() => sections.Add(StorageSection()));
        Try(() => sections.Add(NetworkSection()));
        Try(() => sections.Add(AudioSection()));
        Try(() => { var b = BatterySection(); if (b != null) sections.Add(b); });
        return (sections, summary);
    }

    static void Try(Action a) { try { a(); } catch { /* seção indisponível neste PC */ } }

#if !NET
    [DllImport("kernel32.dll")] static extern bool IsProcessorFeaturePresent(int feature);
    static bool Pf(int feature) { try { return IsProcessorFeaturePresent(feature); } catch { return false; } }
#endif

    // ------------------------------------------------------------------ helpers
    static List<ManagementBaseObject> Query(string wql, string scope = @"root\cimv2")
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(scope, wql);
            return searcher.Get().Cast<ManagementBaseObject>().ToList();
        }
        catch { return []; }
    }

    static string S(ManagementBaseObject o, string prop)
    {
        try { return o[prop]?.ToString()?.Trim() ?? ""; } catch { return ""; }
    }

    static ulong U(ManagementBaseObject o, string prop)
    {
        try { return Convert.ToUInt64(o[prop] ?? 0); } catch { return 0; }
    }

    static string WmiDate(string value)
    {
        try { return string.IsNullOrEmpty(value) ? "" : ManagementDateTimeConverter.ToDateTime(value).ToString("dd/MM/yyyy"); }
        catch { return value; }
    }

    static string Clean(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var t = s.Trim();
        string[] junk = ["To Be Filled By O.E.M.", "Default string", "System Product Name", "System manufacturer", "Not Applicable", "None", "0", "Undefined"];
        return junk.Any(j => t.Equals(j, StringComparison.OrdinalIgnoreCase)) ? "" : t;
    }

    static string Reg(string path, string name)
    {
        try { return Registry.GetValue(path, name, null)?.ToString() ?? ""; } catch { return ""; }
    }

    // ------------------------------------------------------------------ sistema
    static InfoSection SystemSection(SystemSummary summary)
    {
        var sec = new InfoSection("Sistema", "");
        var os = Query("SELECT Caption, Version, BuildNumber, OSArchitecture, InstallDate, LastBootUpTime, RegisteredUser, SerialNumber FROM Win32_OperatingSystem").FirstOrDefault();
        var cs = Query("SELECT Manufacturer, Model, SystemType, Domain, PCSystemType FROM Win32_ComputerSystem").FirstOrDefault();
        const string nt = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion";

        var g = sec.Group("Windows");
        if (os != null)
        {
            var caption = S(os, "Caption").Replace("Microsoft ", "");
            var build = S(os, "BuildNumber");
            var ubr = Reg(nt, "UBR");
            var display = Reg(nt, "DisplayVersion");
            g.Add("Edição", caption)
             .Add("Versão", string.IsNullOrEmpty(display) ? S(os, "Version") : display)
             .Add("Build", string.IsNullOrEmpty(ubr) ? build : $"{build}.{ubr}")
             .Add("Arquitetura", S(os, "OSArchitecture"))
             .Add("Instalado em", WmiDate(S(os, "InstallDate")));
            summary.Os = $"{caption} {display}".Trim();
            try
            {
                var boot = ManagementDateTimeConverter.ToDateTime(S(os, "LastBootUpTime"));
                g.Add("Último boot", boot.ToString("dd/MM/yyyy HH:mm"));
                g.Add("Tempo ligado", Format.Uptime(DateTime.Now - boot));
            }
            catch { }
        }

        var pc = sec.Group("Computador");
        pc.Add("Nome", Environment.MachineName)
          .Add("Usuário", Environment.UserName);
        if (cs != null)
        {
            pc.Add("Fabricante", Clean(S(cs, "Manufacturer")))
              .Add("Modelo", Clean(S(cs, "Model")))
              .Add("Tipo", S(cs, "PCSystemType") switch { "1" => "Desktop", "2" => "Notebook", "3" => "Workstation", "4" => "Servidor", _ => "" })
              .Add("Domínio / Grupo", S(cs, "Domain"));
        }
        pc.Add(".NET Runtime", RuntimeInformation.FrameworkDescription);
        return sec;
    }

    // ------------------------------------------------------------------ CPU
    static InfoSection CpuSection(SystemSummary summary)
    {
        var sec = new InfoSection("Processador", "");
        var cpus = Query("SELECT * FROM Win32_Processor");
        foreach (var c in cpus)
        {
            var name = S(c, "Name");
            summary.Cpu = name;
            sec.Subtitle = name;
            var arch = S(c, "Architecture") switch { "0" => "x86", "5" => "ARM", "9" => "x64", "12" => "ARM64", var a => a };
            var g = sec.Group(name);
            g.Add("Fabricante", S(c, "Manufacturer"))
             .Add("Núcleos", S(c, "NumberOfCores"))
             .Add("Threads", S(c, "NumberOfLogicalProcessors"))
             .Add("Clock base", Format.Mhz(U(c, "MaxClockSpeed")))
             .Add("Soquete", S(c, "SocketDesignation"))
             .Add("Arquitetura", arch)
             .Add("Família / Modelo", S(c, "Caption"))
             .Add("Cache L2", U(c, "L2CacheSize") > 0 ? Format.Bytes(U(c, "L2CacheSize") * 1024.0) : "")
             .Add("Cache L3", U(c, "L3CacheSize") > 0 ? Format.Bytes(U(c, "L3CacheSize") * 1024.0) : "")
             .Add("Virtualização", S(c, "VirtualizationFirmwareEnabled") switch { "True" => "Ativada", "False" => "Desativada", _ => "" })
             .Add("ID do processador", S(c, "ProcessorId"));
        }

        var caches = Query("SELECT Purpose, InstalledSize FROM Win32_CacheMemory");
        var l1 = caches.Where(c => S(c, "Purpose").Contains("L1")).Sum(c => (double)U(c, "InstalledSize"));
        if (l1 > 0 && sec.Groups.Count > 0) sec.Groups[0].Items.Insert(Math.Min(7, sec.Groups[0].Items.Count), new InfoItem("Cache L1", Format.Bytes(l1 * 1024)));

        var ext = new List<string>();
        void X(bool ok, string n) { if (ok) ext.Add(n); }
#if NET
        X(Sse3.IsSupported, "SSE3"); X(Ssse3.IsSupported, "SSSE3"); X(Sse41.IsSupported, "SSE4.1"); X(Sse42.IsSupported, "SSE4.2");
        X(Avx.IsSupported, "AVX"); X(Avx2.IsSupported, "AVX2"); X(Fma.IsSupported, "FMA3"); X(Avx512F.IsSupported, "AVX-512");
        X(System.Runtime.Intrinsics.X86.Aes.IsSupported, "AES-NI"); X(Bmi1.IsSupported, "BMI1"); X(Bmi2.IsSupported, "BMI2");
        X(Popcnt.IsSupported, "POPCNT");
#else
        // .NET Framework (motor do módulo do Piphin Hub): pergunta ao Windows
        X(Pf(13), "SSE3"); X(Pf(36), "SSSE3"); X(Pf(37), "SSE4.1"); X(Pf(38), "SSE4.2");
        X(Pf(39), "AVX"); X(Pf(40), "AVX2"); X(Pf(41), "AVX-512");
#endif
        if (ext.Count > 0) sec.Group("Instruções").Add("Suportadas", string.Join("  ·  ", ext));
        return sec;
    }

    // ------------------------------------------------------------------ placa-mãe
    static InfoSection BoardSection(SystemSummary summary)
    {
        var sec = new InfoSection("Placa-mãe", "");
        var b = Query("SELECT Manufacturer, Product, Version, SerialNumber FROM Win32_BaseBoard").FirstOrDefault();
        if (b != null)
        {
            var man = Clean(S(b, "Manufacturer")); var prod = Clean(S(b, "Product"));
            summary.Board = $"{man} {prod}".Trim();
            sec.Subtitle = summary.Board;
            sec.Group("Placa").Add("Fabricante", man).Add("Modelo", prod).Add("Revisão", Clean(S(b, "Version"))).Add("Número de série", Clean(S(b, "SerialNumber")));
        }
        var bios = Query("SELECT Manufacturer, SMBIOSBIOSVersion, ReleaseDate, SMBIOSMajorVersion, SMBIOSMinorVersion FROM Win32_BIOS").FirstOrDefault();
        if (bios != null)
        {
            var mode = Reg(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control", "PEFirmwareType") switch { "2" => "UEFI", "1" => "Legacy (BIOS)", _ => "" };
            var secure = Reg(@"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\SecureBoot\State", "UEFISecureBootEnabled") switch { "1" => "Ativado", "0" => "Desativado", _ => "" };
            sec.Group("BIOS / UEFI")
               .Add("Fabricante", S(bios, "Manufacturer"))
               .Add("Versão", S(bios, "SMBIOSBIOSVersion"))
               .Add("Data", WmiDate(S(bios, "ReleaseDate")))
               .Add("SMBIOS", $"{S(bios, "SMBIOSMajorVersion")}.{S(bios, "SMBIOSMinorVersion")}")
               .Add("Modo de firmware", mode)
               .Add("Secure Boot", secure);
        }
        var tpm = Query("SELECT SpecVersion, IsEnabled_InitialValue FROM Win32_Tpm", @"root\cimv2\Security\MicrosoftTpm").FirstOrDefault();
        if (tpm != null) sec.Group("Segurança").Add("TPM", "Versão " + S(tpm, "SpecVersion").Split(',').FirstOrDefault());
        return sec;
    }

    // ------------------------------------------------------------------ memória
    static InfoSection MemorySection(SystemSummary summary)
    {
        var sec = new InfoSection("Memória", "");
        var sticks = Query("SELECT * FROM Win32_PhysicalMemory");
        var array = Query("SELECT MemoryDevices, MaxCapacityEx FROM Win32_PhysicalMemoryArray").FirstOrDefault();
        double total = sticks.Sum(s => (double)U(s, "Capacity"));
        summary.RamTotalGb = total / 1024 / 1024 / 1024;
        var type = sticks.Select(s => MemType(U(s, "SMBIOSMemoryType"))).FirstOrDefault(t => t.Length > 0) ?? "";
        var speed = sticks.Select(s => U(s, "ConfiguredClockSpeed")).DefaultIfEmpty(0UL).Max();
        summary.Ram = $"{Format.Bytes(total, 0)} {type}{(speed > 0 ? $" {speed} MT/s" : "")}";
        sec.Subtitle = summary.Ram;

        var g = sec.Group("Resumo")
            .Add("Total instalado", Format.Bytes(total, 0))
            .Add("Tipo", type)
            .Add("Velocidade configurada", speed > 0 ? $"{speed} MT/s" : "")
            .Add("Módulos", sticks.Count.ToString());
        if (array != null)
        {
            g.Add("Slots", S(array, "MemoryDevices"));
            var max = U(array, "MaxCapacityEx");
            if (max > 0) g.Add("Capacidade máxima", Format.Bytes(max * 1024.0, 0));
        }
        var channels = sticks.Count switch { 1 => "Single channel", 2 or 4 => "Dual channel (provável)", _ => "" };
        g.Add("Canais", channels);

        foreach (var s in sticks)
        {
            var slot = S(s, "DeviceLocator");
            var bank = S(s, "BankLabel");
            sec.Group(string.IsNullOrEmpty(bank) ? slot : $"{slot} · {bank}")
               .Add("Capacidade", Format.Bytes(U(s, "Capacity"), 0))
               .Add("Fabricante", Clean(S(s, "Manufacturer")))
               .Add("Part number", Clean(S(s, "PartNumber")))
               .Add("Velocidade nominal", U(s, "Speed") > 0 ? $"{U(s, "Speed")} MT/s" : "")
               .Add("Velocidade atual", U(s, "ConfiguredClockSpeed") > 0 ? $"{U(s, "ConfiguredClockSpeed")} MT/s" : "")
               .Add("Tipo", MemType(U(s, "SMBIOSMemoryType")))
               .Add("Formato", U(s, "FormFactor") switch { 8 => "DIMM", 12 => "SO-DIMM", _ => "" })
               .Add("Tensão", U(s, "ConfiguredVoltage") > 0 ? $"{U(s, "ConfiguredVoltage") / 1000.0:0.00} V" : "")
               .Add("Número de série", Clean(S(s, "SerialNumber")));
        }
        return sec;
    }

    static string MemType(ulong t) => t switch
    {
        20 => "DDR", 21 => "DDR2", 24 => "DDR3", 26 => "DDR4", 27 => "LPDDR", 28 => "LPDDR2",
        29 => "LPDDR3", 30 => "LPDDR4", 34 => "DDR5", 35 => "LPDDR5", _ => ""
    };

    // ------------------------------------------------------------------ GPU
    static InfoSection GpuSection(SystemSummary summary)
    {
        var sec = new InfoSection("Placa de vídeo", "");
        var vram = ReadVramFromRegistry();
        var gpus = Query("SELECT * FROM Win32_VideoController");
        var names = new List<(string Name, ulong Mem)>();
        foreach (var v in gpus)
        {
            var name = S(v, "Name");
            if (name.Contains("Remote Display", StringComparison.OrdinalIgnoreCase) || name.Contains("Basic Display", StringComparison.OrdinalIgnoreCase) && gpus.Count > 1)
                continue;
            ulong mem = vram.TryGetValue(name, out var m) ? m : U(v, "AdapterRAM");
            names.Add((name, mem));
            var w = U(v, "CurrentHorizontalResolution"); var h = U(v, "CurrentVerticalResolution");
            sec.Group(name)
               .Add("Fabricante", S(v, "AdapterCompatibility"))
               .Add("Memória de vídeo", mem > 0 ? Format.Bytes(mem, 0) : "")
               .Add("Processador de vídeo", S(v, "VideoProcessor"))
               .Add("Driver", S(v, "DriverVersion"))
               .Add("Data do driver", WmiDate(S(v, "DriverDate")))
               .Add("Resolução atual", w > 0 ? $"{w} × {h}" : "")
               .Add("Taxa de atualização", U(v, "CurrentRefreshRate") > 0 ? $"{U(v, "CurrentRefreshRate")} Hz" : "")
               .Add("Status", S(v, "Status"));
        }
        // Prefere a GPU dedicada (maior VRAM) no resumo; a integrada vem depois.
        summary.Gpu = names.OrderByDescending(n => n.Mem).Select(n => n.Name).FirstOrDefault() ?? "--";
        var main = names.OrderByDescending(n => n.Mem).FirstOrDefault().Name;
        // Mostra a GPU principal primeiro na lista.
        var idx = sec.Groups.FindIndex(g => g.Header == main);
        if (idx > 0) { var g0 = sec.Groups[idx]; sec.Groups.RemoveAt(idx); sec.Groups.Insert(0, g0); }
        sec.Subtitle = summary.Gpu;
        return sec;
    }

    /// <summary>O WMI limita AdapterRAM a 4 GB; o registro do driver tem o valor real.</summary>
    static Dictionary<string, ulong> ReadVramFromRegistry()
    {
        var result = new Dictionary<string, ulong>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var cls = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}");
            if (cls == null) return result;
            foreach (var sub in cls.GetSubKeyNames().Where(n => n.All(char.IsDigit)))
            {
                try
                {
                    using var k = cls.OpenSubKey(sub);
                    var desc = k?.GetValue("DriverDesc") as string;
                    var raw = k?.GetValue("HardwareInformation.qwMemorySize") ?? k?.GetValue("HardwareInformation.MemorySize");
                    if (desc == null || raw == null) continue;
                    ulong size = raw switch
                    {
                        long l => (ulong)l,
                        int i => (uint)i,
                        byte[] b when b.Length >= 8 => BitConverter.ToUInt64(b, 0),
                        byte[] b when b.Length >= 4 => BitConverter.ToUInt32(b, 0),
                        _ => 0
                    };
                    if (size > 0) result[desc] = size;
                }
                catch { }
            }
        }
        catch { }
        return result;
    }

    // ------------------------------------------------------------------ monitores
    static InfoSection DisplaySection()
    {
        var sec = new InfoSection("Monitores", "");
        var ids = Query("SELECT InstanceName, ManufacturerName, UserFriendlyName, YearOfManufacture FROM WmiMonitorID", @"root\wmi");
        var basics = Query("SELECT InstanceName, MaxHorizontalImageSize, MaxVerticalImageSize FROM WmiMonitorBasicDisplayParams", @"root\wmi");
        var modes = EnumerateDisplays();

        int i = 0;
        foreach (var id in ids)
        {
            var inst = S(id, "InstanceName");
            var name = DecodeWmiString(id["UserFriendlyName"]);
            var man = DecodeWmiString(id["ManufacturerName"]);
            var basic = basics.FirstOrDefault(b => S(b, "InstanceName") == inst);
            string size = "";
            if (basic != null)
            {
                double w = U(basic, "MaxHorizontalImageSize"), h = U(basic, "MaxVerticalImageSize");
                if (w > 0 && h > 0) size = $"{Math.Sqrt(w * w + h * h) / 2.54:0.#}\" ({w:0} × {h:0} cm)";
            }
            var g = sec.Group(string.IsNullOrEmpty(name) ? $"Monitor {i + 1}" : name)
                .Add("Fabricante", man)
                .Add("Tamanho", size)
                .Add("Ano de fabricação", U(id, "YearOfManufacture") > 0 ? U(id, "YearOfManufacture").ToString() : "");
            if (i < modes.Count)
            {
                var m = modes[i];
                g.Add("Resolução", $"{m.Width} × {m.Height}")
                 .Add("Taxa de atualização", $"{m.Hz} Hz")
                 .Add("Profundidade de cor", $"{m.Bits} bits")
                 .Add("Principal", m.Primary ? "Sim" : "Não");
            }
            i++;
        }
        for (; i < modes.Count; i++)
        {
            var m = modes[i];
            sec.Group(m.Device).Add("Resolução", $"{m.Width} × {m.Height}").Add("Taxa de atualização", $"{m.Hz} Hz").Add("Principal", m.Primary ? "Sim" : "Não");
        }
        sec.Subtitle = modes.Count == 1 ? "1 monitor" : $"{modes.Count} monitores";
        return sec;
    }

    static string DecodeWmiString(object? o)
    {
        if (o is ushort[] arr) return new string(arr.TakeWhile(c => c != 0).Select(c => (char)c).ToArray()).Trim();
        return o?.ToString() ?? "";
    }

    record DisplayMode(string Device, int Width, int Height, int Hz, int Bits, bool Primary);

    static List<DisplayMode> EnumerateDisplays()
    {
        var list = new List<DisplayMode>();
        var dd = new DISPLAY_DEVICE { cb = Marshal.SizeOf<DISPLAY_DEVICE>() };
        for (uint i = 0; EnumDisplayDevices(null, i, ref dd, 0); i++)
        {
            if ((dd.StateFlags & 1) != 0) // DISPLAY_DEVICE_ATTACHED_TO_DESKTOP
            {
                var dm = new DEVMODE { dmSize = (short)Marshal.SizeOf<DEVMODE>() };
                if (EnumDisplaySettings(dd.DeviceName, -1, ref dm))
                    list.Add(new DisplayMode(dd.DeviceName, dm.dmPelsWidth, dm.dmPelsHeight, dm.dmDisplayFrequency, dm.dmBitsPerPel, (dd.StateFlags & 4) != 0));
            }
            dd.cb = Marshal.SizeOf<DISPLAY_DEVICE>();
        }
        return list;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplayDevices(string? lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    // ------------------------------------------------------------------ armazenamento
    static InfoSection StorageSection()
    {
        var sec = new InfoSection("Armazenamento", "");
        var disks = Query("SELECT FriendlyName, MediaType, BusType, Size, HealthStatus, SerialNumber, FirmwareVersion, SpindleSpeed FROM MSFT_PhysicalDisk", @"root\Microsoft\Windows\Storage");
        double total = 0;
        foreach (var d in disks)
        {
            var size = U(d, "Size"); total += size;
            var media = U(d, "MediaType") switch { 3 => "HDD", 4 => "SSD", 5 => "SCM", _ => "" };
            var bus = U(d, "BusType") switch
            {
                17 => "NVMe", 11 => "SATA", 7 => "USB", 8 => "RAID", 10 => "SAS", 3 => "ATA", 1 => "SCSI", 12 => "SD", 13 => "MMC", 15 => "Virtual", _ => ""
            };
            var health = U(d, "HealthStatus") switch { 0 => "Saudável", 1 => "Atenção", 2 => "Não saudável", _ => "" };
            var rpm = U(d, "SpindleSpeed");
            sec.Group(S(d, "FriendlyName"))
               .Add("Capacidade", Format.Bytes(size, 0))
               .Add("Tipo", bus == "NVMe" ? "SSD NVMe" : string.Join(" ", new[] { media, bus }.Where(x => x.Length > 0)))
               .Add("Saúde", health)
               .Add("Rotação", rpm is > 0 and < uint.MaxValue ? $"{rpm} RPM" : "")
               .Add("Firmware", S(d, "FirmwareVersion"))
               .Add("Número de série", S(d, "SerialNumber"));
        }

        var vols = sec.Group("Volumes");
        foreach (var drive in DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType is DriveType.Fixed or DriveType.Removable))
        {
            var used = drive.TotalSize - drive.TotalFreeSpace;
            var label = string.IsNullOrEmpty(drive.VolumeLabel) ? "" : $" ({drive.VolumeLabel})";
            vols.Add($"{drive.Name.TrimEnd('\\')}{label}",
                $"{Format.Bytes(used)} usados de {Format.Bytes(drive.TotalSize)} · {Format.Bytes(drive.TotalFreeSpace)} livres · {drive.DriveFormat}");
        }
        sec.Subtitle = $"{disks.Count} disco(s) · {Format.Bytes(total, 0)}";
        return sec;
    }

    // ------------------------------------------------------------------ rede
    static InfoSection NetworkSection()
    {
        var sec = new InfoSection("Rede", "");
        int count = 0;
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces()
                     .Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                     .OrderByDescending(n => n.OperationalStatus == OperationalStatus.Up))
        {
            IPInterfaceProperties? ip = null;
            try { ip = ni.GetIPProperties(); } catch { }
            var ipv4 = ip?.UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork).Select(a => a.Address.ToString()) ?? [];
            var ipv6 = ip?.UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetworkV6 && !a.Address.IsIPv6LinkLocal).Select(a => a.Address.ToString()) ?? [];
            var gw = ip?.GatewayAddresses.Select(g => g.Address.ToString()).Where(a => a != "0.0.0.0") ?? [];
            var dns = ip?.DnsAddresses.Select(d => d.ToString()) ?? [];
            var mac = string.Join(":", ni.GetPhysicalAddress().GetAddressBytes().Select(b => b.ToString("X2")));
            var speed = ni.Speed > 0 ? (ni.Speed >= 1_000_000_000 ? $"{ni.Speed / 1e9:0.#} Gbps" : $"{ni.Speed / 1e6:0} Mbps") : "";
            var up = ni.OperationalStatus == OperationalStatus.Up;
            var isVirtual = ni.Description.Contains("Virtual", StringComparison.OrdinalIgnoreCase) || ni.Description.Contains("Hyper-V", StringComparison.OrdinalIgnoreCase) ||
                            ni.Description.Contains("WAN Miniport", StringComparison.OrdinalIgnoreCase) || ni.Description.Contains("Kernel Debug", StringComparison.OrdinalIgnoreCase) ||
                            ni.Description.Contains("Pseudo", StringComparison.OrdinalIgnoreCase);
            if (isVirtual && !up) continue;
            if (up && !isVirtual) count++;
            sec.Group($"{ni.Name}")
               .Add("Adaptador", ni.Description)
               .Add("Tipo", ni.NetworkInterfaceType switch
               {
                   NetworkInterfaceType.Ethernet or NetworkInterfaceType.GigabitEthernet or NetworkInterfaceType.FastEthernetT => "Ethernet (cabo)",
                   NetworkInterfaceType.Wireless80211 => "Wi-Fi",
                   var t => t.ToString()
               })
               .Add("Status", up ? "Conectado" : "Desconectado")
               .Add("Velocidade do link", up ? speed : "")
               .Add("Endereço MAC", mac)
               .Add("IPv4", string.Join(", ", ipv4))
               .Add("IPv6", string.Join(", ", ipv6))
               .Add("Gateway", string.Join(", ", gw))
               .Add("DNS", string.Join(", ", dns));
        }
        sec.Subtitle = $"{count} conexão(ões) ativa(s)";
        return sec;
    }

    // ------------------------------------------------------------------ áudio
    static InfoSection AudioSection()
    {
        var sec = new InfoSection("Áudio", "");
        var g = sec.Group("Dispositivos");
        foreach (var d in Query("SELECT Name, Manufacturer FROM Win32_SoundDevice"))
            g.Add(S(d, "Name"), S(d, "Manufacturer"));
        sec.Subtitle = $"{g.Items.Count} dispositivo(s)";
        return sec;
    }

    // ------------------------------------------------------------------ bateria
    static InfoSection? BatterySection()
    {
        var bats = Query("SELECT Name, EstimatedChargeRemaining, BatteryStatus, Chemistry FROM Win32_Battery");
        if (bats.Count == 0) return null;
        var sec = new InfoSection("Bateria", "");
        foreach (var b in bats)
        {
            sec.Group(S(b, "Name"))
               .Add("Carga", S(b, "EstimatedChargeRemaining") + " %")
               .Add("Status", U(b, "BatteryStatus") switch { 1 => "Descarregando", 2 => "Na tomada", 3 => "Carregada", 6 or 7 or 8 or 9 => "Carregando", _ => "" })
               .Add("Química", U(b, "Chemistry") switch { 6 => "Li-ion", 8 => "Li-Po", 3 => "Chumbo-ácido", 4 => "NiCd", 5 => "NiMH", _ => "" });
        }
        return sec;
    }

    public static string BuildReport(IEnumerable<InfoSection> sections)
    {
        var sb = new StringBuilder();
        sb.AppendLine("==============================================");
        sb.AppendLine("  INFOHARDWARE — RELATÓRIO DO SISTEMA");
        sb.AppendLine($"  Gerado em {DateTime.Now:dd/MM/yyyy HH:mm:ss}");
        sb.AppendLine("==============================================");
        foreach (var s in sections)
        {
            sb.AppendLine();
            sb.AppendLine($"### {s.Title.ToUpperInvariant()}");
            foreach (var g in s.Groups)
            {
                if (g.HasHeader) sb.AppendLine($"  [{g.Header}]");
                foreach (var i in g.Items) sb.AppendLine($"    {i.Label,-24} {i.Value}");
            }
        }
        return sb.ToString();
    }
}
