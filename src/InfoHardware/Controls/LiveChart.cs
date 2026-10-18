using System.Globalization;
using System.Windows;
using System.Windows.Media;
using InfoHardware.Core;

namespace InfoHardware.Controls;

/// <summary>Gráfico de linha em tempo real (área com gradiente + linha com brilho neon).</summary>
public sealed class LiveChart : FrameworkElement
{
    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IEnumerable<SeriesBuffer>), typeof(LiveChart), new PropertyMetadata(null, OnSeriesChanged));
    public static readonly DependencyProperty MaximumProperty = DependencyProperty.Register(
        nameof(Maximum), typeof(double), typeof(LiveChart), new FrameworkPropertyMetadata(double.NaN, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ShowScaleProperty = DependencyProperty.Register(
        nameof(ShowScale), typeof(bool), typeof(LiveChart), new FrameworkPropertyMetadata(true, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ScaleFormatterProperty = DependencyProperty.Register(
        nameof(ScaleFormatter), typeof(Func<double, string>), typeof(LiveChart), new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

    static readonly Pen GridPen = Frozen(new Pen(new SolidColorBrush(Color.FromArgb(30, 0xB4, 0x7C, 0xFF)), 1) { DashStyle = new DashStyle([3, 4], 0) });
    static readonly Brush ScaleBrush = Frozen(new SolidColorBrush(Color.FromArgb(150, 0x9A, 0x8B, 0xBF)));
    static readonly Typeface Face = new(new FontFamily("Bahnschrift"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);

    public IEnumerable<SeriesBuffer>? Series { get => (IEnumerable<SeriesBuffer>?)GetValue(SeriesProperty); set => SetValue(SeriesProperty, value); }
    /// <summary>Escala fixa; NaN = automática.</summary>
    public double Maximum { get => (double)GetValue(MaximumProperty); set => SetValue(MaximumProperty, value); }
    public bool ShowScale { get => (bool)GetValue(ShowScaleProperty); set => SetValue(ShowScaleProperty, value); }
    public Func<double, string>? ScaleFormatter { get => (Func<double, string>?)GetValue(ScaleFormatterProperty); set => SetValue(ScaleFormatterProperty, value); }

    bool _pending;

    public LiveChart()
    {
        IsVisibleChanged += (_, _) => { if (IsVisible) InvalidateVisual(); };
    }

    static T Frozen<T>(T f) where T : Freezable { f.Freeze(); return f; }

    static void OnSeriesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var c = (LiveChart)d;
        if (e.OldValue is IEnumerable<SeriesBuffer> old) foreach (var s in old) s.Changed -= c.OnData;
        if (e.NewValue is IEnumerable<SeriesBuffer> nw) foreach (var s in nw) s.Changed += c.OnData;
        c.InvalidateVisual();
    }

    void OnData()
    {
        // Várias séries mudam no mesmo ciclo: agrupa em um único redesenho.
        if (_pending || !IsVisible) return;
        _pending = true;
        Dispatcher.BeginInvoke(() => { _pending = false; InvalidateVisual(); }, System.Windows.Threading.DispatcherPriority.Render);
    }

    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight;
        if (w < 4 || h < 4) return;
        dc.DrawRectangle(Brushes.Transparent, null, new Rect(0, 0, w, h));

        for (int i = 1; i < 4; i++)
        {
            double y = Math.Round(h * i / 4) + 0.5;
            dc.DrawLine(GridPen, new Point(0, y), new Point(w, y));
        }

        var series = Series?.ToList();
        if (series == null || series.Count == 0) return;

        double max = Maximum;
        if (double.IsNaN(max))
        {
            max = 0;
            foreach (var s in series)
                for (int i = 0; i < s.Count; i++) if (!double.IsNaN(s[i]) && s[i] > max) max = s[i];
            max = NiceCeiling(max * 1.1);
        }
        if (max <= 0) max = 1;

        dc.PushClip(new RectangleGeometry(new Rect(0, 0, w, h)));
        foreach (var s in series) DrawSeries(dc, s, w, h, max);
        dc.Pop();

        if (ShowScale)
        {
            double dpi = VisualTreeHelper.GetDpi(this).PixelsPerDip;
            var text = ScaleFormatter?.Invoke(max) ?? max.ToString("0.##", CultureInfo.CurrentCulture);
            var ft = new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Face, 10, ScaleBrush, dpi);
            dc.DrawText(ft, new Point(4, 2));
        }
    }

    static void DrawSeries(DrawingContext dc, SeriesBuffer s, double w, double h, double max)
    {
        if (s.Count < 2) return;
        double step = w / (s.Capacity - 1);
        double x0 = w - (s.Count - 1) * step;
        double Y(double v) => h - Math.Clamp(v / max, 0, 1) * (h - 4) - 1;

        var line = new StreamGeometry();
        var area = new StreamGeometry();
        using (var lc = line.Open())
        using (var ac = area.Open())
        {
            bool open = false;
            double segStartX = 0, lastX = 0;
            var pts = new List<Point>();
            void Flush()
            {
                if (pts.Count >= 2)
                {
                    lc.BeginFigure(pts[0], false, false);
                    lc.PolyLineTo(pts.Skip(1).ToList(), true, true);
                    ac.BeginFigure(new Point(segStartX, h), true, true);
                    ac.PolyLineTo(pts, false, false);
                    ac.LineTo(new Point(lastX, h), false, false);
                }
                pts.Clear();
                open = false;
            }
            for (int i = 0; i < s.Count; i++)
            {
                double v = s[i];
                double x = x0 + i * step;
                if (double.IsNaN(v)) { Flush(); continue; }
                if (!open) { segStartX = x; open = true; }
                pts.Add(new Point(x, Y(v)));
                lastX = x;
            }
            Flush();
        }
        line.Freeze();
        area.Freeze();

        var c = s.Color;
        var fill = new LinearGradientBrush(Color.FromArgb(95, c.R, c.G, c.B), Color.FromArgb(0, c.R, c.G, c.B), 90);
        fill.Freeze();
        dc.DrawGeometry(fill, null, area);

        var glow1 = new Pen(new SolidColorBrush(Color.FromArgb(28, c.R, c.G, c.B)), 9) { LineJoin = PenLineJoin.Round };
        var glow2 = new Pen(new SolidColorBrush(Color.FromArgb(60, c.R, c.G, c.B)), 4.5) { LineJoin = PenLineJoin.Round };
        var pen = new Pen(new SolidColorBrush(c), 2) { LineJoin = PenLineJoin.Round };
        dc.DrawGeometry(null, glow1, line);
        dc.DrawGeometry(null, glow2, line);
        dc.DrawGeometry(null, pen, line);

        double last = s[s.Count - 1];
        if (!double.IsNaN(last))
        {
            var p = new Point(w - 1, Y(last));
            dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(80, c.R, c.G, c.B)), null, p, 6, 6);
            dc.DrawEllipse(Brushes.White, null, p, 2.5, 2.5);
        }
    }

    static double NiceCeiling(double v)
    {
        if (v <= 0) return 1;
        double exp = Math.Pow(10, Math.Floor(Math.Log10(v)));
        double f = v / exp;
        double nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
        return nice * exp;
    }
}
