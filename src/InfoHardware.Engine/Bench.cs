// Teste de desempenho do processador (benchmark) do InfoHardware.
// Três medições curtas: um núcleo, todos os núcleos e memória. O resultado é "trabalho por segundo";
// a nota (comparada a um PC de referência) é calculada no módulo, onde fica fácil de ajustar.
using System.Diagnostics;
using System.Management;
using System.Threading;

namespace InfoHardware.Engine;

sealed class BenchResult
{
    public double Single { get; set; }       // unidades de trabalho por segundo (1 thread)
    public double Multi { get; set; }        // unidades de trabalho por segundo (todas as threads)
    public int Threads { get; set; }
    public double MemoryGBs { get; set; }    // cópia de memória, GB/s
    public long DurationMs { get; set; }
}

static class Bench
{
    const int SingleMs = 4000, MultiMs = 5000, MemoryMs = 3000;

    // Uma "unidade de trabalho": um pedaço de Mandelbrot (ponto flutuante) + um bloco de inteiros (xorshift,
    // multiplicação, divisão, deslocamentos). Mistura parecida com o que programas e jogos fazem.
    static double Unit(ref ulong seed)
    {
        double acc = 0;
        for (int py = 0; py < 16; py++)
        {
            double ci = -1.2 + py * 0.15;
            for (int px = 0; px < 16; px++)
            {
                double cr = -2.0 + px * 0.16, zr = 0, zi = 0;
                int n = 0;
                while (n < 64 && zr * zr + zi * zi < 4) { double t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; n++; }
                acc += n;
            }
        }
        ulong x = seed;
        for (int i = 0; i < 2048; i++)
        {
            x ^= x << 13; x ^= x >> 7; x ^= x << 17;
            x = x * 2862933555777941757UL + 3037000493UL;
            acc += (double)((x >> 33) % 1009);
        }
        seed = x;
        return acc;
    }

    static double Run(int threads, int ms, CancellationToken ct, Action<double> progress)
    {
        long total = 0;
        var sw = Stopwatch.StartNew();
        var workers = new Thread[threads];
        for (int t = 0; t < threads; t++)
        {
            ulong seed = (ulong)(0x9E3779B97F4A7C15UL * (ulong)(t + 1));
            workers[t] = new Thread(() =>
            {
                long done = 0; double sink = 0;
                while (sw.ElapsedMilliseconds < ms && !ct.IsCancellationRequested) { sink += Unit(ref seed); done++; }
                Interlocked.Add(ref total, done);
                if (sink == double.MinValue) Console.WriteLine(); // impede o compilador de descartar o cálculo
            }) { IsBackground = true }; // prioridade normal: os sensores continuam medindo durante o teste
        }
        foreach (var w in workers) w.Start();
        while (workers.Any(w => w.IsAlive)) { Thread.Sleep(100); progress(Math.Min(1, sw.ElapsedMilliseconds / (double)ms)); }
        return total / (sw.ElapsedMilliseconds / 1000.0);
    }

    static double Memory(CancellationToken ct, Action<double> progress)
    {
        const int size = 64 * 1024 * 1024; // 64 MB por bloco: bem maior que o cache do processador
        var a = new byte[size];
        var b = new byte[size];
        for (int i = 0; i < size; i += 4096) a[i] = (byte)i; // toca as páginas antes de medir
        Buffer.BlockCopy(a, 0, b, 0, size);
        long bytes = 0;
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < MemoryMs && !ct.IsCancellationRequested)
        {
            Buffer.BlockCopy(a, 0, b, 0, size);
            Buffer.BlockCopy(b, 0, a, 0, size);
            bytes += 2L * size * 2; // cada cópia lê e escreve
            progress(Math.Min(1, sw.ElapsedMilliseconds / (double)MemoryMs));
        }
        return bytes / sw.Elapsed.TotalSeconds / 1e9;
    }

    /// <summary>Roda os três testes; phase(nome, 0..1) informa o andamento.</summary>
    public static BenchResult RunAll(Action<string, double> phase, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var r = new BenchResult { Threads = System.Environment.ProcessorCount };
        Run(1, 400, ct, _ => { }); // aquecimento (JIT e frequência do processador)
        phase("single", 0);
        r.Single = Run(1, SingleMs, ct, p => phase("single", p));
        phase("multi", 0);
        r.Multi = Run(r.Threads, MultiMs, ct, p => phase("multi", p));
        phase("memory", 0);
        r.MemoryGBs = Memory(ct, p => phase("memory", p));
        r.DurationMs = sw.ElapsedMilliseconds;
        GC.Collect();
        return r;
    }

    // ------------------------------------------------------------------ dados do PC para as dicas de melhoria
    static string Q(ManagementBaseObject o, string p) { try { return Convert.ToString(o[p]) ?? ""; } catch { return ""; } }
    static long N(ManagementBaseObject o, string p) { try { return Convert.ToInt64(o[p] ?? 0); } catch { return 0; } }

    public static Dictionary<string, object?> Checks()
    {
        var f = new Dictionary<string, object?>();
        try
        {
            var mods = new List<object>();
            using var s = new ManagementObjectSearcher("SELECT Capacity, Speed, ConfiguredClockSpeed, SMBIOSMemoryType, DeviceLocator, PartNumber FROM Win32_PhysicalMemory");
            foreach (var m in s.Get())
                mods.Add(new { slot = Q(m, "DeviceLocator"), gb = N(m, "Capacity") / 1073741824.0, speed = N(m, "Speed"), configured = N(m, "ConfiguredClockSpeed"),
                    type = N(m, "SMBIOSMemoryType") switch { 26 => "DDR4", 34 => "DDR5", 24 => "DDR3", _ => "" }, part = Q(m, "PartNumber").Trim() });
            f["memory"] = mods;
        }
        catch { /* WMI indisponível */ }
        try
        {
            // disco do Windows: SSD ou HD, NVMe ou SATA, espaço livre
            var sys = Path.GetPathRoot(System.Environment.GetFolderPath(System.Environment.SpecialFolder.Windows)) ?? "C:\\";
            var di = new DriveInfo(sys);
            f["systemDrive"] = new { letter = sys.Substring(0, 2), freeGB = di.AvailableFreeSpace / 1073741824.0, totalGB = di.TotalSize / 1073741824.0 };
            var scope = new ManagementScope(@"\\.\root\Microsoft\Windows\Storage");
            using var ps = new ManagementObjectSearcher(scope, new ObjectQuery($"SELECT DiskNumber FROM MSFT_Partition WHERE DriveLetter='{sys[0]}'"));
            foreach (var p in ps.Get())
            {
                using var ds = new ManagementObjectSearcher(scope, new ObjectQuery($"SELECT MediaType, BusType, FriendlyName FROM MSFT_PhysicalDisk WHERE DeviceId='{N(p, "DiskNumber")}'"));
                foreach (var d in ds.Get())
                    f["systemDisk"] = new { name = Q(d, "FriendlyName"), media = N(d, "MediaType") switch { 3 => "HDD", 4 => "SSD", _ => "" }, bus = N(d, "BusType") switch { 17 => "NVMe", 11 => "SATA", 7 => "USB", _ => "" } };
                break;
            }
        }
        catch { /* sem acesso ao armazenamento */ }
        try
        {
            using var s = new ManagementObjectSearcher("SELECT Command FROM Win32_StartupCommand");
            f["startupApps"] = s.Get().Count;
        }
        catch { }
        try
        {
            var gpus = new List<object>();
            using var s = new ManagementObjectSearcher("SELECT Name, DriverVersion, DriverDate FROM Win32_VideoController");
            foreach (var g in s.Get())
            {
                var date = Q(g, "DriverDate");
                DateTime? dt = date.Length >= 8 && DateTime.TryParseExact(date.Substring(0, 8), "yyyyMMdd", null, System.Globalization.DateTimeStyles.None, out var d) ? d : null;
                gpus.Add(new { name = Q(g, "Name"), driver = Q(g, "DriverVersion"), driverDate = dt?.ToString("yyyy-MM-dd") });
            }
            f["gpus"] = gpus;
        }
        catch { }
        return f;
    }
}
