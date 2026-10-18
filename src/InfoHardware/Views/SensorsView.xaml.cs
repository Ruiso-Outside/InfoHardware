using System.Windows;
using System.Windows.Controls;
using InfoHardware.Core;

namespace InfoHardware.Views;

public partial class SensorsView : UserControl
{
    public SensorsView() => InitializeComponent();

    void Reset_Click(object sender, RoutedEventArgs e) => AppState.Instance.Hardware.ResetMinMax();
}
