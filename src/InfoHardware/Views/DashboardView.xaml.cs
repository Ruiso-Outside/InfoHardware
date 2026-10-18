using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using InfoHardware.Core;

namespace InfoHardware.Views;

public partial class DashboardView : UserControl, INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    public DashboardView()
    {
        InitializeComponent();
        FpsChart.Series = [AppState.Instance.Live.Fps.Series];
        AppState.Instance.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(AppState.PawnIoInstalled))
                PropertyChanged?.Invoke(this, new(nameof(ShowPawnIoWarning)));
            if (e.PropertyName is nameof(AppState.FpsStatus))
                PropertyChanged?.Invoke(this, new(nameof(FpsInactive)));
        };
    }

    public bool ShowPawnIoWarning => !AppState.Instance.PawnIoInstalled;
    public bool FpsInactive => !AppState.Instance.FpsActive;

    void DismissExclusive_Click(object sender, RoutedEventArgs e) => AppState.Instance.DismissExclusiveWarning();

    void InstallPawnIo_Click(object sender, RoutedEventArgs e) => Actions.InstallPawnIo();
}
