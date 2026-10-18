using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Session;

namespace InfoHardware.Services;

public readonly record struct FpsSample(double? Fps, double? FrameTimeMs, double? Low1Fps, string? ProcessName, bool IsForeground);

/// <summary>
/// Mede FPS escutando os eventos de Present do DirectX (DXGI / D3D9) via ETW, como o PresentMon.
/// Funciona em jogos DirectX 9/10/11/12 (e Vulkan/OpenGL quando apresentados via DXGI). Requer administrador.
/// </summary>
public sealed class FpsMonitor : IDisposable
{
    static readonly Guid DxgiProvider = new("CA11C036-0102-4A2D-A6AD-F03CFED5D3C9");
    static readonly Guid D3D9Provider = new("783ACA0A-790E-4D7F-8451-AA850511C6B9");
    const string SessionName = "InfoHardware-FPS";
    const double WindowMs = 1000;
    const double LowWindowMs = 10000;

    readonly int _selfPid = Environment.ProcessId;
    readonly object _lock = new();
    readonly Dictionary<int, Queue<double>> _presents = [];
    readonly Dictionary<int, string> _names = [];
    readonly Stopwatch _clock = Stopwatch.StartNew();
    TraceEventSession? _session;
    double _lastEventMs;
    double _lastEventClockMs;

    public bool IsRunning { get; private set; }
    public string? Error { get; private set; }

    public bool Start()
    {
        if (IsRunning) return true;
        if (TraceEventSession.IsElevated() != true)
        {
            Error = "Execute o InfoHardware como administrador para medir o FPS.";
            return false;
        }
        try
        {
            _session = new TraceEventSession(SessionName) { StopOnDispose = true };
            _session.EnableProvider(DxgiProvider, TraceEventLevel.Informational);
            _session.EnableProvider(D3D9Provider, TraceEventLevel.Informational);
            _session.Source.AllEvents += OnEvent;
            var t = new Thread(() =>
            {
                try { _session.Source.Process(); }
                catch (Exception ex) { Error = ex.Message; IsRunning = false; }
            }) { IsBackground = true, Name = "FpsMonitor" };
            t.Start();
            IsRunning = true;
            Error = null;
            return true;
        }
        catch (Exception ex)
        {
            Error = "Não foi possível iniciar a captura de FPS: " + ex.Message;
            return false;
        }
    }

    void OnEvent(TraceEvent e)
    {
        int id = (int)e.ID;
        bool isPresent = (e.ProviderGuid == DxgiProvider && (id == 42 || id == 55)) ||
                         (e.ProviderGuid == D3D9Provider && id == 1);
        if (!isPresent || e.ProcessID == _selfPid || e.ProcessID <= 4) return;

        double ts = e.TimeStampRelativeMSec;
        lock (_lock)
        {
            if (!_presents.TryGetValue(e.ProcessID, out var q))
                _presents[e.ProcessID] = q = new Queue<double>(512);
            q.Enqueue(ts);
            while (q.Count > 0 && ts - q.Peek() > LowWindowMs) q.Dequeue();
            _lastEventMs = ts;
            _lastEventClockMs = _clock.Elapsed.TotalMilliseconds;
        }
    }

    public FpsSample Sample()
    {
        if (!IsRunning) return default;
        int fgPid = GetForegroundPid();

        lock (_lock)
        {
            // "Agora" no relógio do ETW = último evento + tempo decorrido desde que ele chegou.
            double now = _lastEventMs + (_clock.Elapsed.TotalMilliseconds - _lastEventClockMs);

            foreach (var pid in _presents.Where(kv => kv.Value.Count == 0 || now - kv.Value.Last() > LowWindowMs).Select(kv => kv.Key).ToList())
            {
                _presents.Remove(pid);
                _names.Remove(pid);
            }

            int CountRecent(Queue<double> q) => q.Count(t => now - t <= WindowMs);

            int target = -1; bool isFg = false;
            if (fgPid > 0 && _presents.TryGetValue(fgPid, out var fq) && CountRecent(fq) > 0)
            {
                target = fgPid; isFg = true;
            }
            else
            {
                int best = 0;
                foreach (var (pid, q) in _presents)
                {
                    int c = CountRecent(q);
                    if (c > best) { best = c; target = pid; }
                }
            }
            if (target < 0) return new FpsSample(null, null, null, null, false);

            var times = _presents[target].ToArray();
            var recent = times.Where(t => now - t <= WindowMs).ToArray();
            double fps = recent.Length;
            double? frameTime = null;
            if (recent.Length >= 2) frameTime = (recent[^1] - recent[0]) / (recent.Length - 1);
            else if (fps > 0) frameTime = 1000.0 / fps;
            if (recent.Length >= 2) fps = 1000.0 / frameTime!.Value;

            // 1% low: média dos 1% piores frametimes nos últimos 10 s.
            double? low1 = null;
            if (times.Length > 20)
            {
                var deltas = new double[times.Length - 1];
                for (int i = 1; i < times.Length; i++) deltas[i - 1] = times[i] - times[i - 1];
                Array.Sort(deltas);
                int n = Math.Max(1, deltas.Length / 100);
                double worst = 0;
                for (int i = deltas.Length - n; i < deltas.Length; i++) worst += deltas[i];
                worst /= n;
                if (worst > 0) low1 = Math.Min(fps, 1000.0 / worst);
            }

            return new FpsSample(fps, frameTime, low1, NameOf(target), isFg);
        }
    }

    string NameOf(int pid)
    {
        if (_names.TryGetValue(pid, out var n)) return n;
        try { n = Process.GetProcessById(pid).ProcessName + ".exe"; }
        catch { n = $"PID {pid}"; }
        _names[pid] = n;
        return n;
    }

    static int GetForegroundPid()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return -1;
        GetWindowThreadProcessId(hwnd, out var pid);
        return (int)pid;
    }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public void Dispose()
    {
        IsRunning = false;
        try { _session?.Dispose(); } catch { }
    }
}
