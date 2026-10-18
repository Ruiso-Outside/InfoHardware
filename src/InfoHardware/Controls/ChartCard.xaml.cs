using System.Windows;
using System.Windows.Controls;
using InfoHardware.Core;

namespace InfoHardware.Controls;

public partial class ChartCard : UserControl
{
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(nameof(Title), typeof(string), typeof(ChartCard));
    public static readonly DependencyProperty PrimaryProperty = DependencyProperty.Register(nameof(Primary), typeof(Metric), typeof(ChartCard), new PropertyMetadata(null, OnMetricChanged));
    public static readonly DependencyProperty SecondaryProperty = DependencyProperty.Register(nameof(Secondary), typeof(Metric), typeof(ChartCard), new PropertyMetadata(null, OnMetricChanged));
    public static readonly DependencyProperty MaximumProperty = DependencyProperty.Register(nameof(Maximum), typeof(double), typeof(ChartCard), new PropertyMetadata(double.NaN));

    public string? Title { get => (string?)GetValue(TitleProperty); set => SetValue(TitleProperty, value); }
    public Metric? Primary { get => (Metric?)GetValue(PrimaryProperty); set => SetValue(PrimaryProperty, value); }
    public Metric? Secondary { get => (Metric?)GetValue(SecondaryProperty); set => SetValue(SecondaryProperty, value); }
    public double Maximum { get => (double)GetValue(MaximumProperty); set => SetValue(MaximumProperty, value); }

    public ChartCard()
    {
        InitializeComponent();
        SecondaryPanel.Visibility = Visibility.Collapsed;
    }

    static void OnMetricChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var card = (ChartCard)d;
        var list = new List<SeriesBuffer>();
        if (card.Primary != null) list.Add(card.Primary.Series);
        if (card.Secondary != null) list.Add(card.Secondary.Series);
        card.Chart.Series = list;
        card.SecondaryPanel.Visibility = card.Secondary != null ? Visibility.Visible : Visibility.Collapsed;
        // Métricas com formatador próprio (ex.: MB/s) usam o mesmo formato na escala.
        card.Chart.ScaleFormatter = card.Primary is { HasCustomFormatter: true } p ? p.FormatValue : null;
    }
}
