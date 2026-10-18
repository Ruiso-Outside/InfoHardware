using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace InfoHardware.Controls;

/// <summary>Medidor em arco de 270° com brilho neon e animação suave.</summary>
public sealed class ArcGauge : FrameworkElement
{
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(double), typeof(ArcGauge), new PropertyMetadata(0.0, OnValueChanged));
    public static readonly DependencyProperty MaximumProperty = DependencyProperty.Register(
        nameof(Maximum), typeof(double), typeof(ArcGauge), new FrameworkPropertyMetadata(100.0, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ThicknessProperty = DependencyProperty.Register(
        nameof(Thickness), typeof(double), typeof(ArcGauge), new FrameworkPropertyMetadata(12.0, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ColorFromProperty = DependencyProperty.Register(
        nameof(ColorFrom), typeof(Color), typeof(ArcGauge), new FrameworkPropertyMetadata(Color.FromRgb(0xA8, 0x55, 0xF7), FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ColorToProperty = DependencyProperty.Register(
        nameof(ColorTo), typeof(Color), typeof(ArcGauge), new FrameworkPropertyMetadata(Color.FromRgb(0xFF, 0x3C, 0xAC), FrameworkPropertyMetadataOptions.AffectsRender));
    static readonly DependencyProperty DisplayValueProperty = DependencyProperty.Register(
        "DisplayValue", typeof(double), typeof(ArcGauge), new FrameworkPropertyMetadata(0.0, FrameworkPropertyMetadataOptions.AffectsRender));

    const double StartAngle = 135, Sweep = 270;

    public double Value { get => (double)GetValue(ValueProperty); set => SetValue(ValueProperty, value); }
    public double Maximum { get => (double)GetValue(MaximumProperty); set => SetValue(MaximumProperty, value); }
    public double Thickness { get => (double)GetValue(ThicknessProperty); set => SetValue(ThicknessProperty, value); }
    public Color ColorFrom { get => (Color)GetValue(ColorFromProperty); set => SetValue(ColorFromProperty, value); }
    public Color ColorTo { get => (Color)GetValue(ColorToProperty); set => SetValue(ColorToProperty, value); }

    static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var g = (ArcGauge)d;
        var anim = new DoubleAnimation((double)e.NewValue, TimeSpan.FromMilliseconds(550))
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
        };
        g.BeginAnimation(DisplayValueProperty, anim, HandoffBehavior.SnapshotAndReplace);
    }

    protected override Size MeasureOverride(Size availableSize)
    {
        double s = Math.Min(double.IsInfinity(availableSize.Width) ? 160 : availableSize.Width,
                            double.IsInfinity(availableSize.Height) ? 160 : availableSize.Height);
        return new Size(s, s);
    }

    protected override void OnRender(DrawingContext dc)
    {
        double size = Math.Min(ActualWidth, ActualHeight);
        if (size < 10) return;
        var center = new Point(ActualWidth / 2, ActualHeight / 2);
        double t = Thickness;
        double radius = size / 2 - t / 2 - 8;

        // Marcações externas
        var tickPen = new Pen(new SolidColorBrush(Color.FromArgb(70, 0xA8, 0x55, 0xF7)), 1.2);
        tickPen.Freeze();
        for (int i = 0; i <= 30; i++)
        {
            double a = (StartAngle + Sweep * i / 30) * Math.PI / 180;
            double r1 = radius + t / 2 + 3, r2 = r1 + (i % 5 == 0 ? 5 : 2.5);
            dc.DrawLine(tickPen,
                new Point(center.X + r1 * Math.Cos(a), center.Y + r1 * Math.Sin(a)),
                new Point(center.X + r2 * Math.Cos(a), center.Y + r2 * Math.Sin(a)));
        }

        // Trilho
        var track = new Pen(new SolidColorBrush(Color.FromRgb(0x24, 0x15, 0x40)), t) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        track.Freeze();
        dc.DrawGeometry(null, track, Arc(center, radius, StartAngle, Sweep));

        double max = Maximum <= 0 ? 100 : Maximum;
        double frac = Math.Clamp((double)GetValue(DisplayValueProperty) / max, 0, 1);
        if (frac <= 0.001) return;
        var arc = Arc(center, radius, StartAngle, Sweep * frac);

        var brush = new LinearGradientBrush(ColorFrom, ColorTo, new Point(0, 1), new Point(1, 0));
        brush.Freeze();

        // Brilho: camadas largas e translúcidas por baixo
        foreach (var (w, a) in new[] { (t + 14, (byte)18), (t + 8, (byte)34), (t + 3, (byte)60) })
        {
            var glow = new LinearGradientBrush(Color.FromArgb(a, ColorFrom.R, ColorFrom.G, ColorFrom.B),
                                               Color.FromArgb(a, ColorTo.R, ColorTo.G, ColorTo.B), new Point(0, 1), new Point(1, 0));
            var gp = new Pen(glow, w) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
            dc.DrawGeometry(null, gp, arc);
        }
        var pen = new Pen(brush, t) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        dc.DrawGeometry(null, pen, arc);

        // Ponto luminoso na ponta
        double endA = (StartAngle + Sweep * frac) * Math.PI / 180;
        var tip = new Point(center.X + radius * Math.Cos(endA), center.Y + radius * Math.Sin(endA));
        dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(90, 255, 255, 255)), null, tip, t * 0.55, t * 0.55);
        dc.DrawEllipse(Brushes.White, null, tip, t * 0.28, t * 0.28);
    }

    static Geometry Arc(Point c, double r, double startDeg, double sweepDeg)
    {
        sweepDeg = Math.Min(sweepDeg, 359.9);
        double a0 = startDeg * Math.PI / 180, a1 = (startDeg + sweepDeg) * Math.PI / 180;
        var p0 = new Point(c.X + r * Math.Cos(a0), c.Y + r * Math.Sin(a0));
        var p1 = new Point(c.X + r * Math.Cos(a1), c.Y + r * Math.Sin(a1));
        var g = new StreamGeometry();
        using (var ctx = g.Open())
        {
            ctx.BeginFigure(p0, false, false);
            ctx.ArcTo(p1, new Size(r, r), 0, sweepDeg > 180, SweepDirection.Clockwise, true, false);
        }
        g.Freeze();
        return g;
    }
}
