using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using InfoHardware.Core;

namespace InfoHardware.Views;

public partial class OverlaySettingsView : UserControl
{
    public OverlaySettingsView()
    {
        InitializeComponent();
        AppState.Instance.Settings.PropertyChanged += OnSettingsChanged;
        Loaded += (_, _) => PlacePreview();
    }

    void OnSettingsChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Services.Settings.OverlayPosition)) PlacePreview();
    }

    void Dismiss_Click(object sender, RoutedEventArgs e) => AppState.Instance.DismissExclusiveWarning();

    /// <summary>Posiciona a prévia no mesmo canto escolhido para o overlay real.</summary>
    void PlacePreview()
    {
        var p = AppState.Instance.Settings.OverlayPosition;
        Preview.HorizontalAlignment = p.EndsWith("Right") ? HorizontalAlignment.Right : p.EndsWith("Center") ? HorizontalAlignment.Center : HorizontalAlignment.Left;
        Preview.VerticalAlignment = p.StartsWith("Bottom") ? VerticalAlignment.Bottom : VerticalAlignment.Top;
    }
}
