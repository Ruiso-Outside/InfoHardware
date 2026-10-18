using System.Windows.Media;

namespace InfoHardware.Core;

/// <summary>Buffer circular de amostras para os gráficos em tempo real.</summary>
public sealed class SeriesBuffer(int capacity, Color color)
{
    readonly double[] _data = new double[capacity];
    int _start, _count;

    public Color Color { get; } = color;
    public int Capacity => _data.Length;
    public int Count => _count;
    public double this[int i] => _data[(_start + i) % _data.Length];

    public event Action? Changed;

    public void Push(double value)
    {
        if (_count < _data.Length) _data[(_start + _count++) % _data.Length] = value;
        else { _data[_start] = value; _start = (_start + 1) % _data.Length; }
        Changed?.Invoke();
    }

    public (double Min, double Max, double Avg, bool Any) Stats()
    {
        double min = double.MaxValue, max = double.MinValue, sum = 0; int n = 0;
        for (int i = 0; i < _count; i++)
        {
            var v = this[i];
            if (double.IsNaN(v)) continue;
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v; n++;
        }
        return n == 0 ? (double.NaN, double.NaN, double.NaN, false) : (min, max, sum / n, true);
    }
}

/// <summary>Uma métrica ao vivo (valor atual + histórico + texto formatado).</summary>
public sealed class Metric : ObservableObject
{
    readonly Func<double, string> _fmt;
    double? _value;
    double _gaugeMax;

    public Metric(string name, string unit, Color color, string format = "0", double gaugeMax = 100,
        Func<double, string>? formatter = null, int capacity = 120)
    {
        Name = name;
        Unit = unit;
        _gaugeMax = gaugeMax;
        _fmt = formatter ?? (v => Format.Num(v, format));
        Series = new SeriesBuffer(capacity, color);
        Brush = new SolidColorBrush(color);
        Brush.Freeze();
    }

    public string Name { get; }
    public string Unit { get; }
    public SeriesBuffer Series { get; }
    public SolidColorBrush Brush { get; }
    /// <summary>Quando o formatador já inclui a unidade (ex.: MB/s), a unidade separada fica vazia.</summary>
    public bool HasCustomFormatter => Unit.Length == 0;

    public double? Value => _value;
    public bool HasValue => _value.HasValue;
    public string Text => _value is double v ? _fmt(v) : "--";
    public string TextWithUnit => _value is double v ? (Unit.Length > 0 ? _fmt(v) + " " + Unit : _fmt(v)) : "--";
    public double GaugeValue => _value ?? 0;
    public double GaugeMax { get => _gaugeMax; set => Set(ref _gaugeMax, value); }

    public string StatsText
    {
        get
        {
            var s = Series.Stats();
            return s.Any ? $"mín {_fmt(s.Min)} · méd {_fmt(s.Avg)} · máx {_fmt(s.Max)}" : "sem dados";
        }
    }

    public string FormatValue(double v) => double.IsNaN(v) ? "--" : _fmt(v);

    public void Set(double? value)
    {
        if (value is double d && (double.IsNaN(d) || double.IsInfinity(d))) value = null;
        _value = value;
        Series.Push(value ?? double.NaN);
        OnPropertyChanged(nameof(Value));
        OnPropertyChanged(nameof(HasValue));
        OnPropertyChanged(nameof(Text));
        OnPropertyChanged(nameof(TextWithUnit));
        OnPropertyChanged(nameof(GaugeValue));
        OnPropertyChanged(nameof(StatsText));
    }
}
