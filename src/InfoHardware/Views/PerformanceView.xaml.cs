using System.Windows;
using System.Windows.Controls;
using InfoHardware.Core;
using InfoHardware.Services;

namespace InfoHardware.Views;

public partial class PerformanceView : UserControl
{
    public PerformanceView() => InitializeComponent();

    void Toggle_Click(object sender, RoutedEventArgs e) => AppState.Instance.Recorder.Toggle();

    void OpenFolder_Click(object sender, RoutedEventArgs e) => Actions.OpenFolder(SessionRecorder.Folder);

    void ShowFile_Click(object sender, RoutedEventArgs e)
    {
        if (AppState.Instance.Recorder.LastFile is { } f) Actions.SelectFile(f);
    }
}
