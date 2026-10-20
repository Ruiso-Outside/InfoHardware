// Motor de sensores do módulo InfoHardware (Piphin Hub).
// Roda dentro do PowerShell do Windows (start.ps1) e conversa com o módulo por uma conexão TCP local
// (127.0.0.1) protegida por um código: o módulo pode iniciar o motor como administrador (UAC), e um
// processo elevado não consegue usar a saída padrão de quem o abriu.
//
// Protocolo: uma mensagem JSON por linha.
//   motor -> módulo: hello, structure, snap, info, error
//   módulo -> motor: {"cmd":"interval","ms":1000} | {"cmd":"reset"} | {"cmd":"info"} | {"cmd":"quit"}
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using InfoHardware.Services;
using Microsoft.Win32;

namespace InfoHardware.Engine;

public static class Host
{
    static string _dir = "";

    /// <summary>Ponto de entrada (chamado pelo start.ps1).</summary>
    public static void Run(string dir, int port, string token, int parentPid)
    {
        _dir = dir;
        // as dependências ficam na mesma pasta; carrega sem a restrição de "arquivo baixado da internet"
        AppDomain.CurrentDomain.AssemblyResolve += (_, e) =>
        {
            var file = Path.Combine(_dir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(file) ? Assembly.UnsafeLoadFrom(file) : null;
        };
        Serve(port, token, parentPid);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Serve(int port, string token, int parentPid)
    {
        // encerra junto com o módulo que o abriu (mesmo se ele cair)
        if (parentPid > 0)
        {
            new Thread(() =>
            {
                try { Process.GetProcessById(parentPid).WaitForExit(); } catch { /* já saiu */ }
                System.Environment.Exit(0);
            }) { IsBackground = true }.Start();
        }

        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        var accept = listener.AcceptTcpClientAsync();
        if (!accept.Wait(TimeSpan.FromSeconds(60))) System.Environment.Exit(2);
        listener.Stop();
        using var client = accept.Result;
        client.NoDelay = true;
        var stream = client.GetStream();
        var reader = new StreamReader(stream, new UTF8Encoding(false));
        var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        if (reader.ReadLine() != token) System.Environment.Exit(3);

        new Session(writer).Run(reader);
        System.Environment.Exit(0);
    }
}

sealed class Session(StreamWriter writer)
{
    static readonly JsonSerializerOptions Json = new()
    {
        IncludeFields = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    readonly object _send = new();
    readonly HardwareMonitor _hw = new();
    readonly FpsMonitor _fps = new();

    void Send(object msg)
    {
        var line = JsonSerializer.Serialize(msg, Json);
        lock (_send)
        {
            try { writer.WriteLine(line); }
            catch { System.Environment.Exit(0); } // módulo fechou a conexão
        }
    }

    public void Run(StreamReader reader)
    {
        bool admin = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        bool fps = admin && _fps.Start();
        Send(new
        {
            t = "hello",
            admin,
            fps,
            fpsError = fps ? null : _fps.Error,
            pawnIo = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO") != null,
            version = typeof(Host).Assembly.GetName().Version.ToString(3),
        });

        _hw.StructureChanged += groups => Send(new
        {
            t = "structure",
            groups = groups.Select(g => new
            {
                name = g.Name,
                type = g.Type.ToString(),
                sensors = g.Sensors.Select(s => new { id = s.Id, name = s.Name, type = s.Type.ToString(), index = s.Index }),
            }),
        });
        _hw.Updated += snap =>
        {
            var f = fps ? _fps.Sample() : default;
            Send(new
            {
                t = "snap",
                at = DateTime.Now,
                hw = new
                {
                    snap.CpuName, snap.GpuName, snap.CpuLoad, snap.CpuTemp, snap.CpuClock, snap.CpuPower, snap.CoreLoads,
                    snap.GpuLoad, snap.GpuTemp, snap.GpuHotspot, snap.GpuClock, snap.GpuMemClock, snap.GpuPower, snap.GpuFan,
                    snap.VramUsedMb, snap.VramTotalMb, snap.RamUsedGb, snap.RamAvailableGb, snap.RamLoad,
                    snap.DiskRead, snap.DiskWrite, snap.DiskTemp, snap.DiskActivity, snap.NetUp, snap.NetDown,
                },
                // sensores: id -> [valor, mín, máx]
                sensors = snap.Sensors.ToDictionary(kv => kv.Key, kv => new[] { kv.Value.Value, kv.Value.Min, kv.Value.Max }),
                fps = fps ? new { fps = f.Fps, frameTime = f.FrameTimeMs, low1 = f.Low1Fps, process = f.ProcessName, foreground = f.IsForeground } : null,
                error = _hw.Error,
            });
        };
        _hw.Start();

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                var cmd = doc.RootElement.GetProperty("cmd").GetString();
                switch (cmd)
                {
                    case "interval":
                        _hw.IntervalMs = Math.Max(250, Math.Min(5000, doc.RootElement.GetProperty("ms").GetInt32()));
                        _hw.Poke();
                        break;
                    case "reset": _hw.ResetMinMax(); break;
                    case "info":
                        new Thread(() =>
                        {
                            var (sections, summary) = SystemInfoService.Collect();
                            Send(new { t = "info", sections, summary, report = SystemInfoService.BuildReport(sections) });
                        }) { IsBackground = true }.Start();
                        break;
                    case "quit": return;
                }
            }
            catch (Exception ex) { Send(new { t = "error", message = ex.Message }); }
        }
    }
}
