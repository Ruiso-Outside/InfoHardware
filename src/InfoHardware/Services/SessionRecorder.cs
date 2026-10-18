using System.Collections.ObjectModel;
using System.Globalization;
using InfoHardware.Core;

namespace InfoHardware.Services;

public sealed record SessionStat(string Name, string Min, string Avg, string Max);

/// <summary>Grava uma sessão (ex.: uma partida) em CSV e calcula mín/méd/máx de cada métrica.</summary>
public sealed class SessionRecorder : ObservableObject
{
    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "InfoHardware", "Sessoes");

    readonly Metric[] _metrics;
    readonly Func<string?> _process;
    StreamWriter? _writer;
    DateTime _start;
    double[] _min = [], _max = [], _sum = [];
    int[] _n = [];
    bool _isRecording;
    string _elapsed = "00:00:00";
    string? _lastFile;
    string _lastDuration = "";

    public SessionRecorder(Metric[] metrics, Func<string?> process)
    {
        _metrics = metrics;
        _process = process;
    }

    public bool IsRecording { get => _isRecording; private set => Set(ref _isRecording, value); }
    public string Elapsed { get => _elapsed; private set => Set(ref _elapsed, value); }
    public string? LastFile { get => _lastFile; private set { Set(ref _lastFile, value); OnPropertyChanged(nameof(HasSummary)); } }
    public string LastDuration { get => _lastDuration; private set => Set(ref _lastDuration, value); }
    public bool HasSummary => LastFile != null;
    public ObservableCollection<SessionStat> Summary { get; } = [];

    public void Toggle()
    {
        if (IsRecording) Stop(); else Start();
    }

    public void Start()
    {
        if (IsRecording) return;
        Directory.CreateDirectory(Folder);
        var file = Path.Combine(Folder, $"sessao_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.csv");
        _writer = new StreamWriter(file, false, new System.Text.UTF8Encoding(true));
        _writer.WriteLine("Hora;Processo;" + string.Join(";", _metrics.Select(m => m.Unit.Length > 0 ? $"{m.Name} ({m.Unit})" : m.Name)));
        int c = _metrics.Length;
        _min = Enumerable.Repeat(double.MaxValue, c).ToArray();
        _max = Enumerable.Repeat(double.MinValue, c).ToArray();
        _sum = new double[c];
        _n = new int[c];
        _start = DateTime.Now;
        LastFile = null;
        Summary.Clear();
        _pendingFile = file;
        Elapsed = "00:00:00";
        IsRecording = true;
    }

    string? _pendingFile;

    public void Record()
    {
        if (!IsRecording || _writer == null) return;
        var culture = CultureInfo.CurrentCulture;
        var cells = new string[_metrics.Length];
        for (int i = 0; i < _metrics.Length; i++)
        {
            if (_metrics[i].Value is double v)
            {
                cells[i] = v.ToString("0.##", culture);
                if (v < _min[i]) _min[i] = v;
                if (v > _max[i]) _max[i] = v;
                _sum[i] += v; _n[i]++;
            }
            else cells[i] = "";
        }
        _writer.WriteLine($"{DateTime.Now:HH:mm:ss};{_process()};{string.Join(";", cells)}");
        Elapsed = (DateTime.Now - _start).ToString(@"hh\:mm\:ss");
    }

    public void Stop()
    {
        if (!IsRecording) return;
        IsRecording = false;
        _writer?.Flush();
        _writer?.Dispose();
        _writer = null;
        for (int i = 0; i < _metrics.Length; i++)
        {
            var m = _metrics[i];
            if (_n[i] == 0) continue;
            string F(double v) => m.TextFor(v);
            Summary.Add(new SessionStat(m.Name, F(_min[i]), F(_sum[i] / _n[i]), F(_max[i])));
        }
        LastDuration = (DateTime.Now - _start).ToString(@"hh\:mm\:ss");
        LastFile = _pendingFile;
    }
}

static class MetricExtensions
{
    public static string TextFor(this Metric m, double v) => m.Unit.Length > 0 ? $"{m.FormatValue(v)} {m.Unit}" : m.FormatValue(v);
}
